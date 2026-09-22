import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import { internalMutation } from "../_generated/server";
import { ensureGasAccounting, releaseGasOutstandingHold } from "./accounting";
import { findExecutionAttemptByRequestId } from "./execution";

const MAX_PAGE_SIZE = 100;
const expireLogsRef = makeFunctionReference<"mutation">("gas/retention:expireLogs");

function normalizePageSize(value: number | undefined): number {
  if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
    throw new Error("Gas log retention page size must be a positive safe integer");
  }

  return Math.min(value ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE);
}

function normalizeSweepCutoff(value: number | undefined, now: number): number {
  const cutoff = value ?? now;
  if (!Number.isSafeInteger(cutoff) || cutoff <= 0) {
    throw new Error("Gas log retention sweep cutoff must be a positive safe integer");
  }
  return cutoff;
}

export const expireLogs = internalMutation({
  args: {
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
    sweepCutoff: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = normalizePageSize(args.limit);
    const now = Date.now();
    const sweepCutoff = normalizeSweepCutoff(args.sweepCutoff, now);
    const page = await ctx.db
      .query("gasLogs")
      .withIndex("by_retention_expires_at", (q) => q.lte("retentionExpiresAt", sweepCutoff))
      .paginate({ numItems: limit, cursor: args.cursor ?? null });
    const rows = page.page;
    let deletedCount = 0;

    for (const row of rows) {
      if (
        row.lifecycle === "reserved" &&
        row.expiresAt !== undefined &&
        row.expiresAt <= now &&
        row.reservedStroops !== undefined
      ) {
        const executionAttempt = await findExecutionAttemptByRequestId(
          ctx,
          row.projectId,
          row.requestId,
        );
        if (executionAttempt === "ambiguous") continue;
        if (executionAttempt === null) {
          const policyMatches = await ctx.db
            .query("gasPolicies")
            .withIndex("by_project_id", (q) => q.eq("projectId", row.projectId))
            .take(2);
          if (policyMatches.length > 1) continue;
          const policy = policyMatches[0];
          if (!policy) continue;
          const accounting = await ensureGasAccounting(ctx, policy, now, { persist: false });
          if (
            !accounting.ok ||
            !(await releaseGasOutstandingHold(ctx, accounting.snapshot, row.reservedStroops, now))
          ) {
            continue;
          }
        }
      }
      await ctx.db.delete(row._id);
      deletedCount += 1;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, expireLogsRef, {
        limit,
        cursor: page.continueCursor,
        sweepCutoff,
      });
    }

    return deletedCount;
  },
});
