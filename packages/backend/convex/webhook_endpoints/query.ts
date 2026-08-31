import { v } from "convex/values";

import { internalQuery, query } from "../_generated/server";
import {
  editorProjectOrNull,
  ownerProjectOrNull,
  requireOwnerProjectByToken,
  validateWebhookUrl,
} from "./helpers";

export const getSettings = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    if (!(await editorProjectOrNull(ctx, args.projectId))) {
      return null;
    }

    return await ctx.db
      .query("webhookEndpoints")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .unique();
  },
});

export const getSummary = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    if (!(await ownerProjectOrNull(ctx, args.projectId))) {
      return null;
    }

    const endpoint = await ctx.db
      .query("webhookEndpoints")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .unique();
    const deliveries = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_project_created_at", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(20);
    const successes = deliveries.filter((delivery) => delivery.status === "success").length;

    return {
      configured: Boolean(endpoint),
      enabled: endpoint?.enabled ?? false,
      destinationHost: endpoint?.destinationHost,
      eventTypeCount: endpoint?.eventTypes.length ?? 0,
      lastDelivery: deliveries[0] ?? null,
      recentCount: deliveries.length,
      successCount: successes,
      failedCount: deliveries.filter((delivery) => delivery.status === "failed").length,
    };
  },
});

export const getDeliveryTarget = internalQuery({
  args: {
    projectId: v.id("projects"),
    ownerTokenIdentifier: v.string(),
    ownerSubject: v.string(),
    eventType: v.string(),
    contractEventId: v.optional(v.id("contractEvents")),
    paymentIntentId: v.optional(v.id("paymentIntents")),
  },
  handler: async (ctx, args) => {
    const project = await requireOwnerProjectByToken(
      ctx,
      args.projectId,
      args.ownerTokenIdentifier,
      args.ownerSubject,
    );
    const endpoint = await ctx.db
      .query("webhookEndpoints")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .unique();

    if (!endpoint) {
      throw new Error("Save a webhook endpoint before sending a test event");
    }

    if (!endpoint.enabled) {
      throw new Error("Enable the webhook endpoint before sending");
    }

    if (!endpoint.eventTypes.includes(args.eventType)) {
      throw new Error(`${args.eventType} is not enabled for this endpoint`);
    }

    validateWebhookUrl(endpoint.url);

    const contractEvent = args.contractEventId ? await ctx.db.get(args.contractEventId) : undefined;

    if (contractEvent && contractEvent.projectId !== args.projectId) {
      throw new Error("Observed event does not belong to this project");
    }

    const paymentIntent = args.paymentIntentId ? await ctx.db.get(args.paymentIntentId) : undefined;

    if (paymentIntent && paymentIntent.projectId !== args.projectId) {
      throw new Error("Payment intent does not belong to this project");
    }

    return { endpoint, project, contractEvent, paymentIntent };
  },
});

export const getDeliveryTargetInternal = internalQuery({
  args: {
    projectId: v.id("projects"),
    eventType: v.string(),
    contractEventId: v.optional(v.id("contractEvents")),
    paymentIntentId: v.optional(v.id("paymentIntents")),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) {
      return null;
    }
    const endpoint = await ctx.db
      .query("webhookEndpoints")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .unique();

    if (!endpoint || !endpoint.enabled || !endpoint.eventTypes.includes(args.eventType)) {
      return null;
    }

    // Scheduled delivery must handle invalid or unreachable legacy endpoints
    // through the dispatcher's retry/dead-letter path. The authenticated
    // settings mutation still validates URLs before storing new endpoints.

    const contractEvent = args.contractEventId ? await ctx.db.get(args.contractEventId) : undefined;

    if (contractEvent && contractEvent.projectId !== args.projectId) {
      throw new Error("Observed event does not belong to this project");
    }
    if (args.eventType === "contract.event" && contractEvent) {
      const filters = (
        await ctx.db
          .query("playgroundWebhookFilters")
          .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
          .collect()
      ).filter((filter) => filter.enabled && filter.endpointId === endpoint._id);
      if (filters.length) {
        const matches = filters.some((filter) => {
          if (
            filter.network !== (contractEvent.network ?? "testnet") ||
            filter.contractId !== contractEvent.contractId
          ) {
            return false;
          }
          const topicsMatch = filter.topics.every(
            (topic, index) => JSON.stringify(topic) === JSON.stringify(contractEvent.topics[index]),
          );
          const dataMatch =
            filter.data === undefined ||
            JSON.stringify(filter.data) ===
              JSON.stringify(contractEvent.decoded ?? contractEvent.raw);
          return topicsMatch && dataMatch;
        });
        if (!matches) return null;
      }
    }

    const paymentIntent = args.paymentIntentId ? await ctx.db.get(args.paymentIntentId) : undefined;

    if (paymentIntent && paymentIntent.projectId !== args.projectId) {
      throw new Error("Payment intent does not belong to this project");
    }

    return { endpoint, project, contractEvent, paymentIntent };
  },
});
