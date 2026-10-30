import { v, ConvexError } from "convex/values";

import { internal } from "../_generated/api";
import { internalMutation, mutation } from "../_generated/server";
import { canUseGeneralApi } from "../api_keys/helpers";
import {
  commercialEnforcementEnabled,
  consumeCommercialReservation,
  enforceNewCommercialIntent,
  releaseCommercialReservation,
  reserveCommercialCredit,
} from "../billing/commercial";
import { currentBillingNetwork } from "../billing/config";
import { scheduleShadowEvaluation } from "../billing/shadow";
import { markTopupTerminal, recordTopupException, settleTopup } from "../billing/topups";
import { requireProjectOwner } from "../projects/helpers";
import { recordMetric, recordSpan } from "../telemetry_outbox/helpers";
import { hasEnabledWebhookForEvent } from "../webhook_endpoints/helpers";
import {
  createPaymentIntentFingerprint,
  PAYMENT_INTENT_EXPIRY_MS,
  resolveActivePaymentAnchor,
  STATUS_TRANSITIONS,
  verifyApiKeyForPayments,
} from "./helpers";
import { paymentMatchesIntent } from "./verification";

/**
 * Creates a new payment intent. Requires apiKeyHash for authentication.
 */
export const createPaymentIntent = mutation({
  args: {
    apiKeyHash: v.string(),
    correlationId: v.optional(v.string()),
    amount: v.string(),
    asset: v.string(),
    description: v.optional(v.string()),
    successUrl: v.optional(v.string()),
    cancelUrl: v.optional(v.string()),
    anchor: v.optional(v.union(v.literal("inhouse"), v.literal("pdax"))),
  },
  handler: async (ctx, args) => {
    // 1. Authenticate using API key hash
    const apiKey = await ctx.db
      .query("apiKeys")
      .withIndex("by_key_hash", (q) => q.eq("keyHash", args.apiKeyHash))
      .unique();

    if (!apiKey || apiKey.revoked || !canUseGeneralApi(apiKey)) {
      throw new ConvexError("Unauthorized: Invalid API key.");
    }

    const project = await ctx.db.get(apiKey.projectId);
    if (!project || project.retiredAt !== undefined) {
      throw new ConvexError("Unauthorized: Project not found.");
    }

    if (!project.paymentAccessActive) {
      throw new ConvexError("Unauthorized: Payment access is not activated for this project.");
    }

    const now = Date.now();

    // Resolve payment anchor
    const resolvedAnchor = resolveActivePaymentAnchor({
      requestedAnchor: args.anchor,
      apiKeyAnchor: apiKey.paymentAnchor,
      projectDefaultAnchor: project.defaultPaymentAnchor,
    });

    // 2. Insert payment intent, using the project ownerAddress as the receiver for security
    const id = await ctx.db.insert("paymentIntents", {
      projectId: project._id,
      network: currentBillingNetwork(),
      intentType: "merchant_payment",
      amount: args.amount,
      asset: args.asset,
      receiverAddress: project.ownerAddress,
      merchantName: project.name,
      ...(args.description !== undefined ? { description: args.description } : {}),
      status: "created",
      ...(args.successUrl !== undefined ? { successUrl: args.successUrl } : {}),
      ...(args.cancelUrl !== undefined ? { cancelUrl: args.cancelUrl } : {}),
      anchor: resolvedAnchor,
      ...(args.correlationId !== undefined ? { correlationId: args.correlationId } : {}),
      expiresAt: now + PAYMENT_INTENT_EXPIRY_MS,
      stageTimestamps: {
        created: now,
      },
      createdAt: now,
      updatedAt: now,
    });
    if (await commercialEnforcementEnabled(ctx, project, currentBillingNetwork())) {
      const reservation = await reserveCommercialCredit(ctx, {
        project,
        paymentIntentId: id,
        network: currentBillingNetwork(),
        expiresAt: now + PAYMENT_INTENT_EXPIRY_MS,
      });
      if (!reservation.applied && reservation.reason === "insufficient_balance") {
        throw new ConvexError({
          code: "INSUFFICIENT_BILLING_CREDITS",
          message: "Organization has no available commercial credits",
        });
      }
    }
    await scheduleShadowEvaluation(ctx, {
      phase: "would_reserve",
      projectId: project._id,
      paymentIntentId: id,
      route: "stellar",
      idempotencyKey: `shadow:reserve:${id}`,
    });

    // 3. Increment request count on the API key
    if (await hasEnabledWebhookForEvent(ctx, project._id, "payment.created")) {
      await ctx.scheduler.runAfter(0, internal.webhookDelivery.trigger, {
        projectId: project._id,
        eventType: "payment.created",
        paymentIntentId: id,
        ...(args.correlationId !== undefined ? { correlationId: args.correlationId } : {}),
      });
    }

    return { paymentIntentId: id, projectId: project._id };
  },
});

/**
 * Creates a one-time PaymentIntent from the authenticated merchant dashboard.
 * Ownership replaces API-key authentication while the existing route, billing,
 * idempotency, and webhook semantics remain intact.
 */
