import type { GasExecutionIdentity } from "./types.ts";

export class VeloError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly param?: string;
  readonly requestId?: string;
  retryAfterMs?: number;

  constructor(
    message: string,
    options?: {
      status?: number;
      code?: string;
      param?: string;
      requestId?: string;
      retryAfterMs?: number;
    },
  ) {
    super(message);
    this.name = this.constructor.name;
    this.status = options?.status;
    this.code = options?.code;
    this.param = options?.param;
    this.requestId = options?.requestId;
    this.retryAfterMs = options?.retryAfterMs;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export class VeloRequestCancelledError extends VeloError {
  constructor(message = "Request was cancelled") {
    super(message, { code: "cancelled" });
  }
}

export class VeloProviderError extends VeloError {
  constructor(message: string, options?: { status?: number; code?: string; requestId?: string }) {
    super(message, options);
  }
}

export class VeloSubmissionUnknownError extends VeloError {
  constructor(
    message = "Transaction submission outcome is unknown; reconcile by transaction hash",
  ) {
    super(message, { code: "submission_unknown" });
  }
}

export type GasSubmissionUnknownReason =
  | "timeout"
  | "network_error"
  | "cancelled"
  | "invalid_response";

export class VeloGasSubmissionUnknownError extends VeloSubmissionUnknownError {
  readonly recovery: GasExecutionIdentity;
  readonly reason: GasSubmissionUnknownReason;

  constructor(recovery: GasExecutionIdentity, reason: GasSubmissionUnknownReason) {
    super(
      reason === "timeout"
        ? "Gas transaction submission timed out; reconcile by transaction hash"
        : reason === "network_error"
          ? "Gas transaction submission lost network contact; reconcile by transaction hash"
          : reason === "cancelled"
            ? "Gas transaction submission was cancelled locally; reconcile by transaction hash"
            : "Gas transaction submission returned an invalid response; reconcile by transaction hash",
    );
    this.recovery = { ...recovery };
    this.reason = reason;
  }
}

export type GasWaitReason = "timeout" | "attempts_exhausted" | "cancelled";

const GAS_WAIT_MESSAGES: Record<GasWaitReason, string> = {
  timeout: "Gas result observation timed out; resume with the recovery identity.",
  attempts_exhausted:
    "Gas result observation exhausted its attempts; resume with the recovery identity.",
  cancelled: "Gas result observation was cancelled; resume with the recovery identity.",
};

export class VeloGasWaitError extends VeloError {
  readonly recovery: GasExecutionIdentity;
  readonly reason: GasWaitReason;

  constructor(recovery: GasExecutionIdentity, reason: GasWaitReason) {
    super(GAS_WAIT_MESSAGES[reason], { code: `gas_wait_${reason}` });
    this.recovery = { ...recovery };
    this.reason = reason;
  }
}

export class VeloAuthError extends VeloError {
  constructor(message: string, options?: { status?: number; code?: string; requestId?: string }) {
    super(message, options);
  }
}

export class VeloValidationError extends VeloError {
  constructor(
    message: string,
    options?: { status?: number; code?: string; param?: string; requestId?: string },
  ) {
    super(message, options);
  }
}

export class VeloRateLimitError extends VeloError {
  constructor(message: string, options?: { status?: number; code?: string; requestId?: string }) {
    super(message, options);
  }
}

export class VeloAPIError extends VeloError {
  constructor(message: string, options?: { status?: number; code?: string; requestId?: string }) {
    super(message, options);
  }
}

export class VeloTimeoutError extends VeloAPIError {
  constructor(message: string, options?: { requestId?: string }) {
    super(message, { ...options, status: 408, code: "timeout" });
  }
}

export class VeloWebhookSignatureVerificationError extends VeloValidationError {
  constructor(message: string) {
    super(message, { status: 400, code: "webhook_signature_verification_failed" });
  }
}

const SAFE_METADATA = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function mapErrorResponse(
  status: number,
  payload: unknown,
  requestId?: string,
  options?: { safe?: boolean },
): VeloError {
  const errorObj =
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    payload.error &&
    typeof payload.error === "object"
      ? (payload.error as Record<string, unknown>)
      : {};
  const responseMessage =
    typeof errorObj.message === "string"
      ? errorObj.message
      : `Request failed with status ${status}`;
  const responseCode = typeof errorObj.code === "string" ? errorObj.code : undefined;
  const responseParam = typeof errorObj.param === "string" ? errorObj.param : undefined;
  const responseRequestId = typeof errorObj.requestId === "string" ? errorObj.requestId : requestId;
  const errorType = typeof errorObj.type === "string" ? errorObj.type : undefined;
  const safe = options?.safe === true;
  const message = safe ? safeGasErrorMessage(status, responseCode) : responseMessage;
  const code = safe ? safeMetadata(responseCode) : responseCode;
  const param = safe ? safeMetadata(responseParam) : responseParam;
  const reqId = safe ? safeMetadata(responseRequestId) : responseRequestId;

  const errorOptions = { status, code, param, requestId: reqId };

  if (status === 401 || errorType === "auth_error") {
    return new VeloAuthError(message, errorOptions);
  }
  if (status === 429 || errorType === "rate_limit_error") {
    return new VeloRateLimitError(message, errorOptions);
  }
  if (status === 502 || status === 503 || status === 504 || errorType === "provider_error") {
    return new VeloProviderError(message, errorOptions);
  }
  if (
    status === 400 ||
    status === 404 ||
    status === 409 ||
    errorType === "validation_error" ||
    errorType === "not_found_error" ||
    errorType === "idempotency_error"
  ) {
    return new VeloValidationError(message, errorOptions);
  }

  return new VeloAPIError(message, errorOptions);
}

function safeMetadata(value: string | undefined): string | undefined {
  return value !== undefined && SAFE_METADATA.test(value) ? value : undefined;
}

function safeGasErrorMessage(status: number, code: string | undefined): string {
  switch (code) {
    case "contract_not_whitelisted":
      return "Gas sponsorship is not allowed for this contract.";
    case "daily_cap_exceeded":
      return "Gas sponsorship daily cap was exceeded.";
    case "wallet_rate_limited":
      return "Gas sponsorship wallet quota was exceeded.";
    case "reservation_expired":
      return "Gas sponsorship reservation has expired.";
    case "handoff_unavailable":
      return "Gas transaction handoff is unavailable.";
    default:
      if (status === 401) return "Gas authentication failed.";
      if (status === 429) return "Gas request was rate limited.";
      if (status >= 500) return "Gas provider request failed.";
      return "Gas request failed.";
  }
}
