import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";

import { internalMutation } from "../_generated/server";
import { recordMetric } from "../telemetry_outbox/helpers";
import { createBillingException } from "./exceptions";

export const run = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(100, Math.max(1, Math.floor(args.limit ?? 25)));
    let discrepancies = 0;

    const settledTopups = await ctx.db
      .query("billingTopups")
      .withIndex("by_status_and_updated_at", (q) => q.eq("status", "settled"))
      .take(limit);
    for (const topup of settledTopups) {
      const receipt = await ctx.db
        .query("treasuryReceipts")
        .withIndex("by_topup_id", (q) => q.eq("topupId", topup._id))
        .unique();
      const grants = await ctx.db
        .query("billingLedgerEntries")
        .withIndex("by_organization_id_and_book", (q) =>
          q.eq("organizationId", topup.organizationId).eq("book", "commercial"),
        )
        .take(1_000);
      const grant = grants.find(
        (entry) => entry.entryType === "paid_grant" && entry.topupReference === topup._id,
      );
      if (!receipt || !grant || topup.treasuryReceiptId !== receipt?._id) {
        discrepancies++;
        await createBillingException(ctx, {
          organizationId: topup.organizationId,
          exceptionType: "receipt_mismatch",
          dedupeKey: `reconcile:topup:${topup._id}`,
          summary: "Settled top-up is missing its exact receipt or paid grant",
          evidence: {
            topupId: topup._id,
            receiptId: receipt?._id,
            linkedReceiptId: topup.treasuryReceiptId,
            grantId: grant?._id,
          },
          topupId: topup._id,
          paymentIntentId: topup.paymentIntentId,
          treasuryReceiptId: receipt?._id,
        });
      }
    }

    const receipts = await ctx.db.query("treasuryReceipts").order("desc").take(limit);
    for (const receipt of receipts) {
      const topup = await ctx.db.get(receipt.topupId);
      if (
        !topup ||
        topup.status !== "settled" ||
        topup.treasuryReceiptId !== receipt._id ||
        topup.paymentIntentId !== receipt.paymentIntentId
      ) {
        discrepancies++;
        await createBillingException(ctx, {
          organizationId: receipt.organizationId,
          exceptionType: "receipt_mismatch",
          dedupeKey: `reconcile:receipt:${receipt._id}`,
          summary: "Treasury receipt is not linked to one settled top-up",
          evidence: { receiptId: receipt._id, topupId: receipt.topupId },
          topupId: receipt.topupId,
          paymentIntentId: receipt.paymentIntentId,
          treasuryReceiptId: receipt._id,
        });
      }
    }

    const activeReservations = await ctx.db
      .query("creditReservations")
      .withIndex("by_status_and_expires_at", (q) => q.eq("status", "active"))
      .take(limit);
    for (const reservation of activeReservations) {
      if (!reservation.paymentIntentId) continue;
      const intent = await ctx.db.get(reservation.paymentIntentId);
      if (
        !intent ||
        intent.status === "paid" ||
        intent.status === "failed" ||
        intent.status === "cancelled"
      ) {
        discrepancies++;
        await createBillingException(ctx, {
          organizationId: reservation.organizationId,
          exceptionType: "reservation_mismatch",
          dedupeKey: `reconcile:reservation:${reservation._id}:${intent?.status ?? "missing"}`,
          summary: "Active reservation does not match its PaymentIntent state",
          evidence: { reservationId: reservation._id, intentStatus: intent?.status ?? "missing" },
          paymentIntentId: reservation.paymentIntentId,
          reservationId: reservation._id,
        });
      }
    }

    const consumedEntries = (
      await ctx.db
        .query("billingLedgerEntries")
        .order("desc")
        .take(limit * 4)
    )
      .filter((entry) => entry.book === "commercial" && entry.entryType === "consume")
      .slice(0, limit);
    for (const entry of consumedEntries) {
      const intent = entry.paymentIntentId ? await ctx.db.get(entry.paymentIntentId) : null;
      if (!intent || intent.status !== "paid") {
        discrepancies++;
        await createBillingException(ctx, {
          organizationId: entry.organizationId,
          exceptionType: "ledger_mismatch",
          severity: "high",
          dedupeKey: `reconcile:unmatched-consume:${entry._id}:${intent?.status ?? "missing"}`,
          summary: "Commercial consumption is not linked to one verified paid PaymentIntent",
          evidence: { ledgerEntryId: entry._id, paymentIntentStatus: intent?.status ?? "missing" },
          paymentIntentId: entry.paymentIntentId,
          reservationId: entry.reservationId,
        });
      }
    }

    const paidIntents = await ctx.db
      .query("paymentIntents")
      .withIndex("by_status", (q) => q.eq("status", "paid"))
      .order("desc")
      .take(limit);
    for (const intent of paidIntents) {
      if (intent.intentType === "billing_topup") continue;
      const reservations = await ctx.db
        .query("creditReservations")
        .withIndex("by_payment_intent_id", (q) => q.eq("paymentIntentId", intent._id))
        .take(10);
      const commercialReservation = reservations.find((row) => row.book === "commercial");
      if (!commercialReservation || commercialReservation.status === "consumed") continue;
      discrepancies++;
      await createBillingException(ctx, {
        organizationId: commercialReservation.organizationId,
        exceptionType: "reservation_mismatch",
        severity: "critical",
        dedupeKey: `reconcile:unmatched-success:${intent._id}:${commercialReservation.status}`,
        summary: "Verified paid PaymentIntent has no consumed commercial reservation",
        evidence: {
          paymentIntentId: intent._id,
          reservationId: commercialReservation._id,
          reservationStatus: commercialReservation.status,
        },
        paymentIntentId: intent._id,
        reservationId: commercialReservation._id,
      });
    }

    const balances = await ctx.db.query("billingBalances").take(limit);
    for (const balance of balances) {
      const lots = await ctx.db
        .query("creditLots")
        .withIndex("by_organization_id_and_book_and_credit_class", (q) =>
          q.eq("organizationId", balance.organizationId).eq("book", balance.book),
        )
        .take(1_000);
      const totals = {
        promoAvailable: 0n,
        promoReserved: 0n,
        promoConsumed: 0n,
        promoExpired: 0n,
        paidAvailable: 0n,
        paidReserved: 0n,
        paidConsumed: 0n,
        paidExpired: 0n,
      };
      for (const lot of lots) {
        const prefix = lot.creditClass === "promotional" ? "promo" : "paid";
        totals[`${prefix}Available`] += lot.available;
        totals[`${prefix}Reserved`] += lot.reserved;
        totals[`${prefix}Consumed`] += lot.consumed;
        totals[`${prefix}Expired`] += lot.expired;
      }
      const fields = Object.keys(totals) as Array<keyof typeof totals>;
      if (fields.some((field) => totals[field] !== balance[field])) {
        discrepancies++;
        await createBillingException(ctx, {
          organizationId: balance.organizationId,
          exceptionType: "ledger_mismatch",
          dedupeKey: `reconcile:balance:${balance._id}:${balance.version}`,
          summary: "Materialized billing balance does not match credit lots",
          evidence: {
            balanceId: balance._id,
            version: balance.version,
            expected: Object.fromEntries(fields.map((field) => [field, totals[field].toString()])),
          },
        });
      }
    }

    await recordMetric(
      ctx,
      "velo_billing_reconciliation_exception_total",
      "billing_reconciliation",
      "mutation",
      discrepancies === 0 ? "success" : "error",
      discrepancies,
    );
    return { discrepancies };
  },
});

