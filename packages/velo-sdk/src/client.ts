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

import { createGasApi, type GasApi } from "./gas.ts";
import { HttpClient } from "./http.ts";
import { verifyWebhookSignature } from "./webhooks.ts";

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
        return this.http.request<PaymentIntent>("POST", "/api/v2/payment-intents", params, options);
      },
    },
  };

  readonly paymentIntents = {
    create: async (
      params: CreateCheckoutSessionParams,
      options?: RequestOptions,
    ): Promise<PaymentIntent> => {
      return this.http.request<PaymentIntent>("POST", "/api/v2/payment-intents", params, options);
    },
    retrieve: async (id: string, options?: RequestOptions): Promise<PaymentIntent> => {
      if (!id || typeof id !== "string" || id.trim() === "") {
        throw new Error("Payment intent ID is required");
      }
      return this.http.request<PaymentIntent>(
        "GET",
        `/api/v2/payment-intents/${encodeURIComponent(id)}`,
        undefined,
        options,
      );
    },
    list: async (
      query?: ListPaymentIntentsQuery,
      options?: RequestOptions,
    ): Promise<ListResponse<PaymentIntent>> => {
      let path = "/api/v2/payment-intents";
      const searchParams = new URLSearchParams();
      if (query?.status) {
        searchParams.append("status", query.status);
      }
      if (query?.limit !== undefined) {
        searchParams.append("limit", String(query.limit));
      }
      if (query?.cursor) {
        searchParams.append("cursor", query.cursor);
      }
      const queryString = searchParams.toString();
      if (queryString) {
        path += `?${queryString}`;
      }
      return this.http.request<ListResponse<PaymentIntent>>("GET", path, undefined, options);
    },
  };
}
