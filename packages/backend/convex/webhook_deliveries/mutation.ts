import { v } from "convex/values";

import { internal } from "../_generated/api";
import { internalMutation, mutation } from "../_generated/server";
import { requireIdentity } from "../auth/identity";
import { WEBHOOK_DELIVERY_LEASE_MS } from "./constants";

export const createPending = internalMutation({
  args: {
    projectId: v.id("projects"),
    endpointId: v.id("webhookEndpoints"),
    eventType: v.string(),
    destinationHost: v.string(),
    payloadSummary: v.any(),
    paymentIntentId: v.optional(v.id("paymentIntents")),
    correlationId: v.optional(v.string()),
    nextAttemptAt: v.optional(v.number()),
    deliveryKey: v.optional(v.string()),
    schemaVersion: v.optional(v.string()),
    eventKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { eventKey, ...deliveryArgs } = args;
    if (args.deliveryKey) {
      const existing = await ctx.db
        .query("webhookDeliveries")
        .withIndex("by_delivery_key", (q) => q.eq("deliveryKey", args.deliveryKey))
        .unique();
      if (existing) return existing._id;
    }
    const now = Date.now();
    if (args.correlationId) {
      await ctx.db.insert("journeyStages", {
        journeyCorrelationId: args.correlationId,
        name: "webhook.enqueued",
        source: "webhook",
        outcome: "pending",
        at: now,
        expiresAt: now + 14 * 24 * 60 * 60 * 1_000,
      });
    }
    if (eventKey) {
      const domainEvent = await ctx.db
        .query("webhookDomainEvents")
        .withIndex("by_event_key", (q) => q.eq("eventKey", eventKey))
        .unique();
      if (!domainEvent) {
        await ctx.db.insert("webhookDomainEvents", {
          projectId: args.projectId,
          eventKey,
          eventType: args.eventType,
          schemaVersion: args.schemaVersion ?? "1",
          payloadJson: JSON.stringify(args.payloadSummary),
          createdAt: now,
        });
      }
    }
    return await ctx.db.insert("webhookDeliveries", {
      ...deliveryArgs,
      status: "pending",
      attemptCount: 1,
      lastAttemptAt: now,
      createdAt: now,
      enqueuedAt: now,
      deadLetter: false,
      ...("nextAttemptAt" in args && args.nextAttemptAt !== undefined
        ? { nextAttemptAt: args.nextAttemptAt }
        : {}),
    });
  },
});

export const claimAttempt = internalMutation({
  args: {
    deliveryId: v.id("webhookDeliveries"),
    leaseToken: v.string(),
    attemptCount: v.number(),
  },
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.deliveryId);
    const now = Date.now();
    if (
      !delivery ||
      delivery.status !== "pending" ||
      delivery.deadLetter ||
      (delivery.nextAttemptAt !== undefined && delivery.nextAttemptAt > now) ||
      (delivery.leaseExpiresAt !== undefined && delivery.leaseExpiresAt > now)
    ) {
      return { claimed: false as const };
    }
    const leaseGeneration = (delivery.leaseGeneration ?? 0) + 1;
    await ctx.db.patch(delivery._id, {
      leaseToken: args.leaseToken,
      leaseGeneration,
      leaseExpiresAt: now + WEBHOOK_DELIVERY_LEASE_MS,
      attemptCount: args.attemptCount,
      lastAttemptAt: now,
      attemptStartedAt: now,
    });
    return { claimed: true as const, leaseGeneration };
  },
});

export const finish = internalMutation({
  args: {
    deliveryId: v.id("webhookDeliveries"),
    status: v.union(v.literal("success"), v.literal("failed")),
    httpStatus: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
    responseTimeMs: v.optional(v.number()),
    deadLetter: v.optional(v.boolean()),
    leaseToken: v.optional(v.string()),
    leaseGeneration: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.deliveryId);
    if (!delivery) return false;
    if (
      args.leaseToken !== undefined &&
      (delivery.leaseToken !== args.leaseToken || delivery.leaseGeneration !== args.leaseGeneration)
    ) {
      return false;
    }
    const completedAt = Date.now();
    await ctx.db.patch(args.deliveryId, {
      status: args.status,
      httpStatus: args.httpStatus,
      errorMessage: args.errorMessage?.slice(0, 500),
      responseTimeMs: args.responseTimeMs,
      lastAttemptAt: completedAt,
      responseReceivedAt: completedAt,
      ...(args.status === "success" ? { acknowledgedAt: completedAt } : {}),
      ...(args.deadLetter ? { deadLetter: true, deadLetterAt: completedAt } : {}),
      leaseToken: undefined,
      leaseExpiresAt: undefined,
    });
    if (delivery.correlationId) {
      await ctx.db.insert("journeyStages", {
        journeyCorrelationId: delivery.correlationId,
        name: args.status === "success" ? "webhook.acknowledged" : "webhook.failed",
        source: "webhook",
        outcome: args.status === "success" ? "success" : "error",
        at: completedAt,
        expiresAt: completedAt + 14 * 24 * 60 * 60 * 1_000,
      });
    }
    return true;
  },
});

