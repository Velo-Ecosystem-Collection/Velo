import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

import { currentBillingEnvironment } from "./config";
import { BILLING_CALCULATION_VERSION } from "./constants";

export type BillingBook = "shadow" | "commercial";
export type CreditClass = "promotional" | "paid";
export type BillingNetwork = "testnet" | "public";

export const emptyBalance = (
  organizationId: Id<"organizations">,
  book: BillingBook,
  now: number,
) => ({
  organizationId,
  book,
  promoAvailable: 0n,
  promoReserved: 0n,
  promoConsumed: 0n,
  promoExpired: 0n,
  paidAvailable: 0n,
  paidReserved: 0n,
  paidConsumed: 0n,
  paidExpired: 0n,
  version: 0,
  updatedAt: now,
});

export async function getOrCreateBalance(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  book: BillingBook,
  now = Date.now(),
) {
  const existing = await ctx.db
    .query("billingBalances")
    .withIndex("by_organization_id_and_book", (q) =>
      q.eq("organizationId", organizationId).eq("book", book),
    )
    .unique();
  if (existing) return existing;

  const id = await ctx.db.insert("billingBalances", emptyBalance(organizationId, book, now));
  const balance = await ctx.db.get(id);
  if (!balance) throw new Error("Billing balance not found after creation");
  return balance;
}

export async function findLedgerEntry(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  book: BillingBook,
  idempotencyKey: string,
) {
  return await ctx.db
    .query("billingLedgerEntries")
    .withIndex("by_organization_id_and_book_and_idempotency_key", (q) =>
      q.eq("organizationId", organizationId).eq("book", book).eq("idempotencyKey", idempotencyKey),
    )
    .unique();
}

export async function insertLedgerEntry(
  ctx: MutationCtx,
  args: {
    organizationId: Id<"organizations">;
    book: BillingBook;
    creditClass: CreditClass;
    entryType: Doc<"billingLedgerEntries">["entryType"];
    amount: bigint;
    idempotencyKey: string;
    projectId?: Id<"projects">;
    paymentIntentId?: Id<"paymentIntents">;
    reservationId?: Id<"creditReservations">;
    creditLotId?: Id<"creditLots">;
    topupReference?: string;
    treasuryReceiptReference?: string;
    actor: string;
    reason: string;
    network?: BillingNetwork;
    occurredAt?: number;
  },
) {
  if (args.amount === 0n) throw new Error("Ledger amount cannot be zero");
  const idempotencyKey = args.idempotencyKey.trim();
  if (!idempotencyKey) throw new Error("Idempotency key is required");
  const actor = args.actor.trim();
  const reason = args.reason.trim();
  if (!actor || !reason) throw new Error("Ledger actor and reason are required");
  const existing = await findLedgerEntry(ctx, args.organizationId, args.book, idempotencyKey);
  if (existing) return { applied: false as const, entry: existing };

  const occurredAt = args.occurredAt ?? Date.now();
  const id = await ctx.db.insert("billingLedgerEntries", {
    organizationId: args.organizationId,
    book: args.book,
    creditClass: args.creditClass,
    entryType: args.entryType,
    amount: args.amount,
    idempotencyKey,
    ...(args.projectId ? { projectId: args.projectId } : {}),
    ...(args.paymentIntentId ? { paymentIntentId: args.paymentIntentId } : {}),
    ...(args.reservationId ? { reservationId: args.reservationId } : {}),
    ...(args.creditLotId ? { creditLotId: args.creditLotId } : {}),
    ...(args.topupReference ? { topupReference: args.topupReference } : {}),
    ...(args.treasuryReceiptReference
      ? { treasuryReceiptReference: args.treasuryReceiptReference }
      : {}),
    actor,
    reason,
    environment: currentBillingEnvironment(),
    network: args.network ?? "testnet",
    calculationVersion: BILLING_CALCULATION_VERSION,
    occurredAt,
  });
  const entry = await ctx.db.get(id);
  if (!entry) throw new Error("Ledger entry not found after creation");
  return { applied: true as const, entry };
}

