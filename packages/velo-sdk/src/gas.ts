import type { GasSponsorOptions, GasSponsorReservation, RequestOptions } from "./types.ts";

import { VeloAPIError, VeloValidationError } from "./errors.ts";
import { HttpClient } from "./http.ts";

const MAX_IDEMPOTENCY_KEY_BYTES = 255;
const MAX_XDR_BYTES = 64 * 1_024;
const MAX_BODY_BYTES = 64 * 1_024;
const MAX_SIGNED_INT64 = 2n ** 63n - 1n;

const CANONICAL_STROOP = /^(?:0|[1-9][0-9]*)$/;
const TRANSACTION_HASH = /^[0-9a-f]{64}$/;
const PUBLIC_ADDRESS_SHAPE = /^[GC][A-Z2-7]{55}$/;
const CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const API_KEY_SHAPE = /^tk_(?:live|test)_[a-f0-9]{32}$/i;
const SECRET_SEED_SHAPE = /^S[A-Z2-7]{55}$/;
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const TRACEPARENT = /^00-(?!0{32})[0-9a-f]{32}-(?!0{16})[0-9a-f]{16}-[0-9a-f]{2}$/;

const textEncoder = new TextEncoder();

export type GasApi = {
  sponsor(transactionXdr: string, options: GasSponsorOptions): Promise<GasSponsorReservation>;
};

export function createGasApi(http: HttpClient): GasApi {
  return {
    sponsor: async (
      transactionXdr: string,
      options: GasSponsorOptions,
    ): Promise<GasSponsorReservation> => {
      const normalizedOptions = normalizeSponsorOptions(options);
      const normalizedXdr = validateTransactionXdr(transactionXdr);
      const body = { transactionXdr: normalizedXdr };
      const serializedBody = JSON.stringify(body);

      if (textEncoder.encode(serializedBody).byteLength > MAX_BODY_BYTES) {
        throw validationError("Gas sponsorship request body is too large.", "transactionXdr");
      }

      const payload = await http.request<unknown>("POST", "/api/gas/sponsor", body, {
        ...normalizedOptions,
        maxRetries: 0,
        submission: false,
      });

      return parseGasSponsorReservation(payload);
    },
  };
}

function normalizeSponsorOptions(options: GasSponsorOptions): RequestOptions {
  if (!isRecord(options)) {
    throw validationError("Gas sponsorship options are required.", "options");
  }

  const idempotencyKey = validateHeaderValue(options.idempotencyKey, "idempotencyKey");
  if (textEncoder.encode(idempotencyKey).byteLength > MAX_IDEMPOTENCY_KEY_BYTES) {
    throw validationError("idempotencyKey is too large.", "idempotencyKey");
  }

  const correlationId =
    options.correlationId === undefined ? undefined : validateCorrelationId(options.correlationId);
  const traceparent =
    options.traceparent === undefined ? undefined : validateTraceparent(options.traceparent);

  return {
    ...options,
    idempotencyKey,
    ...(correlationId === undefined ? {} : { correlationId }),
    ...(traceparent === undefined ? {} : { traceparent }),
  };
}

function validateTransactionXdr(transactionXdr: string): string {
  if (typeof transactionXdr !== "string" || transactionXdr.trim() === "") {
    throw validationError(
      "transactionXdr is required and must be a non-empty string.",
      "transactionXdr",
    );
  }

  const normalized = transactionXdr.trim();
  if (textEncoder.encode(normalized).byteLength > MAX_XDR_BYTES) {
    throw validationError("transactionXdr is too large.", "transactionXdr");
  }
  return normalized;
}

function validateHeaderValue(value: unknown, parameter: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw validationError(`${parameter} is required and must be a non-empty string.`, parameter);
  }

  const normalized = value.trim();
  if (hasInvalidHeaderCharacters(normalized)) {
    throw validationError(`${parameter} contains invalid header characters.`, parameter);
  }
  return normalized;
}

function hasInvalidHeaderCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) return true;
  }
  return false;
}

function validateCorrelationId(value: unknown): string {
  const normalized = validateHeaderValue(value, "correlationId");
  if (
    !CORRELATION_ID.test(normalized) ||
    API_KEY_SHAPE.test(normalized) ||
    SECRET_SEED_SHAPE.test(normalized) ||
    JWT_SHAPE.test(normalized)
  ) {
    throw validationError(
      "correlationId is not a valid correlation header value.",
      "correlationId",
    );
  }
  return normalized;
}

function validateTraceparent(value: unknown): string {
  const normalized = validateHeaderValue(value, "traceparent");
  if (!TRACEPARENT.test(normalized)) {
    throw validationError("traceparent is not a valid trace header value.", "traceparent");
  }
  return normalized;
}

function parseGasSponsorReservation(value: unknown): GasSponsorReservation {
  if (
    !isRecord(value) ||
    value.object !== "gas_sponsor_reservation" ||
    typeof value.requestId !== "string" ||
    !isSafeRequestId(value.requestId) ||
    typeof value.replayed !== "boolean" ||
    value.decision !== "reserved" ||
    typeof value.transactionHash !== "string" ||
    !TRANSACTION_HASH.test(value.transactionHash) ||
    typeof value.sourceWallet !== "string" ||
    !PUBLIC_ADDRESS_SHAPE.test(value.sourceWallet) ||
    !isSingleContractId(value.targetContractIds) ||
    typeof value.innerMaxFeeStroops !== "string" ||
    !isCanonicalStroop(value.innerMaxFeeStroops) ||
    typeof value.reservedStroops !== "string" ||
    !isCanonicalStroop(value.reservedStroops) ||
    typeof value.expiresAt !== "string" ||
    !isCanonicalIsoTimestamp(value.expiresAt)
  ) {
    throw invalidResponseError();
  }

  return {
    object: "gas_sponsor_reservation",
    requestId: value.requestId,
    replayed: value.replayed,
    decision: "reserved",
    transactionHash: value.transactionHash,
    sourceWallet: value.sourceWallet,
    targetContractIds: [...value.targetContractIds],
    innerMaxFeeStroops: value.innerMaxFeeStroops,
    reservedStroops: value.reservedStroops,
    expiresAt: value.expiresAt,
  };
}

function isSingleContractId(value: unknown): value is [string] {
  return (
    Array.isArray(value) &&
    value.length === 1 &&
    typeof value[0] === "string" &&
    /^C[A-Z2-7]{55}$/.test(value[0])
  );
}

function isSafeRequestId(value: string): boolean {
  return (
    textEncoder.encode(value).byteLength <= 128 &&
    CORRELATION_ID.test(value) &&
    !API_KEY_SHAPE.test(value) &&
    !SECRET_SEED_SHAPE.test(value) &&
    !JWT_SHAPE.test(value)
  );
}

function isCanonicalStroop(value: string): boolean {
  if (!CANONICAL_STROOP.test(value)) return false;
  try {
    return BigInt(value) <= MAX_SIGNED_INT64;
  } catch {
    return false;
  }
}

function isCanonicalIsoTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validationError(message: string, parameter: string): VeloValidationError {
  return new VeloValidationError(message, { code: "invalid_request", param: parameter });
}

function invalidResponseError(): VeloAPIError {
  return new VeloAPIError("Invalid Gas sponsorship response.", { code: "invalid_response" });
}
