import { v } from "convex/values";

import { internalMutation } from "../_generated/server";
import { recordMetric } from "../telemetry_outbox/helpers";
import { consumeCommercialReservation, releaseCommercialReservation } from "./commercial";
import { DEFAULT_BILLING_POLICY, PROMOTIONAL_CREDITS, PROMOTIONAL_VALIDITY_MS } from "./constants";
import { createBillingException } from "./exceptions";
import {
  findLedgerEntry,
  getOrCreateBalance,
  insertLedgerEntry,
  moveBalance,
  requireReservation,
  selectCreditLot,
} from "./helpers";
import { notifyOrganization } from "./notifications";
import { billingBookValidator, billingNetworkValidator, creditClassValidator } from "./schema";

export const initializePolicy = internalMutation({
  args: { actor: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("billingPolicies")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .unique();
    if (existing) return { applied: false as const, policyId: existing._id };
    const policyId = await ctx.db.insert("billingPolicies", {
      ...DEFAULT_BILLING_POLICY,
      updatedBy: args.actor.trim(),
      updatedAt: Date.now(),
    });
    return { applied: true as const, policyId };
  },
});

export const updatePolicy = internalMutation({
  args: {
    billingLedgerWrite: v.boolean(),
    billingShadowMode: v.boolean(),
    mainnetCreditEnforcement: v.boolean(),
    billingTopupsEnabled: v.boolean(),
    promoGrantEnabled: v.boolean(),
    pdaxBillingEnabled: v.boolean(),
    billingKillSwitch: v.boolean(),
    promoCredits: v.optional(v.int64()),
    promoValidityMs: v.optional(v.number()),
    reservationTtlMs: v.optional(v.number()),
    promoFirst: v.optional(v.boolean()),
    actor: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("billingPolicies")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .unique();
    const promoCredits = args.promoCredits ?? existing?.promoCredits ?? PROMOTIONAL_CREDITS;
    const promoValidityMs =
      args.promoValidityMs ?? existing?.promoValidityMs ?? PROMOTIONAL_VALIDITY_MS;
    const reservationTtlMs =
      args.reservationTtlMs ??
      existing?.reservationTtlMs ??
      DEFAULT_BILLING_POLICY.reservationTtlMs;
    if (promoCredits <= 0n || promoValidityMs <= 0 || reservationTtlMs <= 0) {
      throw new Error("Billing policy credit and duration values must be positive");
    }
    const now = Date.now();
    const values = {
      key: "global" as const,
      billingLedgerWrite: args.billingLedgerWrite,
      billingShadowMode: args.billingShadowMode,
      mainnetCreditEnforcement: args.mainnetCreditEnforcement,
      billingTopupsEnabled: args.billingTopupsEnabled,
      promoGrantEnabled: args.promoGrantEnabled,
      pdaxBillingEnabled: args.pdaxBillingEnabled,
      billingKillSwitch: args.billingKillSwitch,
      promoCredits,
      promoValidityMs,
      reservationTtlMs,
      promoFirst: args.promoFirst ?? existing?.promoFirst ?? DEFAULT_BILLING_POLICY.promoFirst,
      updatedBy: args.actor.trim(),
      updatedAt: now,
      version: (existing?.version ?? 0) + 1,
    };
    if (existing) {
      await ctx.db.patch(existing._id, values);
      return existing._id;
    }
    return await ctx.db.insert("billingPolicies", values);
  },
});

export const setOrganizationPolicy = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    enforcementEnabled: v.boolean(),
    shadowEnabled: v.boolean(),
    sandboxEnforcementEnabled: v.optional(v.boolean()),
    actor: v.string(),
  },
  handler: async (ctx, args) => {
    const organization = await ctx.db.get(args.organizationId);
    if (!organization) throw new Error("Organization not found");
    const existing = await ctx.db
      .query("organizationBillingSettings")
      .withIndex("by_organization_id", (q) => q.eq("organizationId", args.organizationId))
      .unique();
    const values = {
      organizationId: args.organizationId,
      enforcementEnabled: args.enforcementEnabled,
      shadowEnabled: args.shadowEnabled,
      sandboxEnforcementEnabled:
        args.sandboxEnforcementEnabled ?? existing?.sandboxEnforcementEnabled ?? false,
      updatedBy: args.actor.trim(),
      updatedAt: Date.now(),
    };
    if (existing) {
      await ctx.db.patch(existing._id, values);
      return existing._id;
    }
    return await ctx.db.insert("organizationBillingSettings", values);
  },
});

