import type {
  GasExecutionIdentity,
  GasExecutionStatus,
  GasSponsorOptions,
  GasSponsorReservation,
  GasSubmitParams,
  GasSubmitResult,
  RequestOptions,
} from "./types.ts";

import {
  VeloAPIError,
  VeloGasSubmissionUnknownError,
  VeloTimeoutError,
  VeloValidationError,
} from "./errors.ts";
import { HttpClient } from "./http.ts";

const MAX_IDEMPOTENCY_KEY_BYTES = 255;
const MAX_XDR_BYTES = 64 * 1_024;
const MAX_BODY_BYTES = 64 * 1_024;
const MAX_SIGNED_INT64 = 2n ** 63n - 1n;

const CANONICAL_STROOP = /^(?:0|[1-9][0-9]*)$/;
const TRANSACTION_HASH = /^[0-9a-f]{64}$/;
const TRANSACTION_HASH_INPUT = /^[0-9a-f]{64}$/i;
const PUBLIC_ADDRESS_SHAPE = /^[GC][A-Z2-7]{55}$/;
const CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const API_KEY_SHAPE = /^tk_(?:live|test)_[a-f0-9]{32}$/i;
const SECRET_SEED_SHAPE = /^S[A-Z2-7]{55}$/;
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const TRACEPARENT = /^00-(?!0{32})[0-9a-f]{32}-(?!0{16})[0-9a-f]{16}-[0-9a-f]{2}$/;

const textEncoder = new TextEncoder();

export interface GasApi {
  sponsor(transactionXdr: string, options: GasSponsorOptions): Promise<GasSponsorReservation>;
  submit(params: GasSubmitParams, options?: RequestOptions): Promise<GasSubmitResult>;
  getStatus(identity: GasExecutionIdentity, options?: RequestOptions): Promise<GasSubmitResult>;
  sponsorAndSubmit(transactionXdr: string, options: GasSponsorOptions): Promise<GasSubmitResult>;
}

export function createGasApi(http: HttpClient): GasApi {
  const sponsor = async (
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

    const payload = await http.request<unknown>(
      "POST",
      "/api/gas/sponsor",
      body,
      {
        ...normalizedOptions,
        submission: false,
      },
      { kind: "sponsor" },
    );

    return parseGasSponsorReservation(payload);
  };

  const submit = async (
    params: GasSubmitParams,
    options?: RequestOptions,
  ): Promise<GasSubmitResult> => {
    const normalizedParams = normalizeGasSubmitParams(params);
    const normalizedOptions = normalizeRequestOptions(options);
    const payload = await http.request<unknown>(
      "POST",
      "/api/gas/submit",
      normalizedParams.body,
      {
        ...normalizedOptions,
        maxRetries: 0,
        submission: true,
      },
      { kind: "submit", recovery: normalizedParams.identity },
    );

    try {
      return parseGasSubmitResult(payload, normalizedParams.identity);
    } catch (error) {
      if (isInvalidResponseError(error)) {
        throw new VeloGasSubmissionUnknownError(normalizedParams.identity, "invalid_response");
      }
      throw error;
    }
  };

  const getStatus = async (
    identity: GasExecutionIdentity,
    options?: RequestOptions,
  ): Promise<GasSubmitResult> => {
    const normalizedIdentity = normalizeGasExecutionIdentity(identity);
    const normalizedOptions = normalizeRequestOptions(options);
    const payload = await http.request<unknown>(
      "POST",
      "/api/gas/submit",
      {
        requestId: normalizedIdentity.requestId,
        transactionHash: normalizedIdentity.transactionHash,
      },
      {
        ...normalizedOptions,
        maxRetries: 0,
        submission: false,
      },
      { kind: "status" },
    );

    return parseGasSubmitResult(payload, normalizedIdentity);
  };

  const sponsorAndSubmit = async (
    transactionXdr: string,
    options: GasSponsorOptions,
  ): Promise<GasSubmitResult> => {
    const normalizedOptions = normalizeSponsorOptions(options);
    const normalizedXdr = validateTransactionXdr(transactionXdr);
    const deadline = resolveWorkflowDeadline(http, normalizedOptions);

    throwIfWorkflowAborted(normalizedOptions.signal);
    const sponsorTimeoutMs = remainingWorkflowTimeout(deadline);
    const reservation = await sponsor(normalizedXdr, {
      ...normalizedOptions,
      timeoutMs: sponsorTimeoutMs,
    });

    throwIfWorkflowAborted(normalizedOptions.signal);
    const submitTimeoutMs = remainingWorkflowTimeout(deadline);
    return submit(
      {
        requestId: reservation.requestId,
        transactionHash: reservation.transactionHash,
        transactionXdr: normalizedXdr,
      },
      {
        ...normalizedOptions,
        timeoutMs: submitTimeoutMs,
      },
    );
  };

  return { sponsor, submit, getStatus, sponsorAndSubmit };
}

function resolveWorkflowDeadline(http: HttpClient, options: RequestOptions): number {
  const timeoutMs = Math.max(1, options.timeoutMs ?? http.getConfiguredTimeoutMs());
  return Date.now() + timeoutMs;
}

function remainingWorkflowTimeout(deadline: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    throw new VeloTimeoutError("Gas sponsor-and-submit workflow timed out before submission.");
  }
  return remaining;
}

function throwIfWorkflowAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

