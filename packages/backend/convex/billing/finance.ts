import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

import { internalMutation, mutation, query } from "../_generated/server";
import { requireBillingOperator } from "./access";

const SCALE = 1_000_000n;

function parseUsd(value: string) {
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(normalized)) {
    throw new Error("USD amounts must be non-negative decimals with at most 6 places");
  }
  const [whole = "0", fraction = ""] = normalized.split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, "0"));
}

function parseSignedUsd(value: string) {
  const normalized = value.trim();
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(normalized)) {
    throw new Error("USD amounts must be decimals with at most 6 places");
  }
  const negative = normalized.startsWith("-");
  const amount = parseUsd(negative ? normalized.slice(1) : normalized);
  return negative ? -amount : amount;
}

function formatUsd(value: bigint) {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const whole = absolute / SCALE;
  const fraction = (absolute % SCALE).toString().padStart(6, "0").replace(/0+$/, "");
  return `${sign}${whole.toString()}${fraction ? `.${fraction}` : ""}`;
}

function requiredText(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

export const createCostPeriod = mutation({
  args: {
    periodStart: v.number(),
    periodEnd: v.number(),
    infrastructureCostUsd: v.string(),
    fullyLoadedCostUsd: v.string(),
    evidenceReference: v.string(),
  },
  handler: async (ctx, args) => {
    const operator = await requireBillingOperator(ctx);
    if (args.periodEnd <= args.periodStart) throw new Error("Cost period end must follow start");
    const infrastructure = parseUsd(args.infrastructureCostUsd);
    const fullyLoaded = parseUsd(args.fullyLoadedCostUsd);
    if (fullyLoaded < infrastructure) {
      throw new Error("Fully loaded cost must be at least infrastructure cost");
    }
    const prior = await ctx.db
      .query("billingCostPeriods")
      .withIndex("by_period_start_and_revision", (q) => q.eq("periodStart", args.periodStart))
      .order("desc")
      .take(1);
    return await ctx.db.insert("billingCostPeriods", {
      periodStart: args.periodStart,
      periodEnd: args.periodEnd,
      revision: (prior[0]?.revision ?? 0) + 1,
      infrastructureCostUsd: formatUsd(infrastructure),
      fullyLoadedCostUsd: formatUsd(fullyLoaded),
      evidenceReference: requiredText(args.evidenceReference, "Cost evidence"),
      status: "draft",
      createdBy: operator.walletAddress,
      createdAt: Date.now(),
    });
  },
});

export const approveCostPeriod = mutation({
  args: { periodId: v.id("billingCostPeriods"), note: v.string() },
  handler: async (ctx, args) => {
    const operator = await requireBillingOperator(ctx);
    const period = await ctx.db.get(args.periodId);
    if (!period) throw new Error("Cost period not found");
    if (period.status === "approved") return period._id;
    await ctx.db.patch(period._id, {
      status: "approved",
      approvedBy: operator.walletAddress,
      approvedAt: Date.now(),
      approvalNote: requiredText(args.note, "Approval note"),
    });
    return period._id;
  },
});

export const recordRefund = mutation({
  args: {
    topupId: v.id("billingTopups"),
    amountUsd: v.string(),
    accountingTreatment: v.union(
      v.literal("deferred_reduction"),
      v.literal("revenue_reversal"),
      v.literal("expense"),
    ),
    reason: v.string(),
    evidenceReference: v.string(),
  },
  handler: async (ctx, args) => {
    const operator = await requireBillingOperator(ctx);
    const topup = await ctx.db.get(args.topupId);
    if (topup?.status !== "settled" || !topup.treasuryReceiptId) {
      throw new Error("Refund requires a settled top-up receipt");
    }
    const receipt = await ctx.db.get(topup.treasuryReceiptId);
    if (!receipt || receipt.topupId !== topup._id) {
      throw new Error("Refund receipt linkage is invalid");
    }
    const amount = parseUsd(args.amountUsd);
    if (amount <= 0n) throw new Error("Refund amount must be positive");
    const existingRefunds = await ctx.db
      .query("billingRefunds")
      .withIndex("by_topup_id", (q) => q.eq("topupId", topup._id))
      .take(1_000);
    const alreadyRefunded = existingRefunds.reduce(
      (sum, refund) => sum + parseUsd(refund.amountUsd),
      0n,
    );
    if (alreadyRefunded + amount > parseUsd(topup.priceAmount)) {
      throw new Error("Cumulative refunds cannot exceed the settled top-up amount");
    }
    return await ctx.db.insert("billingRefunds", {
      organizationId: topup.organizationId,
      topupId: topup._id,
      treasuryReceiptId: topup.treasuryReceiptId,
      amountUsd: formatUsd(amount),
      accountingTreatment: args.accountingTreatment,
      reason: requiredText(args.reason, "Refund reason"),
      evidenceReference: requiredText(args.evidenceReference, "Refund evidence"),
      recordedBy: operator.walletAddress,
      recordedAt: Date.now(),
    });
  },
});

export const recordPdaxEconomics = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    paymentIntentId: v.id("paymentIntents"),
    settlementTransactionId: v.id("settlementTransactions"),
    quotedCost: v.string(),
    actualCost: v.string(),
    passThroughAmount: v.string(),
    spread: v.string(),
    failureCost: v.string(),
    subsidy: v.string(),
    currency: v.string(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("billingPdaxEconomics")
      .withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", args.idempotencyKey))
      .unique();
    if (existing) return existing._id;
    for (const value of [
      args.quotedCost,
      args.actualCost,
      args.passThroughAmount,
      args.failureCost,
      args.subsidy,
    ]) {
      parseUsd(value);
    }
    parseSignedUsd(args.spread);
    return await ctx.db.insert("billingPdaxEconomics", {
      ...args,
      currency: requiredText(args.currency, "PDAX currency").toUpperCase(),
      idempotencyKey: requiredText(args.idempotencyKey, "PDAX economics idempotency key"),
      recordedAt: Date.now(),
    });
  },
});