function balanceFields(creditClass: CreditClass) {
  return creditClass === "promotional"
    ? ({
        available: "promoAvailable",
        reserved: "promoReserved",
        consumed: "promoConsumed",
        expired: "promoExpired",
      } as const)
    : ({
        available: "paidAvailable",
        reserved: "paidReserved",
        consumed: "paidConsumed",
        expired: "paidExpired",
      } as const);
}

export async function moveBalance(
  ctx: MutationCtx,
  balance: Doc<"billingBalances">,
  creditClass: CreditClass,
  delta: { available?: bigint; reserved?: bigint; consumed?: bigint; expired?: bigint },
  now = Date.now(),
) {
  const fields = balanceFields(creditClass);
  const available = balance[fields.available] + (delta.available ?? 0n);
  const reserved = balance[fields.reserved] + (delta.reserved ?? 0n);
  const consumed = balance[fields.consumed] + (delta.consumed ?? 0n);
  const expired = balance[fields.expired] + (delta.expired ?? 0n);
  if (available < 0n || reserved < 0n || consumed < 0n || expired < 0n) {
    throw new Error("Billing balance cannot become negative");
  }
  await ctx.db.patch(balance._id, {
    [fields.available]: available,
    [fields.reserved]: reserved,
    [fields.consumed]: consumed,
    [fields.expired]: expired,
    version: balance.version + 1,
    updatedAt: now,
  });
  if (balance.book === "commercial") {
    const settings = await ctx.db
      .query("organizationBillingSettings")
      .withIndex("by_organization_id", (q) => q.eq("organizationId", balance.organizationId))
      .unique();
    if (settings?.payAccessMirrorEnabled) {
      const desiredCredits =
        (creditClass === "promotional" ? available : balance.promoAvailable) +
        (creditClass === "paid" ? available : balance.paidAvailable);
      const projects = await ctx.db
        .query("projects")
        .withIndex("by_organization_id", (q) => q.eq("organizationId", balance.organizationId))
        .take(100);
      for (const project of projects) {
        if (!project.registryProjectId) continue;
        const state = await ctx.db
          .query("payAccessMirrorStates")
          .withIndex("by_project_id", (q) => q.eq("projectId", project._id))
          .unique();
        const values = {
          projectId: project._id,
          organizationId: balance.organizationId,
          registryProjectId: project.registryProjectId,
          desiredCredits,
          desiredVersion: balance.version + 1,
          status: "pending" as const,
          updatedAt: now,
        };
        if (state) await ctx.db.patch(state._id, values);
        else await ctx.db.insert("payAccessMirrorStates", values);
      }
    }
  }
}

export async function selectCreditLot(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  book: BillingBook,
  amount: bigint,
  now: number,
  requestedClass?: CreditClass,
  promoFirst = true,
) {
  const classes = requestedClass
    ? [requestedClass]
    : promoFirst
      ? (["promotional", "paid"] as const)
      : (["paid", "promotional"] as const);
  for (const creditClass of classes) {
    const lots = await ctx.db
      .query("creditLots")
      .withIndex("by_organization_id_and_book_and_credit_class", (q) =>
        q.eq("organizationId", organizationId).eq("book", book).eq("creditClass", creditClass),
      )
      .take(256);
    const eligible = lots
      .filter(
        (lot) => lot.available >= amount && (lot.expiresAt === undefined || lot.expiresAt > now),
      )
      .sort(
        (a, b) =>
          (a.expiresAt ?? Number.MAX_SAFE_INTEGER) - (b.expiresAt ?? Number.MAX_SAFE_INTEGER),
      );
    if (eligible[0]) return eligible[0];
  }
  return null;
}

export async function requireReservation(
  ctx: MutationCtx,
  reservationId: Id<"creditReservations">,
) {
  const reservation = await ctx.db.get(reservationId);
  if (!reservation) throw new Error("Reservation not found");
  return reservation;
}
