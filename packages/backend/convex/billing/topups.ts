import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

import { internalMutation, mutation } from "../_generated/server";
import { findOrganizationForIdentity } from "../organizations/helpers";
import { PAYMENT_INTENT_EXPIRY_MS } from "../payment_intents/helpers";
import { recordMetric } from "../telemetry_outbox/helpers";
import { topupAvailability } from "./availability";
import { currentBillingNetwork } from "./config";
import { createBillingException } from "./exceptions";
import { getOrCreateBalance, insertLedgerEntry, moveBalance } from "./helpers";
import { notifyOrganization } from "./notifications";
import { activeOffer } from "./offers";

function normalizedHash(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) throw new Error("Transaction hash is required");
  return normalized;
}

export const create = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const organization = await findOrganizationForIdentity(ctx, identity.tokenIdentifier);
    if (!organization) throw new Error("Organization not found");
    const policy = await ctx.db
      .query("billingPolicies")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .unique();
    const availability = topupAvailability(policy);
    if (!availability.enabled) throw new Error(availability.reason);
    const network = currentBillingNetwork();
    const offer = await activeOffer(ctx, Date.now(), network);
    if (!offer) throw new Error("No active billing offer");
    if (offer.network !== network) {
      throw new Error("Active billing offer does not match the configured Stellar network");
    }
    if (network === "public") {
      const settings = await ctx.db
        .query("organizationBillingSettings")
        .withIndex("by_organization_id", (q) => q.eq("organizationId", organization._id))
        .unique();
      if (
        organization.verificationStatus !== "verified" ||
        !settings?.enforcementEnabled ||
        !settings.cohortStage ||
        !settings.graceUntil ||
        settings.activationState === "paused"
      ) {
        throw new Error("Mainnet top-ups are limited to enabled cohort organizations");
      }
    }
    const project = (
      await ctx.db
        .query("projects")
        .withIndex("by_organization_id", (q) => q.eq("organizationId", organization._id))
        .order("asc")
        .take(1)
    )[0];
    if (!project) throw new Error("Organization has no project");

    const now = Date.now();
    const topupId = await ctx.db.insert("billingTopups", {
      organizationId: organization._id,
      projectId: project._id,
      offerId: offer._id,
      sku: offer.sku,
      offerVersion: offer.version,
      creditQuantity: offer.creditQuantity,
      priceAmount: offer.priceAmount,
      asset: offer.asset,
      network: offer.network,
      treasuryAddress: offer.treasuryAddress,
      refundPolicy: offer.refundPolicy,
      status: "created",
      payerAddress: organization.ownerAddress,
      createdAt: now,
      updatedAt: now,
    });
    const paymentIntentId = await ctx.db.insert("paymentIntents", {
      projectId: project._id,
      billingTopupId: topupId,
      network: offer.network,
      intentType: "billing_topup",
      amount: offer.priceAmount,
      asset: offer.asset,
      receiverAddress: offer.treasuryAddress,
      payerAddress: organization.ownerAddress,
      merchantName: "Velo credit top-up",
      description: `${offer.creditQuantity.toString()} Velo checkout credits`,
      status: "created",
      anchor: "inhouse",
      successUrl: `/billing?topup=${topupId}`,
      cancelUrl: `/billing?topup=${topupId}`,
      expiresAt: now + PAYMENT_INTENT_EXPIRY_MS,
      stageTimestamps: { created: now },
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(topupId, { paymentIntentId });
    return { topupId, paymentIntentId };
  },
});

