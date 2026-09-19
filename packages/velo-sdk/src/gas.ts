import type {
  GasExecutionIdentity,
  GasExecutionStatus,
  GasSponsorOptions,
  GasSponsorReservation,
  GasWaitOptions,
  GasSubmitParams,
  GasSubmitResult,
  RequestOptions,
} from "./types.ts";

import {
  VeloAPIError,
  VeloAuthError,
  VeloError,
  VeloGasWaitError,
  VeloGasSubmissionUnknownError,
  VeloRateLimitError,
  VeloTimeoutError,
  VeloValidationError,
} from "./errors.ts";
import { HttpClient } from "./http.ts";
import { sleep } from "./sleep.ts";

const MAX_IDEMPOTENCY_KEY_BYTES = 255;
const MAX_XDR_BYTES = 64 * 1_024;
const MAX_BODY_BYTES = 64 * 1_024;
const MAX_SIGNED_INT64 = 2n ** 63n - 1n;
const MAX_TIMER_DURATION_MS = 2_147_483_647;
const DEFAULT_WAIT_MAX_ATTEMPTS = 10;
const DEFAULT_WAIT_INITIAL_DELAY_MS = 500;
const DEFAULT_WAIT_MAX_DELAY_MS = 5_000;
const GAS_NON_RETRYABLE_CODES = new Set(["daily_cap_exceeded", "wallet_rate_limited"]);

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
  waitForResult(identity: GasExecutionIdentity, options?: GasWaitOptions): Promise<GasSubmitResult>;
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

  const waitForResult = async (
    identity: GasExecutionIdentity,
    options?: GasWaitOptions,
  ): Promise<GasSubmitResult> => {
    const normalizedIdentity = normalizeGasExecutionIdentity(identity);
    const normalizedOptions = normalizeGasWaitOptions(options, http.getConfiguredTimeoutMs());
    const deadline = Date.now() + normalizedOptions.timeoutMs;
    let attempts = 0;
    let delayMs = normalizedOptions.initialDelayMs;
    let lastResult: GasSubmitResult | undefined;

    for (;;) {
      throwIfWaitCancelled(normalizedOptions.signal, normalizedIdentity);
      if (Date.now() >= deadline) {
        return lastResult ?? throwGasWaitError(normalizedIdentity, "timeout");
      }
      if (attempts >= normalizedOptions.maxAttempts) {
        return lastResult ?? throwGasWaitError(normalizedIdentity, "attempts_exhausted");
      }

      attempts++;
      try {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          return lastResult ?? throwGasWaitError(normalizedIdentity, "timeout");
        }
        const result = await getStatus(normalizedIdentity, {
          ...normalizedOptions.requestOptions,
          timeoutMs: remaining,
        });
        throwIfWaitCancelled(normalizedOptions.signal, normalizedIdentity);
        lastResult = result;
        if (isTerminalGasStatus(result.status) || attempts >= normalizedOptions.maxAttempts) {
          return result;
        }
      } catch (error) {
        throwIfWaitCancelled(normalizedOptions.signal, normalizedIdentity);
        if (!isWaitRetryable(error)) throw error;
        if (attempts >= normalizedOptions.maxAttempts) {
          return lastResult ?? throwGasWaitError(normalizedIdentity, "attempts_exhausted");
        }
        if (Date.now() >= deadline) {
          return lastResult ?? throwGasWaitError(normalizedIdentity, "timeout");
        }

        const retryAfterMs = getRetryAfterMs(error);
        await waitForNextAttempt(
          Math.max(delayMs, retryAfterMs ?? 0),
          deadline,
          normalizedOptions.signal,
          normalizedIdentity,
        );
        delayMs = nextWaitDelay(delayMs, normalizedOptions.maxDelayMs);
        continue;
      }

      if (Date.now() >= deadline) {
        return lastResult ?? throwGasWaitError(normalizedIdentity, "timeout");
      }
      await waitForNextAttempt(delayMs, deadline, normalizedOptions.signal, normalizedIdentity);
      delayMs = nextWaitDelay(delayMs, normalizedOptions.maxDelayMs);
    }
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

  return { sponsor, submit, getStatus, waitForResult, sponsorAndSubmit };
}

type NormalizedGasWaitOptions = {
  requestOptions: RequestOptions;
  signal?: AbortSignal;
  timeoutMs: number;
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
};

