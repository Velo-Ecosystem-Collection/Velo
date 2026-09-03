import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import { internalMutation } from "../_generated/server";

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

    for (const row of rows) await ctx.db.delete(row._id);
    if (rows.length === limit) await ctx.scheduler.runAfter(0, expireLogsRef, { limit });

    return rows.length;
  },
});