export async function settleTopup(
  ctx: MutationCtx,
  args: {
    intent: Doc<"paymentIntents">;
    transactionHash: string;
    verifiedNetwork: "testnet" | "public";
    verifiedPayment: {
      source: string;
      destination: string;
      amount: string;
      asset: string;
    };
    now: number;
  },
) {
  if (!args.intent.billingTopupId) throw new Error("Billing top-up reference is missing");
  const topup = await ctx.db.get(args.intent.billingTopupId);
  if (!topup || topup.paymentIntentId !== args.intent._id) {
    throw new Error("Billing top-up linkage is invalid");
  }
  if (topup.status === "settled" && topup.treasuryReceiptId) {
    return { applied: false as const, receiptId: topup.treasuryReceiptId };
  }
  const transactionHash = normalizedHash(args.transactionHash);
  const claimedReceipt = await ctx.db
    .query("treasuryReceipts")
    .withIndex("by_transaction_hash", (q) => q.eq("transactionHash", transactionHash))
    .unique();
  if (claimedReceipt) {
    if (claimedReceipt.topupId === topup._id) {
      return { applied: false as const, receiptId: claimedReceipt._id };
    }
    throw new Error("Treasury transaction is already assigned to another top-up");
  }

  const receiptId = await ctx.db.insert("treasuryReceipts", {
    organizationId: topup.organizationId,
    topupId: topup._id,
    paymentIntentId: args.intent._id,
    offerId: topup.offerId,
    transactionHash,
    sourceAddress: args.verifiedPayment.source.trim().toUpperCase(),
    destinationAddress: args.verifiedPayment.destination.trim().toUpperCase(),
    amount: args.verifiedPayment.amount,
    asset: args.verifiedPayment.asset.trim().toUpperCase(),
    network: args.verifiedNetwork,
    sku: topup.sku,
    offerVersion: topup.offerVersion,
    creditQuantity: topup.creditQuantity,
    priceAmount: topup.priceAmount,
    refundPolicy: topup.refundPolicy,
    verifiedAt: args.now,
  });
  const ledger = await insertLedgerEntry(ctx, {
    organizationId: topup.organizationId,
    book: "commercial",
    creditClass: "paid",
    entryType: "paid_grant",
    amount: topup.creditQuantity,
    idempotencyKey: `topup:settle:${topup._id}`,
    topupReference: topup._id,
    treasuryReceiptReference: receiptId,
    actor: "system:treasury_verifier",
    reason: "verified_test_treasury_settlement",
    network: topup.network,
    occurredAt: args.now,
  });
  if (!ledger.applied) throw new Error("Top-up grant already exists without a settled receipt");
  await ctx.db.insert("creditLots", {
    organizationId: topup.organizationId,
    book: "commercial",
    creditClass: "paid",
    sourceLedgerEntryId: ledger.entry._id,
    granted: topup.creditQuantity,
    available: topup.creditQuantity,
    reserved: 0n,
    consumed: 0n,
    expired: 0n,
    createdAt: args.now,
    updatedAt: args.now,
  });
  const balance = await getOrCreateBalance(ctx, topup.organizationId, "commercial", args.now);
  await moveBalance(ctx, balance, "paid", { available: topup.creditQuantity }, args.now);
  await ctx.db.patch(topup._id, {
    status: "settled",
    transactionHash,
    treasuryReceiptId: receiptId,
    settledAt: args.now,
    updatedAt: args.now,
  });
  await notifyOrganization(ctx, {
    organizationId: topup.organizationId,
    notificationType: "topup_success",
    dedupeKey: `topup-success:${topup._id}`,
    title: "Credit top-up complete",
    message: `${topup.creditQuantity.toString()} paid credits are now available.`,
    topupId: topup._id,
    paymentIntentId: args.intent._id,
  });
  await recordMetric(
    ctx,
    "velo_billing_topup_settlement_total",
    "topup_settlement",
    "mutation",
    "success",
    1,
  );
  return { applied: true as const, receiptId };
}

export async function markTopupTerminal(
  ctx: MutationCtx,
  intent: Doc<"paymentIntents">,
  status: "pending" | "failed" | "cancelled" | "expired",
) {
  if (!intent.billingTopupId) return;
  const topup = await ctx.db.get(intent.billingTopupId);
  if (!topup || topup.status === "settled") return;
  const mappedStatus = status === "pending" ? "pending" : status;
  await ctx.db.patch(topup._id, { status: mappedStatus, updatedAt: Date.now() });
  if (status !== "pending") {
    await notifyOrganization(ctx, {
      organizationId: topup.organizationId,
      notificationType: "topup_failure",
      dedupeKey: `topup-${status}:${topup._id}`,
      title: "Credit top-up not completed",
      message: `The top-up ended with status ${status}. No credits were granted.`,
      topupId: topup._id,
      paymentIntentId: intent._id,
    });
  }
}

export async function recordTopupException(
  ctx: MutationCtx,
  args: {
    intent: Doc<"paymentIntents">;
    exceptionType: "topup_mismatch" | "reused_transaction" | "verification_ambiguous";
    reason: string;
    transactionHash?: string;
  },
) {
  if (!args.intent.billingTopupId) return null;
  const topup = await ctx.db.get(args.intent.billingTopupId);
  if (!topup) return null;
  const exceptionId = await createBillingException(ctx, {
    organizationId: topup.organizationId,
    exceptionType: args.exceptionType,
    dedupeKey: `topup-verification:${topup._id}:${args.reason}:${args.transactionHash ?? "none"}`,
    summary: args.reason,
    evidence: {
      topupId: topup._id,
      paymentIntentId: args.intent._id,
      transactionHash: args.transactionHash,
    },
    paymentIntentId: args.intent._id,
    topupId: topup._id,
  });
  await ctx.db.patch(topup._id, { status: "exception", updatedAt: Date.now() });
  return exceptionId;
}

export const recordVerificationException = internalMutation({
  args: {
    paymentIntentId: v.id("paymentIntents"),
    reason: v.string(),
    transactionHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.paymentIntentId);
    if (!intent || intent.intentType !== "billing_topup") return null;
    return await recordTopupException(ctx, {
      intent,
      exceptionType: "topup_mismatch",
      reason: args.reason,
      transactionHash: args.transactionHash,
    });
  },
});