export const grantPromotion = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    book: billingBookValidator,
    idempotencyKey: v.string(),
    actor: v.string(),
  },
  handler: async (ctx, args) => {
    const organization = await ctx.db.get(args.organizationId);
    if (!organization) throw new Error("Organization not found");
    if (organization.verificationStatus !== "verified") {
      throw new Error("Organization must be verified before receiving promotional credits");
    }
    const policy = await ctx.db
      .query("billingPolicies")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .unique();
    const promoCredits = policy?.promoCredits ?? PROMOTIONAL_CREDITS;
    const promoValidityMs = policy?.promoValidityMs ?? PROMOTIONAL_VALIDITY_MS;
    if (args.book === "commercial" && !policy?.promoGrantEnabled) {
      throw new Error("Commercial promotional grants are disabled");
    }
    const existingPromoGrants = await ctx.db
      .query("billingLedgerEntries")
      .withIndex("by_organization_id_and_book", (q) =>
        q.eq("organizationId", args.organizationId).eq("book", args.book),
      )
      .take(100);
    const priorGrant = existingPromoGrants.find((entry) => entry.entryType === "promo_grant");
    if (priorGrant || (args.book === "commercial" && organization.trialState === "granted")) {
      const existing = await findLedgerEntry(
        ctx,
        args.organizationId,
        args.book,
        args.idempotencyKey,
      );
      if (existing) {
        return {
          applied: false as const,
          ledgerEntryId: existing._id,
          expiresAt: organization.trialExpiresAt,
        };
      }
      throw new Error("Organization promotional trial was already granted");
    }

    const now = Date.now();
    const expiresAt = now + promoValidityMs;
    const inserted = await insertLedgerEntry(ctx, {
      organizationId: args.organizationId,
      book: args.book,
      creditClass: "promotional",
      entryType: "promo_grant",
      amount: promoCredits,
      idempotencyKey: args.idempotencyKey,
      actor: args.actor,
      reason: "organization_promotional_trial",
      occurredAt: now,
    });
    if (!inserted.applied) {
      return { applied: false as const, ledgerEntryId: inserted.entry._id, expiresAt };
    }

    await ctx.db.insert("creditLots", {
      organizationId: args.organizationId,
      book: args.book,
      creditClass: "promotional",
      sourceLedgerEntryId: inserted.entry._id,
      granted: promoCredits,
      available: promoCredits,
      reserved: 0n,
      consumed: 0n,
      expired: 0n,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    });
    const balance = await getOrCreateBalance(ctx, args.organizationId, args.book, now);
    await moveBalance(ctx, balance, "promotional", { available: promoCredits }, now);
    if (args.book === "commercial") {
      await ctx.db.patch(args.organizationId, {
        trialState: "granted",
        trialGrantedAt: now,
        trialExpiresAt: expiresAt,
        updatedAt: now,
      });
    }
    return { applied: true as const, ledgerEntryId: inserted.entry._id, expiresAt };
  },
});

export const grantPaidCredits = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    book: billingBookValidator,
    amount: v.int64(),
    idempotencyKey: v.string(),
    topupReference: v.string(),
    treasuryReceiptReference: v.string(),
    actor: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.amount <= 0n) throw new Error("Paid grant amount must be positive");
    if (!args.topupReference.trim() || !args.treasuryReceiptReference.trim()) {
      throw new Error("Paid grants require top-up and treasury receipt references");
    }
    const organization = await ctx.db.get(args.organizationId);
    if (!organization) throw new Error("Organization not found");
    const policy = await ctx.db
      .query("billingPolicies")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .unique();
    if (args.book === "commercial" && !policy?.billingTopupsEnabled) {
      throw new Error("Commercial paid grants are disabled");
    }
    const inserted = await insertLedgerEntry(ctx, {
      organizationId: args.organizationId,
      book: args.book,
      creditClass: "paid",
      entryType: "paid_grant",
      amount: args.amount,
      idempotencyKey: args.idempotencyKey,
      topupReference: args.topupReference,
      treasuryReceiptReference: args.treasuryReceiptReference,
      actor: args.actor,
      reason: args.reason,
    });
    if (!inserted.applied) {
      return { applied: false as const, ledgerEntryId: inserted.entry._id };
    }
    const now = Date.now();
    await ctx.db.insert("creditLots", {
      organizationId: args.organizationId,
      book: args.book,
      creditClass: "paid",
      sourceLedgerEntryId: inserted.entry._id,
      granted: args.amount,
      available: args.amount,
      reserved: 0n,
      consumed: 0n,
      expired: 0n,
      createdAt: now,
      updatedAt: now,
    });
    const balance = await getOrCreateBalance(ctx, args.organizationId, args.book, now);
    await moveBalance(ctx, balance, "paid", { available: args.amount }, now);
    return { applied: true as const, ledgerEntryId: inserted.entry._id };
  },
});

