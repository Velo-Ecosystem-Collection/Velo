import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

import { mutation, query } from "../_generated/server";
import { requireBillingOperator } from "./access";

type ExceptionType =
  | "topup_mismatch"
  | "reused_transaction"
  | "reservation_mismatch"
  | "ledger_mismatch"
  | "receipt_mismatch"
  | "verification_ambiguous";
type ExceptionSeverity = "critical" | "high" | "medium" | "low";

const SLA_MS: Record<ExceptionSeverity, number> = {
  critical: 60 * 60_000,
  high: 4 * 60 * 60_000,
  medium: 24 * 60 * 60_000,
  low: 72 * 60 * 60_000,
};

function defaultSeverity(type: ExceptionType): ExceptionSeverity {
  if (type === "ledger_mismatch" || type === "receipt_mismatch") return "high";
  if (type === "reused_transaction" || type === "verification_ambiguous") return "critical";
  return "medium";
}

export async function createBillingException(
  ctx: MutationCtx,
  args: {
    organizationId?: Id<"organizations">;
    exceptionType: ExceptionType;
    dedupeKey: string;
    summary: string;
    evidence: Record<string, unknown>;
    paymentIntentId?: Id<"paymentIntents">;
    reservationId?: Id<"creditReservations">;
    topupId?: Id<"billingTopups">;
    treasuryReceiptId?: Id<"treasuryReceipts">;
    severity?: ExceptionSeverity;
    assignee?: string;
  },
) {
  const existing = await ctx.db
    .query("billingExceptions")
    .withIndex("by_dedupe_key", (q) => q.eq("dedupeKey", args.dedupeKey))
    .unique();
  if (existing) return existing._id;
  const now = Date.now();
  const severity = args.severity ?? defaultSeverity(args.exceptionType);
  const assignee = args.assignee?.trim() || "billing-operations";
  const exceptionId = await ctx.db.insert("billingExceptions", {
    organizationId: args.organizationId,
    exceptionType: args.exceptionType,
    status: "open",
    severity,
    assignee,
    slaDueAt: now + SLA_MS[severity],
    investigationStatus: "investigating",
    dedupeKey: args.dedupeKey,
    summary: args.summary,
    evidenceJson: JSON.stringify(args.evidence),
    paymentIntentId: args.paymentIntentId,
    reservationId: args.reservationId,
    topupId: args.topupId,
    treasuryReceiptId: args.treasuryReceiptId,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("billingExceptionHistory", {
    exceptionId,
    action: "created",
    actor: "system:billing_reconciliation",
    note: args.summary,
    occurredAt: now,
  });
  return exceptionId;
}

export const list = query({
  args: {
    status: v.optional(v.union(v.literal("open"), v.literal("resolved"))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireBillingOperator(ctx);
    const limit = Math.min(100, Math.max(1, Math.floor(args.limit ?? 50)));
    return args.status
      ? await ctx.db
          .query("billingExceptions")
          .withIndex("by_status_and_created_at", (q) => q.eq("status", args.status!))
          .order("desc")
          .take(limit)
      : await ctx.db.query("billingExceptions").order("desc").take(limit);
  },
});

export const backfillOperationalFields = mutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const operator = await requireBillingOperator(ctx);
    const rows = await ctx.db
      .query("billingExceptions")
      .order("asc")
      .take(Math.min(100, Math.max(1, Math.floor(args.limit ?? 25))));
    let updated = 0;
    for (const row of rows) {
      if (row.severity && row.slaDueAt && row.investigationStatus) continue;
      const severity = row.severity ?? "medium";
      await ctx.db.patch(row._id, {
        severity,
        slaDueAt: row.slaDueAt ?? row.createdAt + SLA_MS[severity],
        investigationStatus:
          row.investigationStatus ?? (row.assignee ? "investigating" : "unassigned"),
      });
      await ctx.db.insert("billingExceptionHistory", {
        exceptionId: row._id,
        action: "assigned",
        actor: operator.walletAddress,
        note: "Sprint 3 operational fields backfilled",
        occurredAt: Date.now(),
      });
      updated++;
    }
    return { updated };
  },
});

