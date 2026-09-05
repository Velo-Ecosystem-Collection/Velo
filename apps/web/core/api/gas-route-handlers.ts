import { api } from "@repo/backend/convex/_generated/api.js";
import { isCorrelationId } from "@repo/observability";
import { TESTNET_TRANSACTION_ENVELOPE_MAX_XDR_BYTES } from "@repo/stellar/transaction-envelope";
import {
  assertValidContractId,
  assertValidPublicKey,
  assertValidTransactionHash,
} from "@repo/stellar/validation";

import type { FunctionArgs, FunctionReturnType } from "convex/server";
import type { NextRequest } from "next/server";

import { measureTelemetryStage, type RouteTelemetry } from "../observability.ts";
import { getApiKeyFromRequest, hashApiKey } from "./auth.ts";
import { veloErrorResponse } from "./payment-intents.ts";

const API_KEY_PATTERN = /^tk_live_[a-f0-9]{32}$/;
const CANONICAL_DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const GAS_MAX_STROOPS = 2n ** 63n - 1n;
const GAS_FEE_OVERHEAD_STROOPS = 100n;
const GAS_LOG_PROJECTION_KEYS = [
  "actualFeeStroops",
  "createdAt",
  "decisionCode",
  "expiresAt",
  "innerMaxFeeStroops",
  "lifecycle",
  "rejectionCode",
  "requestId",
  "reservedStroops",
  "sourceWallet",
  "targetContractIds",
  "transactionHash",
  "updatedAt",
].sort();
const GAS_REJECTION_CODES = new Set([
  "policy_disabled",
  "contract_not_whitelisted",
  "daily_cap_exceeded",
  "wallet_rate_limited",
  "invalid_signature",
  "wrong_network",
  "unsupported_transaction",
  "duplicate_transaction",
]);

/** Maximum raw request size accepted by the sponsor HTTP boundary. */
const GAS_MAX_BODY_BYTES = 64 * 1_024;
export const GAS_SPONSOR_MAX_BODY_BYTES = GAS_MAX_BODY_BYTES;
export const GAS_SPONSOR_MAX_XDR_BYTES = TESTNET_TRANSACTION_ENVELOPE_MAX_XDR_BYTES;
export const GAS_SPONSOR_MAX_IDEMPOTENCY_KEY_BYTES = 255;
export const GAS_SUBMIT_MAX_BODY_BYTES = GAS_MAX_BODY_BYTES;
export const GAS_SUBMIT_MAX_REQUEST_ID_BYTES = 128;

type SponsorFunction = typeof api.gas.public_api.sponsor;
type SponsorArgs = FunctionArgs<SponsorFunction>;
export type GasSponsorResult = FunctionReturnType<SponsorFunction>;

type SubmitFunction = typeof api.gas.public_api.submit;
type SubmitArgs = FunctionArgs<SubmitFunction>;
export type GasSubmitResult = FunctionReturnType<SubmitFunction>;

/** Narrow Convex action seam used by production and injected route tests. */
export type GasSponsorCaller = {
  action: (reference: SponsorFunction, args: SponsorArgs) => Promise<GasSponsorResult>;
};

/** Narrow Convex submit seam used by production and injected route tests. */
export type GasSubmitCaller = {
  action: (reference: SubmitFunction, args: SubmitArgs) => Promise<GasSubmitResult>;
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
  actualFeeStroops: string | null;
  decisionCode: "reserved";
  rejectionCode: null;
  lifecycle: "reserved";
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
};

type BodyReadResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: "invalid" | "too_large" };

type ParsedSponsorBody = {
  transactionXdr: string;
};

type ParsedSubmitBody = {
  requestId: string;
  transactionHash: string;
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
          status: idempotencyKey.reason === "too_large" ? 413 : 400,
          type: "validation_error",
          code: "invalid_request",
          message: idempotencyKey.message,
          param: "Idempotency-Key",
        });
      }

      const rawBody = await readRawBody(request, GAS_SPONSOR_MAX_BODY_BYTES);
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

