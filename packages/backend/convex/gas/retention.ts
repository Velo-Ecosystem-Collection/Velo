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

export const expireLogs = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = normalizePageSize(args.limit);
    const now = Date.now();
    const rows = await ctx.db
      .query("gasLogs")
      .withIndex("by_retention_expires_at", (q) => q.lte("retentionExpiresAt", now))
      .take(limit);

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
            !releaseGasOutstandingHold(ctx, accounting.snapshot, row.reservedStroops, now)
          ) {
            continue;
          }
        }
      }
      await ctx.db.delete(row._id);
    }
    if (rows.length === limit) await ctx.scheduler.runAfter(0, expireLogsRef, { limit });

    return rows.length;
  },
});
