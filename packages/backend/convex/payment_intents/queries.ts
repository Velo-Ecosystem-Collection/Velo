import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";

import { internalQuery, query } from "../_generated/server";
import { projectOwnerOrNull, requireProjectOwner } from "../projects/helpers";
import {
  createPaymentIntentFingerprint,
  resolveActivePaymentAnchor,
  verifyApiKeyForPayments,
} from "./helpers";

const paymentIntentStatusValidator = v.union(
  v.literal("awaiting_route"),
  v.literal("created"),
  v.literal("pending"),
  v.literal("paid"),
  v.literal("failed"),
  v.literal("expired"),
  v.literal("cancelled"),
);

export const getPublicPaymentIntent = internalQuery({
  args: {
    apiKeyHash: v.string(),
    paymentIntentId: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await verifyApiKeyForPayments(ctx, args.apiKeyHash);
    if (!auth.authorized) {
      return { authorized: false as const, reason: auth.reason };
    }

    const normalizedId = ctx.db.normalizeId("paymentIntents", args.paymentIntentId);
    if (!normalizedId) {
      return { authorized: true as const, projectId: auth.project._id, intent: null };
    }

    const intent = await ctx.db.get(normalizedId);
    if (!intent || intent.projectId !== auth.project._id) {
      return { authorized: true as const, projectId: auth.project._id, intent: null };
    }

    return { authorized: true as const, projectId: auth.project._id, intent };
  },
});

export const listPublicPaymentIntents = internalQuery({
  args: {
    apiKeyHash: v.string(),
    status: v.optional(paymentIntentStatusValidator),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const auth = await verifyApiKeyForPayments(ctx, args.apiKeyHash);
    if (!auth.authorized) {
      return { authorized: false as const, reason: auth.reason };
    }

    const page = args.status
      ? await ctx.db
          .query("paymentIntents")
          .withIndex("by_project_status_created_at", (q) =>
            q.eq("projectId", auth.project._id).eq("status", args.status!),
          )
          .order("desc")
          .paginate(args.paginationOpts)
      : await ctx.db
          .query("paymentIntents")
          .withIndex("by_project_created_at", (q) => q.eq("projectId", auth.project._id))
          .order("desc")
          .paginate(args.paginationOpts);

    return { authorized: true as const, projectId: auth.project._id, page };
  },
});

/**
 * Get a payment intent by ID. Public query — no auth required.
 * Used by the hosted checkout page to display payment details.
 */
export const getPaymentIntent = query({
  args: { paymentIntentId: v.id("paymentIntents") },
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.paymentIntentId);
    if (!intent) {
      return null;
    }

    // Check if the intent has expired and update status inline if needed
    if (
      (intent.status === "created" || intent.status === "awaiting_route") &&
      Date.now() > intent.expiresAt
    ) {
      return {
        ...intent,
        status: "expired" as const,
        stageTimestamps: intent.stageTimestamps
          ? { ...intent.stageTimestamps, expired: intent.expiresAt }
          : { created: intent.createdAt, expired: intent.expiresAt },
      };
    }

    return intent;
  },
});

/**
 * List payment intents for a project. Used in the merchant dashboard.
 * Requires the caller to be the project owner.
 */
export const listByProject = query({
  args: {
    projectId: v.id("projects"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!(await projectOwnerOrNull(ctx, args.projectId))) {
      return [];
    }

    const limit = Math.min(100, Math.max(1, args.limit ?? 20));
    return await ctx.db
      .query("paymentIntents")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(limit);
  },
});

/**
 * Cursor-paginated payment ledger for the authenticated project owner.
 */
export const listOwnerPage = query({
  args: {
    projectId: v.id("projects"),
    status: v.optional(paymentIntentStatusValidator),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireProjectOwner(ctx, args.projectId);

    return args.status
      ? await ctx.db
          .query("paymentIntents")
          .withIndex("by_project_status_created_at", (q) =>
            q.eq("projectId", args.projectId).eq("status", args.status!),
          )
          .order("desc")
          .paginate(args.paginationOpts)
      : await ctx.db
          .query("paymentIntents")
          .withIndex("by_project_created_at", (q) => q.eq("projectId", args.projectId))
          .order("desc")
          .paginate(args.paginationOpts);
  },
});

