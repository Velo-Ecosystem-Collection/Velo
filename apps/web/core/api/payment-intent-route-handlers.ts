import { env } from "@/core/config/env";
import { stellarConfig } from "@/core/config/stellar";
import { measureTelemetryStage, type RouteTelemetry } from "@/core/observability";
import { api } from "@repo/backend/convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { NextRequest, NextResponse } from "next/server";

import { distributedRateLimitHeaders, type DistributedRateLimit } from "./distributed-rate-limit";
import {
  attachHeaders,
  getApiKeyHashOrError,
  getIdempotencyKey,
  parseCreatePaymentIntentBody,
  parseListPaymentIntentQuery,
  publicPaymentIntentFromDoc,
  publicPaymentIntentFromDocV2,
  type PublicPaymentIntentDocV2,
  veloErrorResponse,
} from "./payment-intents";

type ActionTimings = {
  authMs: number;
  rateLimitMs: number;
  redisMs: number;
  createMs?: number;
  operationMs?: number;
  totalMs: number;
};

type PaymentActionResult =
  | { status: "unauthorized"; reason?: string }
  | { status: "limiter_unavailable"; retryAfterMs: number; timings: ActionTimings }
  | { status: "rate_limited"; rateLimit: DistributedRateLimit; timings: ActionTimings }
  | { status: "idempotency_conflict"; rateLimit?: DistributedRateLimit; timings?: ActionTimings }
  | { status: "pdax_unavailable"; code: "PDAX_UNAVAILABLE"; message: string }
  | {
      status: "success" | "idempotency_replay";
      intent: PublicPaymentIntentDocV2;
      rateLimit: DistributedRateLimit;
      timings: ActionTimings;
    };

type ListActionResult =
  | Exclude<PaymentActionResult, { status: "pdax_unavailable" | "success" | "idempotency_replay" }>
  | {
      status: "success";
      page: {
        page: PublicPaymentIntentDocV2[];
        isDone: boolean;
        continueCursor: string;
      };
      rateLimit: DistributedRateLimit;
      timings: ActionTimings;
    };

type RetrieveActionResult =
  | Exclude<PaymentActionResult, { status: "pdax_unavailable" | "success" | "idempotency_replay" }>
  | {
      status: "success";
      intent: PublicPaymentIntentDocV2 | null;
      rateLimit: DistributedRateLimit;
      timings: ActionTimings;
    };

const convex = new ConvexHttpClient(env.NEXT_PUBLIC_CONVEX_URL);

function addActionTimings(telemetry: RouteTelemetry, timings?: ActionTimings) {
  if (!timings) return;
  telemetry.stages.push({ name: "auth", durationMs: timings.authMs });
  telemetry.stages.push({ name: "rate_limit", durationMs: timings.rateLimitMs });
  telemetry.stages.push({ name: "redis", durationMs: timings.redisMs });
  if (timings.createMs !== undefined) {
    telemetry.stages.push({ name: "create", durationMs: timings.createMs });
  }
}

function jsonResponse(telemetry: RouteTelemetry, body: unknown, init?: ResponseInit) {
  const startedAt = globalThis.performance?.now?.() ?? Date.now();
  const response = NextResponse.json(body, init);
  const finishedAt = globalThis.performance?.now?.() ?? Date.now();
  telemetry.stages.push({ name: "serialize", durationMs: finishedAt - startedAt });
  return response;
}