export const startAttempt = internalMutation({
  args: {
    deliveryId: v.id("webhookDeliveries"),
    attemptCount: v.number(),
    nextAttemptAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const startedAt = Date.now();
    await ctx.db.patch(args.deliveryId, {
      attemptCount: args.attemptCount,
      lastAttemptAt: startedAt,
      attemptStartedAt: startedAt,
      ...(args.nextAttemptAt !== undefined ? { nextAttemptAt: args.nextAttemptAt } : {}),
    });
  },
});

export const logAttemptFailure = internalMutation({
  args: {
    deliveryId: v.id("webhookDeliveries"),
    httpStatus: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
    responseTimeMs: v.optional(v.number()),
    nextAttemptAt: v.optional(v.number()),
    leaseToken: v.optional(v.string()),
    leaseGeneration: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.deliveryId);
    if (!delivery) return false;
    if (
      args.leaseToken !== undefined &&
      (delivery.leaseToken !== args.leaseToken || delivery.leaseGeneration !== args.leaseGeneration)
    ) {
      return false;
    }
    const completedAt = Date.now();
    await ctx.db.patch(args.deliveryId, {
      httpStatus: args.httpStatus,
      errorMessage: args.errorMessage?.slice(0, 500),
      responseTimeMs: args.responseTimeMs,
      lastAttemptAt: completedAt,
      responseReceivedAt: completedAt,
      ...(args.nextAttemptAt !== undefined ? { nextAttemptAt: args.nextAttemptAt } : {}),
      leaseToken: undefined,
      leaseExpiresAt: undefined,
    });
    return true;
  },
});

export const scheduleRetry = internalMutation({
  args: {
    delaySeconds: v.number(),
    projectId: v.id("projects"),
    eventType: v.union(
      v.literal("contract.event"),
      v.literal("transaction.succeeded"),
      v.literal("transaction.failed"),
      v.literal("project.registered"),
      v.literal("project.updated"),
      v.literal("payment.created"),
      v.literal("payment.succeeded"),
      v.literal("payment.failed"),
      v.literal("payment_access.activated"),
      v.literal("settlement.quote.created"),
      v.literal("settlement.trade.executed"),
      v.literal("settlement.withdrawal.pending"),
      v.literal("settlement.withdrawal.succeeded"),
      v.literal("settlement.withdrawal.failed"),
      v.literal("provider.pdax.event.received"),
    ),
    contractEventId: v.optional(v.id("contractEvents")),
    paymentIntentId: v.optional(v.id("paymentIntents")),
    settlementQuoteId: v.optional(v.id("settlementQuotes")),
    settlementTransactionId: v.optional(v.id("settlementTransactions")),
    providerEventId: v.optional(v.id("providerEvents")),
    deliveryId: v.id("webhookDeliveries"),
    attemptCount: v.number(),
    correlationId: v.optional(v.string()),
    nextAttemptAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { delaySeconds, ...triggerArgs } = args;
    await ctx.scheduler.runAfter(delaySeconds * 1000, internal.webhookDelivery.trigger, {
      ...triggerArgs,
      nextAttemptAt: args.nextAttemptAt,
    });
  },
});

export const replay = mutation({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const delivery = await ctx.db.get(args.deliveryId);
    if (!delivery) throw new Error("Webhook delivery not found");
    const project = await ctx.db.get(delivery.projectId);
    if (
      !project ||
      (project.ownerTokenIdentifier !== identity.tokenIdentifier &&
        project.ownerAddress !== identity.subject)
    ) {
      throw new Error("Not authorized to replay this delivery");
    }
    await ctx.db.patch(args.deliveryId, {
      status: "pending",
      deadLetter: false,
      nextAttemptAt: Date.now(),
      replayedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.webhookDelivery.trigger, {
      projectId: delivery.projectId,
      eventType: delivery.eventType as
        | "contract.event"
        | "transaction.succeeded"
        | "transaction.failed"
        | "project.registered"
        | "project.updated"
        | "payment.created"
        | "payment.succeeded"
        | "payment.failed"
        | "payment_access.activated"
        | "settlement.quote.created"
        | "settlement.trade.executed"
        | "settlement.withdrawal.pending"
        | "settlement.withdrawal.succeeded"
        | "settlement.withdrawal.failed"
        | "provider.pdax.event.received",
      paymentIntentId: delivery.paymentIntentId,
      deliveryId: delivery._id,
      attemptCount: delivery.attemptCount + 1,
      correlationId: delivery.correlationId,
    });
    return { deliveryId: delivery._id };
  },
});
