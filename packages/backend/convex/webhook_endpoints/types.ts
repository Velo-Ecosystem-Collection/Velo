import type { Doc, Id } from "../_generated/dataModel";

export const WEBHOOK_EVENT_TYPES = [
  "contract.event",
  "transaction.succeeded",
  "transaction.failed",
  "project.registered",
  "project.updated",
  "payment.created",
  "payment.succeeded",
  "payment.failed",
  "payment_access.activated",
  "settlement.quote.created",
  "settlement.trade.executed",
  "settlement.withdrawal.pending",
  "settlement.withdrawal.succeeded",
  "settlement.withdrawal.failed",
  "provider.pdax.event.received",
] as const;

export const ACTIVE_WEBHOOK_EVENT_TYPES = [
  "contract.event",
  "transaction.succeeded",
  "transaction.failed",
  "project.registered",
  "project.updated",
  "payment.created",
  "payment.succeeded",
  "payment.failed",
  "payment_access.activated",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];
export type WebhookEndpoint = Doc<"webhookEndpoints">;
export type WebhookEndpointId = Id<"webhookEndpoints">;

export type WebhookSettingsInput = Pick<
  WebhookEndpoint,
  "projectId" | "url" | "enabled" | "eventTypes"
>;
