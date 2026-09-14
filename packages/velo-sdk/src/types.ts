export type PaymentIntentStatus =
  | "awaiting_route"
  | "created"
  | "pending"
  | "paid"
  | "failed"
  | "expired"
  | "cancelled";

export type PaymentIntent = {
  id: string;
  object: "payment_intent";
  paymentIntentId: string;
  /** Durable journey identifier returned by Velo. */
  correlationId?: string | null;
  status: PaymentIntentStatus;
  amount: string;
  asset: string;
  description: string | null;
  checkoutUrl: string | null;
  successUrl: string | null;
  cancelUrl: string | null;
  anchor?: "inhouse" | "pdax";
  receiverAddress?: string | null;
  receiverMemo?: string | null;
  anchorDepositCurrency?: string | null;
  payerAddress?: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
};

export type VeloConfig = {
  apiKey: string;
  baseUrl?: string;
  environment?: "production" | "testnet" | "development" | string;
  /** Total wall-clock deadline for one SDK request, including retries. Defaults to 30 seconds. */
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
};

export type CreateCheckoutSessionParams = {
  amount: string;
  asset?: string;
  description?: string;
  successUrl?: string;
  cancelUrl?: string;
  anchor?: "inhouse" | "pdax";
};

export type RequestOptions = {
  idempotencyKey?: string;
  correlationId?: string;
  /** W3C trace context propagated to Velo and downstream dependencies. */
  traceparent?: string;
  signal?: AbortSignal;
  /** Overrides the client default total wall-clock deadline for this request. */
  timeoutMs?: number;
  /** Overrides the client default retry count for this request. */
  maxRetries?: number;
  /** Set for transaction submission calls whose network outcome must be reconciled, never retried. */
  submission?: boolean;
};

export type GasSponsorOptions = Omit<RequestOptions, "idempotencyKey"> & {
  idempotencyKey: string;
};

export type GasWaitOptions = Omit<RequestOptions, "maxRetries" | "submission"> & {
  /** Maximum number of status calls, including calls that fail transiently. Defaults to 10. */
  maxAttempts?: number;
  /** Initial delay between status calls in milliseconds. Defaults to 500. */
  initialDelayMs?: number;
  /** Maximum exponential delay between status calls in milliseconds. Defaults to 5000. */
  maxDelayMs?: number;
};

export type GasSponsorReservation = {
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

export type GasExecutionStatus =
  | "claimed"
  | "submission_unknown"
  | "submitted"
  | "succeeded"
  | "failed"
  | "cancelled";

export type GasExecutionIdentity = {
  requestId: string;
  /** Inner transaction hash returned by the Gas sponsorship response. */
  transactionHash: string;
};

export type GasSubmitParams = GasExecutionIdentity & {
  /** The original user-signed XDR, supplied transiently for the handoff only. */
  transactionXdr: string;
};

export type GasSubmitResult = {
  object: "gas_submit_result";
  requestId: string;
  /** Inner transaction hash; the outer FeeBump hash is separate. */
  transactionHash: string;
  outerTransactionHash: string | null;
  status: GasExecutionStatus;
  reservedStroops: string;
  actualFeeStroops: string | null;
  expiresAt: string;
  reconciliationRequired: boolean;
};

export type ListPaymentIntentsQuery = {
  status?: PaymentIntentStatus;
  limit?: number;
  cursor?: string;
};

export type ListResponse<T> = {
  object: "list";
  data: T[];
  hasMore: boolean;
  nextCursor: string | null;
};

export type WebhookEventType =
  | "project.registered"
  | "project.updated"
  | "transaction.succeeded"
  | "transaction.failed"
  | "payment.created"
  | "payment.succeeded"
  | "payment.failed"
  | "payment_access.activated"
  | "payment.access_activated"
  | "contract.event"
  | "settlement.quote.created"
  | "settlement.trade.executed"
  | "settlement.withdrawal.pending"
  | "settlement.withdrawal.succeeded"
  | "settlement.withdrawal.failed"
  | "provider.pdax.event.received";

export type WebhookEventBase = {
  version: "1";
  id: string;
  type: WebhookEventType;
  test: boolean;
  sentAt: string;
  correlationId?: string;
  project: {
    id: string;
    registryProjectId: string;
    name: string;
    slug: string;
  };
};

export type WebhookPaymentIntentData = {
  id: string;
  amount: string;
  asset: string;
  receiverAddress?: string;
  merchantName: string;
  description: string | null;
  status: PaymentIntentStatus;
  payerAddress?: string;
  txHash?: string;
  createdAt: string;
  updatedAt: string;
};

export type WebhookPaymentEvent = WebhookEventBase & {
  type:
    | "payment.created"
    | "payment.succeeded"
    | "payment.failed"
    | "payment_access.activated"
    | "payment.access_activated";
  paymentIntent: WebhookPaymentIntentData;
};

export type WebhookContractEvent = WebhookEventBase & {
  type: "contract.event";
  contractId: string;
  transactionHash: string;
  ledger: number;
  event: {
    id: string;
    topic: string;
    type: string;
    data: unknown;
    observedAt: string;
  };
};

export type WebhookProjectEvent = WebhookEventBase & {
  type: "project.registered" | "project.updated";
  ledger: number;
  metadataHash: string;
  status: string;
};

export type WebhookTransactionEvent = WebhookEventBase & {
  type: "transaction.succeeded" | "transaction.failed";
  transactionHash: string;
  ledger: number;
  status: "success" | "failed";
};

export type WebhookSettlementQuoteEvent = WebhookEventBase & {
  type: "settlement.quote.created";
  quote: {
    id: string;
    side: string;
    quoteCurrency: string;
    baseCurrency: string;
    quantity: string;
    price: number;
    totalAmount: number;
    expiresAt: string;
    status: string;
  };
};

export type WebhookSettlementTradeEvent = WebhookEventBase & {
  type: "settlement.trade.executed";
  trade: {
    orderId: number;
    quoteId: string;
    price?: number;
    amount?: number;
    quantity?: number;
    status?: string;
  };
};

export type WebhookSettlementWithdrawalEvent = WebhookEventBase & {
  type:
    | "settlement.withdrawal.pending"
    | "settlement.withdrawal.succeeded"
    | "settlement.withdrawal.failed";
  withdrawal: {
    withdrawalId: string;
    referenceNumber?: string;
    amount?: number;
    fee?: number;
    status?: string;
    bankCode?: string;
    accountName?: string;
    accountNumber?: string;
  };
};

export type WebhookProviderPdaxEvent = WebhookEventBase & {
  type: "provider.pdax.event.received";
  provider: "pdax";
  eventId: string;
  eventType: string;
  rawEvent: unknown;
};

export type WebhookEvent =
  | WebhookPaymentEvent
  | WebhookContractEvent
  | WebhookProjectEvent
  | WebhookTransactionEvent
  | WebhookSettlementQuoteEvent
  | WebhookSettlementTradeEvent
  | WebhookSettlementWithdrawalEvent
  | WebhookProviderPdaxEvent;

export type VerifyWebhookParams = {
  payload: string;
  signature: string | null;
  secret: string;
  toleranceSeconds?: number;
};
