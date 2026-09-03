import { api } from "@repo/backend/convex/_generated/api.js";

import type { FunctionArgs, FunctionReturnType } from "convex/server";
import type { NextRequest } from "next/server";

import { measureTelemetryStage, type RouteTelemetry } from "../observability.ts";
import { getApiKeyFromRequest, hashApiKey } from "./auth.ts";
import { veloErrorResponse } from "./payment-intents.ts";

const API_KEY_PATTERN = /^tk_live_[a-f0-9]{32}$/;
const CANONICAL_DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/;

/** Maximum raw request size accepted by the sponsor HTTP boundary. */
export const GAS_SPONSOR_MAX_BODY_BYTES = 64 * 1_024;
const GAS_SPONSOR_MAX_IDEMPOTENCY_KEY_BYTES = 255;

type SponsorFunction = typeof api.gas.public_api.sponsor;
type SponsorArgs = FunctionArgs<SponsorFunction>;
export type GasSponsorResult = FunctionReturnType<SponsorFunction>;

/** Narrow Convex action seam used by production and injected route tests. */
export type GasSponsorCaller = {
  action: (reference: SponsorFunction, args: SponsorArgs) => Promise<GasSponsorResult>;
};

type GasSponsorReservationDto = {
  object: "gas_sponsor_reservation";
  requestId: string;
  replayed: boolean;
  decision: "reserved";
  transactionHash: string;
  sourceWallet: string;
  targetContractIds: string[];
  innerMaxFeeStroops: string;
  reservedStroops: string;
  expiresAt: string;
};

type GasSponsorReservation = {
  requestId: string;
  transactionHash: string;
  sourceWallet: string;
  targetContractIds: string[];
  innerMaxFeeStroops: string;
  reservedStroops: string;
  decisionCode: "reserved";
  rejectionCode: null;
  lifecycle: "reserved";
  expiresAt: number;
};

type BodyReadResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: "invalid" | "too_large" };

type ParsedSponsorBody = {
  transactionXdr: string;
};

/** Build the shared Gas sponsor handler around an injectable Convex caller. */
export function createGasSponsorHandler(convex: GasSponsorCaller) {
  return async function gasSponsorHandler(
    request: Request,
    telemetry: RouteTelemetry,
  ): Promise<Response> {
    try {
      const apiKey = getApiKeyFromRequest(request as NextRequest);
      if (!apiKey || !API_KEY_PATTERN.test(apiKey)) {
        return gasError(telemetry, {
          status: 401,
          type: "auth_error",
          code: "invalid_api_key",
          message: "Missing or invalid API key.",
        });
      }

      const idempotencyKey = parseIdempotencyKey(request);
      if (!idempotencyKey.ok) {
        return gasError(telemetry, {
          status: 400,
          type: "validation_error",
          code: "invalid_request",
          message: idempotencyKey.message,
          param: "Idempotency-Key",
        });
      }

      const rawBody = await readRawBody(request);
      if (!rawBody.ok) {
        return gasError(telemetry, {
          status: rawBody.reason === "too_large" ? 413 : 400,
          type: "validation_error",
          code: "invalid_request",
          message:
            rawBody.reason === "too_large"
              ? "Request body is too large."
              : "Request body could not be read.",
        });
      }

      const parsedBody = parseSponsorBody(rawBody.bytes);
      if (!parsedBody.ok) {
        return gasError(telemetry, {
          status: parsedBody.reason === "too_large" ? 413 : 400,
          type: "validation_error",
          code: "invalid_request",
          message: parsedBody.message,
          ...(parsedBody.reason === "invalid" ? { param: "transactionXdr" } : {}),
        });
      }

      const args: SponsorArgs = {
        apiKeyHash: hashApiKey(apiKey),
        idempotencyKey: idempotencyKey.value,
        transactionXdr: parsedBody.value.transactionXdr,
      };

      let result: GasSponsorResult;
      try {
        result = await measureTelemetryStage(telemetry, "convex.action", () =>
          convex.action(api.gas.public_api.sponsor, args),
        );
      } catch {
        return gasError(telemetry, {
          status: 503,
          type: "api_error",
          code: "dependency_unavailable",
          message: "Gas sponsorship is temporarily unavailable.",
        });
      }

      return mapGasSponsorResult(result, telemetry);
    } catch {
      return gasError(telemetry, {
        status: 500,
        type: "api_error",
        code: "internal_error",
        message: "Internal server error.",
      });
    }
  };
}

function parseIdempotencyKey(request: Request) {
  const value = request.headers.get("idempotency-key")?.trim();
  if (!value) {
    return { ok: false as const, message: "Idempotency-Key is required." };
  }
  if (new TextEncoder().encode(value).byteLength > GAS_SPONSOR_MAX_IDEMPOTENCY_KEY_BYTES) {
    return {
      ok: false as const,
      message: "Idempotency-Key must be at most 255 UTF-8 bytes.",
    };
  }
  return { ok: true as const, value };
}

