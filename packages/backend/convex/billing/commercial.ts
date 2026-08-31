import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

import {
  findLedgerEntry,
  getOrCreateBalance,
  insertLedgerEntry,
  moveBalance,
  selectCreditLot,
} from "./helpers";
import { notifyOrganization } from "./notifications";

export async function commercialEnforcementEnabled(
  ctx: MutationCtx,
  project: Doc<"projects">,
  network: "testnet" | "public",
) {
  if (!project.organizationId) return false;
  const [policy, settings] = await Promise.all([
    ctx.db
      .query("billingPolicies")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .unique(),
    ctx.db
      .query("organizationBillingSettings")
      .withIndex("by_organization_id", (q) => q.eq("organizationId", project.organizationId!))
      .unique(),
  ]);
  if (!policy?.billingLedgerWrite || policy.billingKillSwitch || !settings) return false;
  if (network === "testnet") return settings.sandboxEnforcementEnabled === true;
  if (
    !settings.cohortStage ||
    !settings.graceUntil ||
    settings.graceUntil > Date.now() ||
    settings.activationState === "paused"
  ) {
    return false;
  }
  return policy.mainnetCreditEnforcement && settings.enforcementEnabled;
}

export async function reserveCommercialCredit(
  ctx: MutationCtx,
  args: {
    project: Doc<"projects">;
    paymentIntentId: Id<"paymentIntents">;
    network: "testnet" | "public";
    expiresAt: number;
  },
) {
  const organizationId = args.project.organizationId;
  if (!organizationId) return { applied: false as const, reason: "organization_missing" as const };
  const idempotencyKey = `commercial:reserve:${args.paymentIntentId}`;
  const existing = await ctx.db
    .query("creditReservations")
    .withIndex("by_organization_id_and_book_and_reserve_idempotency_key", (q) =>
      q
        .eq("organizationId", organizationId)
        .eq("book", "commercial")
        .eq("reserveIdempotencyKey", idempotencyKey),
    )
    .unique();
  if (existing) {
    return { applied: false as const, reason: "idempotency_replay" as const };
  }
  const now = Date.now();
  const policy = await ctx.db
    .query("billingPolicies")
    .withIndex("by_key", (q) => q.eq("key", "global"))
    .unique();
  const lot = await selectCreditLot(
    ctx,
    organizationId,
    "commercial",
    1n,
    now,
    undefined,
    policy?.promoFirst ?? true,
  );
  if (!lot) return { applied: false as const, reason: "insufficient_balance" as const };
  const reservationId = await ctx.db.insert("creditReservations", {
    organizationId,
    projectId: args.project._id,
    paymentIntentId: args.paymentIntentId,
    book: "commercial",
    network: args.network,
    creditClass: lot.creditClass,
    creditLotId: lot._id,
    amount: 1n,
    status: "active",
    reserveIdempotencyKey: idempotencyKey,
    expiresAt: args.expiresAt,
    createdAt: now,
    updatedAt: now,
  });
  await insertLedgerEntry(ctx, {
    organizationId,
    book: "commercial",
    creditClass: lot.creditClass,
    entryType: "reserve",
    amount: 1n,
    idempotencyKey,
    projectId: args.project._id,
    paymentIntentId: args.paymentIntentId,
    reservationId,
    creditLotId: lot._id,
    actor: "system:commercial_enforcement",
    reason: "chargeable_payment_started",
    network: args.network,
    occurredAt: now,
  });
  await ctx.db.patch(lot._id, {
    available: lot.available - 1n,
    reserved: lot.reserved + 1n,
    updatedAt: now,
  });
  const balance = await getOrCreateBalance(ctx, organizationId, "commercial", now);
  await moveBalance(ctx, balance, lot.creditClass, { available: -1n, reserved: 1n }, now);
  const remaining = balance.promoAvailable + balance.paidAvailable - 1n;
  if (remaining <= 10n) {
    await notifyOrganization(ctx, {
      organizationId,
      notificationType: remaining === 0n ? "zero_balance" : "low_balance",
      dedupeKey: `${remaining === 0n ? "zero" : "low"}-balance:${balance.version + 1}`,
      title: remaining === 0n ? "No credits remaining" : "Credit balance is low",
      message:
        remaining === 0n
          ? "Top up before starting another sandbox-enforced payment."
          : `${remaining.toString()} credits remain available.`,
      paymentIntentId: args.paymentIntentId,
      reservationId,
    });
  }
  return { applied: true as const, reservationId };
}

