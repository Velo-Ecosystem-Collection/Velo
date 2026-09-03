import crypto from "node:crypto";

import { isCorrelationId } from "@repo/observability";

const API_KEY_PATTERN = /^tk_live_[a-f0-9]{32}$/;
export const PAYMENT_INTENT_STATUSES = [
  "awaiting_route",
  "created",
  "pending",
  "paid",
  "failed",
  "expired",
  "cancelled",
] as const;

type PaymentIntentStatus = (typeof PAYMENT_INTENT_STATUSES)[number];

type PublicPaymentIntentDoc = {
  _id: string;
  status: PaymentIntentStatus;
  amount: string;
  asset: string;
  description?: string;
  successUrl?: string;
  cancelUrl?: string;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
};

type VeloErrorType =
  | "auth_error"
  | "validation_error"
  | "not_found_error"
  | "idempotency_error"
  | "rate_limit_error"
  | "billing_error"
  | "api_error";

type CreatePaymentIntentBody = {
  amount: string;
  asset?: string;
  description?: string;
  successUrl?: string;
  cancelUrl?: string;
  anchor?: string;
};

export function getApiKeyHashOrError(request: { headers: Headers }) {
  const apiKey = getApiKeyFromHeaders(request.headers);
  if (!apiKey || !API_KEY_PATTERN.test(apiKey)) {
    return {
      ok: false as const,
      response: veloErrorResponse({
        status: 401,
        type: "auth_error",
        code: "invalid_api_key",
        message: "Missing or invalid API key.",
      }),
    };
  }

  return { ok: true as const, apiKeyHash: hashApiKey(apiKey) };
}

export function veloErrorResponse(args: {
  status: number;
  type: VeloErrorType;
  code: string;
  message: string;
  param?: string;
  headers?: Record<string, string>;
  requestId?: string;
}) {
  const suppliedRequestId = args.requestId?.trim();
  const requestId = isCorrelationId(suppliedRequestId) ? suppliedRequestId : crypto.randomUUID();
  const response = Response.json(
    {
      error: {
        type: args.type,
        code: args.code,
        message: args.message,
        ...(args.param !== undefined ? { param: args.param } : {}),
        requestId,
      },
    },
    { status: args.status, headers: args.headers },
  );
  response.headers.set("X-Request-Id", requestId);
  return response;
}

export function attachHeaders<T extends Response>(response: T, headers: Record<string, string>) {
  Object.entries(headers).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}

export function publicPaymentIntentFromDoc(intent: PublicPaymentIntentDoc, appUrl: string) {
  const paymentIntentId = intent._id;
  return {
    id: paymentIntentId,
    object: "payment_intent" as const,
    paymentIntentId,
    status: intent.status,
    amount: intent.amount,
    asset: intent.asset,
    description: intent.description ?? null,
    checkoutUrl: `${appUrl}/pay/${paymentIntentId}`,
    successUrl: intent.successUrl ?? null,
    cancelUrl: intent.cancelUrl ?? null,
    expiresAt: new Date(intent.expiresAt).toISOString(),
    createdAt: new Date(intent.createdAt).toISOString(),
    updatedAt: new Date(intent.updatedAt).toISOString(),
  };
}

export type PublicPaymentIntentDocV2 = PublicPaymentIntentDoc & {
  correlationId?: string;
  traceparent?: string;
  anchor?: "inhouse" | "pdax";
  receiverAddress?: string;
  receiverMemo?: string;
  anchorDepositCurrency?: string;
  payerAddress?: string;
  stageTimestamps?: {
    created: number;
    routeReady?: number;
    routeFailed?: number;
    awaiting_signature?: number;
    signed?: number;
    submitted?: number;
    submissionReported?: number;
    observed?: number;
    confirmed?: number;
    failed?: number;
    cancelled?: number;
    expired?: number;
  };
};