/** Build the shared Gas submit handler around an injectable Convex caller. */
export function createGasSubmitHandler(convex: GasSubmitCaller) {
  return async function gasSubmitHandler(
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

      const rawBody = await readRawBody(request, GAS_SUBMIT_MAX_BODY_BYTES);
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

      const parsedBody = parseSubmitBody(rawBody.bytes);
      if (!parsedBody.ok) {
        return gasError(telemetry, {
          status: 400,
          type: "validation_error",
          code: "invalid_request",
          message: parsedBody.message,
          param: parsedBody.param,
        });
      }

      const args: SubmitArgs = {
        apiKeyHash: hashApiKey(apiKey),
        requestId: parsedBody.value.requestId,
        transactionHash: parsedBody.value.transactionHash,
      };

      let result: GasSubmitResult;
      try {
        result = await measureTelemetryStage(telemetry, "convex.action", () =>
          convex.action(api.gas.public_api.submit, args),
        );
      } catch {
        return gasError(telemetry, {
          status: 503,
          type: "api_error",
          code: "dependency_unavailable",
          message: "Gas submission is temporarily unavailable.",
        });
      }

      return mapGasSubmitResult(result, telemetry);
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
    return {
      ok: false as const,
      reason: "missing" as const,
      message: "Idempotency-Key is required.",
    };
  }
  if (new TextEncoder().encode(value).byteLength > GAS_SPONSOR_MAX_IDEMPOTENCY_KEY_BYTES) {
    return {
      ok: false as const,
      reason: "too_large" as const,
      message: "Idempotency-Key must be at most 255 UTF-8 bytes.",
    };
  }
  return { ok: true as const, value };
}