function normalizeGasWaitOptions(
  options: GasWaitOptions | undefined,
  configuredTimeoutMs: number,
): NormalizedGasWaitOptions {
  if (options !== undefined && !isRecord(options)) {
    throw validationError("Gas wait options must be an object.", "options");
  }

  const source = (options ?? {}) as GasWaitOptions;
  const normalized = normalizeRequestOptions(options);
  const timeoutMs = validateWaitDuration(source.timeoutMs ?? configuredTimeoutMs, "timeoutMs");
  const maxAttempts = validatePositiveSafeInteger(
    source.maxAttempts ?? DEFAULT_WAIT_MAX_ATTEMPTS,
    "maxAttempts",
  );
  const initialDelayMs = validateWaitDuration(
    source.initialDelayMs ?? DEFAULT_WAIT_INITIAL_DELAY_MS,
    "initialDelayMs",
  );
  const maxDelayMs = validateWaitDuration(
    source.maxDelayMs ?? DEFAULT_WAIT_MAX_DELAY_MS,
    "maxDelayMs",
  );
  if (maxDelayMs < initialDelayMs) {
    throw validationError("maxDelayMs must be at least initialDelayMs.", "maxDelayMs");
  }

  const requestOptions: RequestOptions = {
    ...(normalized.idempotencyKey === undefined
      ? {}
      : { idempotencyKey: normalized.idempotencyKey }),
    ...(normalized.correlationId === undefined ? {} : { correlationId: normalized.correlationId }),
    ...(normalized.traceparent === undefined ? {} : { traceparent: normalized.traceparent }),
    ...(normalized.signal === undefined ? {} : { signal: normalized.signal }),
  };

  return {
    requestOptions,
    signal: normalized.signal,
    timeoutMs,
    maxAttempts,
    initialDelayMs,
    maxDelayMs,
  };
}

function validatePositiveSafeInteger(value: unknown, parameter: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw validationError(`${parameter} must be a positive safe integer.`, parameter);
  }
  return value;
}

function validateWaitDuration(value: unknown, parameter: string): number {
  const duration = validatePositiveSafeInteger(value, parameter);
  if (duration > MAX_TIMER_DURATION_MS) {
    throw validationError(`${parameter} exceeds the supported timer range.`, parameter);
  }
  return duration;
}

function isTerminalGasStatus(status: GasExecutionStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function throwGasWaitError(
  identity: GasExecutionIdentity,
  reason: "timeout" | "attempts_exhausted" | "cancelled",
): never {
  throw new VeloGasWaitError(identity, reason);
}

function throwIfWaitCancelled(
  signal: AbortSignal | undefined,
  identity: GasExecutionIdentity,
): void {
  if (signal?.aborted) throwGasWaitError(identity, "cancelled");
}

async function waitForNextAttempt(
  delayMs: number,
  deadline: number,
  signal: AbortSignal | undefined,
  identity: GasExecutionIdentity,
): Promise<void> {
  throwIfWaitCancelled(signal, identity);
  const remaining = deadline - Date.now();
  if (remaining <= 0) return;
  try {
    await sleep(Math.min(delayMs, remaining), signal);
  } catch {
    throwIfWaitCancelled(signal, identity);
    return;
  }
  throwIfWaitCancelled(signal, identity);
}

function nextWaitDelay(currentDelayMs: number, maxDelayMs: number): number {
  return currentDelayMs >= maxDelayMs / 2 ? maxDelayMs : Math.min(maxDelayMs, currentDelayMs * 2);
}

function getRetryAfterMs(error: unknown): number | undefined {
  return error instanceof VeloError ? error.retryAfterMs : undefined;
}

function isWaitRetryable(error: unknown): boolean {
  if (error instanceof VeloAuthError || error instanceof VeloValidationError) return false;
  if (error instanceof VeloAPIError && error.code === "invalid_response") return false;
  if (error instanceof VeloError && error.code !== undefined) {
    if (GAS_NON_RETRYABLE_CODES.has(error.code)) return false;
  }

  return (
    error instanceof VeloRateLimitError ||
    (error instanceof VeloError && error.status === 408) ||
    (error instanceof VeloError &&
      error.status !== undefined &&
      error.status >= 500 &&
      error.status < 600) ||
    error instanceof VeloTimeoutError ||
    isNetworkError(error)
  );
}

function isNetworkError(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof Error &&
      /fetch failed|ECONNREFUSED|ENOTFOUND|network error/i.test(error.message))
  );
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