async function paidCreditUnitValue(ctx: MutationCtx, creditLotId: Id<"creditLots"> | undefined) {
  if (!creditLotId) return 0n;
  const lot = await ctx.db.get(creditLotId);
  if (!lot) return 0n;
  const grant = await ctx.db.get(lot.sourceLedgerEntryId);
  if (!grant?.topupReference) return 0n;
  const topup = await ctx.db.get(grant.topupReference as Id<"billingTopups">);
  if (!topup) return 0n;
  return parseUsd(topup.priceAmount) / topup.creditQuantity;
}

export const generateReport = mutation({
  args: { periodId: v.id("billingCostPeriods") },
  handler: async (ctx, args) => {
    const operator = await requireBillingOperator(ctx);
    const period = await ctx.db.get(args.periodId);
    if (!period) throw new Error("Cost period not found");
    if (period.status !== "approved") throw new Error("Cost period must be approved");

    const receipts = (await ctx.db.query("treasuryReceipts").take(5_000)).filter(
      (row) =>
        row.verifiedAt >= period.periodStart &&
        row.verifiedAt < period.periodEnd &&
        row.asset.startsWith("USDC:"),
    );
    const ledger = (await ctx.db.query("billingLedgerEntries").take(10_000)).filter(
      (row) =>
        row.book === "commercial" &&
        row.occurredAt >= period.periodStart &&
        row.occurredAt < period.periodEnd,
    );
    const refunds = (await ctx.db.query("billingRefunds").take(5_000)).filter(
      (row) => row.recordedAt >= period.periodStart && row.recordedAt < period.periodEnd,
    );
    const pdax = (await ctx.db.query("billingPdaxEconomics").take(5_000)).filter(
      (row) => row.recordedAt >= period.periodStart && row.recordedAt < period.periodEnd,
    );

    const cashCollected = receipts.reduce((sum, row) => sum + parseUsd(row.priceAmount), 0n);
    let recognizedRevenue = 0n;
    let promotionalCreditsConsumed = 0n;
    let creditAdjustments = 0n;
    let usdcTransactionValue = 0n;
    let nonUsdcSuccessesExcluded = 0;
    const consumes = ledger.filter((row) => row.entryType === "consume");
    for (const entry of consumes) {
      if (entry.creditClass === "paid") {
        recognizedRevenue += (await paidCreditUnitValue(ctx, entry.creditLotId)) * entry.amount;
      } else {
        promotionalCreditsConsumed += entry.amount;
      }
      const intent = entry.paymentIntentId ? await ctx.db.get(entry.paymentIntentId) : null;
      if (intent?.asset.startsWith("USDC:")) usdcTransactionValue += parseUsd(intent.amount);
      else nonUsdcSuccessesExcluded++;
    }
    for (const entry of ledger) {
      if (entry.entryType === "adjustment" || entry.entryType === "refund_adjustment") {
        creditAdjustments += entry.amount;
      }
    }
    const refundTotal = refunds.reduce((sum, row) => sum + parseUsd(row.amountUsd), 0n);
    const revenueReversals = refunds
      .filter((row) => row.accountingTreatment === "revenue_reversal")
      .reduce((sum, row) => sum + parseUsd(row.amountUsd), 0n);
    const pdaxPassThrough = pdax
      .filter((row) => row.currency === "USD" || row.currency === "USDC")
      .reduce((sum, row) => sum + parseUsd(row.passThroughAmount), 0n);
    const pdaxActualCost = pdax
      .filter((row) => row.currency === "USD" || row.currency === "USDC")
      .reduce((sum, row) => sum + parseUsd(row.actualCost), 0n);
    const netRevenue = recognizedRevenue + pdaxPassThrough - revenueReversals;
    const infrastructureCost = parseUsd(period.infrastructureCostUsd);
    const fullyLoadedCost = parseUsd(period.fullyLoadedCostUsd);
    const infrastructureContribution = netRevenue - pdaxActualCost - infrastructureCost;
    const fullyLoadedContribution = netRevenue - pdaxActualCost - fullyLoadedCost;
    const successfulPayments = consumes.length;

    const paidLots = (await ctx.db.query("creditLots").take(10_000)).filter(
      (lot) => lot.book === "commercial" && lot.creditClass === "paid",
    );
    let unusedPaidValue = 0n;
    for (const lot of paidLots) {
      const unit = await paidCreditUnitValue(ctx, lot._id);
      unusedPaidValue += unit * (lot.available + lot.reserved);
    }

    return await ctx.db.insert("billingFinanceReports", {
      costPeriodId: period._id,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      cashCollectedUsd: formatUsd(cashCollected),
      unusedPaidCreditValueUsd: formatUsd(unusedPaidValue),
      recognizedRevenueUsd: formatUsd(recognizedRevenue),
      promotionalCreditsConsumed,
      creditAdjustments,
      refundsAndAdjustmentsUsd: formatUsd(refundTotal),
      pdaxPassThroughRevenueUsd: formatUsd(pdaxPassThrough),
      pdaxActualCostUsd: formatUsd(pdaxActualCost),
      netRevenueUsd: formatUsd(netRevenue),
      infrastructureCostUsd: formatUsd(infrastructureCost),
      fullyLoadedCostUsd: formatUsd(fullyLoadedCost),
      ...(successfulPayments
        ? {
            infrastructureCostPerSuccessUsd: formatUsd(
              infrastructureCost / BigInt(successfulPayments),
            ),
            fullyLoadedCostPerSuccessUsd: formatUsd(fullyLoadedCost / BigInt(successfulPayments)),
          }
        : {}),
      infrastructureContributionUsd: formatUsd(infrastructureContribution),
      fullyLoadedContributionUsd: formatUsd(fullyLoadedContribution),
      ...(netRevenue
        ? {
            infrastructureMarginBps: Number((infrastructureContribution * 10_000n) / netRevenue),
            fullyLoadedMarginBps: Number((fullyLoadedContribution * 10_000n) / netRevenue),
          }
        : {}),
      successfulPayments,
      usdcTransactionValueUsd: formatUsd(usdcTransactionValue),
      nonUsdcSuccessesExcluded,
      ...(usdcTransactionValue
        ? { effectiveVeloFeeBps: Number((recognizedRevenue * 10_000n) / usdcTransactionValue) }
        : {}),
      generatedBy: operator.walletAddress,
      generatedAt: Date.now(),
    });
  },
});

export const listReports = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireBillingOperator(ctx);
    return await ctx.db
      .query("billingFinanceReports")
      .order("desc")
      .take(Math.min(100, Math.max(1, Math.floor(args.limit ?? 25))));
  },
});

export const listCostPeriods = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireBillingOperator(ctx);
    return await ctx.db
      .query("billingCostPeriods")
      .order("desc")
      .take(Math.min(100, Math.max(1, Math.floor(args.limit ?? 25))));
  },
});