export const assign = mutation({
  args: {
    exceptionId: v.id("billingExceptions"),
    assignee: v.string(),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    const operator = await requireBillingOperator(ctx);
    const exception = await ctx.db.get(args.exceptionId);
    if (!exception) throw new Error("Billing exception not found");
    if (exception.status === "resolved")
      throw new Error("Resolved exceptions cannot be reassigned");
    const assignee = args.assignee.trim().toUpperCase();
    const note = args.note.trim();
    if (!assignee || !note) throw new Error("Assignee and assignment note are required");
    await ctx.db.patch(exception._id, {
      assignee,
      investigationStatus: "investigating",
      updatedAt: Date.now(),
    });
    await ctx.db.insert("billingExceptionHistory", {
      exceptionId: exception._id,
      action: "assigned",
      actor: operator.walletAddress,
      note,
      occurredAt: Date.now(),
    });
    return exception._id;
  },
});

export const addEvidence = mutation({
  args: {
    exceptionId: v.id("billingExceptions"),
    evidenceType: v.string(),
    reference: v.string(),
    digest: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const operator = await requireBillingOperator(ctx);
    const exception = await ctx.db.get(args.exceptionId);
    if (!exception) throw new Error("Billing exception not found");
    const evidenceType = args.evidenceType.trim();
    const reference = args.reference.trim();
    if (!evidenceType || !reference) throw new Error("Evidence type and reference are required");
    const now = Date.now();
    const evidenceId = await ctx.db.insert("billingExceptionEvidence", {
      exceptionId: exception._id,
      evidenceType,
      reference,
      ...(args.digest?.trim() ? { digest: args.digest.trim() } : {}),
      addedBy: operator.walletAddress,
      addedAt: now,
    });
    await ctx.db.insert("billingExceptionHistory", {
      exceptionId: exception._id,
      action: "evidence_added",
      actor: operator.walletAddress,
      note: `${evidenceType}: ${reference}`,
      occurredAt: now,
    });
    return evidenceId;
  },
});

const adjustRef = makeFunctionReference<"mutation">("billing/mutations:adjust");

export const resolve = mutation({
  args: {
    exceptionId: v.id("billingExceptions"),
    action: v.union(
      v.literal("acknowledge"),
      v.literal("retry_verification"),
      v.literal("compensating_adjustment"),
    ),
    note: v.string(),
    adjustmentAmount: v.optional(v.int64()),
    adjustmentCreditClass: v.optional(v.union(v.literal("promotional"), v.literal("paid"))),
  },
  handler: async (ctx, args) => {
    const operator = await requireBillingOperator(ctx);
    const exception = await ctx.db.get(args.exceptionId);
    if (!exception) throw new Error("Billing exception not found");
    if (exception.status === "resolved") return { applied: false as const };
    const note = args.note.trim();
    if (!note) throw new Error("Resolution note is required");

    let resolutionLedgerEntryId: Id<"billingLedgerEntries"> | undefined;
    if (args.action === "compensating_adjustment") {
      if (
        !exception.organizationId ||
        args.adjustmentAmount === undefined ||
        args.adjustmentAmount === 0n ||
        !args.adjustmentCreditClass
      ) {
        throw new Error("Compensating adjustment details are required");
      }
      const adjustment = (await ctx.runMutation(adjustRef, {
        organizationId: exception.organizationId,
        book: "commercial",
        creditClass: args.adjustmentCreditClass,
        amount: args.adjustmentAmount,
        entryType: "adjustment",
        idempotencyKey: `exception-resolution:${exception._id}`,
        actor: `operator:${operator.walletAddress}`,
        reason: note,
      })) as { applied: boolean; ledgerEntryId?: Id<"billingLedgerEntries"> };
      resolutionLedgerEntryId = adjustment.ledgerEntryId;
    }

    if (args.action === "retry_verification" && exception.paymentIntentId) {
      const intent = await ctx.db.get(exception.paymentIntentId);
      if (intent?.txHash) {
        await ctx.scheduler.runAfter(
          0,
          makeFunctionReference<"action">("payment_intents/scanner:watchTransaction"),
          { paymentIntentId: intent._id, txHash: intent.txHash },
        );
      }
    }

    const now = Date.now();
    await ctx.db.patch(exception._id, {
      status: "resolved",
      investigationStatus: "resolved",
      resolutionAction: args.action,
      resolutionNote: note,
      resolutionLedgerEntryId,
      resolvedBy: operator.walletAddress,
      resolvedAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("billingExceptionHistory", {
      exceptionId: exception._id,
      action: "resolved",
      actor: operator.walletAddress,
      note,
      occurredAt: now,
    });
    return { applied: true as const, resolutionLedgerEntryId };
  },
});