export const reserve = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    projectId: v.id("projects"),
    paymentIntentId: v.optional(v.id("paymentIntents")),
    book: billingBookValidator,
    amount: v.int64(),
    idempotencyKey: v.string(),
    expiresAt: v.number(),
    network: billingNetworkValidator,
    promoFirst: v.optional(v.boolean()),
    actor: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.amount <= 0n) throw new Error("Reservation amount must be positive");
    if (args.expiresAt <= Date.now()) throw new Error("Reservation expiry must be in the future");
    const project = await ctx.db.get(args.projectId);
    if (!project || project.organizationId !== args.organizationId) {
      throw new Error("Project does not belong to organization");
    }
    const existing = await ctx.db
      .query("creditReservations")
      .withIndex("by_organization_id_and_book_and_reserve_idempotency_key", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .eq("book", args.book)
          .eq("reserveIdempotencyKey", args.idempotencyKey),
      )
      .unique();
    if (existing) {
      return {
        applied: false as const,
        reason: "idempotency_replay" as const,
        reservationId: existing._id,
        creditClass: existing.creditClass,
      };
    }

    if (project.retiredAt !== undefined) {
      throw new Error("Project is retired");
    }

    const now = Date.now();
    const lot = await selectCreditLot(
      ctx,
      args.organizationId,
      args.book,
      args.amount,
      now,
      undefined,
      args.promoFirst ?? true,
    );
    if (!lot) return { applied: false as const, reason: "insufficient_balance" as const };

    const reservationId = await ctx.db.insert("creditReservations", {
      organizationId: args.organizationId,
      projectId: args.projectId,
      ...(args.paymentIntentId ? { paymentIntentId: args.paymentIntentId } : {}),
      book: args.book,
      network: args.network,
      creditClass: lot.creditClass,
      creditLotId: lot._id,
      amount: args.amount,
      status: "active",
      reserveIdempotencyKey: args.idempotencyKey,
      expiresAt: args.expiresAt,
      createdAt: now,
      updatedAt: now,
    });
    const ledger = await insertLedgerEntry(ctx, {
      organizationId: args.organizationId,
      book: args.book,
      creditClass: lot.creditClass,
      entryType: "reserve",
      amount: args.amount,
      idempotencyKey: args.idempotencyKey,
      projectId: args.projectId,
      paymentIntentId: args.paymentIntentId,
      reservationId,
      creditLotId: lot._id,
      actor: args.actor,
      reason: args.reason,
      network: args.network,
      occurredAt: now,
    });
    if (!ledger.applied) throw new Error("Reservation ledger entry already exists");

    await ctx.db.patch(lot._id, {
      available: lot.available - args.amount,
      reserved: lot.reserved + args.amount,
      updatedAt: now,
    });
    const balance = await getOrCreateBalance(ctx, args.organizationId, args.book, now);
    await moveBalance(
      ctx,
      balance,
      lot.creditClass,
      { available: -args.amount, reserved: args.amount },
      now,
    );
    return {
      applied: true as const,
      reservationId,
      creditClass: lot.creditClass,
      ledgerEntryId: ledger.entry._id,
    };
  },
});

