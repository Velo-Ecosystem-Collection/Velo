import { v } from "convex/values";

import { internalMutation } from "../_generated/server";
import { consumeCommercialReservation, releaseCommercialReservation } from "../billing/commercial";
import { scheduleShadowEvaluation } from "../billing/shadow";

export const create = internalMutation({
  args: {
    projectId: v.id("projects"),
    paymentIntentId: v.optional(v.id("paymentIntents")),
    provider: v.literal("pdax"),
    status: v.union(
      v.literal("QUOTE_PENDING"),
      v.literal("QUOTE_FIRM"),
      v.literal("TRADE_EXECUTED"),
      v.literal("PAYOUT_PENDING"),
      v.literal("PAYOUT_SUCCEEDED"),
      v.literal("PAYOUT_FAILED"),
    ),
    idempotencyId: v.string(),
    quoteId: v.optional(v.string()),
    orderId: v.optional(v.number()),
    withdrawalId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("settlementTransactions")
      .withIndex("by_project_and_idempotency", (q) =>
        q.eq("projectId", args.projectId).eq("idempotencyId", args.idempotencyId),
      )
      .unique();

    if (existing) {
      return existing._id;
    }

    const now = Date.now();
    return await ctx.db.insert("settlementTransactions", {
      projectId: args.projectId,
      paymentIntentId: args.paymentIntentId,
      provider: args.provider,
      status: args.status,
      idempotencyId: args.idempotencyId,
      quoteId: args.quoteId,
      orderId: args.orderId,
      withdrawalId: args.withdrawalId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateStatus = internalMutation({
  args: {
    projectId: v.optional(v.id("projects")),
    idempotencyId: v.string(),
    status: v.union(
      v.literal("QUOTE_PENDING"),
      v.literal("QUOTE_FIRM"),
      v.literal("TRADE_EXECUTED"),
      v.literal("PAYOUT_PENDING"),
      v.literal("PAYOUT_SUCCEEDED"),
      v.literal("PAYOUT_FAILED"),
    ),
    orderId: v.optional(v.number()),
    withdrawalId: v.optional(v.string()),
    tradeDetails: v.optional(
      v.object({
        orderId: v.number(),
        price: v.number(),
        amount: v.number(),
        quantity: v.number(),
        status: v.string(),
      }),
    ),
    withdrawalDetails: v.optional(
      v.object({
        referenceNumber: v.optional(v.string()),
        amount: v.number(),
        fee: v.number(),
        status: v.string(),
        bankCode: v.string(),
        accountName: v.string(),
        accountNumber: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existing = args.projectId
      ? await ctx.db
          .query("settlementTransactions")
          .withIndex("by_project_and_idempotency", (q) =>
            q.eq("projectId", args.projectId!).eq("idempotencyId", args.idempotencyId),
          )
          .unique()
      : await ctx.db
          .query("settlementTransactions")
          .withIndex("by_idempotency", (q) => q.eq("idempotencyId", args.idempotencyId))
          .unique();

    if (!existing) {
      throw new Error(`Settlement transaction not found: ${args.idempotencyId}`);
    }

    const terminal = new Set(["PAYOUT_SUCCEEDED", "PAYOUT_FAILED"]);
    if (terminal.has(existing.status) && args.status !== existing.status) {
      throw new Error(
        `Invalid terminal settlement transition: ${existing.status} -> ${args.status}`,
      );
    }
    if (
      (existing.status === "PAYOUT_SUCCEEDED" || existing.status === "PAYOUT_FAILED") &&
      args.status === "PAYOUT_PENDING"
    ) {
      throw new Error(`Stale settlement transition rejected: ${existing.status} -> ${args.status}`);
    }

    const patchPayload: Record<string, unknown> = {
      status: args.status,
      updatedAt: Date.now(),
    };

    if (args.orderId !== undefined) patchPayload.orderId = args.orderId;
    if (args.withdrawalId !== undefined) patchPayload.withdrawalId = args.withdrawalId;
    if (args.tradeDetails !== undefined) patchPayload.tradeDetails = args.tradeDetails;
    if (args.withdrawalDetails !== undefined)
      patchPayload.withdrawalDetails = args.withdrawalDetails;

    await ctx.db.patch(existing._id, patchPayload);
    if (
      existing.paymentIntentId &&
      (args.status === "PAYOUT_SUCCEEDED" || args.status === "PAYOUT_FAILED")
    ) {
      if (args.status === "PAYOUT_SUCCEEDED") {
        await consumeCommercialReservation(ctx, existing.paymentIntentId, `pdax:${existing._id}`);
      } else {
        await releaseCommercialReservation(ctx, existing.paymentIntentId, "pdax_payout_failed");
      }
      await scheduleShadowEvaluation(ctx, {
        phase: args.status === "PAYOUT_SUCCEEDED" ? "would_consume" : "would_release",
        projectId: existing.projectId,
        paymentIntentId: existing.paymentIntentId,
        route: "pdax",
        idempotencyKey: `shadow:${args.status.toLowerCase()}:${existing._id}`,
        settlementTransactionId: existing._id,
      });
      const project = await ctx.db.get(existing.projectId);
      if (project?.organizationId) {
        const idempotencyKey = `pdax-economics:${existing._id}:${args.status}`;
        const priorEconomics = await ctx.db
          .query("billingPdaxEconomics")
          .withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", idempotencyKey))
          .unique();
        if (!priorEconomics) {
          const quote = existing.quoteId
            ? await ctx.db
                .query("settlementQuotes")
                .withIndex("by_quote_id", (q) => q.eq("quoteId", existing.quoteId!))
                .unique()
            : null;
          const withdrawal = args.withdrawalDetails ?? existing.withdrawalDetails;
          const actualCost = withdrawal?.fee ?? 0;
          const quotedCost = quote?.totalAmount ?? 0;
          const spread =
            (args.tradeDetails ?? existing.tradeDetails) && quote
              ? (args.tradeDetails ?? existing.tradeDetails)!.amount - quote.totalAmount
              : 0;
          await ctx.db.insert("billingPdaxEconomics", {
            organizationId: project.organizationId,
            paymentIntentId: existing.paymentIntentId,
            settlementTransactionId: existing._id,
            quotedCost: String(Math.max(0, quotedCost)),
            actualCost: String(Math.max(0, actualCost)),
            passThroughAmount: String(Math.max(0, actualCost)),
            spread: String(spread),
            failureCost: String(args.status === "PAYOUT_FAILED" ? Math.max(0, actualCost) : 0),
            subsidy: "0",
            currency: quote?.baseCurrency?.toUpperCase() ?? "PHP",
            idempotencyKey,
            recordedAt: Date.now(),
          });
        }
      }
    }
    return existing._id;
  },
});