function replayLedger(entries: Doc<"billingLedgerEntries">[]) {
  const totals = {
    promoAvailable: 0n,
    promoReserved: 0n,
    promoConsumed: 0n,
    promoExpired: 0n,
    paidAvailable: 0n,
    paidReserved: 0n,
    paidConsumed: 0n,
    paidExpired: 0n,
  };
  for (const entry of entries) {
    const prefix = entry.creditClass === "promotional" ? "promo" : "paid";
    const available = `${prefix}Available` as "promoAvailable" | "paidAvailable";
    const reserved = `${prefix}Reserved` as "promoReserved" | "paidReserved";
    const consumed = `${prefix}Consumed` as "promoConsumed" | "paidConsumed";
    const expired = `${prefix}Expired` as "promoExpired" | "paidExpired";
    if (
      entry.entryType === "promo_grant" ||
      entry.entryType === "paid_grant" ||
      entry.entryType === "adjustment" ||
      entry.entryType === "refund_adjustment"
    ) {
      totals[available] += entry.amount;
    } else if (entry.entryType === "reserve") {
      totals[available] -= entry.amount;
      totals[reserved] += entry.amount;
    } else if (entry.entryType === "consume") {
      totals[reserved] -= entry.amount;
      totals[consumed] += entry.amount;
    } else if (entry.entryType === "release") {
      totals[reserved] -= entry.amount;
      totals[available] += entry.amount;
    } else if (entry.entryType === "expiry") {
      totals[available] -= entry.amount;
      totals[expired] += entry.amount;
    }
  }
  return totals;
}

type ReplayTotals = ReturnType<typeof replayLedger>;

function emptyReplayTotals(): ReplayTotals {
  return replayLedger([]);
}

function parseReplayTotals(value?: string): ReplayTotals {
  if (!value) return emptyReplayTotals();
  const parsed = JSON.parse(value) as Record<keyof ReplayTotals, string>;
  return Object.fromEntries(
    Object.entries(parsed).map(([key, amount]) => [key, BigInt(amount)]),
  ) as ReplayTotals;
}

