import type {
  VeloConfig,
  CreateCheckoutSessionParams,
  RequestOptions,
  PaymentIntent,
  ListPaymentIntentsQuery,
  ListResponse,
  WebhookEvent,
  VerifyWebhookParams,
} from "./types.ts";

import { VeloInvalidResponseError, VeloValidationError } from "./errors.ts";
import { createGasApi, type GasApi } from "./gas.ts";
import { HttpClient } from "./http.ts";
import { verifyWebhookSignature } from "./webhooks.ts";

const PAYMENT_INTENT_STATUSES = new Set([
  "awaiting_route",
  "created",
  "pending",
  "paid",
  "failed",
  "expired",
  "cancelled",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidInput(message: string, param?: string): VeloValidationError {
  return new VeloValidationError(message, { code: "invalid_request", param });
}

function normalizeCreateParams(params: CreateCheckoutSessionParams): CreateCheckoutSessionParams {
  if (!isRecord(params)) throw invalidInput("Payment intent parameters must be an object.");

  const amount = params.amount;
  if (
    typeof amount !== "string" ||
    !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(amount.trim()) ||
    !Number.isFinite(Number(amount)) ||
    Number(amount) <= 0
  ) {
    throw invalidInput("amount must be a positive decimal string.", "amount");
  }

  const normalized: CreateCheckoutSessionParams = { amount: amount.trim() };
  for (const field of ["asset", "description", "successUrl", "cancelUrl"] as const) {
    const value = params[field];
    if (value !== undefined) {
      if (typeof value !== "string") throw invalidInput(`${field} must be a string.`, field);
      normalized[field] = value;
    }
  }

  if (params.anchor !== undefined) {
    if (params.anchor !== "inhouse") {
      throw invalidInput("anchor must be 'inhouse'.", "anchor");
    }
    normalized.anchor = params.anchor;
  }

  return normalized;
}

function isStringOrNull(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function parsePaymentIntent(value: unknown): PaymentIntent {
  if (
    !isRecord(value) ||
    value.object !== "payment_intent" ||
    typeof value.id !== "string" ||
    typeof value.paymentIntentId !== "string" ||
    value.id !== value.paymentIntentId ||
    typeof value.status !== "string" ||
    !PAYMENT_INTENT_STATUSES.has(value.status) ||
    typeof value.amount !== "string" ||
    typeof value.asset !== "string" ||
    !isStringOrNull(value.description) ||
    !isStringOrNull(value.checkoutUrl) ||
    !isStringOrNull(value.successUrl) ||
    !isStringOrNull(value.cancelUrl) ||
    !isTimestamp(value.expiresAt) ||
    !isTimestamp(value.createdAt) ||
    !isTimestamp(value.updatedAt) ||
    (value.correlationId !== undefined && !isStringOrNull(value.correlationId)) ||
    (value.anchor !== undefined && value.anchor !== "inhouse" && value.anchor !== "pdax") ||
    (value.receiverAddress !== undefined && !isStringOrNull(value.receiverAddress)) ||
    (value.receiverMemo !== undefined && !isStringOrNull(value.receiverMemo)) ||
    (value.anchorDepositCurrency !== undefined && !isStringOrNull(value.anchorDepositCurrency)) ||
    (value.payerAddress !== undefined && !isStringOrNull(value.payerAddress))
  ) {
    throw new VeloInvalidResponseError();
  }

  return value as unknown as PaymentIntent;
}

function parsePaymentIntentList(value: unknown): ListResponse<PaymentIntent> {
  if (
    !isRecord(value) ||
    value.object !== "list" ||
    !Array.isArray(value.data) ||
    typeof value.hasMore !== "boolean" ||
    (value.nextCursor !== null && typeof value.nextCursor !== "string")
  ) {
    throw new VeloInvalidResponseError();
  }

  return { ...value, data: value.data.map(parsePaymentIntent) } as ListResponse<PaymentIntent>;
}

function normalizeListQuery(query: ListPaymentIntentsQuery | undefined): ListPaymentIntentsQuery {
  if (query === undefined) return {};
  if (!isRecord(query)) throw invalidInput("Payment intent list query must be an object.");

  const normalized: ListPaymentIntentsQuery = {};
  if (query.status !== undefined) {
    if (typeof query.status !== "string" || !PAYMENT_INTENT_STATUSES.has(query.status)) {
      throw invalidInput("status is invalid.", "status");
    }
    normalized.status = query.status as ListPaymentIntentsQuery["status"];
  }
  if (query.limit !== undefined) {
    if (!Number.isSafeInteger(query.limit) || (query.limit as number) < 0) {
      throw invalidInput("limit must be a non-negative integer.", "limit");
    }
    normalized.limit = Math.min(100, Math.max(1, query.limit as number));
  }
  if (query.cursor !== undefined) {
    if (typeof query.cursor !== "string") throw invalidInput("cursor must be a string.", "cursor");
    normalized.cursor = query.cursor;
  }
  return normalized;
}

export class Velo {
  private readonly http: HttpClient;

  readonly gas: GasApi;

  static readonly webhooks = {
    verify: async (params: VerifyWebhookParams): Promise<WebhookEvent> => {
      return verifyWebhookSignature(params);
    },
  };

  readonly webhooks = {
    verify: async (params: VerifyWebhookParams): Promise<WebhookEvent> => {
      return verifyWebhookSignature(params);
    },
  };

  constructor(config: VeloConfig) {
    if (
      !config ||
      !config.apiKey ||
      typeof config.apiKey !== "string" ||
      config.apiKey.trim() === ""
    ) {
      throw new Error("API key is required");
    }
    this.http = new HttpClient(config);
    this.gas = createGasApi(this.http);
  }

  readonly checkout = {
    sessions: {
      create: async (
        params: CreateCheckoutSessionParams,
        options?: RequestOptions,
      ): Promise<PaymentIntent> => {
        const body = normalizeCreateParams(params);
        const payload = await this.http.request<unknown>(
          "POST",
          "/api/v2/payment-intents",
          body,
          options,
        );
        return parsePaymentIntent(payload);
      },
    },
  };

  readonly paymentIntents = {
    create: async (
      params: CreateCheckoutSessionParams,
      options?: RequestOptions,
    ): Promise<PaymentIntent> => {
      const body = normalizeCreateParams(params);
      const payload = await this.http.request<unknown>(
        "POST",
        "/api/v2/payment-intents",
        body,
        options,
      );
      return parsePaymentIntent(payload);
    },
    retrieve: async (id: string, options?: RequestOptions): Promise<PaymentIntent> => {
      if (!id || typeof id !== "string" || id.trim() === "") {
        throw new Error("Payment intent ID is required");
      }
      const payload = await this.http.request<unknown>(
        "GET",
        `/api/v2/payment-intents/${encodeURIComponent(id)}`,
        undefined,
        options,
      );
      return parsePaymentIntent(payload);
    },
    list: async (
      query?: ListPaymentIntentsQuery,
      options?: RequestOptions,
    ): Promise<ListResponse<PaymentIntent>> => {
      const normalizedQuery = normalizeListQuery(query);
      let path = "/api/v2/payment-intents";
      const searchParams = new URLSearchParams();
      if (normalizedQuery.status) {
        searchParams.append("status", normalizedQuery.status);
      }
      if (normalizedQuery.limit !== undefined) {
        searchParams.append("limit", String(normalizedQuery.limit));
      }
      if (normalizedQuery.cursor) {
        searchParams.append("cursor", normalizedQuery.cursor);
      }
      const queryString = searchParams.toString();
      if (queryString) {
        path += `?${queryString}`;
      }
      const payload = await this.http.request<unknown>("GET", path, undefined, options);
      return parsePaymentIntentList(payload);
    },
  };
}