export const consume = internalMutation({
  args: {
    reservationId: v.id("creditReservations"),
    idempotencyKey: v.string(),
    actor: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const reservation = await requireReservation(ctx, args.reservationId);
    if (reservation.status === "consumed") return { applied: false as const };
    if (reservation.status === "released" || reservation.status === "expired") {
      throw new Error(`Cannot consume ${reservation.status} reservation`);
    }

    const lot = await ctx.db.get(reservation.creditLotId);
    if (!lot) throw new Error("Reservation credit lot not found");
    const existing = await findLedgerEntry(
      ctx,
      reservation.organizationId,
      reservation.book,
      args.idempotencyKey,
    );
    if (existing) return { applied: false as const };

    const now = Date.now();
    const ledger = await insertLedgerEntry(ctx, {
      organizationId: reservation.organizationId,
      book: reservation.book,
      creditClass: reservation.creditClass,
      entryType: "consume",
      amount: reservation.amount,
      idempotencyKey: args.idempotencyKey,
      projectId: reservation.projectId,
      paymentIntentId: reservation.paymentIntentId,
      reservationId: reservation._id,
      creditLotId: lot._id,
      actor: args.actor,
      reason: args.reason,
      network: reservation.network,
      occurredAt: now,
    });
    await ctx.db.patch(lot._id, {
      reserved: lot.reserved - reservation.amount,
      consumed: lot.consumed + reservation.amount,
      updatedAt: now,
    });
    const balance = await getOrCreateBalance(
      ctx,
      reservation.organizationId,
      reservation.book,
      now,
    );
    await moveBalance(
      ctx,
      balance,
      reservation.creditClass,
      { reserved: -reservation.amount, consumed: reservation.amount },
      now,
    );
    await ctx.db.patch(reservation._id, {
      status: "consumed",
      terminalIdempotencyKey: args.idempotencyKey,
      updatedAt: now,
    });
    return { applied: ledger.applied };
  },
});

export const release = internalMutation({
  args: {
    reservationId: v.id("creditReservations"),
    idempotencyKey: v.string(),
    actor: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const reservation = await requireReservation(ctx, args.reservationId);
    if (reservation.status === "released" || reservation.status === "expired") {
      return { applied: false as const };
    }
    if (reservation.status === "consumed") throw new Error("Cannot release consumed reservation");
    const lot = await ctx.db.get(reservation.creditLotId);
    if (!lot) throw new Error("Reservation credit lot not found");
    const existing = await findLedgerEntry(
      ctx,
      reservation.organizationId,
      reservation.book,
      args.idempotencyKey,
    );
    if (existing) return { applied: false as const };

    const now = Date.now();
    const ledger = await insertLedgerEntry(ctx, {
      organizationId: reservation.organizationId,
      book: reservation.book,
      creditClass: reservation.creditClass,
      entryType: "release",
      amount: reservation.amount,
      idempotencyKey: args.idempotencyKey,
      projectId: reservation.projectId,
      paymentIntentId: reservation.paymentIntentId,
      reservationId: reservation._id,
      creditLotId: lot._id,
      actor: args.actor,
      reason: args.reason,
      network: reservation.network,
      occurredAt: now,
    });
    await ctx.db.patch(lot._id, {
      available: lot.available + reservation.amount,
      reserved: lot.reserved - reservation.amount,
      updatedAt: now,
    });
    const balance = await getOrCreateBalance(
      ctx,
      reservation.organizationId,
      reservation.book,
      now,
    );
    await moveBalance(
      ctx,
      balance,
      reservation.creditClass,
      { available: reservation.amount, reserved: -reservation.amount },
      now,
    );
    await ctx.db.patch(reservation._id, {
      status: "released",
      terminalIdempotencyKey: args.idempotencyKey,
      updatedAt: now,
    });
    return { applied: ledger.applied };
  },
});

