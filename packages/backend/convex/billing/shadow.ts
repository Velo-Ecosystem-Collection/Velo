import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

import { internalMutation } from "../_generated/server";
import { recordMetric } from "../telemetry_outbox/helpers";
import { BILLING_CALCULATION_VERSION, DEFAULT_BILLING_POLICY } from "./constants";

const evaluateRef = makeFunctionReference<"mutation">("billing/shadow:evaluate");
const reserveRef = makeFunctionReference<"mutation">("billing/mutations:reserve");
const consumeRef = makeFunctionReference<"mutation">("billing/mutations:consume");
const releaseRef = makeFunctionReference<"mutation">("billing/mutations:release");

type ShadowPhase = "would_reserve" | "would_consume" | "would_release";
type ShadowRoute = "stellar";

export async function scheduleShadowEvaluation(
  ctx: MutationCtx,
  args: {
    phase: ShadowPhase;
    projectId: Id<"projects">;
    paymentIntentId: Id<"paymentIntents">;
    route: ShadowRoute;
    idempotencyKey: string;
    transactionHash?: string;
    settlementTransactionId?: Id<"settlementTransactions">;
  },
) {
  await ctx.scheduler.runAfter(0, evaluateRef, args);
}

async function existingDecision(ctx: MutationCtx, idempotencyKey: string) {
  return await ctx.db
    .query("shadowBillingDecisions")
    .withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", idempotencyKey))
    .unique();
}

async function insertDecision(
  ctx: MutationCtx,
  args: {
    organizationId?: Id<"organizations">;
    projectId: Id<"projects">;
    paymentIntentId: Id<"paymentIntents">;
    reservationId?: Id<"creditReservations">;
    phase: ShadowPhase;
    outcome:
      | "applied"
      | "fee_exempt"
      | "insufficient_balance"
      | "unmatched_success"
      | "disabled"
      | "error";
    reason: string;
    route: ShadowRoute;
    network: "testnet" | "public";
    idempotencyKey: string;
    legacyCheckoutCredits?: number;
    correlationId?: string;
    transactionHash?: string;
    settlementTransactionId?: Id<"settlementTransactions">;
  },
) {
  const existing = await existingDecision(ctx, args.idempotencyKey);
  if (existing) return existing._id;
  return await ctx.db.insert("shadowBillingDecisions", {
    ...args,
    calculationVersion: BILLING_CALCULATION_VERSION,
    createdAt: Date.now(),
  });
}