export async function enforceNewCommercialIntent(
  ctx: MutationCtx,
  args: {
    project: Doc<"projects">;
    paymentIntentId: Id<"paymentIntents">;
    network: "testnet" | "public";
    expiresAt: number;
  },
) {
  if (!(await commercialEnforcementEnabled(ctx, args.project, args.network))) {
    return { allowed: true as const, enforced: false as const };
  }
  const reservation = await reserveCommercialCredit(ctx, args);
  if (!reservation.applied && reservation.reason === "insufficient_balance") {
    await ctx.db.delete(args.paymentIntentId);
    return { allowed: false as const, enforced: true as const };
  }
  return { allowed: true as const, enforced: true as const };
}

async function activeCommercialReservation(
  ctx: MutationCtx,
  paymentIntentId: Id<"paymentIntents">,
) {
  const reservations = await ctx.db
    .query("creditReservations")
    .withIndex("by_payment_intent_id", (q) => q.eq("paymentIntentId", paymentIntentId))
    .take(10);
  return reservations.find(
    (reservation) => reservation.book === "commercial" && reservation.status === "active",
  );
}

export async function consumeCommercialReservation(
  ctx: MutationCtx,
  paymentIntentId: Id<"paymentIntents">,
  transactionHash: string,
) {
  const reservation = await activeCommercialReservation(ctx, paymentIntentId);
  if (!reservation) return { applied: false as const, reason: "not_enforced" as const };
  const idempotencyKey = `commercial:consume:${paymentIntentId}:${transactionHash}`;
  if (await findLedgerEntry(ctx, reservation.organizationId, "commercial", idempotencyKey)) {
    return { applied: false as const, reason: "idempotency_replay" as const };
  }
  const lot = await ctx.db.get(reservation.creditLotId);
  if (!lot) throw new Error("Commercial reservation credit lot not found");
  const now = Date.now();
  await insertLedgerEntry(ctx, {
    organizationId: reservation.organizationId,
    book: "commercial",
    creditClass: reservation.creditClass,
    entryType: "consume",
    amount: reservation.amount,
    idempotencyKey,
    projectId: reservation.projectId,
    paymentIntentId,
    reservationId: reservation._id,
    creditLotId: lot._id,
    actor: "system:commercial_enforcement",
    reason: "independently_verified_success",
    network: reservation.network,
    occurredAt: now,
  });
  await ctx.db.patch(lot._id, {
    reserved: lot.reserved - reservation.amount,
    consumed: lot.consumed + reservation.amount,
    updatedAt: now,
  });
  const balance = await getOrCreateBalance(ctx, reservation.organizationId, "commercial", now);
  await moveBalance(
    ctx,
    balance,
    reservation.creditClass,
    { reserved: -reservation.amount, consumed: reservation.amount },
    now,
  );
  await ctx.db.patch(reservation._id, {
    status: "consumed",
    terminalIdempotencyKey: idempotencyKey,
    updatedAt: now,
  });
  return { applied: true as const };
}

export async function releaseCommercialReservation(
  ctx: MutationCtx,
  paymentIntentId: Id<"paymentIntents">,
  terminalStatus: string,
) {
  const reservation = await activeCommercialReservation(ctx, paymentIntentId);
  if (!reservation) return { applied: false as const };
  const idempotencyKey = `commercial:release:${paymentIntentId}:${terminalStatus}`;
  if (await findLedgerEntry(ctx, reservation.organizationId, "commercial", idempotencyKey)) {
    return { applied: false as const };
  }
  const lot = await ctx.db.get(reservation.creditLotId);
  if (!lot) throw new Error("Commercial reservation credit lot not found");
  const now = Date.now();
  await insertLedgerEntry(ctx, {
    organizationId: reservation.organizationId,
    book: "commercial",
    creditClass: reservation.creditClass,
    entryType: "release",
    amount: reservation.amount,
    idempotencyKey,
    projectId: reservation.projectId,
    paymentIntentId,
    reservationId: reservation._id,
    creditLotId: lot._id,
    actor: "system:commercial_enforcement",
    reason: `payment_${terminalStatus}`,
    network: reservation.network,
    occurredAt: now,
  });
  await ctx.db.patch(lot._id, {
    available: lot.available + reservation.amount,
    reserved: lot.reserved - reservation.amount,
    updatedAt: now,
  });
  const balance = await getOrCreateBalance(ctx, reservation.organizationId, "commercial", now);
  await moveBalance(
    ctx,
    balance,
    reservation.creditClass,
    { available: reservation.amount, reserved: -reservation.amount },
    now,
  );
  await ctx.db.patch(reservation._id, {
    status: "released",
    terminalIdempotencyKey: idempotencyKey,
    updatedAt: now,
  });
  if (terminalStatus === "reservation_recovery") {
    await notifyOrganization(ctx, {
      organizationId: reservation.organizationId,
      notificationType: "reservation_recovery",
      dedupeKey: `reservation-recovery:${reservation._id}`,
      title: "Reserved credit restored",
      message: "An abandoned payment reservation was returned to your available balance.",
      paymentIntentId,
      reservationId: reservation._id,
    });
  }
  return { applied: true as const };
}