/**
 * Exact owner-scoped lookup by PaymentIntent ID or transaction hash.
 */
export const findOwnerIntent = query({
  args: {
    projectId: v.id("projects"),
    term: v.string(),
  },
  handler: async (ctx, args) => {
    await requireProjectOwner(ctx, args.projectId);
    const term = args.term.trim();
    if (!term) return null;

    const normalizedId = ctx.db.normalizeId("paymentIntents", term);
    if (normalizedId) {
      const intent = await ctx.db.get(normalizedId);
      return intent?.projectId === args.projectId ? intent : null;
    }

    if (!/^[0-9a-f]{64}$/i.test(term)) return null;
    const transactionHash = term.toLowerCase();
    const bySubmittedHash = await ctx.db
      .query("paymentIntents")
      .withIndex("by_tx_hash", (q) => q.eq("txHash", transactionHash))
      .first();
    if (bySubmittedHash?.projectId === args.projectId) return bySubmittedHash;

    const byVerifiedHash = await ctx.db
      .query("paymentIntents")
      .withIndex("by_verified_tx_hash", (q) => q.eq("verifiedTxHash", transactionHash))
      .first();
    return byVerifiedHash?.projectId === args.projectId ? byVerifiedHash : null;
  },
});

function formatAsset(asset: string) {
  if (asset === "native" || asset === "XLM") return "XLM";
  const parts = asset.split(":");
  return parts[0] || asset;
}

/**
 * Count rows returned by an indexed range without loading full documents.
 * Uses a per-query cap to stay well under the 16 MB read limit.
 */
const STATUS_CAP = 5_000;

/**
 * Aggregated telemetry and analytics metrics for a project dashboard.
 *
 * Uses per-status indexed queries with bounded `.take()` instead of a single
 * unbounded `.collect()` to avoid hitting the Convex 16 MB read limit.
 */
export const getProjectStats = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    if (!(await projectOwnerOrNull(ctx, args.projectId))) {
      return null;
    }

    // 1. Count payment intents per status using the composite index.
    //    Only "paid" needs full document reads (for volume aggregation);
    //    the other statuses just need a length count.
    const paidIntents = await ctx.db
      .query("paymentIntents")
      .withIndex("by_project_status_created_at", (q) =>
        q.eq("projectId", args.projectId).eq("status", "paid"),
      )
      .take(STATUS_CAP);

    const pendingIntents = await ctx.db
      .query("paymentIntents")
      .withIndex("by_project_status_created_at", (q) =>
        q.eq("projectId", args.projectId).eq("status", "pending"),
      )
      .take(STATUS_CAP);

    const failedIntents = await ctx.db
      .query("paymentIntents")
      .withIndex("by_project_status_created_at", (q) =>
        q.eq("projectId", args.projectId).eq("status", "failed"),
      )
      .take(STATUS_CAP);

    const createdIntents = await ctx.db
      .query("paymentIntents")
      .withIndex("by_project_status_created_at", (q) =>
        q.eq("projectId", args.projectId).eq("status", "created"),
      )
      .take(STATUS_CAP);

    const awaitingRouteIntents = await ctx.db
      .query("paymentIntents")
      .withIndex("by_project_status_created_at", (q) =>
        q.eq("projectId", args.projectId).eq("status", "awaiting_route"),
      )
      .take(STATUS_CAP);

    const expiredIntents = await ctx.db
      .query("paymentIntents")
      .withIndex("by_project_status_created_at", (q) =>
        q.eq("projectId", args.projectId).eq("status", "expired"),
      )
      .take(STATUS_CAP);

    const cancelledIntents = await ctx.db
      .query("paymentIntents")
      .withIndex("by_project_status_created_at", (q) =>
        q.eq("projectId", args.projectId).eq("status", "cancelled"),
      )
      .take(STATUS_CAP);

    // Aggregate paid volumes
    const volumes: Record<string, number> = {};
    for (const intent of paidIntents) {
      const assetLabel = formatAsset(intent.asset);
      const amountNum = parseFloat(intent.amount) || 0;
      volumes[assetLabel] = (volumes[assetLabel] || 0) + amountNum;
    }

    const paidCount = paidIntents.length;
    const pendingCount = pendingIntents.length;
    const failedCount = failedIntents.length;
    const createdCount = createdIntents.length;
    const totalCount =
      paidCount +
      pendingCount +
      failedCount +
      createdCount +
      awaitingRouteIntents.length +
      expiredIntents.length +
      cancelledIntents.length;

    // 2. Webhook health — bounded read of recent deliveries
    const WEBHOOK_CAP = 1_000;
    const webhookDeliveries = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_project_created_at", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(WEBHOOK_CAP);

    let successCount = 0;
    let totalLatency = 0;
    let latencyCount = 0;
    const totalDeliveries = webhookDeliveries.length;

    for (const delivery of webhookDeliveries) {
      if (delivery.status === "success") {
        successCount++;
      }
      if (delivery.responseTimeMs !== undefined) {
        totalLatency += delivery.responseTimeMs;
        latencyCount++;
      }
    }

    const successRate = totalDeliveries > 0 ? (successCount / totalDeliveries) * 100 : 100;
    const averageLatency = latencyCount > 0 ? totalLatency / latencyCount : 0;

    return {
      volumes: Object.entries(volumes).map(([asset, volume]) => ({ asset, volume })),
      counts: {
        total: totalCount,
        paid: paidCount,
        pending: pendingCount,
        failed: failedCount,
        created: createdCount,
      },
      webhooks: {
        totalDeliveries,
        successRate,
        averageLatency,
      },
    };
  },
});