export const evaluate = internalMutation({
  args: {
    phase: v.union(
      v.literal("would_reserve"),
      v.literal("would_consume"),
      v.literal("would_release"),
    ),
    projectId: v.id("projects"),
    paymentIntentId: v.id("paymentIntents"),
    route: v.union(v.literal("stellar"), v.literal("pdax")),
    idempotencyKey: v.string(),
    transactionHash: v.optional(v.string()),
    settlementTransactionId: v.optional(v.id("settlementTransactions")),
  },
  handler: async (ctx, args) => {
    if (await existingDecision(ctx, args.idempotencyKey)) return { applied: false };
    if (args.route === "pdax") {
      return { applied: false, outcome: "disabled" as const };
    }
    const [project, intent, policy] = await Promise.all([
      ctx.db.get(args.projectId),
      ctx.db.get(args.paymentIntentId),
      ctx.db
        .query("billingPolicies")
        .withIndex("by_key", (q) => q.eq("key", "global"))
        .unique(),
    ]);
    if (!project || !intent || intent.projectId !== project._id) {
      throw new Error("Shadow billing payment context not found");
    }
    const network = intent.network ?? "testnet";
    const common = {
      organizationId: project.organizationId,
      projectId: project._id,
      paymentIntentId: intent._id,
      phase: args.phase,
      route: args.route,
      network,
      idempotencyKey: args.idempotencyKey,
      legacyCheckoutCredits: project.checkoutCredits,
      correlationId: intent.correlationId,
      transactionHash: args.transactionHash,
      settlementTransactionId: args.settlementTransactionId,
    };

    if (intent.intentType === "billing_topup") {
      await insertDecision(ctx, {
        ...common,
        outcome: "fee_exempt",
        reason: "billing_topup_is_fee_exempt",
      });
      return { applied: false, outcome: "fee_exempt" as const };
    }

    if (network === "testnet") {
      await insertDecision(ctx, {
        ...common,
        outcome: "fee_exempt",
        reason: "testnet_is_free",
      });
      return { applied: false, outcome: "fee_exempt" as const };
    }

    const effectivePolicy = policy ?? {
      ...DEFAULT_BILLING_POLICY,
      _id: undefined,
      _creationTime: undefined,
      updatedBy: "system:default",
      updatedAt: 0,
    };
    const organizationSettings = project.organizationId
      ? await ctx.db
          .query("organizationBillingSettings")
          .withIndex("by_organization_id", (q) => q.eq("organizationId", project.organizationId!))
          .unique()
      : null;
    if (
      !project.organizationId ||
      effectivePolicy.billingKillSwitch ||
      !effectivePolicy.billingShadowMode ||
      !effectivePolicy.billingLedgerWrite ||
      organizationSettings?.shadowEnabled !== true
    ) {
      await insertDecision(ctx, {
        ...common,
        outcome: "disabled",
        reason: !project.organizationId ? "organization_not_migrated" : "shadow_policy_disabled",
      });
      return { applied: false, outcome: "disabled" as const };
    }

    try {
      if (args.phase === "would_reserve") {
        const result: {
          applied: boolean;
          reason?: "idempotency_replay" | "insufficient_balance";
          reservationId?: Id<"creditReservations">;
        } = await ctx.runMutation(reserveRef, {
          organizationId: project.organizationId,
          projectId: project._id,
          paymentIntentId: intent._id,
          book: "shadow",
          amount: 1n,
          idempotencyKey: `ledger:${args.idempotencyKey}`,
          expiresAt: Math.min(intent.expiresAt, Date.now() + effectivePolicy.reservationTtlMs),
          network,
          promoFirst: effectivePolicy.promoFirst,
          actor: "system:shadow_billing",
          reason: "would_reserve",
        });
        const outcome = result.applied
          ? "applied"
          : result.reason === "insufficient_balance"
            ? "insufficient_balance"
            : "applied";
        await insertDecision(ctx, {
          ...common,
          reservationId: result.reservationId,
          outcome,
          reason: result.reason ?? "shadow_reservation_recorded",
        });
        await recordMetric(
          ctx,
          result.applied
            ? "velo_billing_shadow_reservation_total"
            : "velo_billing_insufficient_balance_total",
          args.route,
          "mutation",
          result.applied ? "success" : "rejected",
        );
        const legacyWouldAllow = (project.checkoutCredits ?? 0) > 0;
        if (legacyWouldAllow !== result.applied) {
          await recordMetric(
            ctx,
            "velo_billing_legacy_divergence_total",
            args.route,
            "observation",
            "success",
          );
        }
        return { applied: result.applied, outcome };
      }

      const reservations = await ctx.db
        .query("creditReservations")
        .withIndex("by_payment_intent_id", (q) => q.eq("paymentIntentId", intent._id))
        .take(10);
      const reservation = reservations.find((candidate) => candidate.book === "shadow");
      if (!reservation) {
        const outcome = args.phase === "would_consume" ? "unmatched_success" : "disabled";
        await insertDecision(ctx, {
          ...common,
          outcome,
          reason:
            args.phase === "would_consume"
              ? "no_shadow_reservation"
              : "no_active_shadow_reservation",
        });
        if (args.phase === "would_consume") {
          await recordMetric(
            ctx,
            "velo_billing_unmatched_success_total",
            args.route,
            "observation",
            "error",
          );
        }
        return { applied: false, outcome };
      }

      const result: { applied: boolean } =
        args.phase === "would_consume"
          ? await ctx.runMutation(consumeRef, {
              reservationId: reservation._id,
              idempotencyKey: `ledger:${args.idempotencyKey}`,
              actor: "system:shadow_billing",
              reason: "verified_terminal_success",
            })
          : await ctx.runMutation(releaseRef, {
              reservationId: reservation._id,
              idempotencyKey: `ledger:${args.idempotencyKey}`,
              actor: "system:shadow_billing",
              reason: "terminal_non_success",
            });
      await insertDecision(ctx, {
        ...common,
        reservationId: reservation._id,
        outcome: "applied",
        reason: result.applied ? "shadow_transition_recorded" : "idempotency_replay",
      });
      await recordMetric(
        ctx,
        args.phase === "would_consume"
          ? "velo_billing_shadow_consumption_total"
          : "velo_billing_shadow_release_total",
        args.route,
        "mutation",
        "success",
      );
      return { applied: result.applied, outcome: "applied" as const };
    } catch (error) {
      await insertDecision(ctx, {
        ...common,
        outcome: "error",
        reason: error instanceof Error ? error.message.slice(0, 500) : "unknown_shadow_error",
      });
      return { applied: false, outcome: "error" as const };
    }
  },
});
