import { v } from "convex/values";

import { mutation, query } from "../_generated/server";
import { requireBillingOperator } from "./access";

export const recordSupport = mutation({
  args: {
    organizationId: v.optional(v.id("organizations")),
    recordType: v.union(v.literal("dispute"), v.literal("support")),
    supportMinutes: v.number(),
    notes: v.string(),
    evidenceReference: v.string(),
  },
  handler: async (ctx, args) => {
    const operator = await requireBillingOperator(ctx);
    if (!Number.isFinite(args.supportMinutes) || args.supportMinutes < 0) {
      throw new Error("Support minutes must be non-negative");
    }
    const notes = args.notes.trim();
    const evidenceReference = args.evidenceReference.trim();
    if (!notes || !evidenceReference) throw new Error("Support notes and evidence are required");
    return await ctx.db.insert("billingSupportRecords", {
      ...args,
      notes,
      evidenceReference,
      recordedBy: operator.walletAddress,
      recordedAt: Date.now(),
    });
  },
});

export const get = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, args) => {
    await requireBillingOperator(ctx);
    if (args.to <= args.from) throw new Error("Scorecard end must follow start");
    const [settings, ledgerRows, topupRows, exceptionRows, supportRows, reportRows] =
      await Promise.all([
        ctx.db.query("organizationBillingSettings").take(1_000),
        ctx.db.query("billingLedgerEntries").take(10_000),
        ctx.db.query("billingTopups").take(5_000),
        ctx.db.query("billingExceptions").take(5_000),
        ctx.db.query("billingSupportRecords").take(5_000),
        ctx.db.query("billingFinanceReports").order("desc").take(100),
      ]);
    const ledger = ledgerRows.filter(
      (row) => row.occurredAt >= args.from && row.occurredAt < args.to && row.book === "commercial",
    );
    const topups = topupRows.filter(
      (row) => row.createdAt >= args.from && row.createdAt < args.to && row.status === "settled",
    );
    const consumes = ledger.filter((row) => row.entryType === "consume");
    const promoOrganizations = new Set(
      ledger.filter((row) => row.entryType === "promo_grant").map((row) => row.organizationId),
    );
    const paidOrganizations = new Set(
      ledger.filter((row) => row.entryType === "paid_grant").map((row) => row.organizationId),
    );
    const topupsPerOrganization = new Map<string, number>();
    for (const topup of topups) {
      topupsPerOrganization.set(
        topup.organizationId,
        (topupsPerOrganization.get(topup.organizationId) ?? 0) + 1,
      );
    }
    const exceptions = exceptionRows.filter(
      (row) => row.createdAt >= args.from && row.createdAt < args.to,
    );
    const resolvedDurations = exceptions
      .filter((row) => row.resolvedAt !== undefined)
      .map((row) => row.resolvedAt! - row.createdAt);
    const support = supportRows.filter(
      (row) => row.recordedAt >= args.from && row.recordedAt < args.to,
    );
    const report = reportRows.find(
      (row) => row.periodStart === args.from && row.periodEnd === args.to,
    );
    return {
      organizationsActivated: settings.filter(
        (row) =>
          row.enforcementEnabledAt &&
          row.enforcementEnabledAt >= args.from &&
          row.enforcementEnabledAt < args.to,
      ).length,
      trialOrganizations: promoOrganizations.size,
      trialToPaidOrganizations: [...promoOrganizations].filter((id) => paidOrganizations.has(id))
        .length,
      topups: topups.length,
      repeatTopupOrganizations: [...topupsPerOrganization.values()].filter((count) => count > 1)
        .length,
      successfulPayments: consumes.length,
      paidCreditsConsumed: consumes
        .filter((row) => row.creditClass === "paid")
        .reduce((sum, row) => sum + row.amount, 0n),
      promotionalCreditsConsumed: consumes
        .filter((row) => row.creditClass === "promotional")
        .reduce((sum, row) => sum + row.amount, 0n),
      averageUsdcTransactionValueUsd:
        report && report.successfulPayments > report.nonUsdcSuccessesExcluded
          ? String(
              Number(report.usdcTransactionValueUsd) /
                (report.successfulPayments - report.nonUsdcSuccessesExcluded),
            )
          : null,
      effectiveVeloFeeBps: report?.effectiveVeloFeeBps ?? null,
      netRevenueUsd: report?.netRevenueUsd ?? null,
      infrastructureCostPerSuccessUsd: report?.infrastructureCostPerSuccessUsd ?? null,
      fullyLoadedCostPerSuccessUsd: report?.fullyLoadedCostPerSuccessUsd ?? null,
      infrastructureMarginBps: report?.infrastructureMarginBps ?? null,
      fullyLoadedMarginBps: report?.fullyLoadedMarginBps ?? null,
      pdaxActualCostUsd: report?.pdaxActualCostUsd ?? null,
      exceptionCount: exceptions.length,
      openExceptionCount: exceptions.filter((row) => row.status === "open").length,
      averageResolutionMs:
        resolvedDurations.length > 0
          ? resolvedDurations.reduce((sum, duration) => sum + duration, 0) /
            resolvedDurations.length
          : null,
      disputes: support.filter((row) => row.recordType === "dispute").length,
      supportMinutes: support.reduce((sum, row) => sum + row.supportMinutes, 0),
    };
  },
});