export const recoverExpiredReservations = internalMutation({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const limit = Math.min(100, Math.max(1, Math.floor(args.limit)));
    const now = Date.now();
    const reservations = await ctx.db
      .query("creditReservations")
      .withIndex("by_status_and_expires_at", (q) => q.eq("status", "active").lte("expiresAt", now))
      .take(limit);
    let recovered = 0;
    for (const reservation of reservations) {
      if (reservation.book === "commercial" && reservation.paymentIntentId) {
        const intent = await ctx.db.get(reservation.paymentIntentId);
        if (intent?.anchor === "pdax") {
          const settlement = await ctx.db
            .query("settlementTransactions")
            .withIndex("by_payment_intent", (q) => q.eq("paymentIntentId", intent._id))
            .order("desc")
            .take(1);
          const currentSettlement = settlement[0];
          if (currentSettlement?.status === "PAYOUT_SUCCEEDED") {
            await consumeCommercialReservation(ctx, intent._id, `pdax:${currentSettlement._id}`);
          } else if (currentSettlement?.status === "PAYOUT_FAILED") {
            const released = await releaseCommercialReservation(
              ctx,
              intent._id,
              "pdax_payout_failed",
            );
            if (released.applied) recovered++;
          } else {
            await createBillingException(ctx, {
              organizationId: reservation.organizationId,
              exceptionType: "verification_ambiguous",
              dedupeKey: `recovery:pdax:${reservation._id}`,
              summary: "PDAX reservation remains active until final payout verification",
              evidence: {
                reservationId: reservation._id,
                paymentIntentId: intent._id,
                settlementStatus: currentSettlement?.status ?? "missing",
              },
              paymentIntentId: intent._id,
              reservationId: reservation._id,
            });
          }
          continue;
        }
        if (intent?.status === "paid") {
          if (intent.verifiedTxHash ?? intent.txHash) {
            await consumeCommercialReservation(
              ctx,
              intent._id,
              intent.verifiedTxHash ?? intent.txHash!,
            );
          } else {
            await createBillingException(ctx, {
              organizationId: reservation.organizationId,
              exceptionType: "verification_ambiguous",
              dedupeKey: `recovery:paid-without-hash:${reservation._id}`,
              summary: "Paid PaymentIntent has an active reservation but no verified hash",
              evidence: { reservationId: reservation._id, paymentIntentId: intent._id },
              paymentIntentId: intent._id,
              reservationId: reservation._id,
            });
          }
          continue;
        }
        if (intent?.status === "pending") {
          const job = await ctx.db
            .query("paymentReconciliationJobs")
            .withIndex("by_payment_intent", (q) => q.eq("paymentIntentId", intent._id))
            .unique();
          if (job && (job.state === "pending" || job.state === "leased")) continue;
          await createBillingException(ctx, {
            organizationId: reservation.organizationId,
            exceptionType: "verification_ambiguous",
            dedupeKey: `recovery:pending:${reservation._id}`,
            summary: "Expired reservation is awaiting ambiguous payment verification",
            evidence: {
              reservationId: reservation._id,
              paymentIntentId: intent._id,
              reconciliationState: job?.state ?? "missing",
            },
            paymentIntentId: intent._id,
            reservationId: reservation._id,
          });
          continue;
        }
        if (intent?.status === "created" && intent.expiresAt <= now) {
          await ctx.db.patch(intent._id, {
            status: "expired",
            updatedAt: now,
            stageTimestamps: intent.stageTimestamps
              ? { ...intent.stageTimestamps, expired: now }
              : { created: intent.createdAt, expired: now },
          });
        }
        if (
          !intent ||
          intent.status === "created" ||
          intent.status === "failed" ||
          intent.status === "cancelled" ||
          intent.status === "expired"
        ) {
          const released = await releaseCommercialReservation(
            ctx,
            reservation.paymentIntentId,
            "reservation_recovery",
          );
          if (released.applied) recovered++;
          continue;
        }
      }
      const lot = await ctx.db.get(reservation.creditLotId);
      if (!lot || reservation.status !== "active") continue;
      const idempotencyKey = `reservation-expiry:${reservation._id}`;
      const existing = await findLedgerEntry(
        ctx,
        reservation.organizationId,
        reservation.book,
        idempotencyKey,
      );
      if (existing) continue;
      await insertLedgerEntry(ctx, {
        organizationId: reservation.organizationId,
        book: reservation.book,
        creditClass: reservation.creditClass,
        entryType: "release",
        amount: reservation.amount,
        idempotencyKey,
        projectId: reservation.projectId,
        paymentIntentId: reservation.paymentIntentId,
        reservationId: reservation._id,
        creditLotId: lot._id,
        actor: "system:reservation_recovery",
        reason: "reservation_expired",
        network: reservation.network,
        occurredAt: now,
      });
      await ctx.db.patch(lot._id, {
        available: lot.available + reservation.amount,
        reserved: lot.reserved - reservation.amount,
        updatedAt: now,
      });
      const balance = await getOrCreateBalance(
        ctx,
        reservation.organizationId,
        reservation.book,
        now,
      );
      await moveBalance(
        ctx,
        balance,
        reservation.creditClass,
        { available: reservation.amount, reserved: -reservation.amount },
        now,
      );
      await ctx.db.patch(reservation._id, {
        status: "expired",
        terminalIdempotencyKey: idempotencyKey,
        updatedAt: now,
      });
      if (reservation.book === "commercial") {
        await notifyOrganization(ctx, {
          organizationId: reservation.organizationId,
          notificationType: "reservation_recovery",
          dedupeKey: `reservation-recovery:${reservation._id}`,
          title: "Reserved credit restored",
          message: "An expired reservation was returned to your available balance.",
          paymentIntentId: reservation.paymentIntentId,
          reservationId: reservation._id,
        });
      }
      recovered++;
    }
    if (recovered > 0) {
      await recordMetric(
        ctx,
        "velo_billing_reservation_recovery_total",
        "reservation_recovery",
        "mutation",
        "success",
        recovered,
      );
    }
    return { recovered };
  },
});