function limiterUnavailable(retryAfterMs: number) {
  return veloErrorResponse({
    status: 503,
    type: "api_error",
    code: "rate_limiter_unavailable",
    message: "Rate limiter is temporarily unavailable.",
    headers: { "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1_000))) },
  });
}

function rateLimited(rateLimit: DistributedRateLimit) {
  return veloErrorResponse({
    status: 429,
    type: "rate_limit_error",
    code: "rate_limit_exceeded",
    message: "Rate limit exceeded.",
    headers: distributedRateLimitHeaders(rateLimit),
  });
}

function unauthorized(reason?: string) {
  return veloErrorResponse({
    status: 401,
    type: "auth_error",
    code: "invalid_api_key",
    message: reason || "Invalid API key.",
  });
}

function idempotencyConflict(headers?: Record<string, string>) {
  return veloErrorResponse({
    status: 409,
    type: "idempotency_error",
    code: "idempotency_key_conflict",
    message: "Idempotency-Key was already used with a different request body.",
    headers,
  });
}

export async function createPaymentIntentHandler(baseRequest: Request, telemetry: RouteTelemetry) {
  const request = baseRequest as NextRequest;
  const auth = getApiKeyHashOrError(request);
  if (!auth.ok) return auth.response;
  const parsed = await parseCreatePaymentIntentBody(request);
  if (!parsed.ok) return parsed.response;

  const requestedAsset = parsed.body.asset;
  const asset =
    !requestedAsset || requestedAsset === "USDC" ? stellarConfig.checkoutAsset : requestedAsset;
  try {
    const result = (await measureTelemetryStage(telemetry, "convex.action", () =>
      convex.action(api.payment_intents.public_api.create, {
        apiKeyHash: auth.apiKeyHash,
        admissionId: crypto.randomUUID(),
        correlationId: telemetry.correlationId,
        traceparent: telemetry.context.traceparent,
        amount: parsed.body.amount,
        asset,
        description: parsed.body.description,
        successUrl: parsed.body.successUrl,
        cancelUrl: parsed.body.cancelUrl,
        anchor: parsed.body.anchor as "inhouse" | "pdax" | undefined,
        idempotencyKey: getIdempotencyKey(request),
      }),
    )) as PaymentActionResult;
    addActionTimings(telemetry, "timings" in result ? result.timings : undefined);

    if (result.status === "unauthorized") return unauthorized(result.reason);
    if (result.status === "limiter_unavailable") return limiterUnavailable(result.retryAfterMs);
    if (result.status === "rate_limited") return rateLimited(result.rateLimit);
    if (result.status === "pdax_unavailable") {
      return veloErrorResponse({
        status: 409,
        type: "validation_error",
        code: result.code.toLowerCase(),
        message: result.message,
      });
    }
    const rateHeaders = result.rateLimit
      ? distributedRateLimitHeaders(result.rateLimit)
      : undefined;
    if (result.status === "idempotency_conflict") return idempotencyConflict(rateHeaders);

    const response = jsonResponse(
      telemetry,
      publicPaymentIntentFromDocV2(result.intent, env.NEXT_PUBLIC_APP_URL),
      { status: result.status === "idempotency_replay" ? 200 : 201 },
    );
    if (result.intent.correlationId) {
      telemetry.context.journeyCorrelationId = result.intent.correlationId;
      response.headers.set("X-Velo-Journey-Id", result.intent.correlationId);
    }
    if (result.status === "idempotency_replay" && result.intent.traceparent) {
      telemetry.linkTraceparent = result.intent.traceparent;
    }
    return attachHeaders(response, rateHeaders!);
  } catch (error) {
    if (
      error instanceof Error &&
      ((error as { data?: { code?: string } }).data?.code === "INSUFFICIENT_BILLING_CREDITS" ||
        error.message.includes("INSUFFICIENT_BILLING_CREDITS"))
    ) {
      return veloErrorResponse({
        status: 402,
        type: "billing_error",
        code: "insufficient_billing_credits",
        message: "This organization has no available Velo credits.",
      });
    }
    if (
      error instanceof Error &&
      (error as { data?: { code?: string } }).data?.code === "PDAX_UNAVAILABLE"
    ) {
      return veloErrorResponse({
        status: 409,
        type: "validation_error",
        code: "pdax_unavailable",
        message:
          "PDAX payment routing is no longer available. Switch the project default and API key to in-house before creating payments.",
      });
    }
    return veloErrorResponse({
      status: 500,
      type: "api_error",
      code: "internal_error",
      message: "Internal server error.",
    });
  }
}

export async function listPaymentIntentsHandler(baseRequest: Request, telemetry: RouteTelemetry) {
  const request = baseRequest as NextRequest;
  const auth = getApiKeyHashOrError(request);
  if (!auth.ok) return auth.response;
  const parsed = parseListPaymentIntentQuery(request.nextUrl.searchParams);
  if (!parsed.ok) return parsed.response;
  try {
    const result = (await measureTelemetryStage(telemetry, "convex.action", () =>
      convex.action(api.payment_intents.public_api.list, {
        apiKeyHash: auth.apiKeyHash,
        admissionId: crypto.randomUUID(),
        status: parsed.status,
        paginationOpts: parsed.paginationOpts,
      }),
    )) as ListActionResult;
    addActionTimings(telemetry, "timings" in result ? result.timings : undefined);
    if (result.status === "unauthorized") return unauthorized(result.reason);
    if (result.status === "limiter_unavailable") return limiterUnavailable(result.retryAfterMs);
    if (result.status === "rate_limited") return rateLimited(result.rateLimit);
    if (result.status === "idempotency_conflict") return idempotencyConflict();
    const rateHeaders = distributedRateLimitHeaders(result.rateLimit);
    return attachHeaders(
      jsonResponse(telemetry, {
        object: "list",
        data: result.page.page.map((intent) =>
          publicPaymentIntentFromDocV2(intent, env.NEXT_PUBLIC_APP_URL),
        ),
        hasMore: !result.page.isDone,
        nextCursor: result.page.isDone ? null : result.page.continueCursor,
      }),
      rateHeaders,
    );
  } catch {
    return veloErrorResponse({
      status: 500,
      type: "api_error",
      code: "internal_error",
      message: "Internal server error.",
    });
  }
}

export async function retrievePaymentIntentHandler(
  version: "v1" | "v2",
  baseRequest: Request,
  telemetry: RouteTelemetry,
  { params }: { params: Promise<{ id: string }> },
) {
  const request = baseRequest as NextRequest;
  const { id } = await params;
  const auth = getApiKeyHashOrError(request);
  if (!auth.ok) return auth.response;
  try {
    const result = (await measureTelemetryStage(telemetry, "convex.action", () =>
      convex.action(api.payment_intents.public_api.retrieve, {
        apiKeyHash: auth.apiKeyHash,
        admissionId: crypto.randomUUID(),
        paymentIntentId: id,
      }),
    )) as RetrieveActionResult;
    addActionTimings(telemetry, "timings" in result ? result.timings : undefined);
    if (result.status === "unauthorized") return unauthorized(result.reason);
    if (result.status === "limiter_unavailable") return limiterUnavailable(result.retryAfterMs);
    if (result.status === "rate_limited") return rateLimited(result.rateLimit);
    if (result.status === "idempotency_conflict") return idempotencyConflict();
    const rateHeaders = distributedRateLimitHeaders(result.rateLimit);
    if (!result.intent) {
      return veloErrorResponse({
        status: 404,
        type: "not_found_error",
        code: "payment_intent_not_found",
        message: "Payment intent not found.",
        headers: rateHeaders,
      });
    }
    const body =
      version === "v1"
        ? publicPaymentIntentFromDoc(result.intent, env.NEXT_PUBLIC_APP_URL)
        : publicPaymentIntentFromDocV2(result.intent, env.NEXT_PUBLIC_APP_URL);
    return attachHeaders(jsonResponse(telemetry, body), rateHeaders);
  } catch {
    return veloErrorResponse({
      status: 500,
      type: "api_error",
      code: "internal_error",
      message: "Internal server error.",
    });
  }
}
