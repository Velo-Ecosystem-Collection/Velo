import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";

import { internal } from "../_generated/api";
import { action, env } from "../_generated/server";
import { consumeUpstashPaymentAdmission } from "../rate_limits/upstash";

const paymentIntentStatusValidator = v.union(
  v.literal("awaiting_route"),
  v.literal("created"),
  v.literal("pending"),
  v.literal("paid"),
  v.literal("failed"),
  v.literal("expired"),
  v.literal("cancelled"),
);

type AuthorizedScope = {
  authorized: true;
  apiKeyId: Id<"apiKeys">;
  projectId: Id<"projects">;
  rateLimitBackend: "convex" | "migrating" | "upstash";
  apiKeyAnchor?: "inhouse" | "pdax";
  resolvedAnchor: "inhouse" | "pdax";
};

type AuthorizationResult = AuthorizedScope | { authorized: false; reason?: string };

type RateLimit = { limit: number; remaining: number; retryAfterMs: number };
type PaymentIntentProjection =
  | Doc<"paymentIntents">
  | ({ _id: Id<"paymentIntents"> } & Omit<Doc<"paymentIntents">, "_creationTime" | "_id">);
type ActionTimings = {
  authMs: number;
  rateLimitMs: number;
  redisMs: number;
  createMs?: number;
  operationMs?: number;
  totalMs: number;
};
type CommonActionResult =
  | { status: "unauthorized"; reason?: string }
  | { status: "limiter_unavailable"; retryAfterMs: number; timings: ActionTimings }
  | { status: "rate_limited"; rateLimit: RateLimit; timings: ActionTimings }
  | { status: "idempotency_conflict"; rateLimit?: RateLimit; timings?: ActionTimings };
type CreateActionResult =
  | CommonActionResult
  | {
      status: "pdax_unavailable";
      code: "PDAX_UNAVAILABLE";
      message: string;
    }
  | {
      status: "success" | "idempotency_replay";
      projectId: Id<"projects">;
      intent: PaymentIntentProjection;
      rateLimit: RateLimit;
      timings: ActionTimings;
    };
type PaymentPage = {
  page: Doc<"paymentIntents">[];
  isDone: boolean;
  continueCursor: string;
};
type RetrieveActionResult =
  | CommonActionResult
  | {
      status: "success";
      intent: Doc<"paymentIntents"> | null;
      rateLimit: RateLimit;
      timings: ActionTimings;
    };
type ListActionResult =
  | CommonActionResult
  | {
      status: "success";
      page: PaymentPage;
      rateLimit: RateLimit;
      timings: ActionTimings;
    };

type AdmissionResult =
  | { status: "unauthorized"; rateLimitMs: number; redisMs: number }
  | { status: "unavailable"; rateLimitMs: number; redisMs: number; retryAfterMs: number }
  | { status: "fingerprint_conflict"; rateLimitMs: number; redisMs: number }
  | {
      status: "ok";
      allowed: boolean;
      rateLimit: RateLimit;
      rateLimitMs: number;
      redisMs: number;
    };

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function authorize(
  ctx: ActionCtx,
  apiKeyHash: string,
): Promise<{ result: AuthorizationResult; authMs: number }> {
  const startedAt = Date.now();
  const result: AuthorizationResult = await ctx.runQuery(
    internal.payment_intents.public_api_internal.authorize,
    {
      apiKeyHash,
    },
  );
  return { result, authMs: Date.now() - startedAt };
}

