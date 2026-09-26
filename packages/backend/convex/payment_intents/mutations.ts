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
  mapAssetToPdax,
  PAYMENT_INTENT_EXPIRY_MS,
  STATUS_TRANSITIONS,
  resolvePaymentAnchor,
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
    const resolvedAnchor = resolvePaymentAnchor({
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
      route: resolvedAnchor === "pdax" ? "pdax" : "stellar",
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

    const resolvedAnchor = resolvePaymentAnchor({
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
    const mappedAsset = resolvedAnchor === "pdax" ? mapAssetToPdax(asset) : undefined;
    let cachedPdaxRoute: { address: string; memo?: string; mappedAsset: string } | undefined;
    if (resolvedAnchor === "pdax") {
      const connection = await ctx.db
        .query("providerConnections")
        .withIndex("by_project_provider", (q) =>
          q.eq("projectId", project._id).eq("provider", "pdax"),
        )
        .unique();
      if (connection?.status !== "connected") {
        throw new ConvexError("PDAX provider is not connected for this project.");
      }
      const cached = await ctx.db
        .query("pdaxRouteCache")
        .withIndex("by_project_and_mapped_asset", (q) =>
          q.eq("projectId", project._id).eq("mappedAsset", mappedAsset!),
        )
        .unique();
      if (cached && cached.expiresAt > now) {
        cachedPdaxRoute = {
          address: cached.address,
          ...(cached.memo !== undefined ? { memo: cached.memo } : {}),
          mappedAsset: cached.mappedAsset,
        };
      }
    }

    const intentFields = {
      projectId: project._id,
      network: currentBillingNetwork(),
      intentType: "merchant_payment" as const,
      amount,
      asset,
      ...(resolvedAnchor === "inhouse"
        ? { receiverAddress: project.ownerAddress }
        : cachedPdaxRoute
          ? {
              receiverAddress: cachedPdaxRoute.address,
              ...(cachedPdaxRoute.memo !== undefined ? { receiverMemo: cachedPdaxRoute.memo } : {}),
              anchorDepositCurrency: cachedPdaxRoute.mappedAsset,
            }
          : {}),
      merchantName: project.name,
      ...(description !== undefined ? { description } : {}),
      status:
        resolvedAnchor === "pdax" && !cachedPdaxRoute
          ? ("awaiting_route" as const)
          : ("created" as const),
      anchor: resolvedAnchor,
      correlationId: `dashboard:${requestId}`,
      expiresAt: now + PAYMENT_INTENT_EXPIRY_MS,
      stageTimestamps: {
        created: now,
        ...(cachedPdaxRoute ? { routeReady: now } : {}),
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
      route: resolvedAnchor === "pdax" ? "pdax" : "stellar",
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

    if (resolvedAnchor === "pdax" && !cachedPdaxRoute) {
      await ctx.db.insert("paymentIntentRouteJobs", {
        paymentIntentId,
        projectId: project._id,
        mappedAsset: mappedAsset!,
        state: "scheduled",
        attempts: 0,
        nextAttemptAt: now,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.payment_intents.actions.enrichPdaxRoute, {
        paymentIntentId,
      });
    } else if (await hasEnabledWebhookForEvent(ctx, project._id, "payment.created")) {
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
    const resolvedAnchor = resolvePaymentAnchor({
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
      route: resolvedAnchor === "pdax" ? "pdax" : "stellar",
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
        await scheduleShadowEvaluation(ctx, {
          phase: "would_release",
          projectId: intent.projectId,
          paymentIntentId: intent._id,
          route: intent.anchor === "pdax" ? "pdax" : "stellar",
          idempotencyKey: `shadow:release:${intent._id}:${args.status}`,
        });
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

    const resolvedAnchor = resolvePaymentAnchor({
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

    if (resolvedAnchor === "pdax") {
      const connection = await ctx.db
        .query("providerConnections")
        .withIndex("by_project_provider", (q) =>
          q.eq("projectId", auth.project._id).eq("provider", "pdax"),
        )
        .unique();

      const hasPdaxConnection = connection ? connection.status === "connected" : false;
      if (!hasPdaxConnection) {
        return {
          status: "pdax_not_connected" as const,
          reason: "PDAX provider not connected for this project.",
        };
      }

      return {
        status: "pdax_required" as const,
        projectId: auth.project._id,
      };
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
      anchor: args.anchor,
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
      route: args.anchor === "pdax" ? "pdax" : "stellar",
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

const ROUTE_JOB_LEASE_MS = 8_500;
const ROUTE_CACHE_TTL_MS = 5 * 60 * 1000;
const CIRCUIT_OPEN_MS = 30_000;
const MAX_ROUTE_ATTEMPTS = 5;
const ROUTE_RETRY_DELAYS_MS = [1_000, 5_000, 30_000, 60_000] as const;

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

    const resolvedAnchor = resolvePaymentAnchor({
      requestedAnchor: args.anchor,
      apiKeyAnchor: auth.apiKey.paymentAnchor,
      projectDefaultAnchor: auth.project.defaultPaymentAnchor,
    });
    const fingerprint = createPaymentIntentFingerprint({ ...args, anchor: resolvedAnchor });
    const now = Date.now();
    const mappedAsset = resolvedAnchor === "pdax" ? mapAssetToPdax(args.asset) : undefined;
    let cachedPdaxRoute: { address: string; memo?: string; mappedAsset: string } | undefined;

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

    if (resolvedAnchor === "pdax") {
      const connection = await ctx.db
        .query("providerConnections")
        .withIndex("by_project_provider", (q) =>
          q.eq("projectId", auth.project._id).eq("provider", "pdax"),
        )
        .unique();
      if (connection?.status !== "connected") {
        return { status: "anchor_not_connected" as const, projectId: auth.project._id };
      }

      const cached = await ctx.db
        .query("pdaxRouteCache")
        .withIndex("by_project_and_mapped_asset", (q) =>
          q.eq("projectId", auth.project._id).eq("mappedAsset", mappedAsset!),
        )
        .unique();
      if (cached && cached.expiresAt > now) {
        cachedPdaxRoute = {
          address: cached.address,
          ...(cached.memo !== undefined ? { memo: cached.memo } : {}),
          mappedAsset: cached.mappedAsset,
        };
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
      ...(resolvedAnchor === "inhouse"
        ? { receiverAddress: auth.project.ownerAddress }
        : cachedPdaxRoute
          ? {
              receiverAddress: cachedPdaxRoute.address,
              ...(cachedPdaxRoute.memo !== undefined ? { receiverMemo: cachedPdaxRoute.memo } : {}),
              anchorDepositCurrency: cachedPdaxRoute.mappedAsset,
            }
          : {}),
      merchantName: auth.project.name,
      ...(args.description !== undefined ? { description: args.description } : {}),
      status: resolvedAnchor === "pdax" && !cachedPdaxRoute ? "awaiting_route" : "created",
      ...(args.successUrl !== undefined ? { successUrl: args.successUrl } : {}),
      ...(args.cancelUrl !== undefined ? { cancelUrl: args.cancelUrl } : {}),
      anchor: resolvedAnchor,
      ...(args.correlationId !== undefined ? { correlationId: args.correlationId } : {}),
      ...(args.traceparent !== undefined ? { traceparent: args.traceparent } : {}),
      expiresAt: now + PAYMENT_INTENT_EXPIRY_MS,
      stageTimestamps: {
        created: now,
        ...(cachedPdaxRoute ? { routeReady: now } : {}),
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
      route: resolvedAnchor === "pdax" ? "pdax" : "stellar",
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

    if (resolvedAnchor === "pdax" && !cachedPdaxRoute) {
      await ctx.db.insert("paymentIntentRouteJobs", {
        paymentIntentId,
        projectId: auth.project._id,
        mappedAsset: mappedAsset!,
        state: "scheduled",
        attempts: 0,
        nextAttemptAt: now,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.payment_intents.actions.enrichPdaxRoute, {
        paymentIntentId,
      });
    } else {
      if (await hasEnabledWebhookForEvent(ctx, auth.project._id, "payment.created")) {
        await ctx.scheduler.runAfter(0, internal.webhookDelivery.trigger, {
          projectId: auth.project._id,
          eventType: "payment.created",
          paymentIntentId,
          ...(args.correlationId !== undefined ? { correlationId: args.correlationId } : {}),
        });
      }
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

    const resolvedAnchor = resolvePaymentAnchor({
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

    const mappedAsset = resolvedAnchor === "pdax" ? mapAssetToPdax(args.asset) : undefined;
    let cachedPdaxRoute: { address: string; memo?: string; mappedAsset: string } | undefined;
    if (resolvedAnchor === "pdax") {
      const connection = await ctx.db
        .query("providerConnections")
        .withIndex("by_project_provider", (q) =>
          q.eq("projectId", project._id).eq("provider", "pdax"),
        )
        .unique();
      if (connection?.status !== "connected") {
        return { status: "anchor_not_connected" as const, projectId: project._id };
      }
      const cached = await ctx.db
        .query("pdaxRouteCache")
        .withIndex("by_project_and_mapped_asset", (q) =>
          q.eq("projectId", project._id).eq("mappedAsset", mappedAsset!),
        )
        .unique();
      if (cached && cached.expiresAt > now) {
        cachedPdaxRoute = {
          address: cached.address,
          ...(cached.memo !== undefined ? { memo: cached.memo } : {}),
          mappedAsset: cached.mappedAsset,
        };
      }
    }

    const intentFields = {
      projectId: project._id,
      network: currentBillingNetwork(),
      intentType: "merchant_payment" as const,
      amount: args.amount,
      asset: args.asset,
      ...(resolvedAnchor === "inhouse"
        ? { receiverAddress: project.ownerAddress }
        : cachedPdaxRoute
          ? {
              receiverAddress: cachedPdaxRoute.address,
              ...(cachedPdaxRoute.memo !== undefined ? { receiverMemo: cachedPdaxRoute.memo } : {}),
              anchorDepositCurrency: cachedPdaxRoute.mappedAsset,
            }
          : {}),
      merchantName: project.name,
      ...(args.description !== undefined ? { description: args.description } : {}),
      status:
        resolvedAnchor === "pdax" && !cachedPdaxRoute
          ? ("awaiting_route" as const)
          : ("created" as const),
      ...(args.successUrl !== undefined ? { successUrl: args.successUrl } : {}),
      ...(args.cancelUrl !== undefined ? { cancelUrl: args.cancelUrl } : {}),
      anchor: resolvedAnchor,
      ...(args.correlationId !== undefined ? { correlationId: args.correlationId } : {}),
      ...(args.traceparent !== undefined ? { traceparent: args.traceparent } : {}),
      expiresAt: now + PAYMENT_INTENT_EXPIRY_MS,
      stageTimestamps: {
        created: now,
        ...(cachedPdaxRoute ? { routeReady: now } : {}),
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
      route: resolvedAnchor === "pdax" ? "pdax" : "stellar",
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

    if (resolvedAnchor === "pdax" && !cachedPdaxRoute) {
      await ctx.db.insert("paymentIntentRouteJobs", {
        paymentIntentId,
        projectId: project._id,
        mappedAsset: mappedAsset!,
        state: "scheduled",
        attempts: 0,
        nextAttemptAt: now,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.payment_intents.actions.enrichPdaxRoute, {
        paymentIntentId,
      });
    } else if (await hasEnabledWebhookForEvent(ctx, project._id, "payment.created")) {
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

export const claimRouteJob = internalMutation({
  args: { paymentIntentId: v.id("paymentIntents"), leaseToken: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const job = await ctx.db
      .query("paymentIntentRouteJobs")
      .withIndex("by_payment_intent", (q) => q.eq("paymentIntentId", args.paymentIntentId))
      .unique();
    const intent = await ctx.db.get(args.paymentIntentId);
    if (!job || !intent) return { status: "done" as const };
    if (intent.status !== "awaiting_route") {
      if (job.state !== "succeeded" && job.state !== "failed") {
        await ctx.db.patch(job._id, {
          state: "failed",
          lastErrorCode: `intent_${intent.status}`,
          leaseToken: undefined,
          leaseExpiresAt: undefined,
          updatedAt: now,
        });
      }
      return { status: "done" as const };
    }
    if (job.state === "succeeded" || job.state === "failed") return { status: "done" as const };
    if (job.nextAttemptAt > now) return { status: "wait" as const, retryAt: job.nextAttemptAt };
    if (job.leaseExpiresAt && job.leaseExpiresAt > now) {
      return { status: "wait" as const, retryAt: job.leaseExpiresAt };
    }
    await ctx.db.patch(job._id, {
      state: "leased",
      leaseToken: args.leaseToken,
      leaseExpiresAt: now + ROUTE_JOB_LEASE_MS,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      ROUTE_JOB_LEASE_MS,
      internal.payment_intents.actions.enrichPdaxRoute,
      { paymentIntentId: args.paymentIntentId },
    );
    return {
      status: "claimed" as const,
      jobId: job._id,
      projectId: job.projectId,
      mappedAsset: job.mappedAsset,
      correlationId: intent.correlationId,
      traceparent: intent.traceparent,
    };
  },
});

export const claimProviderRoute = internalMutation({
  args: {
    projectId: v.id("projects"),
    mappedAsset: v.string(),
    leaseToken: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const cached = await ctx.db
      .query("pdaxRouteCache")
      .withIndex("by_project_and_mapped_asset", (q) =>
        q.eq("projectId", args.projectId).eq("mappedAsset", args.mappedAsset),
      )
      .unique();
    if (cached && cached.expiresAt > now) {
      await recordMetric(
        ctx,
        "velo_cache_hit_total",
        "pdax_route_lookup",
        "indexed_read",
        "success",
      );
      return { status: "cache_hit" as const, address: cached.address, memo: cached.memo };
    }
    let resilience = await ctx.db
      .query("providerResilience")
      .withIndex("by_project_and_provider", (q) =>
        q.eq("projectId", args.projectId).eq("provider", "pdax"),
      )
      .unique();
    if (resilience?.circuitOpenUntil && resilience.circuitOpenUntil > now) {
      return { status: "circuit_open" as const, retryAt: resilience.circuitOpenUntil };
    }
    if (resilience?.leaseExpiresAt && resilience.leaseExpiresAt > now) {
      return { status: "coalesced" as const, retryAt: resilience.leaseExpiresAt };
    }
    if (resilience) {
      await ctx.db.patch(resilience._id, {
        leaseToken: args.leaseToken,
        leaseExpiresAt: now + ROUTE_JOB_LEASE_MS,
        updatedAt: now,
      });
    } else {
      const id = await ctx.db.insert("providerResilience", {
        projectId: args.projectId,
        provider: "pdax",
        consecutiveFailures: 0,
        leaseToken: args.leaseToken,
        leaseExpiresAt: now + ROUTE_JOB_LEASE_MS,
        updatedAt: now,
      });
      resilience = await ctx.db.get(id);
    }
    return { status: "claimed" as const };
  },
});

export const completePdaxRoute = internalMutation({
  args: {
    paymentIntentId: v.id("paymentIntents"),
    leaseToken: v.string(),
    mappedAsset: v.string(),
    address: v.string(),
    memo: v.optional(v.string()),
    fromCache: v.boolean(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const job = await ctx.db
      .query("paymentIntentRouteJobs")
      .withIndex("by_payment_intent", (q) => q.eq("paymentIntentId", args.paymentIntentId))
      .unique();
    const intent = await ctx.db.get(args.paymentIntentId);
    if (
      !job ||
      job.leaseToken !== args.leaseToken ||
      !job.leaseExpiresAt ||
      job.leaseExpiresAt <= now ||
      intent?.status !== "awaiting_route"
    ) {
      return { applied: false };
    }
    if (intent.expiresAt <= now) {
      await ctx.db.patch(intent._id, {
        status: "expired",
        updatedAt: now,
      });
      await scheduleShadowEvaluation(ctx, {
        phase: "would_release",
        projectId: intent.projectId,
        paymentIntentId: intent._id,
        route: "pdax",
        idempotencyKey: `shadow:release:${intent._id}:expired`,
      });
      await ctx.db.patch(job._id, {
        state: "failed",
        lastErrorCode: "intent_expired",
        leaseToken: undefined,
        leaseExpiresAt: undefined,
        updatedAt: now,
      });
      return { applied: false };
    }
    if (!args.fromCache) {
      const resilience = await ctx.db
        .query("providerResilience")
        .withIndex("by_project_and_provider", (q) =>
          q.eq("projectId", job.projectId).eq("provider", "pdax"),
        )
        .unique();
      if (
        resilience?.leaseToken !== args.leaseToken ||
        !resilience.leaseExpiresAt ||
        resilience.leaseExpiresAt <= now
      ) {
        return { applied: false };
      }
      const cached = await ctx.db
        .query("pdaxRouteCache")
        .withIndex("by_project_and_mapped_asset", (q) =>
          q.eq("projectId", job.projectId).eq("mappedAsset", args.mappedAsset),
        )
        .unique();
      const cacheValue = {
        projectId: job.projectId,
        mappedAsset: args.mappedAsset,
        address: args.address,
        ...(args.memo !== undefined ? { memo: args.memo } : {}),
        expiresAt: now + ROUTE_CACHE_TTL_MS,
        updatedAt: now,
      };
      if (cached) await ctx.db.replace(cached._id, cacheValue);
      else await ctx.db.insert("pdaxRouteCache", cacheValue);
      await ctx.db.patch(resilience._id, {
        consecutiveFailures: 0,
        circuitOpenUntil: undefined,
        leaseToken: undefined,
        leaseExpiresAt: undefined,
        updatedAt: now,
      });
    }
    await ctx.db.patch(intent._id, {
      receiverAddress: args.address,
      ...(args.memo !== undefined ? { receiverMemo: args.memo } : {}),
      anchorDepositCurrency: args.mappedAsset,
      status: "created",
      stageTimestamps: {
        created: intent.stageTimestamps?.created ?? intent.createdAt,
        ...intent.stageTimestamps,
        routeReady: now,
      },
      updatedAt: now,
    });
    await ctx.db.patch(job._id, {
      state: "succeeded",
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      updatedAt: now,
    });
    await recordSpan(ctx, "velo.dependency.call", "pdax_route_lookup", "provider_call", "success", {
      journeyCorrelationId: intent.correlationId,
      traceparent: intent.traceparent,
    });
    await recordSpan(ctx, "velo.worker.run", "pdax_route_enrichment", "state_update", "success", {
      journeyCorrelationId: intent.correlationId,
      traceparent: intent.traceparent,
    });
    if (await hasEnabledWebhookForEvent(ctx, intent.projectId, "payment.created")) {
      await ctx.scheduler.runAfter(0, internal.webhookDelivery.trigger, {
        projectId: intent.projectId,
        eventType: "payment.created",
        paymentIntentId: intent._id,
        ...(intent.correlationId !== undefined ? { correlationId: intent.correlationId } : {}),
      });
    }
    return { applied: true };
  },
});

export const deferPdaxRoute = internalMutation({
  args: {
    paymentIntentId: v.id("paymentIntents"),
    leaseToken: v.string(),
    retryAt: v.number(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db
      .query("paymentIntentRouteJobs")
      .withIndex("by_payment_intent", (q) => q.eq("paymentIntentId", args.paymentIntentId))
      .unique();
    if (!job || job.leaseToken !== args.leaseToken) return false;
    const delay = Math.max(0, args.retryAt - Date.now());
    await ctx.db.patch(job._id, {
      state: "retry_wait",
      nextAttemptAt: args.retryAt,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(delay, internal.payment_intents.actions.enrichPdaxRoute, {
      paymentIntentId: args.paymentIntentId,
    });
    await recordMetric(ctx, "velo_retry_total", "pdax_route_enrichment", "queue_wait", "retry");
    const intent = await ctx.db.get(args.paymentIntentId);
    await recordSpan(ctx, "velo.worker.run", "pdax_route_enrichment", "queue_wait", "retry", {
      journeyCorrelationId: intent?.correlationId,
      traceparent: intent?.traceparent,
    });
    return true;
  },
});

export const failPdaxRoute = internalMutation({
  args: {
    paymentIntentId: v.id("paymentIntents"),
    leaseToken: v.string(),
    errorCode: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const job = await ctx.db
      .query("paymentIntentRouteJobs")
      .withIndex("by_payment_intent", (q) => q.eq("paymentIntentId", args.paymentIntentId))
      .unique();
    const intent = await ctx.db.get(args.paymentIntentId);
    if (!job || job.leaseToken !== args.leaseToken || intent?.status !== "awaiting_route")
      return false;
    const attempts = job.attempts + 1;
    const timeout = args.errorCode === "provider_timeout";
    if (timeout) {
      await recordMetric(
        ctx,
        "velo_timeout_total",
        "pdax_route_lookup",
        "provider_call",
        "timeout",
      );
    }
    await recordSpan(
      ctx,
      "velo.dependency.call",
      "pdax_route_lookup",
      "provider_call",
      timeout ? "timeout" : "error",
      {
        journeyCorrelationId: intent.correlationId,
        traceparent: intent.traceparent,
        errorCode: timeout ? "dependency_timeout" : "dependency_unavailable",
      },
    );
    const resilience = await ctx.db
      .query("providerResilience")
      .withIndex("by_project_and_provider", (q) =>
        q.eq("projectId", job.projectId).eq("provider", "pdax"),
      )
      .unique();
    const failures = (resilience?.consecutiveFailures ?? 0) + 1;
    if (resilience?.leaseToken === args.leaseToken) {
      await ctx.db.patch(resilience._id, {
        consecutiveFailures: failures,
        ...(failures >= 3 ? { circuitOpenUntil: now + CIRCUIT_OPEN_MS } : {}),
        leaseToken: undefined,
        leaseExpiresAt: undefined,
        updatedAt: now,
      });
    }
    if (attempts >= MAX_ROUTE_ATTEMPTS) {
      await ctx.db.patch(job._id, {
        state: "failed",
        attempts,
        lastErrorCode: args.errorCode,
        leaseToken: undefined,
        leaseExpiresAt: undefined,
        updatedAt: now,
      });
      await ctx.db.patch(intent._id, {
        status: "failed",
        stageTimestamps: {
          created: intent.stageTimestamps?.created ?? intent.createdAt,
          ...intent.stageTimestamps,
          routeFailed: now,
        },
        updatedAt: now,
      });
      await scheduleShadowEvaluation(ctx, {
        phase: "would_release",
        projectId: intent.projectId,
        paymentIntentId: intent._id,
        route: "pdax",
        idempotencyKey: `shadow:release:${intent._id}:route_failed`,
      });
      if (await hasEnabledWebhookForEvent(ctx, intent.projectId, "payment.failed")) {
        await ctx.scheduler.runAfter(0, internal.webhookDelivery.trigger, {
          projectId: intent.projectId,
          eventType: "payment.failed",
          paymentIntentId: intent._id,
          ...(intent.correlationId !== undefined ? { correlationId: intent.correlationId } : {}),
        });
      }
      return true;
    }
    const retryDelay =
      ROUTE_RETRY_DELAYS_MS[Math.min(attempts - 1, ROUTE_RETRY_DELAYS_MS.length - 1)] ?? 60_000;
    await ctx.db.patch(job._id, {
      state: "retry_wait",
      attempts,
      nextAttemptAt: now + retryDelay,
      lastErrorCode: args.errorCode,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(retryDelay, internal.payment_intents.actions.enrichPdaxRoute, {
      paymentIntentId: args.paymentIntentId,
    });
    await recordMetric(ctx, "velo_retry_total", "pdax_route_enrichment", "queue_wait", "retry");
    await recordSpan(ctx, "velo.worker.run", "pdax_route_enrichment", "queue_wait", "retry", {
      journeyCorrelationId: intent.correlationId,
      traceparent: intent.traceparent,
    });
    return true;
  },
});

/**
 * Recovers PDAX route work whose scheduled action was lost or whose worker lease expired.
 * The cron calling this mutation is a safety net; claimRouteJob still provides fencing.
 */
export const recoverPdaxRouteJobs = internalMutation({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const limit = Math.max(1, Math.min(Math.floor(args.limit), 100));
    const dueJobs = [];

    for (const state of ["scheduled", "retry_wait", "leased"] as const) {
      const remaining = limit - dueJobs.length;
      if (remaining <= 0) break;
      const jobs = await ctx.db
        .query("paymentIntentRouteJobs")
        .withIndex("by_state_and_next_attempt_at", (q) =>
          q.eq("state", state).lte("nextAttemptAt", now),
        )
        .take(remaining);
      dueJobs.push(...jobs);
    }

    let recovered = 0;
    let expired = 0;
    for (const job of dueJobs) {
      if (job.state === "leased" && job.leaseExpiresAt && job.leaseExpiresAt > now) continue;

      const intent = await ctx.db.get(job.paymentIntentId);
      if (!intent || intent.status !== "awaiting_route") {
        await ctx.db.patch(job._id, {
          state: "failed",
          lastErrorCode: intent ? `intent_${intent.status}` : "intent_not_found",
          leaseToken: undefined,
          leaseExpiresAt: undefined,
          updatedAt: now,
        });
        continue;
      }

      if (intent.expiresAt <= now) {
        await ctx.db.patch(intent._id, {
          status: "expired",
          stageTimestamps: {
            created: intent.stageTimestamps?.created ?? intent.createdAt,
            ...intent.stageTimestamps,
            expired: now,
          },
          updatedAt: now,
        });
        await scheduleShadowEvaluation(ctx, {
          phase: "would_release",
          projectId: intent.projectId,
          paymentIntentId: intent._id,
          route: intent.anchor === "pdax" ? "pdax" : "stellar",
          idempotencyKey: `shadow:release:${intent._id}:expired`,
        });
        await ctx.db.patch(job._id, {
          state: "failed",
          lastErrorCode: "intent_expired",
          leaseToken: undefined,
          leaseExpiresAt: undefined,
          updatedAt: now,
        });
        expired += 1;
        continue;
      }

      await ctx.db.patch(job._id, {
        state: "scheduled",
        nextAttemptAt: now,
        leaseToken: undefined,
        leaseExpiresAt: undefined,
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.payment_intents.actions.enrichPdaxRoute, {
        paymentIntentId: job.paymentIntentId,
      });
      recovered += 1;
    }

    return { recovered, expired };
  },
});
