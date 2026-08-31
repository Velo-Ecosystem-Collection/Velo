import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

import { env, internalMutation, mutation } from "../_generated/server";
import { recordMetric } from "../telemetry_outbox/helpers";

// One transactional bucket guarantees the advertised global capacity. Random
// shards reject early when traffic is uneven and can exceed capacity when each
// shard is independently full; Convex OCC retries serialize this bounded write.
const NUM_SHARDS = 1;

export async function consumeBucket(
  ctx: MutationCtx,
  scopeKey: string,
  capacity: number,
  refillPerSecond: number,
  now: number,
) {
  // Pick a random shard so concurrent mutations hit different documents
  const shard = Math.floor(Math.random() * NUM_SHARDS);
  const shardKey = `${scopeKey}#${shard}`;
  const shardCapacity = capacity / NUM_SHARDS;
  const shardRefill = refillPerSecond / NUM_SHARDS;

  const bucket = await ctx.db
    .query("rateLimitBuckets")
    .withIndex("by_scope_key", (q) => q.eq("scopeKey", shardKey))
    .unique();
  const available = bucket
    ? Math.min(shardCapacity, bucket.tokens + ((now - bucket.updatedAt) / 1_000) * shardRefill)
    : shardCapacity;
  const allowed = available >= 1;
  const tokens = allowed ? available - 1 : available;
  if (bucket) await ctx.db.patch(bucket._id, { tokens, updatedAt: now });
  else await ctx.db.insert("rateLimitBuckets", { scopeKey: shardKey, tokens, updatedAt: now });
  return {
    allowed,
    limit: capacity,
    remaining: Math.max(0, Math.floor(tokens * NUM_SHARDS)),
    retryAfterMs: allowed ? 0 : Math.ceil(((1 - available) / shardRefill) * 1_000),
  };
}

const playgroundOperation = v.union(
  v.literal("contract_load"),
  v.literal("simulation"),
  v.literal("submission"),
  v.literal("status"),
);
const playgroundPolicies = {
  contract_load: { capacity: 30, refill: 30 / 60 },
  simulation: { capacity: 10, refill: 10 / 60 },
  submission: { capacity: 5, refill: 5 / 60 },
  status: { capacity: 60, refill: 60 / 60 },
} as const;

async function signPlaygroundLimit(
  secret: string,
  scopeHash: string,
  operation: keyof typeof playgroundPolicies,
  signedAt: number,
) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(JSON.stringify([scopeHash, operation, signedAt])),
  );
  return [...new Uint8Array(signature)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function signaturesMatch(actual: string, expected: string) {
  if (!/^[0-9a-f]{64}$/.test(actual) || actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

export const consumePlayground = mutation({
  args: {
    scopeHash: v.string(),
    operation: playgroundOperation,
    signedAt: v.number(),
    signature: v.string(),
  },
  handler: async (ctx, args) => {
    const secret = env.VELO_PLAYGROUND_RATE_LIMIT_SECRET;
    const now = Date.now();
    if (
      !secret ||
      !/^[0-9a-f]{64}$/.test(args.scopeHash) ||
      !Number.isSafeInteger(args.signedAt) ||
      Math.abs(now - args.signedAt) > 60_000
    ) {
      throw new Error("playground_rate_limit_unauthorized");
    }
    const expected = await signPlaygroundLimit(
      secret,
      args.scopeHash,
      args.operation,
      args.signedAt,
    );
    if (!signaturesMatch(args.signature, expected)) {
      throw new Error("playground_rate_limit_unauthorized");
    }
    const policy = playgroundPolicies[args.operation];
    const result = await consumeBucket(
      ctx,
      `playground:${args.operation}:${args.scopeHash}`,
      policy.capacity,
      policy.refill,
      now,
    );
    if (!result.allowed) {
      await recordMetric(ctx, "velo_rate_limit_total", "playground_rate_limit", "auth", "rejected");
    }
    return result;
  },
});

export async function consumePaymentRateLimits(
  ctx: MutationCtx,
  apiKeyHash: string,
  projectId: Id<"projects">,
) {
  const now = Date.now();
  const apiKey = await consumeBucket(ctx, `api:${apiKeyHash}`, 200, 60, now);
  const project = await consumeBucket(ctx, `project:${projectId}`, 300, 100, now);
  if (!apiKey.allowed || !project.allowed) {
    await recordMetric(ctx, "velo_rate_limit_total", "payment_rate_limit", "auth", "rejected");
  }
  return {
    allowed: apiKey.allowed && project.allowed,
    limit: Math.min(apiKey.limit, project.limit),
    remaining: Math.min(apiKey.remaining, project.remaining),
    retryAfterMs: Math.max(apiKey.retryAfterMs, project.retryAfterMs),
  };
}

// REST get/list routes call this transactional mutation before their read query.
export const consume = mutation({
  args: { apiKeyHash: v.string() },
  handler: async (ctx, args) => {
    const apiKey = await ctx.db
      .query("apiKeys")
      .withIndex("by_key_hash", (q) => q.eq("keyHash", args.apiKeyHash))
      .unique();
    if (!apiKey || apiKey.revoked) return { authorized: false as const };
    return {
      authorized: true as const,
      ...(await consumePaymentRateLimits(ctx, args.apiKeyHash, apiKey.projectId)),
    };
  },
});

export const consumeAuthorized = internalMutation({
  args: {
    apiKeyId: v.id("apiKeys"),
    projectId: v.id("projects"),
    apiKeyHash: v.string(),
  },
  handler: async (ctx, args) => {
    const [apiKey, project] = await Promise.all([
      ctx.db.get(args.apiKeyId),
      ctx.db.get(args.projectId),
    ]);
    if (
      !apiKey ||
      apiKey.revoked ||
      apiKey.keyHash !== args.apiKeyHash ||
      apiKey.projectId !== args.projectId ||
      !project ||
      !project.paymentAccessActive ||
      (project.rateLimitBackend ?? "convex") !== "convex"
    ) {
      return { authorized: false as const };
    }
    return {
      authorized: true as const,
      ...(await consumePaymentRateLimits(ctx, args.apiKeyHash, args.projectId)),
    };
  },
});
