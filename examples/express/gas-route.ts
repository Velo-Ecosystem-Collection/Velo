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
import express, { type RequestHandler } from "express";

import { getGasExampleConfig, isAsciiToken, type GasExampleConfig } from "./gas-config.ts";

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

type GasErrorCode =
  | "configuration_error"
  | "caller_unauthorized"
  | "invalid_input"
  | "payload_too_large"
  | "policy_denied"
  | "rate_limited"
  | "upstream_failure"
  | "upstream_timeout";

type GasClient = { gas: GasApi };

export type GasRouterDependencies = {
  getConfig?: () => GasExampleConfig;
  createClient?: (config: GasExampleConfig) => GasClient;
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
} as const;

function jsonResponse(
  res: express.Response,
  body: GasPublicResult | { error: { code: GasErrorCode; message: string } },
  status: number,
): void {
  res.set("Cache-Control", "no-store").status(status).json(body);
}

function errorResponse(
  res: express.Response,
  code: GasErrorCode,
  message: string,
  status: number,
): void {
  jsonResponse(res, { error: { code, message } }, status);
}

function tokenMatches(provided: string, expected: string): boolean {
  const providedDigest = createHash("sha256").update(provided, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

function isAuthorized(authorization: string | undefined, expectedToken: string): boolean {
  const match = authorization ? /^Bearer ([\x21-\x7e]+)$/.exec(authorization) : null;
  const providedToken = match?.[1];
  return (
    providedToken !== undefined &&
    isAsciiToken(providedToken) &&
    new TextEncoder().encode(providedToken).byteLength <= 256 &&
    tokenMatches(providedToken, expectedToken)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isGasExecutionIdentity(value: unknown): value is GasExecutionIdentity {
  return (
    isRecord(value) &&
    typeof value.requestId === "string" &&
    value.requestId.length > 0 &&
    value.requestId.length <= 128 &&
    typeof value.transactionHash === "string" &&
    /^[a-f0-9]{64}$/.test(value.transactionHash)
  );
}

function isGasSubmissionUnknownError(error: unknown): error is VeloGasSubmissionUnknownError {
  if (error instanceof VeloGasSubmissionUnknownError) return true;
  return (
    error instanceof Error &&
    error.name === "VeloGasSubmissionUnknownError" &&
    isRecord(error) &&
    error.code === "submission_unknown" &&
    isGasExecutionIdentity(error.recovery)
  );
}

function isGasWaitError(error: unknown): error is VeloGasWaitError {
  if (error instanceof VeloGasWaitError) return true;
  return (
    error instanceof Error &&
    error.name === "VeloGasWaitError" &&
    isRecord(error) &&
    typeof error.code === "string" &&
    error.code.startsWith("gas_wait_") &&
    isGasExecutionIdentity(error.recovery)
  );
}

function parseGasRequest(body: unknown): GasRequest {
  if (!Buffer.isBuffer(body) || body.byteLength === 0) throw new GasInputError();
  if (body.byteLength > MAX_BODY_BYTES) throw new GasInputError(true);

  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown;
  } catch {
    throw new GasInputError();
  }

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
  if (!OPERATION_ID.test(operationId)) throw new GasInputError();
  if (
    transactionXdr.length === 0 ||
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

function isGasTerminalStatus(status: GasSubmitResult["status"]): boolean {
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
): Promise<GasPublicResult> {
  if (isGasTerminalStatus(result.status)) return toGasPublicResult(operationId, result);

  const timeoutMs = remainingBudget(deadline);
  if (timeoutMs === 0) return toGasPublicResult(operationId, result);
  try {
    const observed = await gas.waitForResult(
      { requestId: result.requestId, transactionHash: result.transactionHash },
      { timeoutMs },
    );
    return toGasPublicResult(operationId, observed);
  } catch (error) {
    if (isGasWaitError(error)) return toGasPublicResult(operationId, result);
    throw error;
  }
}

async function observeUnknown(
  gas: GasApi,
  operationId: string,
  identity: GasExecutionIdentity,
  deadline: number,
): Promise<GasPublicResult> {
  const timeoutMs = remainingBudget(deadline);
  if (timeoutMs === 0) return unknownResult(operationId);
  try {
    const observed = await gas.waitForResult(identity, { timeoutMs });
    return toGasPublicResult(operationId, observed);
  } catch (error) {
    if (isGasWaitError(error)) return unknownResult(operationId);
    throw error;
  }
}

function sdkErrorResponse(res: express.Response, error: unknown): void {
  if (error instanceof VeloRateLimitError) {
    errorResponse(res, "rate_limited", ERROR_MESSAGES.rateLimited, 429);
    return;
  }
  if (error instanceof VeloValidationError && error.code && POLICY_CODES.has(error.code)) {
    if (error.code === "daily_cap_exceeded" || error.code === "wallet_rate_limited") {
      errorResponse(res, "rate_limited", ERROR_MESSAGES.rateLimited, 429);
    } else {
      errorResponse(res, "policy_denied", ERROR_MESSAGES.policy, 403);
    }
    return;
  }
  if (error instanceof VeloValidationError && error.code && INPUT_CODES.has(error.code)) {
    errorResponse(res, "invalid_input", ERROR_MESSAGES.invalidInput, 400);
    return;
  }
  if (error instanceof VeloTimeoutError) {
    errorResponse(res, "upstream_timeout", ERROR_MESSAGES.timeout, 504);
    return;
  }
  if (error instanceof VeloAuthError || error instanceof VeloAPIError) {
    errorResponse(res, "upstream_failure", ERROR_MESSAGES.upstream, 502);
    return;
  }
  errorResponse(res, "upstream_failure", ERROR_MESSAGES.upstream, 502);
}

function defaultCreateClient(config: GasExampleConfig): GasClient {
  return new Velo({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    environment: config.environment,
    timeoutMs: WORKFLOW_BUDGET_MS,
  });
}

export function createGasRouter(dependencies: GasRouterDependencies = {}) {
  const router = express.Router();
  const getConfig = dependencies.getConfig ?? getGasExampleConfig;
  const createClient = dependencies.createClient ?? defaultCreateClient;

  const authorize: RequestHandler = (req, res, next) => {
    let config: GasExampleConfig;
    try {
      config = getConfig();
    } catch {
      errorResponse(res, "configuration_error", ERROR_MESSAGES.configuration, 500);
      return;
    }
    if (!isAuthorized(req.get("authorization"), config.demoToken)) {
      errorResponse(res, "caller_unauthorized", ERROR_MESSAGES.unauthorized, 401);
      return;
    }
    res.locals.gasExampleConfig = config;
    next();
  };

  router.post(
    "/",
    authorize,
    express.raw({ type: "application/json", limit: MAX_BODY_BYTES, inflate: false }),
    async (req, res) => {
      let input: GasRequest;
      try {
        input = parseGasRequest(req.body);
      } catch (error) {
        const tooLarge = error instanceof GasInputError && error.tooLarge;
        errorResponse(
          res,
          tooLarge ? "payload_too_large" : "invalid_input",
          tooLarge ? ERROR_MESSAGES.tooLarge : ERROR_MESSAGES.invalidInput,
          tooLarge ? 413 : 400,
        );
        return;
      }

      const deadline = Date.now() + WORKFLOW_BUDGET_MS;
      const initialBudget = remainingBudget(deadline);
      if (initialBudget === 0) {
        errorResponse(res, "upstream_timeout", ERROR_MESSAGES.timeout, 504);
        return;
      }

      const config = res.locals.gasExampleConfig as GasExampleConfig;
      let gas: GasApi | undefined;
      try {
        gas = createClient(config).gas;
        const result = await gas.sponsorAndSubmit(input.transactionXdr, {
          idempotencyKey: `express-gas:${input.operationId}`,
          timeoutMs: initialBudget,
        });
        const publicResult = await observeResult(gas, input.operationId, result, deadline);
        jsonResponse(res, publicResult, isGasTerminalStatus(publicResult.status) ? 200 : 202);
      } catch (error) {
        if (isGasSubmissionUnknownError(error)) {
          if (!gas) {
            sdkErrorResponse(res, error);
            return;
          }
          try {
            const recovered = await observeUnknown(
              gas,
              input.operationId,
              error.recovery,
              deadline,
            );
            jsonResponse(res, recovered, isGasTerminalStatus(recovered.status) ? 200 : 202);
          } catch (observationError) {
            sdkErrorResponse(res, observationError);
          }
          return;
        }
        sdkErrorResponse(res, error);
      }
    },
  );

  router.use(((error: unknown, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const status =
      isRecord(error) && (error.type === "entity.too.large" || error.status === 413) ? 413 : 400;
    errorResponse(
      res,
      status === 413 ? "payload_too_large" : "invalid_input",
      status === 413 ? ERROR_MESSAGES.tooLarge : ERROR_MESSAGES.invalidInput,
      status,
    );
  }) as express.ErrorRequestHandler);

  return router;
}