export const expireCreditLots = internalMutation({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const limit = Math.min(100, Math.max(1, Math.floor(args.limit)));
    const now = Date.now();
    const lots = await ctx.db
      .query("creditLots")
      .withIndex("by_expires_at", (q) => q.gt("expiresAt", undefined).lte("expiresAt", now))
      .take(limit);
    let expired = 0;
    for (const lot of lots) {
      if (lot.expiresAt === undefined || lot.available <= 0n || lot.reserved > 0n) continue;
      const amount = lot.available;
      const idempotencyKey = `credit-lot-expiry:${lot._id}`;
      const existing = await findLedgerEntry(ctx, lot.organizationId, lot.book, idempotencyKey);
      if (existing) continue;
      await insertLedgerEntry(ctx, {
        organizationId: lot.organizationId,
        book: lot.book,
        creditClass: lot.creditClass,
        entryType: "expiry",
        amount,
        idempotencyKey,
        creditLotId: lot._id,
        actor: "system:credit_expiry",
        reason: "credit_lot_expired",
        occurredAt: now,
      });
      await ctx.db.patch(lot._id, {
        available: 0n,
        expired: lot.expired + amount,
        updatedAt: now,
      });
      const balance = await getOrCreateBalance(ctx, lot.organizationId, lot.book, now);
      await moveBalance(
        ctx,
        balance,
        lot.creditClass,
        { available: -amount, expired: amount },
        now,
      );
      if (lot.book === "commercial" && lot.creditClass === "promotional") {
        await notifyOrganization(ctx, {
          organizationId: lot.organizationId,
          notificationType: "promotional_expiry",
          dedupeKey: `promotional-expiry:${lot._id}`,
          title: "Promotional credits expired",
          message: `${amount.toString()} unused promotional credits have expired.`,
        });
      }
      expired++;
    }
    return { expired };
  },
});

export const adjust = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    book: billingBookValidator,
    creditClass: creditClassValidator,
    amount: v.int64(),
    entryType: v.union(v.literal("adjustment"), v.literal("refund_adjustment")),
    idempotencyKey: v.string(),
    actor: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const organization = await ctx.db.get(args.organizationId);
    if (!organization) throw new Error("Organization not found");
    if (args.amount === 0n) throw new Error("Adjustment amount cannot be zero");
    const now = Date.now();
    const lot =
      args.amount < 0n
        ? await selectCreditLot(
            ctx,
            args.organizationId,
            args.book,
            -args.amount,
            now,
            args.creditClass,
          )
        : null;
    if (args.amount < 0n && (!lot || lot.creditClass !== args.creditClass)) {
      throw new Error("Insufficient matching credits for negative adjustment");
    }
    const inserted = await insertLedgerEntry(ctx, {
      organizationId: args.organizationId,
      book: args.book,
      creditClass: args.creditClass,
      entryType: args.entryType,
      amount: args.amount,
      idempotencyKey: args.idempotencyKey,
      creditLotId: lot?._id,
      actor: args.actor,
      reason: args.reason,
    });
    if (!inserted.applied) return { applied: false as const };
    if (args.amount > 0n) {
      await ctx.db.insert("creditLots", {
        organizationId: args.organizationId,
        book: args.book,
        creditClass: args.creditClass,
        sourceLedgerEntryId: inserted.entry._id,
        granted: args.amount,
        available: args.amount,
        reserved: 0n,
        consumed: 0n,
        expired: 0n,
        createdAt: now,
        updatedAt: now,
      });
    } else if (lot) {
      await ctx.db.patch(lot._id, {
        available: lot.available + args.amount,
        updatedAt: now,
      });
    }
    const balance = await getOrCreateBalance(ctx, args.organizationId, args.book, now);
    await moveBalance(ctx, balance, args.creditClass, { available: args.amount }, now);
    return { applied: true as const, ledgerEntryId: inserted.entry._id };
  },
});