async function readRawBody(request: Request): Promise<BodyReadResult> {
  const declaredLength = parseDeclaredContentLength(request.headers.get("content-length"));
  if (declaredLength === "invalid") return { ok: false, reason: "invalid" };
  if (declaredLength === "too_large") return { ok: false, reason: "too_large" };
  if (declaredLength !== null && declaredLength > GAS_SPONSOR_MAX_BODY_BYTES) {
    return { ok: false, reason: "too_large" };
  }

  if (request.body === null) {
    return declaredLength === null || declaredLength === 0
      ? { ok: true, bytes: new Uint8Array() }
      : { ok: false, reason: "invalid" };
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    reader = request.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) return { ok: false, reason: "invalid" };
      totalBytes += value.byteLength;
      if (totalBytes > GAS_SPONSOR_MAX_BODY_BYTES) {
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "invalid" };
  } finally {
    reader?.releaseLock();
  }

  if (declaredLength !== null && declaredLength !== totalBytes) {
    return { ok: false, reason: "invalid" };
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

function parseDeclaredContentLength(value: string | null): number | "invalid" | "too_large" | null {
  if (value === null) return null;
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return "invalid";
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) return "too_large";
  return parsed;
}

function parseSponsorBody(
  bytes: Uint8Array,
):
  | { ok: true; value: ParsedSponsorBody }
  | { ok: false; reason: "invalid" | "too_large"; message: string } {
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, reason: "invalid", message: "Request body must be valid UTF-8 JSON." };
  }

  let body: unknown;
  try {
    body = JSON.parse(decoded);
  } catch {
    return { ok: false, reason: "invalid", message: "Request body must be valid JSON." };
  }

  if (!isRecord(body)) {
    return { ok: false, reason: "invalid", message: "Request body must be a JSON object." };
  }

  const transactionXdr = body.transactionXdr;
  if (typeof transactionXdr !== "string" || transactionXdr.trim() === "") {
    return {
      ok: false,
      reason: "invalid",
      message: "transactionXdr is required and must be a non-empty string.",
    };
  }

  const normalizedXdr = transactionXdr.trim();
  if (new TextEncoder().encode(normalizedXdr).byteLength > GAS_SPONSOR_MAX_BODY_BYTES) {
    return { ok: false, reason: "too_large", message: "transactionXdr is too large." };
  }

  return { ok: true, value: { transactionXdr: normalizedXdr } };
}

function mapGasSponsorResult(result: GasSponsorResult, telemetry: RouteTelemetry): Response {
  if (!isRecord(result) || typeof result.status !== "string") {
    return internalError(telemetry);
  }

  switch (result.status) {
    case "success":
      if (!isReservation(result.reservation) || typeof result.replayed !== "boolean") {
        return internalError(telemetry);
      }
      return Response.json(toReservationDto(result.reservation, result.replayed), {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      });
    case "rejected":
      if (!isRejectedDecision(result)) return internalError(telemetry);
      return mapRejection(result.rejectionCode, telemetry);
    case "unauthorized":
      return gasError(telemetry, {
        status: 401,
        type: "auth_error",
        code: "invalid_api_key",
        message: "Invalid API key.",
      });
    case "invalid_request":
      return gasError(telemetry, {
        status: 400,
        type: "validation_error",
        code: "invalid_request",
        message: "The transaction request is invalid.",
      });
    case "invalid_signature":
      return gasError(telemetry, {
        status: 400,
        type: "validation_error",
        code: "invalid_signature",
        message: "The transaction signature is invalid.",
      });
    case "wrong_network":
      return gasError(telemetry, {
        status: 400,
        type: "validation_error",
        code: "wrong_network",
        message: "Only Testnet transactions are supported.",
      });
    case "unsupported_transaction":
      return gasError(telemetry, {
        status: 400,
        type: "validation_error",
        code: "unsupported_transaction",
        message: "The transaction type is not supported.",
      });
    case "idempotency_key_conflict":
      return gasError(telemetry, {
        status: 409,
        type: "idempotency_error",
        code: "idempotency_key_conflict",
        message: "Idempotency-Key was already used with a different request.",
      });
    case "duplicate_transaction":
      return gasError(telemetry, {
        status: 409,
        type: "api_error",
        code: "duplicate_transaction",
        message: "The transaction has already been reserved.",
      });
    case "internal_error":
      return internalError(telemetry);
    default:
      return internalError(telemetry);
  }
}

