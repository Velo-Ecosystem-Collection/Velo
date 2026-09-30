import { createHash, timingSafeEqual } from "node:crypto";

import {
  Velo,
  VeloAPIError,
  VeloAuthError,
  VeloGasSubmissionUnknownError,
  VeloGasWaitError,
  VeloRateLimitError,
  VeloTimeoutError,
  VeloValidationError,
  type GasApi,
  type GasExecutionIdentity,
  type GasSubmitResult,
} from "@carts1024/velo-sdk";
import { NextResponse } from "next/server.js";

import { getGasExampleConfig, isAsciiToken, type GasExampleConfig } from "./config.ts";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 64 * 1_024;
const MAX_XDR_BYTES = 64 * 1_024;
const WORKFLOW_BUDGET_MS = 30_000;
const OPERATION_ID = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,128}$/;
const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);
const POLICY_CODES = new Set([
  "policy_disabled",
  "policy_denied",
  "contract_not_whitelisted",
  "daily_cap_exceeded",
  "wallet_rate_limited",
]);
const INPUT_CODES = new Set([
  "invalid_request",
  "invalid_signature",
  "wrong_network",
  "unsupported_transaction",
]);

type GasRequest = {
  operationId: string;
  transactionXdr: string;
};

export type GasPublicResult = {
  operationId: string;
  status: GasSubmitResult["status"];
  actualFeeStroops: string | null;
  reconciliationRequired: boolean;
};

type GasErrorBody = {
  error: {
    code:
      | "configuration_error"
      | "caller_unauthorized"
      | "invalid_input"
      | "payload_too_large"
      | "policy_denied"
      | "rate_limited"
      | "upstream_failure"
      | "upstream_timeout"
      | "request_cancelled";
    message: string;
  };
};

class GasInputError extends Error {
  readonly tooLarge: boolean;

  constructor(tooLarge = false) {
    super(tooLarge ? "Gas request body is too large." : "Gas request input is invalid.");
    this.name = "GasInputError";
    this.tooLarge = tooLarge;
  }
}

const ERROR_MESSAGES = {
  configuration: "Gas example server configuration is invalid.",
  unauthorized: "Gas demo authorization failed.",
  invalidInput: "Gas request input is invalid.",
  tooLarge: "Gas request body is too large.",
  policy: "Gas sponsorship policy denied this request.",
  rateLimited: "Gas sponsorship is rate limited.",
  upstream: "Gas provider request failed.",
  timeout: "Gas provider request timed out.",
  cancelled: "Gas request was cancelled.",
} as const;