export function publicPaymentIntentFromDocV2(intent: PublicPaymentIntentDocV2, appUrl: string) {
  const paymentIntentId = intent._id;
  return {
    id: paymentIntentId,
    object: "payment_intent" as const,
    paymentIntentId,
    correlationId: intent.correlationId ?? null,
    status: intent.status,
    amount: intent.amount,
    asset: intent.asset,
    description: intent.description ?? null,
    checkoutUrl: `${appUrl}/pay/${paymentIntentId}`,
    successUrl: intent.successUrl ?? null,
    cancelUrl: intent.cancelUrl ?? null,
    anchor: intent.anchor ?? "inhouse",
    receiverAddress: intent.receiverAddress ?? null,
    receiverMemo: intent.receiverMemo ?? null,
    anchorDepositCurrency: intent.anchorDepositCurrency ?? null,
    payerAddress: intent.payerAddress ?? null,
    expiresAt: new Date(intent.expiresAt).toISOString(),
    createdAt: new Date(intent.createdAt).toISOString(),
    updatedAt: new Date(intent.updatedAt).toISOString(),
    stageTimestamps: intent.stageTimestamps
      ? {
          created: new Date(intent.stageTimestamps.created).toISOString(),
          routeReady: intent.stageTimestamps.routeReady
            ? new Date(intent.stageTimestamps.routeReady).toISOString()
            : null,
          routeFailed: intent.stageTimestamps.routeFailed
            ? new Date(intent.stageTimestamps.routeFailed).toISOString()
            : null,
          awaiting_signature: intent.stageTimestamps.awaiting_signature
            ? new Date(intent.stageTimestamps.awaiting_signature).toISOString()
            : null,
          signed: intent.stageTimestamps.signed
            ? new Date(intent.stageTimestamps.signed).toISOString()
            : null,
          submitted: intent.stageTimestamps.submitted
            ? new Date(intent.stageTimestamps.submitted).toISOString()
            : null,
          submissionReported: intent.stageTimestamps.submissionReported
            ? new Date(intent.stageTimestamps.submissionReported).toISOString()
            : null,
          observed: intent.stageTimestamps.observed
            ? new Date(intent.stageTimestamps.observed).toISOString()
            : null,
          confirmed: intent.stageTimestamps.confirmed
            ? new Date(intent.stageTimestamps.confirmed).toISOString()
            : null,
          failed: intent.stageTimestamps.failed
            ? new Date(intent.stageTimestamps.failed).toISOString()
            : null,
          cancelled: intent.stageTimestamps.cancelled
            ? new Date(intent.stageTimestamps.cancelled).toISOString()
            : null,
          expired: intent.stageTimestamps.expired
            ? new Date(intent.stageTimestamps.expired).toISOString()
            : null,
        }
      : null,
  };
}

export async function parseCreatePaymentIntentBody(request: { json: () => Promise<unknown> }) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      ok: false as const,
      response: veloErrorResponse({
        status: 400,
        type: "validation_error",
        code: "invalid_request",
        message: "Request body must be valid JSON.",
      }),
    };
  }

  if (!isRecord(body)) {
    return validationError("Request body must be an object.");
  }

  const amount = body.amount;
  if (typeof amount !== "string" || amount.trim() === "" || Number.parseFloat(amount) <= 0) {
    return validationError("amount is required and must be positive.", "amount");
  }

  const parsed: CreatePaymentIntentBody = { amount };
  for (const field of ["asset", "description", "successUrl", "cancelUrl", "anchor"] as const) {
    const value = body[field];
    if (value !== undefined) {
      if (typeof value !== "string") {
        return validationError(`${field} must be a string.`, field);
      }
      if (field === "anchor" && value !== "inhouse" && value !== "pdax") {
        return validationError("anchor must be 'inhouse' or 'pdax'.", "anchor");
      }
      parsed[field] = value;
    }
  }

  return { ok: true as const, body: parsed };
}

export function parseListPaymentIntentQuery(searchParams: URLSearchParams) {
  const status = searchParams.get("status");
  if (status !== null && !isPaymentIntentStatus(status)) {
    return validationError("status is invalid.", "status");
  }

  const limitParam = searchParams.get("limit");
  if (limitParam !== null && !/^\d+$/.test(limitParam)) {
    return validationError("limit must be a positive integer.", "limit");
  }

  const limit =
    limitParam === null ? 20 : Math.min(100, Math.max(1, Number.parseInt(limitParam, 10)));
  const cursor = searchParams.get("cursor");

  return {
    ok: true as const,
    status: status ?? undefined,
    paginationOpts: {
      numItems: limit,
      cursor: cursor === null || cursor.trim() === "" ? null : cursor,
    },
  };
}

export function getIdempotencyKey(request: { headers: Headers }) {
  const key = request.headers.get("idempotency-key")?.trim();
  return key === "" ? undefined : key;
}

function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

function getApiKeyFromHeaders(headers: Headers): string | null {
  const authHeader = headers.get("authorization");
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.substring(7).trim();
  }

  const apiKey = headers.get("x-api-key");
  return apiKey ? apiKey.trim() : null;
}

function validationError(message: string, param?: string) {
  return {
    ok: false as const,
    response: veloErrorResponse({
      status: 400,
      type: "validation_error",
      code: "invalid_request",
      message,
      param,
    }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPaymentIntentStatus(value: string): value is PaymentIntentStatus {
  return PAYMENT_INTENT_STATUSES.includes(value as PaymentIntentStatus);
}