function mapRejection(
  rejectionCode: Extract<GasSponsorResult, { status: "rejected" }>["rejectionCode"],
  telemetry: RouteTelemetry,
): Response {
  switch (rejectionCode) {
    case "policy_disabled":
      return gasError(telemetry, {
        status: 403,
        type: "validation_error",
        code: rejectionCode,
        message: "Gas sponsorship is disabled for this project.",
      });
    case "contract_not_whitelisted":
      return gasError(telemetry, {
        status: 403,
        type: "validation_error",
        code: rejectionCode,
        message: "The transaction contract is not whitelisted.",
      });
    case "daily_cap_exceeded":
      return gasError(telemetry, {
        status: 429,
        type: "rate_limit_error",
        code: rejectionCode,
        message: "The project daily Gas sponsorship cap has been reached.",
        headers: { "Retry-After": retryAfterSeconds("daily") },
      });
    case "wallet_rate_limited":
      return gasError(telemetry, {
        status: 429,
        type: "rate_limit_error",
        code: rejectionCode,
        message: "The wallet Gas sponsorship quota has been reached.",
        headers: { "Retry-After": retryAfterSeconds("hourly") },
      });
    case "invalid_signature":
      return gasError(telemetry, {
        status: 400,
        type: "validation_error",
        code: rejectionCode,
        message: "The transaction signature is invalid.",
      });
    case "wrong_network":
      return gasError(telemetry, {
        status: 400,
        type: "validation_error",
        code: rejectionCode,
        message: "Only Testnet transactions are supported.",
      });
    case "unsupported_transaction":
      return gasError(telemetry, {
        status: 400,
        type: "validation_error",
        code: rejectionCode,
        message: "The transaction type is not supported.",
      });
    case "duplicate_transaction":
      return gasError(telemetry, {
        status: 409,
        type: "api_error",
        code: rejectionCode,
        message: "The transaction has already been reserved.",
      });
    default:
      return internalError(telemetry);
  }
}

function isRejectedDecision(result: Extract<GasSponsorResult, { status: "rejected" }>): boolean {
  return (
    typeof result.replayed === "boolean" &&
    isRecord(result.decision) &&
    result.decision.decisionCode === "rejected" &&
    result.decision.rejectionCode === result.rejectionCode &&
    result.decision.lifecycle === "rejected"
  );
}

function isReservation(value: unknown): value is GasSponsorReservation {
  if (!isRecord(value)) return false;
  return (
    typeof value.requestId === "string" &&
    value.requestId.length > 0 &&
    typeof value.transactionHash === "string" &&
    value.transactionHash.length > 0 &&
    typeof value.sourceWallet === "string" &&
    value.sourceWallet.length > 0 &&
    Array.isArray(value.targetContractIds) &&
    value.targetContractIds.length > 0 &&
    value.targetContractIds.every((target) => typeof target === "string" && target.length > 0) &&
    typeof value.innerMaxFeeStroops === "string" &&
    CANONICAL_DECIMAL_PATTERN.test(value.innerMaxFeeStroops) &&
    typeof value.reservedStroops === "string" &&
    CANONICAL_DECIMAL_PATTERN.test(value.reservedStroops) &&
    value.decisionCode === "reserved" &&
    value.rejectionCode === null &&
    value.lifecycle === "reserved" &&
    typeof value.expiresAt === "number" &&
    Number.isSafeInteger(value.expiresAt) &&
    value.expiresAt > 0 &&
    Number.isFinite(new Date(value.expiresAt).getTime())
  );
}

function toReservationDto(
  reservation: GasSponsorReservation,
  replayed: boolean,
): GasSponsorReservationDto {
  return {
    object: "gas_sponsor_reservation",
    requestId: reservation.requestId,
    replayed,
    decision: "reserved",
    transactionHash: reservation.transactionHash,
    sourceWallet: reservation.sourceWallet,
    targetContractIds: [...reservation.targetContractIds],
    innerMaxFeeStroops: reservation.innerMaxFeeStroops,
    reservedStroops: reservation.reservedStroops,
    expiresAt: new Date(reservation.expiresAt).toISOString(),
  };
}

function retryAfterSeconds(window: "daily" | "hourly"): string {
  const now = Date.now();
  const nextBoundary = new Date(now);
  if (window === "daily") {
    nextBoundary.setUTCHours(24, 0, 0, 0);
  } else {
    nextBoundary.setUTCMinutes(60, 0, 0);
  }
  return String(Math.max(1, Math.ceil((nextBoundary.getTime() - now) / 1_000)));
}

function gasError(
  telemetry: RouteTelemetry,
  args: Parameters<typeof veloErrorResponse>[0],
): Response {
  return veloErrorResponse({
    ...args,
    requestId: telemetry.correlationId,
    headers: { "Cache-Control": "no-store", ...args.headers },
  });
}

function internalError(telemetry: RouteTelemetry): Response {
  return gasError(telemetry, {
    status: 500,
    type: "api_error",
    code: "internal_error",
    message: "Internal server error.",
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