function jsonResponse(body: GasPublicResult | GasErrorBody, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function errorResponse(
  code: GasErrorBody["error"]["code"],
  message: string,
  status: number,
): NextResponse {
  return jsonResponse({ error: { code, message } }, status);
}

function tokenMatches(provided: string, expected: string): boolean {
  const providedDigest = createHash("sha256").update(provided, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

function isAuthorized(request: Request, expectedToken: string): boolean {
  const authorization = request.headers.get("authorization");
  if (!authorization) return false;

  const match = /^Bearer ([\x21-\x7e]+)$/.exec(authorization);
  const providedToken = match?.[1];
  return (
    providedToken !== undefined &&
    isAsciiToken(providedToken) &&
    new TextEncoder().encode(providedToken).byteLength <= 256 &&
    tokenMatches(providedToken, expectedToken)
  );
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_BODY_BYTES) {
    throw new GasInputError(true);
  }

  if (!request.body) throw new GasInputError();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The bounded input failure is the response that matters.
        }
        throw new GasInputError(true);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch {
    throw new GasInputError();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseGasRequest(value: unknown): GasRequest {
  if (!isRecord(value)) throw new GasInputError();
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== "operationId" || keys[1] !== "transactionXdr") {
    throw new GasInputError();
  }

  if (typeof value.operationId !== "string" || typeof value.transactionXdr !== "string") {
    throw new GasInputError();
  }

  const operationId = value.operationId.trim();
  const transactionXdr = value.transactionXdr.trim();
  if (!OPERATION_ID.test(operationId) || new TextEncoder().encode(operationId).byteLength > 128) {
    throw new GasInputError();
  }
  if (
    transactionXdr === "" ||
    new TextEncoder().encode(transactionXdr).byteLength > MAX_XDR_BYTES
  ) {
    throw new GasInputError();
  }

  return { operationId, transactionXdr };
}

export function toGasPublicResult(operationId: string, result: GasSubmitResult): GasPublicResult {
  return {
    operationId,
    status: result.status,
    actualFeeStroops: result.actualFeeStroops,
    reconciliationRequired: result.reconciliationRequired,
  };
}

export function isGasTerminalStatus(status: GasSubmitResult["status"]): boolean {
  return TERMINAL_STATUSES.has(status);
}

function unknownResult(operationId: string): GasPublicResult {
  return {
    operationId,
    status: "submission_unknown",
    actualFeeStroops: null,
    reconciliationRequired: true,
  };
}

function remainingBudget(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}

async function observeResult(
  gas: GasApi,
  operationId: string,
  result: GasSubmitResult,
  deadline: number,
  signal: AbortSignal,
): Promise<GasPublicResult> {
  if (isGasTerminalStatus(result.status)) return toGasPublicResult(operationId, result);

  const timeoutMs = remainingBudget(deadline);
  if (timeoutMs === 0) return toGasPublicResult(operationId, result);

  try {
    const observed = await gas.waitForResult(
      { requestId: result.requestId, transactionHash: result.transactionHash },
      { timeoutMs, signal },
    );
    return toGasPublicResult(operationId, observed);
  } catch (error) {
    if (error instanceof VeloGasWaitError) return toGasPublicResult(operationId, result);
    throw error;
  }
}

async function observeUnknown(
  gas: GasApi,
  operationId: string,
  identity: GasExecutionIdentity,
  deadline: number,
  signal: AbortSignal,
): Promise<GasPublicResult> {
  const timeoutMs = remainingBudget(deadline);
  if (timeoutMs === 0) return unknownResult(operationId);

  try {
    const observed = await gas.waitForResult(identity, { timeoutMs, signal });
    return toGasPublicResult(operationId, observed);
  } catch (error) {
    if (error instanceof VeloGasWaitError) return unknownResult(operationId);
    throw error;
  }
}

function sdkErrorResponse(error: unknown): NextResponse {
  if (error instanceof VeloRateLimitError) {
    return errorResponse("rate_limited", ERROR_MESSAGES.rateLimited, 429);
  }
  if (error instanceof VeloValidationError && error.code && POLICY_CODES.has(error.code)) {
    if (error.code === "daily_cap_exceeded" || error.code === "wallet_rate_limited") {
      return errorResponse("rate_limited", ERROR_MESSAGES.rateLimited, 429);
    }
    return errorResponse("policy_denied", ERROR_MESSAGES.policy, 403);
  }
  if (error instanceof VeloValidationError && error.code && INPUT_CODES.has(error.code)) {
    return errorResponse("invalid_input", ERROR_MESSAGES.invalidInput, 400);
  }
  if (error instanceof VeloTimeoutError) {
    return errorResponse("upstream_timeout", ERROR_MESSAGES.timeout, 504);
  }
  if (error instanceof VeloAuthError || error instanceof VeloAPIError) {
    return errorResponse("upstream_failure", ERROR_MESSAGES.upstream, 502);
  }
  return errorResponse("upstream_failure", ERROR_MESSAGES.upstream, 502);
}

export async function POST(request: Request): Promise<NextResponse> {
  let config: GasExampleConfig;
  try {
    config = getGasExampleConfig();
  } catch {
    return errorResponse("configuration_error", ERROR_MESSAGES.configuration, 500);
  }

  if (!isAuthorized(request, config.demoToken)) {
    return errorResponse("caller_unauthorized", ERROR_MESSAGES.unauthorized, 401);
  }

  let input: GasRequest;
  try {
    input = parseGasRequest(await readBoundedJson(request));
  } catch (error) {
    if (error instanceof GasInputError) {
      return errorResponse(
        error.tooLarge ? "payload_too_large" : "invalid_input",
        error.tooLarge ? ERROR_MESSAGES.tooLarge : ERROR_MESSAGES.invalidInput,
        error.tooLarge ? 413 : 400,
      );
    }
    return errorResponse("invalid_input", ERROR_MESSAGES.invalidInput, 400);
  }

  const deadline = Date.now() + WORKFLOW_BUDGET_MS;
  const initialBudget = remainingBudget(deadline);
  if (initialBudget === 0) {
    return errorResponse("upstream_timeout", ERROR_MESSAGES.timeout, 504);
  }
  const signal = request.signal;
  const velo = new Velo({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    environment: config.environment,
    timeoutMs: WORKFLOW_BUDGET_MS,
  });

  try {
    const result = await velo.gas.sponsorAndSubmit(input.transactionXdr, {
      idempotencyKey: `nextjs-gas:${input.operationId}`,
      timeoutMs: initialBudget,
      signal,
    });
    const publicResultValue = await observeResult(
      velo.gas,
      input.operationId,
      result,
      deadline,
      signal,
    );
    return jsonResponse(
      publicResultValue,
      isGasTerminalStatus(publicResultValue.status) ? 200 : 202,
    );
  } catch (error) {
    if (error instanceof VeloGasSubmissionUnknownError) {
      try {
        const recovered = await observeUnknown(
          velo.gas,
          input.operationId,
          error.recovery,
          deadline,
          signal,
        );
        return jsonResponse(recovered, isGasTerminalStatus(recovered.status) ? 200 : 202);
      } catch (observationError) {
        return sdkErrorResponse(observationError);
      }
    }
    if (signal.aborted) {
      return errorResponse("request_cancelled", ERROR_MESSAGES.cancelled, 499);
    }
    return sdkErrorResponse(error);
  }
}