async function admit(
  ctx: ActionCtx,
  args: {
    scope: AuthorizedScope;
    apiKeyHash: string;
    admissionId: string;
    fingerprint: string;
  },
): Promise<AdmissionResult> {
  const startedAt = Date.now();
  if (args.scope.rateLimitBackend === "migrating" || args.admissionId.length > 128) {
    return {
      status: "unavailable" as const,
      rateLimitMs: Date.now() - startedAt,
      redisMs: 0,
      retryAfterMs: 1_000,
    };
  }
  if (args.scope.rateLimitBackend === "convex") {
    const result: { authorized: false } | ({ authorized: true; allowed: boolean } & RateLimit) =
      await ctx.runMutation(internal.rate_limits.mutations.consumeAuthorized, {
        apiKeyId: args.scope.apiKeyId,
        projectId: args.scope.projectId,
        apiKeyHash: args.apiKeyHash,
      });
    const rateLimitMs = Date.now() - startedAt;
    if (!result.authorized) return { status: "unauthorized" as const, rateLimitMs, redisMs: 0 };
    return {
      status: "ok" as const,
      allowed: result.allowed,
      rateLimit: {
        limit: result.limit,
        remaining: result.remaining,
        retryAfterMs: result.retryAfterMs,
      },
      rateLimitMs,
      redisMs: 0,
    };
  }

  const result = await consumeUpstashPaymentAdmission({
    apiKeyHash: args.apiKeyHash,
    projectId: args.scope.projectId,
    admissionId: args.admissionId,
    fingerprint: args.fingerprint,
  });
  const rateLimitMs = Date.now() - startedAt;
  if (result.status === "unavailable") {
    return {
      status: "unavailable" as const,
      rateLimitMs,
      redisMs: result.redisMs,
      retryAfterMs: result.retryAfterMs,
    };
  }
  if (result.status === "fingerprint_conflict") {
    return { status: "fingerprint_conflict" as const, rateLimitMs, redisMs: result.redisMs };
  }
  return {
    status: "ok" as const,
    allowed: result.allowed,
    rateLimit: {
      limit: result.limit,
      remaining: result.remaining,
      retryAfterMs: result.retryAfterMs,
    },
    rateLimitMs,
    redisMs: result.redisMs,
  };
}

function unavailableResult(
  authMs: number,
  rateLimitMs: number,
  redisMs: number,
  retryAfterMs: number,
) {
  return {
    status: "limiter_unavailable" as const,
    retryAfterMs,
    timings: { authMs, rateLimitMs, redisMs, totalMs: authMs + rateLimitMs },
  };
}

