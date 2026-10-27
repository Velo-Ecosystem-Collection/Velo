import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import { internalMutation, internalQuery } from "../_generated/server";
import { canUseGeneralApi } from "../api_keys/helpers";
import { verifyApiKeyForPayments } from "./helpers";

const paymentIntentStatusValidator = v.union(
  v.literal("awaiting_route"),
  v.literal("created"),
  v.literal("pending"),
  v.literal("paid"),
  v.literal("failed"),
  v.literal("expired"),
  v.literal("cancelled"),
);

export const authorize = internalQuery({
  args: { apiKeyHash: v.string() },
  handler: async (ctx, args) => {
    const auth = await verifyApiKeyForPayments(ctx, args.apiKeyHash);
    if (!auth.authorized) return { authorized: false as const, reason: auth.reason };
    return {
      authorized: true as const,
      apiKeyId: auth.apiKey._id,
      projectId: auth.project._id,
      rateLimitBackend: auth.project.rateLimitBackend ?? ("convex" as const),
    };
  },
});

export const getAuthorized = internalQuery({
  args: {
    apiKeyId: v.id("apiKeys"),
    projectId: v.id("projects"),
    apiKeyHash: v.string(),
    expectedRateLimitBackend: v.union(v.literal("convex"), v.literal("upstash")),
    paymentIntentId: v.string(),
  },
  handler: async (ctx, args) => {
    const [apiKey, project] = await Promise.all([
      ctx.db.get(args.apiKeyId),
      ctx.db.get(args.projectId),
    ]);
    if (
      !apiKey ||
      apiKey.revoked ||
      !canUseGeneralApi(apiKey) ||
      apiKey.keyHash !== args.apiKeyHash ||
      apiKey.projectId !== args.projectId ||
      !project ||
      !project.paymentAccessActive ||
      (project.rateLimitBackend ?? "convex") !== args.expectedRateLimitBackend
    ) {
      return { authorized: false as const };
    }
    const normalizedId = ctx.db.normalizeId("paymentIntents", args.paymentIntentId);
    if (!normalizedId) return { authorized: true as const, intent: null };
    const intent = await ctx.db.get(normalizedId);
    return {
      authorized: true as const,
      intent: intent?.projectId === args.projectId ? intent : null,
    };
  },
});

export const listAuthorized = internalQuery({
  args: {
    apiKeyId: v.id("apiKeys"),
    projectId: v.id("projects"),
    apiKeyHash: v.string(),
    expectedRateLimitBackend: v.union(v.literal("convex"), v.literal("upstash")),
    status: v.optional(paymentIntentStatusValidator),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const [apiKey, project] = await Promise.all([
      ctx.db.get(args.apiKeyId),
      ctx.db.get(args.projectId),
    ]);
    if (
      !apiKey ||
      apiKey.revoked ||
      !canUseGeneralApi(apiKey) ||
      apiKey.keyHash !== args.apiKeyHash ||
      apiKey.projectId !== args.projectId ||
      !project ||
      !project.paymentAccessActive ||
      (project.rateLimitBackend ?? "convex") !== args.expectedRateLimitBackend
    ) {
      return { authorized: false as const };
    }
    const page = args.status
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
    return { authorized: true as const, page };
  },
});

export const emptyAuthorizedMutation = internalMutation({
  args: {
    apiKeyId: v.id("apiKeys"),
    projectId: v.id("projects"),
    apiKeyHash: v.string(),
    expectedRateLimitBackend: v.union(v.literal("convex"), v.literal("upstash")),
  },
  handler: async (ctx, args) => {
    const [apiKey, project] = await Promise.all([
      ctx.db.get(args.apiKeyId),
      ctx.db.get(args.projectId),
    ]);
    return Boolean(
      apiKey &&
      !apiKey.revoked &&
      canUseGeneralApi(apiKey) &&
      apiKey.keyHash === args.apiKeyHash &&
      apiKey.projectId === args.projectId &&
      project?.paymentAccessActive &&
      (project.rateLimitBackend ?? "convex") === args.expectedRateLimitBackend,
    );
  },
});