async function readRawBody(request: Request, maxBytes: number): Promise<BodyReadResult> {
  const declaredLength = parseDeclaredContentLength(request.headers.get("content-length"));
  if (declaredLength === "invalid") return { ok: false, reason: "invalid" };
  if (declaredLength === "too_large") {
    await cancelBody(request.body);
    return { ok: false, reason: "too_large" };
  }
  if (declaredLength !== null && declaredLength > maxBytes) {
    await cancelBody(request.body);
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
      if (!(value instanceof Uint8Array)) {
        await cancelReader(reader);
        return { ok: false, reason: "invalid" };
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await cancelReader(reader);
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    await cancelReader(reader);
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

async function cancelBody(body: ReadableStream<Uint8Array> | null): Promise<void> {
  try {
    await body?.cancel();
  } catch {
    // Request cancellation is best effort; the bounded response still closes the route.
  }
}

async function cancelReader(
  reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
): Promise<void> {
  try {
    await reader?.cancel();
  } catch {
    // Reader cancellation is best effort for already-closed or hostile streams.
  }
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
  if (new TextEncoder().encode(normalizedXdr).byteLength > GAS_SPONSOR_MAX_XDR_BYTES) {
    return { ok: false, reason: "too_large", message: "transactionXdr is too large." };
  }

  return { ok: true, value: { transactionXdr: normalizedXdr } };
}

function parseSubmitBody(
  bytes: Uint8Array,
):
  | { ok: true; value: ParsedSubmitBody }
  | { ok: false; message: string; param: "requestId" | "transactionHash" } {
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return {
      ok: false,
      message: "Request body must be valid UTF-8 JSON.",
      param: "requestId",
    };
  }

  let body: unknown;
  try {
    body = JSON.parse(decoded);
  } catch {
    return {
      ok: false,
      message: "Request body must be valid JSON.",
      param: "requestId",
    };
  }

  if (!isRecord(body)) {
    return {
      ok: false,
      message: "Request body must be a JSON object.",
      param: "requestId",
    };
  }

  const requestId = body.requestId;
  if (typeof requestId !== "string" || requestId.trim() === "") {
    return {
      ok: false,
      message: "requestId is required and must be a non-empty string.",
      param: "requestId",
    };
  }

  const normalizedRequestId = requestId.trim();
  if (new TextEncoder().encode(normalizedRequestId).byteLength > GAS_SUBMIT_MAX_REQUEST_ID_BYTES) {
    return {
      ok: false,
      message: "requestId must be at most 128 UTF-8 bytes.",
      param: "requestId",
    };
  }

  const transactionHash = body.transactionHash;
  if (typeof transactionHash !== "string" || transactionHash.trim() === "") {
    return {
      ok: false,
      message: "transactionHash is required and must be a 64-character hex string.",
      param: "transactionHash",
    };
  }

  let normalizedTransactionHash: string;
  try {
    normalizedTransactionHash = assertValidTransactionHash(transactionHash);
  } catch {
    return {
      ok: false,
      message: "transactionHash must be a 64-character hex string.",
      param: "transactionHash",
    };
  }

  return {
    ok: true,
    value: { requestId: normalizedRequestId, transactionHash: normalizedTransactionHash },
  };
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
    case "payload_too_large":
      return gasError(telemetry, {
        status: 413,
        type: "validation_error",
        code: "invalid_request",
        message: "The transaction request is too large.",
      });
    case "dependency_unavailable":
      return gasError(telemetry, {
        status: 503,
        type: "api_error",
        code: "dependency_unavailable",
        message: "Gas sponsorship is temporarily unavailable.",
      });
    case "internal_error":
      return internalError(telemetry);
    default:
      return internalError(telemetry);
  }
}

function mapGasSubmitResult(result: GasSubmitResult, telemetry: RouteTelemetry): Response {
  if (!isRecord(result) || typeof result.status !== "string") {
    return internalError(telemetry);
  }

  switch (result.status) {
    case "handoff_unavailable":
      return gasError(telemetry, {
        status: 503,
        type: "api_error",
        code: "handoff_unavailable",
        message: "Gas handoff is unavailable.",
      });
    case "reservation_expired":
      return gasError(telemetry, {
        status: 409,
        type: "api_error",
        code: "reservation_expired",
        message: "The Gas reservation has expired.",
      });
    case "invalid_lifecycle":
      return gasError(telemetry, {
        status: 409,
        type: "api_error",
        code: "invalid_lifecycle",
        message: "The Gas reservation cannot be submitted in its current lifecycle.",
      });
    case "resource_not_found":
      return gasError(telemetry, {
        status: 404,
        type: "not_found_error",
        code: "resource_not_found",
        message: "The Gas reservation was not found.",
      });
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
        message: "The submit request is invalid.",
      });
    case "dependency_unavailable":
      return gasError(telemetry, {
        status: 503,
        type: "api_error",
        code: "dependency_unavailable",
        message: "Gas submission is temporarily unavailable.",
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
    isValidGasLogProjection(result.decision) &&
    result.decision.decisionCode === "rejected" &&
    result.decision.rejectionCode === result.rejectionCode &&
    result.decision.lifecycle === "rejected"
  );
}

function isReservation(value: unknown): value is GasSponsorReservation {
  if (!isRecord(value)) return false;
  if (!isValidGasLogProjection(value)) return false;
  if (
    typeof value.requestId !== "string" ||
    !isCorrelationId(value.requestId) ||
    new TextEncoder().encode(value.requestId).byteLength > GAS_SUBMIT_MAX_REQUEST_ID_BYTES
  ) {
    return false;
  }

  if (
    typeof value.transactionHash !== "string" ||
    !isCanonicalTransactionHash(value.transactionHash) ||
    typeof value.sourceWallet !== "string" ||
    !isCanonicalPublicKey(value.sourceWallet) ||
    !Array.isArray(value.targetContractIds) ||
    value.targetContractIds.length !== 1 ||
    !value.targetContractIds.every(isCanonicalContractId) ||
    typeof value.innerMaxFeeStroops !== "string" ||
    typeof value.reservedStroops !== "string" ||
    !isCanonicalStroop(value.innerMaxFeeStroops) ||
    !isCanonicalStroop(value.reservedStroops) ||
    value.actualFeeStroops !== null ||
    value.decisionCode !== "reserved" ||
    value.rejectionCode !== null ||
    value.lifecycle !== "reserved" ||
    typeof value.expiresAt !== "number" ||
    !Number.isSafeInteger(value.expiresAt) ||
    value.expiresAt <= 0 ||
    !Number.isFinite(new Date(value.expiresAt).getTime()) ||
    !isValidTimestamp(value.createdAt) ||
    !isValidTimestamp(value.updatedAt) ||
    value.expiresAt <= value.createdAt ||
    value.updatedAt < value.createdAt
  ) {
    return false;
  }

  try {
    return (
      BigInt(value.reservedStroops) === BigInt(value.innerMaxFeeStroops) + GAS_FEE_OVERHEAD_STROOPS
    );
  } catch {
    return false;
  }
}

function isValidGasLogProjection(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  if (Object.keys(value).sort().join("\u0000") !== GAS_LOG_PROJECTION_KEYS.join("\u0000")) {
    return false;
  }

  if (
    typeof value.requestId !== "string" ||
    !isCorrelationId(value.requestId) ||
    new TextEncoder().encode(value.requestId).byteLength > GAS_SUBMIT_MAX_REQUEST_ID_BYTES ||
    !isValidTimestamp(value.createdAt) ||
    !isValidTimestamp(value.updatedAt) ||
    value.updatedAt < value.createdAt ||
    (value.transactionHash !== null &&
      (typeof value.transactionHash !== "string" ||
        !isCanonicalTransactionHash(value.transactionHash))) ||
    (value.sourceWallet !== null &&
      (typeof value.sourceWallet !== "string" || !isCanonicalPublicKey(value.sourceWallet))) ||
    (value.targetContractIds !== null &&
      (!Array.isArray(value.targetContractIds) ||
        !value.targetContractIds.every(isCanonicalContractId))) ||
    (value.innerMaxFeeStroops !== null &&
      (typeof value.innerMaxFeeStroops !== "string" ||
        !isCanonicalStroop(value.innerMaxFeeStroops))) ||
    (value.reservedStroops !== null &&
      (typeof value.reservedStroops !== "string" || !isCanonicalStroop(value.reservedStroops))) ||
    (value.actualFeeStroops !== null &&
      (typeof value.actualFeeStroops !== "string" || !isCanonicalStroop(value.actualFeeStroops))) ||
    (value.rejectionCode !== null &&
      (typeof value.rejectionCode !== "string" || !GAS_REJECTION_CODES.has(value.rejectionCode))) ||
    (value.expiresAt !== null && !isValidTimestamp(value.expiresAt)) ||
    (value.decisionCode !== "reserved" && value.decisionCode !== "rejected") ||
    (value.lifecycle !== "reserved" &&
      value.lifecycle !== "expired" &&
      value.lifecycle !== "rejected")
  ) {
    return false;
  }

  if (value.decisionCode === "reserved") {
    return value.rejectionCode === null && value.lifecycle === "reserved";
  }

  return value.rejectionCode !== null && value.lifecycle === "rejected";
}

function isValidTimestamp(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    Number.isFinite(new Date(value).getTime())
  );
}

function isCanonicalTransactionHash(value: string): boolean {
  try {
    return assertValidTransactionHash(value) === value;
  } catch {
    return false;
  }
}

function isCanonicalPublicKey(value: string): boolean {
  try {
    return assertValidPublicKey(value) === value;
  } catch {
    return false;
  }
}

function isCanonicalContractId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return assertValidContractId(value) === value;
  } catch {
    return false;
  }
}

function isCanonicalStroop(value: string): boolean {
  if (!CANONICAL_DECIMAL_PATTERN.test(value)) return false;
  if (value.length > GAS_MAX_STROOPS.toString().length) return false;
  try {
    const amount = BigInt(value);
    return amount >= 0n && amount <= GAS_MAX_STROOPS;
  } catch {
    return false;
  }
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