export const create = action({
  args: {
    apiKeyHash: v.string(),
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
  handler: async (ctx, args): Promise<CreateActionResult> => {
    const startedAt = Date.now();
    const { result: scope, authMs } = await authorize(ctx, args.apiKeyHash);
    if (!scope.authorized) return { status: "unauthorized" as const, reason: scope.reason };
    const legacyPdaxRoute =
      args.anchor === "pdax" ||
      (args.anchor === undefined && scope.resolvedAnchor === "pdax") ||
      (args.anchor === "inhouse" && scope.apiKeyAnchor === "pdax");
    if (legacyPdaxRoute) {
      return {
        status: "pdax_unavailable" as const,
        code: "PDAX_UNAVAILABLE" as const,
        message:
          "PDAX payment routing is no longer available. Switch the project default and API key to in-house before creating payments.",
      };
    }
    const fingerprint = await sha256(
      JSON.stringify({
        operation: "create",
        amount: args.amount,
        asset: args.asset,
        description: args.description ?? null,
        successUrl: args.successUrl ?? null,
        cancelUrl: args.cancelUrl ?? null,
        anchor: args.anchor ?? null,
        idempotencyKey: args.idempotencyKey ?? null,
      }),
    );
    const admission = await admit(ctx, {
      scope,
      apiKeyHash: args.apiKeyHash,
      admissionId: args.admissionId,
      fingerprint,
    });
    if (admission.status === "unauthorized") return { status: "unauthorized" as const };
    if (admission.status === "unavailable") {
      return unavailableResult(
        authMs,
        admission.rateLimitMs,
        admission.redisMs,
        admission.retryAfterMs,
      );
    }
    if (admission.status === "fingerprint_conflict") {
      return { status: "idempotency_conflict" as const };
    }
    if (!admission.allowed) {
      return {
        status: "rate_limited" as const,
        rateLimit: admission.rateLimit,
        timings: {
          authMs,
          rateLimitMs: admission.rateLimitMs,
          redisMs: admission.redisMs,
          totalMs: Date.now() - startedAt,
        },
      };
    }
    if (scope.rateLimitBackend === "migrating") {
      return unavailableResult(authMs, admission.rateLimitMs, admission.redisMs, 1_000);
    }
    const createStartedAt = Date.now();
    const result:
      | { status: "unauthorized"; reason?: string }
      | { status: "limiter_unavailable" }
      | { status: "idempotency_conflict"; projectId: Id<"projects"> }
      | {
          status: "success" | "idempotency_replay";
          projectId: Id<"projects">;
          intent: PaymentIntentProjection;
          timings: { createMs: number };
        } = await ctx.runMutation(
      internal.payment_intents.mutations.createAuthorizedPaymentIntentV2,
      {
        apiKeyId: scope.apiKeyId,
        projectId: scope.projectId,
        apiKeyHash: args.apiKeyHash,
        expectedRateLimitBackend: scope.rateLimitBackend,
        admissionId: args.admissionId,
        correlationId: args.correlationId,
        traceparent: args.traceparent,
        amount: args.amount,
        asset: args.asset,
        description: args.description,
        successUrl: args.successUrl,
        cancelUrl: args.cancelUrl,
        idempotencyKey: args.idempotencyKey,
        anchor: args.anchor,
      },
    );
    const createMs = Date.now() - createStartedAt;
    const timings = {
      authMs,
      rateLimitMs: admission.rateLimitMs,
      redisMs: admission.redisMs,
      createMs,
      totalMs: Date.now() - startedAt,
    };
    if (result.status === "limiter_unavailable") {
      return unavailableResult(authMs, admission.rateLimitMs, admission.redisMs, 1_000);
    }
    if (result.status === "unauthorized") {
      return { status: "unauthorized", reason: result.reason };
    }
    if (result.status === "idempotency_conflict") {
      return { status: "idempotency_conflict", rateLimit: admission.rateLimit, timings };
    }
    return {
      status: result.status,
      projectId: result.projectId,
      intent: result.intent,
      rateLimit: admission.rateLimit,
      timings,
    };
  },
});

export const retrieve = action({
  args: {
    apiKeyHash: v.string(),
    admissionId: v.string(),
    paymentIntentId: v.string(),
  },
  handler: async (ctx, args): Promise<RetrieveActionResult> => {
    const startedAt = Date.now();
    const { result: scope, authMs } = await authorize(ctx, args.apiKeyHash);
    if (!scope.authorized) return { status: "unauthorized" as const, reason: scope.reason };
    const admission = await admit(ctx, {
      scope,
      apiKeyHash: args.apiKeyHash,
      admissionId: args.admissionId,
      fingerprint: await sha256(`retrieve:${args.paymentIntentId}`),
    });
    if (admission.status === "unauthorized") return { status: "unauthorized" as const };
    if (admission.status === "unavailable") {
      return unavailableResult(
        authMs,
        admission.rateLimitMs,
        admission.redisMs,
        admission.retryAfterMs,
      );
    }
    if (admission.status === "fingerprint_conflict")
      return { status: "idempotency_conflict" as const };
    if (!admission.allowed) {
      return {
        status: "rate_limited" as const,
        rateLimit: admission.rateLimit,
        timings: {
          authMs,
          rateLimitMs: admission.rateLimitMs,
          redisMs: admission.redisMs,
          totalMs: Date.now() - startedAt,
        },
      };
    }
    if (scope.rateLimitBackend === "migrating") {
      return unavailableResult(authMs, admission.rateLimitMs, admission.redisMs, 1_000);
    }
    const operationStartedAt = Date.now();
    const result:
      | { authorized: false }
      | { authorized: true; intent: Doc<"paymentIntents"> | null } = await ctx.runQuery(
      internal.payment_intents.public_api_internal.getAuthorized,
      {
        apiKeyId: scope.apiKeyId,
        projectId: scope.projectId,
        apiKeyHash: args.apiKeyHash,
        expectedRateLimitBackend: scope.rateLimitBackend,
        paymentIntentId: args.paymentIntentId,
      },
    );
    if (!result.authorized) return { status: "unauthorized" as const };
    return {
      status: "success" as const,
      intent: result.intent,
      rateLimit: admission.rateLimit,
      timings: {
        authMs,
        rateLimitMs: admission.rateLimitMs,
        redisMs: admission.redisMs,
        operationMs: Date.now() - operationStartedAt,
        totalMs: Date.now() - startedAt,
      },
    };
  },
});

export const list = action({
  args: {
    apiKeyHash: v.string(),
    admissionId: v.string(),
    status: v.optional(paymentIntentStatusValidator),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args): Promise<ListActionResult> => {
    const startedAt = Date.now();
    const { result: scope, authMs } = await authorize(ctx, args.apiKeyHash);
    if (!scope.authorized) return { status: "unauthorized" as const, reason: scope.reason };
    const admission = await admit(ctx, {
      scope,
      apiKeyHash: args.apiKeyHash,
      admissionId: args.admissionId,
      fingerprint: await sha256(
        JSON.stringify({
          operation: "list",
          status: args.status ?? null,
          pagination: args.paginationOpts,
        }),
      ),
    });
    if (admission.status === "unauthorized") return { status: "unauthorized" as const };
    if (admission.status === "unavailable") {
      return unavailableResult(
        authMs,
        admission.rateLimitMs,
        admission.redisMs,
        admission.retryAfterMs,
      );
    }
    if (admission.status === "fingerprint_conflict")
      return { status: "idempotency_conflict" as const };
    if (!admission.allowed) {
      return {
        status: "rate_limited" as const,
        rateLimit: admission.rateLimit,
        timings: {
          authMs,
          rateLimitMs: admission.rateLimitMs,
          redisMs: admission.redisMs,
          totalMs: Date.now() - startedAt,
        },
      };
    }
    if (scope.rateLimitBackend === "migrating") {
      return unavailableResult(authMs, admission.rateLimitMs, admission.redisMs, 1_000);
    }
    const operationStartedAt = Date.now();
    const result: { authorized: false } | { authorized: true; page: PaymentPage } =
      await ctx.runQuery(internal.payment_intents.public_api_internal.listAuthorized, {
        apiKeyId: scope.apiKeyId,
        projectId: scope.projectId,
        apiKeyHash: args.apiKeyHash,
        expectedRateLimitBackend: scope.rateLimitBackend,
        status: args.status,
        paginationOpts: args.paginationOpts,
      });
    if (!result.authorized) return { status: "unauthorized" as const };
    return {
      status: "success" as const,
      page: result.page,
      rateLimit: admission.rateLimit,
      timings: {
        authMs,
        rateLimitMs: admission.rateLimitMs,
        redisMs: admission.redisMs,
        operationMs: Date.now() - operationStartedAt,
        totalMs: Date.now() - startedAt,
      },
    };
  },
});

export const stagingBaseline = action({
  args: { apiKeyHash: v.string(), admissionId: v.string() },
  handler: async (ctx, args): Promise<Record<string, unknown>> => {
    if (env.VELO_ENABLE_RATE_LIMIT_BENCHMARK !== "true") {
      return { status: "not_found" as const };
    }
    const startedAt = Date.now();
    const { result: scope, authMs } = await authorize(ctx, args.apiKeyHash);
    if (!scope.authorized) return { status: "unauthorized" as const };
    const admission = await admit(ctx, {
      scope,
      apiKeyHash: args.apiKeyHash,
      admissionId: args.admissionId,
      fingerprint: await sha256("staging-baseline"),
    });
    if (admission.status !== "ok" || !admission.allowed) {
      return {
        status:
          admission.status === "ok" ? ("rate_limited" as const) : ("limiter_unavailable" as const),
      };
    }
    if (scope.rateLimitBackend === "migrating") {
      return { status: "limiter_unavailable" as const };
    }
    const createStartedAt = Date.now();
    const authorized: boolean = await ctx.runMutation(
      internal.payment_intents.public_api_internal.emptyAuthorizedMutation,
      {
        apiKeyId: scope.apiKeyId,
        projectId: scope.projectId,
        apiKeyHash: args.apiKeyHash,
        expectedRateLimitBackend: scope.rateLimitBackend,
      },
    );
    return {
      status: authorized ? ("success" as const) : ("unauthorized" as const),
      timings: {
        authMs,
        rateLimitMs: admission.rateLimitMs,
        redisMs: admission.redisMs,
        createMs: Date.now() - createStartedAt,
        totalMs: Date.now() - startedAt,
      },
    };
  },
});
