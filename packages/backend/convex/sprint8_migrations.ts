import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import { internalMutation } from "./_generated/server";

const backfillRef = makeFunctionReference<"mutation">("sprint8_migrations:backfill");

// Additive payment-only backfill. Legacy provider rows are retained without creating operations.
export const backfill = internalMutation({
  args: {
    paymentCursor: v.optional(v.union(v.string(), v.null())),
    eventCursor: v.optional(v.union(v.string(), v.null())),
    payoutCursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const payments = await ctx.db
      .query("paymentIntents")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .paginate({ numItems: 100, cursor: args.paymentCursor ?? null });
    for (const intent of payments.page) {
      const existing = await ctx.db
        .query("paymentReconciliationJobs")
        .withIndex("by_payment_intent", (q) => q.eq("paymentIntentId", intent._id))
        .unique();
      if (!existing) {
        const now = Date.now();
        await ctx.db.insert("paymentReconciliationJobs", {
          paymentIntentId: intent._id,
          projectId: intent.projectId,
          ...(intent.txHash ? { txHash: intent.txHash } : {}),
          state: "pending",
          attemptCount: 0,
          nextAttemptAt: now,
          leaseGeneration: 0,
          expiresAt: now + 30 * 60 * 1_000,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    if (!payments.isDone) {
      await ctx.scheduler.runAfter(0, backfillRef, {
        paymentCursor: payments.continueCursor,
      });
    }
    return {
      paymentCount: payments.page.length,
      eventCount: 0,
      payoutCount: 0,
      done: payments.isDone,
    };
  },
});