export const resolveIntentRequest = internalQuery({
  args: {
    apiKeyHash: v.string(),
    amount: v.string(),
    asset: v.string(),
    description: v.optional(v.string()),
    successUrl: v.optional(v.string()),
    cancelUrl: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
    anchor: v.optional(v.union(v.literal("inhouse"), v.literal("pdax"))),
  },
  handler: async (ctx, args) => {
    const auth = await verifyApiKeyForPayments(ctx, args.apiKeyHash);
    if (!auth.authorized) {
      return { authorized: false as const, reason: auth.reason };
    }

    const resolvedAnchor = resolveActivePaymentAnchor({
      requestedAnchor: args.anchor,
      apiKeyAnchor: auth.apiKey.paymentAnchor,
      projectDefaultAnchor: auth.project.defaultPaymentAnchor,
    });

    if (args.idempotencyKey !== undefined) {
      const existing = await ctx.db
        .query("paymentIntentIdempotencyKeys")
        .withIndex("by_project_and_key", (q) =>
          q.eq("projectId", auth.project._id).eq("key", args.idempotencyKey!),
        )
        .unique();

      if (existing) {
        const requestFingerprint = createPaymentIntentFingerprint(args);
        if (existing.requestFingerprint !== requestFingerprint) {
          return {
            authorized: true as const,
            status: "idempotency_conflict" as const,
            projectId: auth.project._id,
          };
        }

        const intent = await ctx.db.get(existing.paymentIntentId);
        if (intent && intent.projectId === auth.project._id) {
          return {
            authorized: true as const,
            status: "idempotency_replay" as const,
            projectId: auth.project._id,
            intent,
          };
        }
      }
    }

    return {
      authorized: true as const,
      status: "proceed" as const,
      resolvedAnchor,
      projectId: auth.project._id,
      ownerAddress: auth.project.ownerAddress,
    };
  },
});