function normalizeSponsorOptions(options: GasSponsorOptions): GasSponsorOptions {
  if (!isRecord(options)) {
    throw validationError("Gas sponsorship options are required.", "options");
  }

  const normalized = normalizeRequestOptions(options, true);
  if (normalized.idempotencyKey === undefined) {
    throw validationError("idempotencyKey is required.", "idempotencyKey");
  }
  return { ...normalized, idempotencyKey: normalized.idempotencyKey };
}

function normalizeRequestOptions(
  options: RequestOptions | undefined,
  requireIdempotencyKey = false,
): RequestOptions {
  if (options !== undefined && !isRecord(options)) {
    throw validationError("Gas request options must be an object.", "options");
  }

  const source = options ?? {};
  const idempotencyKey =
    source.idempotencyKey === undefined
      ? undefined
      : validateHeaderValue(source.idempotencyKey, "idempotencyKey");
  if (requireIdempotencyKey && idempotencyKey === undefined) {
    throw validationError("idempotencyKey is required.", "idempotencyKey");
  }
  if (
    idempotencyKey !== undefined &&
    textEncoder.encode(idempotencyKey).byteLength > MAX_IDEMPOTENCY_KEY_BYTES
  ) {
    throw validationError("idempotencyKey is too large.", "idempotencyKey");
  }

  const correlationId =
    source.correlationId === undefined ? undefined : validateCorrelationId(source.correlationId);
  const traceparent =
    source.traceparent === undefined ? undefined : validateTraceparent(source.traceparent);

  return {
    ...source,
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    ...(correlationId === undefined ? {} : { correlationId }),
    ...(traceparent === undefined ? {} : { traceparent }),
  };
}

function normalizeGasSubmitParams(params: GasSubmitParams): {
  identity: GasExecutionIdentity;
  body: { requestId: string; transactionHash: string; transactionXdr: string };
} {
  if (!isRecord(params)) {
    throw validationError("Gas submission parameters are required.", "params");
  }

  const identity = normalizeGasExecutionIdentity(params);
  const transactionXdr = validateTransactionXdr(params.transactionXdr);
  const body = {
    requestId: identity.requestId,
    transactionHash: identity.transactionHash,
    transactionXdr,
  };

  if (textEncoder.encode(JSON.stringify(body)).byteLength > MAX_BODY_BYTES) {
    throw validationError("Gas submission request body is too large.", "transactionXdr");
  }

  return { identity, body };
}

function normalizeGasExecutionIdentity(value: GasExecutionIdentity): GasExecutionIdentity {
  if (!isRecord(value)) {
    throw validationError("Gas execution identity is required.", "identity");
  }

  return {
    requestId: validateRequestId(value.requestId, "requestId"),
    transactionHash: validateTransactionHash(value.transactionHash, "transactionHash"),
  };
}

function validateRequestId(value: unknown, parameter: string): string {
  const normalized = validateHeaderValue(value, parameter);
  if (!isSafeRequestId(normalized)) {
    throw validationError(`${parameter} is not a valid Gas request ID.`, parameter);
  }
  return normalized;
}

function validateTransactionHash(value: unknown, parameter: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw validationError(`${parameter} is required and must be a non-empty string.`, parameter);
  }

  const normalized = value.trim().toLowerCase();
  if (!TRANSACTION_HASH_INPUT.test(normalized)) {
    throw validationError(`${parameter} must be a 32-byte hexadecimal hash.`, parameter);
  }
  return normalized;
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

function parseGasSubmitResult(value: unknown, identity: GasExecutionIdentity): GasSubmitResult {
  if (
    !isRecord(value) ||
    value.object !== "gas_submit_result" ||
    typeof value.requestId !== "string" ||
    !isSafeRequestId(value.requestId) ||
    value.requestId !== identity.requestId ||
    typeof value.transactionHash !== "string" ||
    !TRANSACTION_HASH.test(value.transactionHash) ||
    value.transactionHash !== identity.transactionHash ||
    (value.outerTransactionHash !== null &&
      (typeof value.outerTransactionHash !== "string" ||
        !TRANSACTION_HASH.test(value.outerTransactionHash))) ||
    !isGasExecutionStatus(value.status) ||
    typeof value.reservedStroops !== "string" ||
    !isCanonicalStroop(value.reservedStroops) ||
    (value.actualFeeStroops !== null &&
      (typeof value.actualFeeStroops !== "string" || !isCanonicalStroop(value.actualFeeStroops))) ||
    typeof value.expiresAt !== "string" ||
    !isCanonicalIsoTimestamp(value.expiresAt) ||
    typeof value.reconciliationRequired !== "boolean"
  ) {
    throw invalidSubmitResponseError();
  }

  return {
    object: "gas_submit_result",
    requestId: value.requestId,
    transactionHash: value.transactionHash,
    outerTransactionHash: value.outerTransactionHash,
    status: value.status,
    reservedStroops: value.reservedStroops,
    actualFeeStroops: value.actualFeeStroops,
    expiresAt: value.expiresAt,
    reconciliationRequired: value.reconciliationRequired,
  };
}

function isGasExecutionStatus(value: unknown): value is GasExecutionStatus {
  return (
    value === "claimed" ||
    value === "submission_unknown" ||
    value === "submitted" ||
    value === "succeeded" ||
    value === "failed" ||
    value === "cancelled"
  );
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

function invalidSubmitResponseError(): VeloAPIError {
  return new VeloAPIError("Invalid Gas submission response.", { code: "invalid_response" });
}

function isInvalidResponseError(error: unknown): error is VeloAPIError {
  return error instanceof VeloAPIError && error.code === "invalid_response";
}