export const createFromDashboard = mutation({
  args: {
    projectId: v.id("projects"),
    requestId: v.string(),
    amount: v.string(),
    asset: v.string(),
    description: v.optional(v.string()),
    anchor: v.optional(v.union(v.literal("inhouse"), v.literal("pdax"))),
  },
  handler: async (ctx, args) => {
    const project = await requireProjectOwner(ctx, args.projectId, { allowRetired: true });
    if (!project.paymentAccessActive) {
      throw new ConvexError("Payment access is not activated for this project.");
    }

    const requestId = args.requestId.trim();
    if (!requestId || requestId.length > 128) {
      throw new ConvexError("Invalid dashboard payment request ID.");
    }
    const amount = args.amount.trim();
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amount) || Number(amount) <= 0) {
      throw new ConvexError("Amount must be a positive decimal.");
    }
    const asset = args.asset.trim();
    if (!asset) {
      throw new ConvexError("Asset is required.");
    }
    const description = args.description?.trim() || undefined;
    if (description && description.length > 500) {
      throw new ConvexError("Description must be 500 characters or fewer.");
    }

    const resolvedAnchor = resolveActivePaymentAnchor({
      requestedAnchor: args.anchor,
      projectDefaultAnchor: project.defaultPaymentAnchor,
    });
    const fingerprint = createPaymentIntentFingerprint({
      amount,
      asset,
      description,
      anchor: resolvedAnchor,
    });
    const idempotencyKey = `dashboard:${requestId}`;
    const existing = await ctx.db
      .query("paymentIntentIdempotencyKeys")
      .withIndex("by_project_and_key", (q) =>
        q.eq("projectId", project._id).eq("key", idempotencyKey),
      )
      .unique();
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) {
        throw new ConvexError("Dashboard payment request conflicts with an earlier submission.");
      }
      const intent = await ctx.db.get(existing.paymentIntentId);
      if (intent?.projectId === project._id) {
        return { status: "idempotency_replay" as const, intent };
      }
    }

    if (project.retiredAt !== undefined) {
      throw new ConvexError("Project is retired.");
    }

    const now = Date.now();

    const intentFields = {
      projectId: project._id,
      network: currentBillingNetwork(),
      intentType: "merchant_payment" as const,
      amount,
      asset,
      receiverAddress: project.ownerAddress,
      merchantName: project.name,
      ...(description !== undefined ? { description } : {}),
      status: "created" as const,
      anchor: resolvedAnchor,
      correlationId: `dashboard:${requestId}`,
      expiresAt: now + PAYMENT_INTENT_EXPIRY_MS,
      stageTimestamps: {
        created: now,
      },
      createdAt: now,
      updatedAt: now,
    };
    const paymentIntentId = await ctx.db.insert("paymentIntents", intentFields);
    const enforcement = await enforceNewCommercialIntent(ctx, {
      project,
      paymentIntentId,
      network: currentBillingNetwork(),
      expiresAt: intentFields.expiresAt,
    });
    if (!enforcement.allowed) {
      throw new ConvexError({
        code: "INSUFFICIENT_BILLING_CREDITS",
        message: "Organization has no available commercial credits",
      });
    }
    await scheduleShadowEvaluation(ctx, {
      phase: "would_reserve",
      projectId: project._id,
      paymentIntentId,
      route: "stellar",
      idempotencyKey: `shadow:reserve:${paymentIntentId}`,
    });

    await ctx.db.insert("paymentIntentIdempotencyKeys", {
      projectId: project._id,
      key: idempotencyKey,
      requestFingerprint: fingerprint,
      paymentIntentId,
      createdAt: now,
      updatedAt: now,
    });

    if (await hasEnabledWebhookForEvent(ctx, project._id, "payment.created")) {
      await ctx.scheduler.runAfter(0, internal.webhookDelivery.trigger, {
        projectId: project._id,
        eventType: "payment.created",
        paymentIntentId,
        correlationId: intentFields.correlationId,
      });
    }

    const intent = await ctx.db.get(paymentIntentId);
    if (!intent) throw new ConvexError("Payment intent not found after creation.");
    return { status: "success" as const, intent };
  },
});

/**
 * Creates a payment intent for SDK-facing REST routes.
 * Auth and project scope are derived from the API key hash.
 */