function lifecycleProjection(
  correlationId: string,
  intents: Doc<"paymentIntents">[],
  deliveries: Doc<"webhookDeliveries">[],
  journeyStages: Doc<"journeyStages">[] = [],
) {
  const paymentIntents = intents.map((intent) => ({
    id: intent._id,
    status: intent.status,
    transactionHash: intent.txHash ?? null,
    createdAt: intent.createdAt,
    updatedAt: intent.updatedAt,
    stageTimestamps: intent.stageTimestamps ?? null,
    traceparent: intent.traceparent ?? null,
  }));
  const webhookDeliveries = deliveries.map((delivery) => ({
    id: delivery._id,
    paymentIntentId: delivery.paymentIntentId ?? null,
    eventType: delivery.eventType,
    status: delivery.status,
    attemptCount: delivery.attemptCount,
    createdAt: delivery.createdAt,
    enqueuedAt: delivery.enqueuedAt ?? delivery.createdAt,
    attemptStartedAt: delivery.attemptStartedAt ?? null,
    responseReceivedAt: delivery.responseReceivedAt ?? null,
    acknowledgedAt: delivery.acknowledgedAt ?? null,
    lastAttemptAt: delivery.lastAttemptAt,
    httpStatus: delivery.httpStatus ?? null,
    responseTimeMs: delivery.responseTimeMs ?? null,
  }));

  const stages = [
    ...paymentIntents.flatMap((intent) => {
      const intentStages = intent.stageTimestamps ?? { created: intent.createdAt };
      return Object.entries(intentStages)
        .filter((entry): entry is [string, number] => typeof entry[1] === "number")
        .flatMap(([name, at]) => [
          { name: `payment_intent.${name}`, at, paymentIntentId: intent.id },
          ...(name === "confirmed"
            ? [{ name: "payment_intent.paid", at, paymentIntentId: intent.id }]
            : []),
        ]);
    }),
    ...webhookDeliveries.flatMap((delivery) => [
      { name: "webhook.enqueued", at: delivery.enqueuedAt, deliveryId: delivery.id },
      ...(delivery.attemptStartedAt === null
        ? []
        : [
            {
              name: "webhook.attempt_started",
              at: delivery.attemptStartedAt,
              deliveryId: delivery.id,
            },
          ]),
      ...(delivery.responseReceivedAt === null
        ? []
        : [
            {
              name: "webhook.response_received",
              at: delivery.responseReceivedAt,
              deliveryId: delivery.id,
            },
          ]),
      ...(delivery.acknowledgedAt === null
        ? []
        : [
            { name: "webhook.acknowledged", at: delivery.acknowledgedAt, deliveryId: delivery.id },
            { name: "webhook.success", at: delivery.acknowledgedAt, deliveryId: delivery.id },
          ]),
    ]),
    ...journeyStages.map((event) => ({
      name: event.name,
      at: event.at,
      journeyStageId: event._id,
      source: event.source,
      outcome: event.outcome,
    })),
  ].sort((left, right) => left.at - right.at);
  const observed = new Set(stages.map((stage) => stage.name));
  const required = [
    "payment_intent.created",
    "payment_intent.submitted",
    "payment_intent.observed",
    "payment_intent.confirmed",
    "webhook.acknowledged",
    "ui.rendered",
  ];

  return {
    correlationId,
    traceIdentifiers: {
      journeyCorrelationId: correlationId,
      traceparents: paymentIntents.flatMap((intent) =>
        intent.traceparent === null ? [] : [intent.traceparent],
      ),
    },
    paymentIntents,
    webhookDeliveries,
    stages,
    missingStages: required.filter((stage) => !observed.has(stage)),
  };
}

/**
 * Project-operator trace lookup. Ownership is verified before either indexed
 * read, so a correlation ID cannot enumerate another project's activity.
 */
export const getProjectPaymentLifecycleByCorrelation = query({
  args: {
    projectId: v.id("projects"),
    correlationId: v.string(),
  },
  handler: async (ctx, args) => {
    if (!(await projectOwnerOrNull(ctx, args.projectId))) {
      return null;
    }

    const intents = await ctx.db
      .query("paymentIntents")
      .withIndex("by_project_and_correlation_id", (q) =>
        q.eq("projectId", args.projectId).eq("correlationId", args.correlationId),
      )
      .take(10);
    const deliveries = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_project_and_correlation_id_created_at", (q) =>
        q.eq("projectId", args.projectId).eq("correlationId", args.correlationId),
      )
      .order("asc")
      .take(100);

    const journeyStages = await ctx.db
      .query("journeyStages")
      .withIndex("by_journey_correlation_id_and_at", (q) =>
        q.eq("journeyCorrelationId", args.correlationId),
      )
      .order("asc")
      .take(100);

    return lifecycleProjection(args.correlationId, intents, deliveries, journeyStages);
  },
});

export const getPaymentIntentInternal = internalQuery({
  args: { paymentIntentId: v.id("paymentIntents") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.paymentIntentId);
  },
});