function serializeReplayTotals(value: ReplayTotals) {
  return JSON.stringify(
    Object.fromEntries(
      (Object.keys(value) as Array<keyof ReplayTotals>).map((field) => [
        field,
        value[field].toString(),
      ]),
    ),
  );
}

function addReplayTotals(target: ReplayTotals, increment: ReplayTotals) {
  for (const field of Object.keys(target) as Array<keyof ReplayTotals>) {
    target[field] += increment[field];
  }
  return target;
}

function digest(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

const replayRef = makeFunctionReference<"mutation">("billing/reconciliation:runDailyReplay");

export const runDailyReplay = internalMutation({
  args: {
    runId: v.optional(v.id("billingReplayRuns")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const runDate = new Date(now).toISOString().slice(0, 10);
    let runId: Id<"billingReplayRuns">;
    if (args.runId) {
      runId = args.runId;
    } else {
      const existing = await ctx.db
        .query("billingReplayRuns")
        .withIndex("by_run_date", (q) => q.eq("runDate", runDate))
        .unique();
      if (existing) return { runId: existing._id, status: existing.status };
      runId = await ctx.db.insert("billingReplayRuns", {
        runDate,
        status: "running",
        processedBalances: 0,
        discrepancies: 0,
        digest: "fnv1a32:811c9dc5",
        startedAt: now,
      });
    }
    const run = await ctx.db.get(runId);
    if (!run || run.status !== "running") return { runId, status: run?.status ?? "missing" };
    const limit = Math.min(100, Math.max(1, Math.floor(args.limit ?? 25)));
    let balance = run.currentBalanceId ? await ctx.db.get(run.currentBalanceId) : null;
    let replayed = parseReplayTotals(run.currentTotalsJson);
    if (!balance) {
      balance =
        (
          await ctx.db
            .query("billingBalances")
            .order("asc")
            .filter((q) => q.gt(q.field("_creationTime"), run.balanceCursorCreationTime ?? -1))
            .take(1)
        )[0] ?? null;
      replayed = emptyReplayTotals();
    }
    if (!balance) {
      await ctx.db.patch(runId, {
        status: run.discrepancies === 0 ? "passed" : "failed",
        completedAt: now,
        currentBalanceId: undefined,
        ledgerCursorCreationTime: undefined,
        currentTotalsJson: undefined,
      });
      await recordMetric(
        ctx,
        "velo_billing_daily_replay_total",
        "billing_replay",
        "mutation",
        run.discrepancies === 0 ? "success" : "error",
        1,
      );
      return {
        runId,
        status: run.discrepancies === 0 ? ("passed" as const) : ("failed" as const),
      };
    }
    const entries = await ctx.db
      .query("billingLedgerEntries")
      .withIndex("by_organization_id_and_book", (q) =>
        q.eq("organizationId", balance.organizationId).eq("book", balance.book),
      )
      .order("asc")
      .filter((q) => q.gt(q.field("_creationTime"), run.ledgerCursorCreationTime ?? -1))
      .take(limit + 1);
    const page = entries.slice(0, limit);
    addReplayTotals(replayed, replayLedger(page));
    if (entries.length > limit && page.length > 0) {
      await ctx.db.patch(runId, {
        currentBalanceId: balance._id,
        ledgerCursorCreationTime: page[page.length - 1]!._creationTime,
        currentTotalsJson: serializeReplayTotals(replayed),
      });
      await ctx.scheduler.runAfter(0, replayRef, {
        runId,
        limit,
      });
      return { runId, status: "running" as const };
    }
    const fields = Object.keys(replayed) as Array<keyof ReplayTotals>;
    const mismatch = fields.some((field) => replayed[field] !== balance[field]);
    if (mismatch) {
      await createBillingException(ctx, {
        organizationId: balance.organizationId,
        exceptionType: "ledger_mismatch",
        severity: "high",
        dedupeKey: `daily-replay:${runDate}:${balance._id}:${balance.version}`,
        summary: "Daily ledger replay does not match the materialized balance",
        evidence: { runId, balanceId: balance._id, version: balance.version },
      });
    }
    const nextDigest = digest(
      run.digest +
        JSON.stringify({
          balanceId: balance._id,
          version: balance.version,
          replayed: Object.fromEntries(fields.map((field) => [field, replayed[field].toString()])),
        }),
    );
    await ctx.db.patch(runId, {
      processedBalances: run.processedBalances + 1,
      discrepancies: run.discrepancies + (mismatch ? 1 : 0),
      digest: nextDigest,
      balanceCursorCreationTime: balance._creationTime,
      currentBalanceId: undefined,
      ledgerCursorCreationTime: undefined,
      currentTotalsJson: undefined,
    });
    await ctx.scheduler.runAfter(0, replayRef, { runId, limit });
    return { runId, status: "running" as const };
  },
});