export const createPublicPaymentIntent = internalMutation({
  args: {
    apiKeyHash: v.string(),
    correlationId: v.optional(v.string()),
    amount: v.string(),
    asset: v.string(),
    description: v.optional(v.string()),
    successUrl: v.optional(v.string()),
    cancelUrl: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
    anchor: v.optional(v.union(v.literal("inhouse"), v.literal("pdax"))),
  },
  handler: async (ctx, args) => {
    const startedAt = Date.now();
    const auth = await verifyApiKeyForPayments(ctx, args.apiKeyHash);
    if (!auth.authorized) {
      return { authorized: false as const, reason: auth.reason };
    }

    const now = Date.now();
    const requestFingerprint = createPaymentIntentFingerprint(args);

    if (args.idempotencyKey !== undefined) {
      const existing = await ctx.db
        .query("paymentIntentIdempotencyKeys")
        .withIndex("by_project_and_key", (q) =>
          q.eq("projectId", auth.project._id).eq("key", args.idempotencyKey!),
        )
        .unique();

      if (existing) {
        if (existing.requestFingerprint !== requestFingerprint) {
          return {
            authorized: true as const,
            idempotencyConflict: true as const,
            projectId: auth.project._id,
          };
        }

        const intent = await ctx.db.get(existing.paymentIntentId);
        if (intent && intent.projectId === auth.project._id) {
          return {
            authorized: true as const,
            idempotencyReplay: true as const,
            projectId: auth.project._id,
            intent,
          };
        }
      }
    }

    if (auth.project.retiredAt !== undefined) {
      return { authorized: false as const, reason: "Project is retired." };
    }

    // Resolve payment anchor
    const resolvedAnchor = resolveActivePaymentAnchor({
      requestedAnchor: args.anchor,
      apiKeyAnchor: auth.apiKey.paymentAnchor,
      projectDefaultAnchor: auth.project.defaultPaymentAnchor,
    });

    const paymentIntentId = await ctx.db.insert("paymentIntents", {
      projectId: auth.project._id,
      network: currentBillingNetwork(),
      intentType: "merchant_payment",
      amount: args.amount,
      asset: args.asset,
      receiverAddress: auth.project.ownerAddress,
      merchantName: auth.project.name,
      ...(args.description !== undefined ? { description: args.description } : {}),
      status: "created",
      ...(args.successUrl !== undefined ? { successUrl: args.successUrl } : {}),
      ...(args.cancelUrl !== undefined ? { cancelUrl: args.cancelUrl } : {}),
      anchor: resolvedAnchor,
      ...(args.correlationId !== undefined ? { correlationId: args.correlationId } : {}),
      expiresAt: now + PAYMENT_INTENT_EXPIRY_MS,
      stageTimestamps: {
        created: now,
      },
      createdAt: now,
      updatedAt: now,
    });
    if (await commercialEnforcementEnabled(ctx, auth.project, currentBillingNetwork())) {
      const reservation = await reserveCommercialCredit(ctx, {
        project: auth.project,
        paymentIntentId,
        network: currentBillingNetwork(),
        expiresAt: now + PAYMENT_INTENT_EXPIRY_MS,
      });
      if (!reservation.applied && reservation.reason === "insufficient_balance") {
        throw new ConvexError({
          code: "INSUFFICIENT_BILLING_CREDITS",
          message: "Organization has no available commercial credits",
        });
      }
    }
    await scheduleShadowEvaluation(ctx, {
      phase: "would_reserve",
      projectId: auth.project._id,
      paymentIntentId,
      route: "stellar",
      idempotencyKey: `shadow:reserve:${paymentIntentId}`,
    });
    if (args.correlationId !== undefined) {
      await recordSpan(
        ctx,
        "velo.convex.operation",
        "payment_intent.create",
        "mutation",
        "success",
        {
          requestCorrelationId: args.correlationId,
          journeyCorrelationId: args.correlationId,
          durationMs: Date.now() - startedAt,
        },
      );
    }

    if (args.idempotencyKey !== undefined) {
      await ctx.db.insert("paymentIntentIdempotencyKeys", {
        projectId: auth.project._id,
        key: args.idempotencyKey,
        requestFingerprint,
        paymentIntentId,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (await hasEnabledWebhookForEvent(ctx, auth.project._id, "payment.created")) {
      await ctx.scheduler.runAfter(0, internal.webhookDelivery.trigger, {
        projectId: auth.project._id,
        eventType: "payment.created",
        paymentIntentId,
        ...(args.correlationId !== undefined ? { correlationId: args.correlationId } : {}),
      });
    }

    const intent = await ctx.db.get(paymentIntentId);
    if (!intent) {
      throw new ConvexError("Payment intent not found after creation");
    }

    return {
      authorized: true as const,
      idempotencyReplay: false as const,
      projectId: auth.project._id,
      intent,
    };
  },
});

/**
 * Updates a payment intent's status with state machine validation.
 * Used by the checkout page to transition status.
 */
export const updateStatus = mutation({
  args: {
    paymentIntentId: v.id("paymentIntents"),
    status: v.union(
      v.literal("pending"),
      v.literal("paid"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    payerAddress: v.optional(v.string()),
    txHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.status === "paid") {
      throw new ConvexError("Public mutation cannot mark payment intent paid");
    }

    const intent = await ctx.db.get(args.paymentIntentId);
    if (!intent) {
      throw new ConvexError("Payment intent not found");
    }

    if (args.status === "pending" && intent.anchor === "pdax") {
      throw new ConvexError({
        code: "PDAX_UNAVAILABLE",
        message:
          "This legacy PDAX checkout cannot accept a new payment submission. Create a new in-house checkout instead.",
      });
    }

    const now = Date.now();

    // Check expiry for non-terminal transitions
    if (args.status === "pending" && now > intent.expiresAt) {
      await ctx.db.patch(args.paymentIntentId, {
        status: "expired",
        updatedAt: now,
      });
      throw new ConvexError("Payment intent has expired");
    }

    // Validate state machine transition
    const allowedTransitions = STATUS_TRANSITIONS[intent.status];
    if (!allowedTransitions || !allowedTransitions.has(args.status)) {
      throw new ConvexError(`Invalid status transition: ${intent.status} → ${args.status}`);
    }

    const patch: Record<string, unknown> = {
      status: args.status,
      updatedAt: now,
    };

    if (args.payerAddress !== undefined) {
      patch.payerAddress = args.payerAddress;
    }

    if (args.txHash !== undefined) {
      patch.txHash = args.txHash;
    }

    const stageKey = args.status === "pending" ? "submitted" : args.status;
    const updatedStageTimestamps = intent.stageTimestamps
      ? { ...intent.stageTimestamps, [stageKey]: now }
      : { created: intent.createdAt, [stageKey]: now };
    patch.stageTimestamps = updatedStageTimestamps;

    await ctx.db.patch(args.paymentIntentId, patch);
    await markTopupTerminal(ctx, intent, args.status);

    if (args.status === "failed" || args.status === "cancelled") {
      if (intent.intentType !== "billing_topup") {
        await releaseCommercialReservation(ctx, intent._id, args.status);
        if (intent.anchor !== "pdax") {
          await scheduleShadowEvaluation(ctx, {
            phase: "would_release",
            projectId: intent.projectId,
            paymentIntentId: intent._id,
            route: "stellar",
            idempotencyKey: `shadow:release:${intent._id}:${args.status}`,
          });
        }
      }
    }

    if (args.status === "pending") {
      const existingJob = await ctx.db
        .query("paymentReconciliationJobs")
        .withIndex("by_payment_intent", (q) => q.eq("paymentIntentId", args.paymentIntentId))
        .unique();
      if (!existingJob) {
        await ctx.db.insert("paymentReconciliationJobs", {
          paymentIntentId: args.paymentIntentId,
          projectId: intent.projectId,
          ...(args.txHash ? { txHash: args.txHash } : {}),
          state: "pending",
          attemptCount: 0,
          nextAttemptAt: now,
          leaseGeneration: 0,
          expiresAt: now + 30 * 60_000,
          createdAt: now,
          updatedAt: now,
        });
      }
      if (args.txHash) {
        await ctx.scheduler.runAfter(0, internal.payment_intents.scanner.watchTransaction, {
          paymentIntentId: args.paymentIntentId,
          txHash: args.txHash,
        });
      }
    }

    if (
      args.status === "failed" &&
      (await hasEnabledWebhookForEvent(ctx, intent.projectId, "payment.failed"))
    ) {
      await ctx.scheduler.runAfter(0, internal.webhookDelivery.trigger, {
        projectId: intent.projectId,
        eventType: "payment.failed",
        paymentIntentId: args.paymentIntentId,
        ...(intent.correlationId !== undefined ? { correlationId: intent.correlationId } : {}),
      });
    }
  },
});

/**
 * Marks a payment intent paid after backend ledger verification.
 * This is intentionally internal so clients cannot equate Horizon submission with settlement.
 */
export const markVerifiedPaid = internalMutation({
  args: {
    paymentIntentId: v.id("paymentIntents"),
    txHash: v.string(),
    verifiedPayment: v.object({
      source: v.string(),
      destination: v.string(),
      amount: v.string(),
      asset: v.string(),
    }),
    verifiedNetwork: v.optional(v.union(v.literal("testnet"), v.literal("public"))),
    observedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.paymentIntentId);
    if (!intent) {
      throw new ConvexError("Payment intent not found");
    }

    if (!paymentMatchesIntent(args.verifiedPayment, intent)) {
      if (intent.intentType === "billing_topup") {
        await recordTopupException(ctx, {
          intent,
          exceptionType: "topup_mismatch",
          reason: "Verified payment does not match the snapshotted top-up terms",
          transactionHash: args.txHash,
        });
        await ctx.db.patch(intent._id, { status: "failed", updatedAt: Date.now() });
        return { applied: false as const, projectId: intent.projectId, exception: true as const };
      }
      throw new ConvexError("Verified Stellar payment does not match payment intent");
    }
    const verifiedNetwork = args.verifiedNetwork ?? "testnet";
    if ((intent.network ?? "testnet") !== verifiedNetwork) {
      if (intent.intentType === "billing_topup") {
        await recordTopupException(ctx, {
          intent,
          exceptionType: "topup_mismatch",
          reason: "Verified network does not match the snapshotted top-up network",
          transactionHash: args.txHash,
        });
        await ctx.db.patch(intent._id, { status: "failed", updatedAt: Date.now() });
        return { applied: false as const, projectId: intent.projectId, exception: true as const };
      }
      throw new ConvexError("Verified Stellar payment network does not match payment intent");
    }

    const verifiedTxHash = args.txHash.trim().toLowerCase();
    const existingClaim = await ctx.db
      .query("paymentIntents")
      .withIndex("by_verified_tx_hash", (q) => q.eq("verifiedTxHash", verifiedTxHash))
      .unique();
    if (existingClaim && existingClaim._id !== args.paymentIntentId) {
      if (intent.intentType === "billing_topup") {
        await recordTopupException(ctx, {
          intent,
          exceptionType: "reused_transaction",
          reason: "Verified transaction is already assigned to another intent",
          transactionHash: args.txHash,
        });
        await ctx.db.patch(intent._id, { status: "failed", updatedAt: Date.now() });
        return { applied: false as const, projectId: intent.projectId, exception: true as const };
      }
      throw new ConvexError("Verified Stellar transaction is already assigned to another intent");
    }

    const legacyHashVariants = new Set([
      args.txHash,
      args.txHash.trim(),
      verifiedTxHash,
      verifiedTxHash.toUpperCase(),
    ]);
    let hasLegacyClaim = false;
    for (const txHash of legacyHashVariants) {
      const legacyClaims = await ctx.db
        .query("paymentIntents")
        .withIndex("by_tx_hash", (q) => q.eq("txHash", txHash))
        .collect();
      if (
        legacyClaims.some((claim) => claim._id !== args.paymentIntentId && claim.status === "paid")
      ) {
        hasLegacyClaim = true;
      }
    }
    if (hasLegacyClaim) {
      if (intent.intentType === "billing_topup") {
        await recordTopupException(ctx, {
          intent,
          exceptionType: "reused_transaction",
          reason: "Verified transaction is already assigned to a paid legacy intent",
          transactionHash: args.txHash,
        });
        await ctx.db.patch(intent._id, { status: "failed", updatedAt: Date.now() });
        return { applied: false as const, projectId: intent.projectId, exception: true as const };
      }
      throw new ConvexError("Verified Stellar transaction is already assigned to another intent");
    }

    if (intent.status === "paid") {
      if ((intent.verifiedTxHash ?? intent.txHash?.toLowerCase()) === verifiedTxHash) {
        if (intent.verifiedTxHash === undefined) {
          await ctx.db.patch(intent._id, { verifiedTxHash });
        }
        return { applied: false as const, projectId: intent.projectId };
      }
      throw new ConvexError("Paid payment intent has a different verified transaction hash");
    }

    const now = Date.now();
    if (now > intent.expiresAt) {
      await ctx.db.patch(args.paymentIntentId, {
        status: "expired",
        updatedAt: now,
      });
      throw new ConvexError("Payment intent has expired");
    }

    if (intent.status !== "pending") {
      throw new ConvexError(`Invalid verified paid transition: ${intent.status} -> paid`);
    }

    const project = await ctx.db.get(intent.projectId);
    if (!project) {
      throw new ConvexError("Payment intent project not found");
    }

    const observedAt = Math.min(now, Math.max(intent.createdAt, args.observedAt ?? now));
    const updatedStageTimestamps = intent.stageTimestamps
      ? { ...intent.stageTimestamps, observed: observedAt, confirmed: now }
      : { created: intent.createdAt, observed: observedAt, confirmed: now };

    if (intent.intentType === "billing_topup") {
      await settleTopup(ctx, {
        intent,
        transactionHash: verifiedTxHash,
        verifiedNetwork,
        verifiedPayment: args.verifiedPayment,
        now,
      });
    } else if (intent.anchor !== "pdax") {
      await consumeCommercialReservation(ctx, intent._id, verifiedTxHash);
    }

    await ctx.db.patch(args.paymentIntentId, {
      status: "paid",
      txHash: verifiedTxHash,
      verifiedTxHash,
      updatedAt: now,
      stageTimestamps: updatedStageTimestamps,
    });
    if (intent.intentType !== "billing_topup" && intent.anchor !== "pdax") {
      await scheduleShadowEvaluation(ctx, {
        phase: "would_consume",
        projectId: intent.projectId,
        paymentIntentId: intent._id,
        route: "stellar",
        idempotencyKey: `shadow:consume:stellar:${intent._id}:${verifiedTxHash}`,
        transactionHash: verifiedTxHash,
      });
    }

    if (
      intent.intentType !== "billing_topup" &&
      project.checkoutCredits !== undefined &&
      project.checkoutCredits > 0
    ) {
      await ctx.db.patch(project._id, {
        checkoutCredits: project.checkoutCredits - 1,
        updatedAt: now,
      });
    }

    if (
      intent.intentType !== "billing_topup" &&
      (await hasEnabledWebhookForEvent(ctx, intent.projectId, "payment.succeeded"))
    ) {
      await ctx.scheduler.runAfter(0, internal.webhookDelivery.trigger, {
        projectId: intent.projectId,
        eventType: "payment.succeeded",
        paymentIntentId: args.paymentIntentId,
        ...(intent.correlationId !== undefined ? { correlationId: intent.correlationId } : {}),
      });
    }

    return { applied: true as const, projectId: intent.projectId };
  },
});

export const prepareOrInsertPaymentIntentV2 = internalMutation({
  args: {
    apiKeyHash: v.string(),
    correlationId: v.optional(v.string()),
    amount: v.string(),
    asset: v.string(),
    description: v.optional(v.string()),
    successUrl: v.optional(v.string()),
    cancelUrl: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
    anchor: v.optional(v.union(v.literal("inhouse"), v.literal("pdax"))),
  },
  handler: async (ctx, args) => {
    const startedAt = Date.now();
    const auth = await verifyApiKeyForPayments(ctx, args.apiKeyHash);
    if (!auth.authorized) {
      return { status: "unauthorized" as const, reason: auth.reason };
    }

    const resolvedAnchor = resolveActivePaymentAnchor({
      requestedAnchor: args.anchor,
      apiKeyAnchor: auth.apiKey.paymentAnchor,
      projectDefaultAnchor: auth.project.defaultPaymentAnchor,
    });

    const now = Date.now();

    if (args.idempotencyKey !== undefined) {
      const existing = await ctx.db
        .query("paymentIntentIdempotencyKeys")
        .withIndex("by_project_and_key", (q) =>
          q.eq("projectId", auth.project._id).eq("key", args.idempotencyKey!),
        )
        .unique();

      if (existing) {
        const requestFingerprint = createPaymentIntentFingerprint({
          amount: args.amount,
          asset: args.asset,
          description: args.description,
          successUrl: args.successUrl,
          cancelUrl: args.cancelUrl,
          anchor: resolvedAnchor,
        });

        if (existing.requestFingerprint !== requestFingerprint) {
          return {
            status: "idempotency_conflict" as const,
            projectId: auth.project._id,
          };
        }

        const intent = await ctx.db.get(existing.paymentIntentId);
        if (intent && intent.projectId === auth.project._id) {
          return {
            status: "idempotency_replay" as const,
            projectId: auth.project._id,
            intent,
          };
        }
      }
    }

    if (auth.project.retiredAt !== undefined) {
      return { status: "unauthorized" as const, reason: "Project is retired." };
    }

    const paymentIntentId = await ctx.db.insert("paymentIntents", {
      projectId: auth.project._id,
      network: currentBillingNetwork(),
      intentType: "merchant_payment",
      amount: args.amount,
      asset: args.asset,
      receiverAddress: auth.project.ownerAddress,
      merchantName: auth.project.name,
      ...(args.description !== undefined ? { description: args.description } : {}),
      status: "created",
      ...(args.successUrl !== undefined ? { successUrl: args.successUrl } : {}),
      ...(args.cancelUrl !== undefined ? { cancelUrl: args.cancelUrl } : {}),
      anchor: "inhouse",
      ...(args.correlationId !== undefined ? { correlationId: args.correlationId } : {}),
      expiresAt: now + PAYMENT_INTENT_EXPIRY_MS,
      stageTimestamps: {
        created: now,
      },
      createdAt: now,
      updatedAt: now,
    });
    const enforcement = await enforceNewCommercialIntent(ctx, {
      project: auth.project,
      paymentIntentId,
      network: currentBillingNetwork(),
      expiresAt: now + PAYMENT_INTENT_EXPIRY_MS,
    });
    if (!enforcement.allowed) {
      throw new ConvexError({
        code: "INSUFFICIENT_BILLING_CREDITS",
        message: "Organization has no available commercial credits",
      });
    }
    await scheduleShadowEvaluation(ctx, {
      phase: "would_reserve",
      projectId: auth.project._id,
      paymentIntentId,
      route: "stellar",
      idempotencyKey: `shadow:reserve:${paymentIntentId}`,
    });

    if (args.correlationId !== undefined) {
      await recordSpan(
        ctx,
        "velo.convex.operation",
        "payment_intent.create.v2",
        "mutation",
        "success",
        {
          requestCorrelationId: args.correlationId,
          journeyCorrelationId: args.correlationId,
          durationMs: Date.now() - startedAt,
        },
      );
    }

    if (args.idempotencyKey !== undefined) {
      const requestFingerprint = createPaymentIntentFingerprint({
        amount: args.amount,
        asset: args.asset,
        description: args.description,
        successUrl: args.successUrl,
        cancelUrl: args.cancelUrl,
        anchor: "inhouse",
      });

      await ctx.db.insert("paymentIntentIdempotencyKeys", {
        projectId: auth.project._id,
        key: args.idempotencyKey,
        requestFingerprint,
        paymentIntentId,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (await hasEnabledWebhookForEvent(ctx, auth.project._id, "payment.created")) {
      await ctx.scheduler.runAfter(0, internal.webhookDelivery.trigger, {
        projectId: auth.project._id,
        eventType: "payment.created",
        paymentIntentId,
        ...(args.correlationId !== undefined ? { correlationId: args.correlationId } : {}),
      });
    }

    const intent = await ctx.db.get(paymentIntentId);
    if (!intent) {
      throw new ConvexError("Payment intent not found after creation");
    }

    return {
      status: "inhouse_success" as const,
      projectId: auth.project._id,
      intent,
    };
  },
});

export const insertPublicPaymentIntentV2 = internalMutation({
  args: {
    apiKeyHash: v.string(),
    correlationId: v.optional(v.string()),
    amount: v.string(),
    asset: v.string(),
    description: v.optional(v.string()),
    successUrl: v.optional(v.string()),
    cancelUrl: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
    anchor: v.union(v.literal("inhouse"), v.literal("pdax")),
    receiverAddress: v.string(),
    receiverMemo: v.optional(v.string()),
    anchorDepositCurrency: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await verifyApiKeyForPayments(ctx, args.apiKeyHash);
    if (!auth.authorized) {
      return { status: "unauthorized" as const, reason: auth.reason || "Unauthorized" };
    }

    resolveActivePaymentAnchor({ requestedAnchor: args.anchor });

    const now = Date.now();

    if (args.idempotencyKey !== undefined) {
      const existing = await ctx.db
        .query("paymentIntentIdempotencyKeys")
        .withIndex("by_project_and_key", (q) =>
          q.eq("projectId", auth.project._id).eq("key", args.idempotencyKey!),
        )
        .unique();

      if (existing) {
        const requestFingerprint = createPaymentIntentFingerprint({
          amount: args.amount,
          asset: args.asset,
          description: args.description,
          successUrl: args.successUrl,
          cancelUrl: args.cancelUrl,
          anchor: args.anchor,
        });

        if (existing.requestFingerprint !== requestFingerprint) {
          return { status: "idempotency_conflict" as const };
        }

        const intent = await ctx.db.get(existing.paymentIntentId);
        if (intent && intent.projectId === auth.project._id) {
          return { status: "idempotency_replay" as const, intent };
        }
      }
    }

    if (auth.project.retiredAt !== undefined) {
      return { status: "unauthorized" as const, reason: "Project is retired." };
    }

    const paymentIntentId = await ctx.db.insert("paymentIntents", {
      projectId: auth.project._id,
      network: currentBillingNetwork(),
      intentType: "merchant_payment",
      amount: args.amount,
      asset: args.asset,
      receiverAddress: args.receiverAddress,
      merchantName: auth.project.name,
      ...(args.description !== undefined ? { description: args.description } : {}),
      status: "created",
      ...(args.successUrl !== undefined ? { successUrl: args.successUrl } : {}),
      ...(args.cancelUrl !== undefined ? { cancelUrl: args.cancelUrl } : {}),
      anchor: "inhouse",
      ...(args.correlationId !== undefined ? { correlationId: args.correlationId } : {}),
      receiverMemo: args.receiverMemo,
      anchorDepositCurrency: args.anchorDepositCurrency,
      expiresAt: now + PAYMENT_INTENT_EXPIRY_MS,
      stageTimestamps: {
        created: now,
      },
      createdAt: now,
      updatedAt: now,
    });
    const enforcement = await enforceNewCommercialIntent(ctx, {
      project: auth.project,
      paymentIntentId,
      network: currentBillingNetwork(),
      expiresAt: now + PAYMENT_INTENT_EXPIRY_MS,
    });
    if (!enforcement.allowed) {
      throw new ConvexError({
        code: "INSUFFICIENT_BILLING_CREDITS",
        message: "Organization has no available commercial credits",
      });
    }
    await scheduleShadowEvaluation(ctx, {
      phase: "would_reserve",
      projectId: auth.project._id,
      paymentIntentId,
      route: "stellar",
      idempotencyKey: `shadow:reserve:${paymentIntentId}`,
    });

    if (args.idempotencyKey !== undefined) {
      const requestFingerprint = createPaymentIntentFingerprint({
        amount: args.amount,
        asset: args.asset,
        description: args.description,
        successUrl: args.successUrl,
        cancelUrl: args.cancelUrl,
        anchor: args.anchor,
      });

      await ctx.db.insert("paymentIntentIdempotencyKeys", {
        projectId: auth.project._id,
        key: args.idempotencyKey,
        requestFingerprint,
        paymentIntentId,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (await hasEnabledWebhookForEvent(ctx, auth.project._id, "payment.created")) {
      await ctx.scheduler.runAfter(0, internal.webhookDelivery.trigger, {
        projectId: auth.project._id,
        eventType: "payment.created",
        paymentIntentId,
        ...(args.correlationId !== undefined ? { correlationId: args.correlationId } : {}),
      });
    }

    const intent = await ctx.db.get(paymentIntentId);
    if (!intent) {
      throw new ConvexError("Payment intent not found after creation");
    }

    return { status: "success" as const, intent };
  },
});

export const createPublicPaymentIntentV2 = internalMutation({
  args: {
    apiKeyHash: v.string(),
    correlationId: v.optional(v.string()),
    traceparent: v.optional(v.string()),
    amount: v.string(),
    asset: v.string(),
    description: v.optional(v.string()),
    successUrl: v.optional(v.string()),
    cancelUrl: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
    anchor: v.optional(v.union(v.literal("inhouse"), v.literal("pdax"))),
  },
  handler: async (ctx, args) => {
    const startedAt = Date.now();
    const auth = await verifyApiKeyForPayments(ctx, args.apiKeyHash);
    const authCompletedAt = Date.now();
    if (!auth.authorized) return { status: "unauthorized" as const, reason: auth.reason };

    const resolvedAnchor = resolveActivePaymentAnchor({
      requestedAnchor: args.anchor,
      apiKeyAnchor: auth.apiKey.paymentAnchor,
      projectDefaultAnchor: auth.project.defaultPaymentAnchor,
    });
    const fingerprint = createPaymentIntentFingerprint({ ...args, anchor: resolvedAnchor });
    const now = Date.now();
    if (args.idempotencyKey !== undefined) {
      const existing = await ctx.db
        .query("paymentIntentIdempotencyKeys")
        .withIndex("by_project_and_key", (q) =>
          q.eq("projectId", auth.project._id).eq("key", args.idempotencyKey!),
        )
        .unique();
      if (existing) {
        if (existing.requestFingerprint !== fingerprint) {
          await recordMetric(
            ctx,
            "velo_idempotency_contention_total",
            "payment_intent_create",
            "mutation",
            "rejected",
          );
          return { status: "idempotency_conflict" as const, projectId: auth.project._id };
        }
        const intent = await ctx.db.get(existing.paymentIntentId);
        if (intent?.projectId === auth.project._id) {
          return {
            status: "idempotency_replay" as const,
            projectId: auth.project._id,
            intent,
            timings: { authMs: authCompletedAt - startedAt, totalMs: Date.now() - startedAt },
          };
        }
      }
    }

    if (auth.project.retiredAt !== undefined) {
      return { status: "unauthorized" as const, reason: "Project is retired." };
    }

    if (auth.project.retiredAt !== undefined) {
      return { status: "unauthorized" as const, reason: "Project is retired." };
    }

    const paymentIntentId = await ctx.db.insert("paymentIntents", {
      projectId: auth.project._id,
      network: currentBillingNetwork(),
      intentType: "merchant_payment",
      amount: args.amount,
      asset: args.asset,
      receiverAddress: auth.project.ownerAddress,
      merchantName: auth.project.name,
      ...(args.description !== undefined ? { description: args.description } : {}),
      status: "created",
      ...(args.successUrl !== undefined ? { successUrl: args.successUrl } : {}),
      ...(args.cancelUrl !== undefined ? { cancelUrl: args.cancelUrl } : {}),
      anchor: resolvedAnchor,
      ...(args.correlationId !== undefined ? { correlationId: args.correlationId } : {}),
      ...(args.traceparent !== undefined ? { traceparent: args.traceparent } : {}),
      expiresAt: now + PAYMENT_INTENT_EXPIRY_MS,
      stageTimestamps: {
        created: now,
      },
      createdAt: now,
      updatedAt: now,
    });
    const enforcement = await enforceNewCommercialIntent(ctx, {
      project: auth.project,
      paymentIntentId,
      network: currentBillingNetwork(),
      expiresAt: now + PAYMENT_INTENT_EXPIRY_MS,
    });
    if (!enforcement.allowed) {
      throw new ConvexError({
        code: "INSUFFICIENT_BILLING_CREDITS",
        message: "Organization has no available commercial credits",
      });
    }
    await scheduleShadowEvaluation(ctx, {
      phase: "would_reserve",
      projectId: auth.project._id,
      paymentIntentId,
      route: "stellar",
      idempotencyKey: `shadow:reserve:${paymentIntentId}`,
    });

    if (args.correlationId !== undefined) {
      await recordSpan(
        ctx,
        "velo.convex.operation",
        "payment_intent.create.public_v2",
        "mutation",
        "success",
        {
          requestCorrelationId: args.correlationId,
          journeyCorrelationId: args.correlationId,
          ...(args.traceparent !== undefined ? { traceparent: args.traceparent } : {}),
          durationMs: Date.now() - startedAt,
        },
      );
    }

    if (args.idempotencyKey !== undefined) {
      await ctx.db.insert("paymentIntentIdempotencyKeys", {
        projectId: auth.project._id,
        key: args.idempotencyKey,
        requestFingerprint: fingerprint,
        paymentIntentId,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (await hasEnabledWebhookForEvent(ctx, auth.project._id, "payment.created")) {
      await ctx.scheduler.runAfter(0, internal.webhookDelivery.trigger, {
        projectId: auth.project._id,
        eventType: "payment.created",
        paymentIntentId,
        ...(args.correlationId !== undefined ? { correlationId: args.correlationId } : {}),
      });
    }

    const intent = await ctx.db.get(paymentIntentId);
    if (!intent) throw new ConvexError("Payment intent not found after creation");
    return {
      status: "success" as const,
      projectId: auth.project._id,
      intent,
      timings: { authMs: authCompletedAt - startedAt, totalMs: Date.now() - startedAt },
    };
  },
});

export const createAuthorizedPaymentIntentV2 = internalMutation({
  args: {
    apiKeyId: v.id("apiKeys"),
    projectId: v.id("projects"),
    apiKeyHash: v.string(),
    expectedRateLimitBackend: v.union(v.literal("convex"), v.literal("upstash")),
    admissionId: v.string(),
    correlationId: v.optional(v.string()),
    traceparent: v.optional(v.string()),
    amount: v.string(),
    asset: v.string(),
    description: v.optional(v.string()),
    successUrl: v.optional(v.string()),
    cancelUrl: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
    anchor: v.optional(v.union(v.literal("inhouse"), v.literal("pdax"))),
  },
  handler: async (ctx, args) => {
    const startedAt = Date.now();
    const [apiKey, project] = await Promise.all([
      ctx.db.get(args.apiKeyId),
      ctx.db.get(args.projectId),
    ]);
    const currentBackend = project?.rateLimitBackend ?? "convex";
    if (
      !apiKey ||
      apiKey.revoked ||
      !canUseGeneralApi(apiKey) ||
      apiKey.keyHash !== args.apiKeyHash ||
      apiKey.projectId !== args.projectId ||
      !project ||
      !project.paymentAccessActive
    ) {
      return { status: "unauthorized" as const };
    }
    if (currentBackend === "migrating" || currentBackend !== args.expectedRateLimitBackend) {
      return { status: "limiter_unavailable" as const };
    }

    const resolvedAnchor = resolveActivePaymentAnchor({
      requestedAnchor: args.anchor,
      apiKeyAnchor: apiKey.paymentAnchor,
      projectDefaultAnchor: project.defaultPaymentAnchor,
    });
    const fingerprint = createPaymentIntentFingerprint({ ...args, anchor: resolvedAnchor });
    const effectiveIdempotencyKey = args.idempotencyKey ?? `\u0000admission:${args.admissionId}`;
    const now = Date.now();
    const existing = await ctx.db
      .query("paymentIntentIdempotencyKeys")
      .withIndex("by_project_and_key", (q) =>
        q.eq("projectId", project._id).eq("key", effectiveIdempotencyKey),
      )
      .unique();
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) {
        return { status: "idempotency_conflict" as const, projectId: project._id };
      }
      const intent = await ctx.db.get(existing.paymentIntentId);
      if (intent?.projectId === project._id) {
        return {
          status: "idempotency_replay" as const,
          projectId: project._id,
          intent,
          timings: { createMs: Date.now() - startedAt },
        };
      }
    }

    if (project.retiredAt !== undefined) {
      return { status: "unauthorized" as const };
    }

    const intentFields = {
      projectId: project._id,
      network: currentBillingNetwork(),
      intentType: "merchant_payment" as const,
      amount: args.amount,
      asset: args.asset,
      receiverAddress: project.ownerAddress,
      merchantName: project.name,
      ...(args.description !== undefined ? { description: args.description } : {}),
      status: "created" as const,
      ...(args.successUrl !== undefined ? { successUrl: args.successUrl } : {}),
      ...(args.cancelUrl !== undefined ? { cancelUrl: args.cancelUrl } : {}),
      anchor: resolvedAnchor,
      ...(args.correlationId !== undefined ? { correlationId: args.correlationId } : {}),
      ...(args.traceparent !== undefined ? { traceparent: args.traceparent } : {}),
      expiresAt: now + PAYMENT_INTENT_EXPIRY_MS,
      stageTimestamps: {
        created: now,
      },
      createdAt: now,
      updatedAt: now,
    };
    const paymentIntentId = await ctx.db.insert("paymentIntents", intentFields);
    const enforcement = await enforceNewCommercialIntent(ctx, {
      project,
      paymentIntentId,
      network: currentBillingNetwork(),
      expiresAt: now + PAYMENT_INTENT_EXPIRY_MS,
    });
    if (!enforcement.allowed) {
      throw new ConvexError({
        code: "INSUFFICIENT_BILLING_CREDITS",
        message: "Organization has no available commercial credits",
      });
    }
    await scheduleShadowEvaluation(ctx, {
      phase: "would_reserve",
      projectId: project._id,
      paymentIntentId,
      route: "stellar",
      idempotencyKey: `shadow:reserve:${paymentIntentId}`,
    });

    if (args.correlationId !== undefined) {
      await recordSpan(
        ctx,
        "velo.convex.operation",
        "payment_intent.create.public_action",
        "mutation",
        "success",
        {
          requestCorrelationId: args.correlationId,
          journeyCorrelationId: args.correlationId,
          ...(args.traceparent !== undefined ? { traceparent: args.traceparent } : {}),
          durationMs: Date.now() - startedAt,
        },
      );
    }

    await ctx.db.insert("paymentIntentIdempotencyKeys", {
      projectId: project._id,
      key: effectiveIdempotencyKey,
      requestFingerprint: fingerprint,
      paymentIntentId,
      createdAt: now,
      updatedAt: now,
    });

    if (await hasEnabledWebhookForEvent(ctx, project._id, "payment.created")) {
      await ctx.scheduler.runAfter(0, internal.webhookDelivery.trigger, {
        projectId: project._id,
        eventType: "payment.created",
        paymentIntentId,
        ...(args.correlationId !== undefined ? { correlationId: args.correlationId } : {}),
      });
    }

    return {
      status: "success" as const,
      projectId: project._id,
      intent: { _id: paymentIntentId, ...intentFields },
      timings: { createMs: Date.now() - startedAt },
    };
  },
});

/** Compatibility target for queued legacy route recovery jobs. */
export const recoverPdaxRouteJobs = internalMutation({
  args: { limit: v.number() },
  handler: async () => ({ recovered: 0, expired: 0 }),
});
