"use node";

import crypto from "crypto";

import { isCorrelationId } from "@repo/observability";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import type { WebhookDeliveryId } from "./webhook_deliveries/types";
import type { WebhookEventType } from "./webhook_endpoints/types";

import { internal } from "./_generated/api";
import { action, internalAction } from "./_generated/server";
import { requireIdentity } from "./projects/helpers";
import { WEBHOOK_DELIVERY_LEASE_MS } from "./webhook_deliveries/constants";

type DeliveryTarget = {
  endpoint: Doc<"webhookEndpoints">;
  project: Doc<"projects">;
  contractEvent?: Doc<"contractEvents"> | null;
  paymentIntent?: Doc<"paymentIntents"> | null;
  settlementQuote?: Doc<"settlementQuotes"> | null;
  settlementTransaction?: Doc<"settlementTransactions"> | null;
  providerEvent?: Doc<"providerEvents"> | null;
};

const WEBHOOK_CONNECT_TIMEOUT_MS = 2_000;
const WEBHOOK_TOTAL_TIMEOUT_MS = 8_000;
const MAX_WEBHOOK_ATTEMPTS = 5;
const MAX_RETRY_DELAY_SECONDS = 900;
const RETRY_DELAYS_SECONDS = [0, 15, 60, 300, 900];
const telemetryRef = makeFunctionReference<"mutation">("telemetry_outbox/mutations:enqueue");

function testCorrelationId(value: string | undefined) {
  return value !== undefined && isCorrelationId(value) ? value : crypto.randomUUID();
}

function buildPayload(
  target: DeliveryTarget,
  eventType: WebhookEventType,
  test = false,
  overrideEventId?: string,
  correlationId?: string,
) {
  const event = target.contractEvent;
  const paymentIntent = target.paymentIntent;
  const sentAt = new Date().toISOString();
  const base = {
    version: "1" as const,
    id: overrideEventId ?? crypto.randomUUID(),
    type: eventType,
    test,
    sentAt,
    ...(correlationId !== undefined ? { correlationId } : {}),
    project: {
      id: target.project._id,
      registryProjectId: target.project.registryProjectId,
      name: target.project.name,
      slug: target.project.slug,
    },
  };

  if (eventType === "contract.event" && event) {
    return {
      ...base,
      contractId: event.contractId,
      transactionHash: event.transactionHash,
      ledger: event.ledger,
      event: {
        id: event.eventId,
        topic: event.topic,
        type: event.type,
        data: event.decoded ?? event.raw,
        observedAt: event.observedAt,
      },
    };
  }

  if (eventType === "transaction.succeeded" || eventType === "transaction.failed") {
    return {
      ...base,
      transactionHash: event?.transactionHash ?? target.project.registrationTxHash,
      ledger: event?.ledger ?? target.project.createdLedger,
      status: eventType === "transaction.succeeded" ? "success" : "failed",
    };
  }

  // Handle payment and activation events
  if (eventType.startsWith("payment.") || eventType === "payment_access.activated") {
    const pi = (paymentIntent ?? {
      _id: "pi_mock1234567890",
      amount: "100.00",
      asset: "USDC",
      receiverAddress: target.project.ownerAddress,
      merchantName: target.project.name,
      description: "Mock test payment",
      status:
        eventType === "payment.succeeded"
          ? "paid"
          : eventType === "payment.failed"
            ? "failed"
            : "created",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }) as Record<string, unknown>;
    return {
      ...base,
      paymentIntent: {
        id: pi._id as string,
        amount: (pi.amount as string) ?? "0",
        asset: (pi.asset as string) ?? "native",
        ...(typeof pi.receiverAddress === "string" ? { receiverAddress: pi.receiverAddress } : {}),
        merchantName: (pi.merchantName as string) ?? "",
        description: pi.description as string | undefined,
        status: pi.status as Doc<"paymentIntents">["status"],
        payerAddress: pi.payerAddress as string | undefined,
        txHash: pi.txHash as string | undefined,
        createdAt: new Date((pi.createdAt as number) ?? Date.now()).toISOString(),
        updatedAt: new Date((pi.updatedAt as number) ?? Date.now()).toISOString(),
      },
    };
  }

  if (eventType === "settlement.quote.created") {
    const q = target.settlementQuote ?? {
      quoteId: "quote_mock12345",
      side: "sell",
      quoteCurrency: "USDCXLM",
      baseCurrency: "PHP",
      quantity: "100.00",
      price: 58.2,
      totalAmount: 5820.0,
      expiresAt: Date.now() + 15000,
      status: "active",
    };
    return {
      ...base,
      quote: {
        id: q.quoteId,
        side: q.side,
        quoteCurrency: q.quoteCurrency,
        baseCurrency: q.baseCurrency,
        quantity: q.quantity,
        price: q.price,
        totalAmount: q.totalAmount,
        expiresAt: new Date(q.expiresAt).toISOString(),
        status: q.status,
      },
    };
  }

  if (eventType === "settlement.trade.executed") {
    const tx = target.settlementTransaction ?? {
      orderId: 98765,
      quoteId: "quote_mock12345",
      tradeDetails: {
        price: 58.2,
        amount: 5820.0,
        quantity: 100.0,
        status: "successful",
      },
    };
    return {
      ...base,
      trade: {
        orderId: tx.orderId,
        quoteId: tx.quoteId,
        price: tx.tradeDetails?.price,
        amount: tx.tradeDetails?.amount,
        quantity: tx.tradeDetails?.quantity,
        status: tx.tradeDetails?.status,
      },
    };
  }

  if (eventType.startsWith("settlement.withdrawal.")) {
    const tx = target.settlementTransaction ?? {
      withdrawalId: "tx_mock_withdrawal123",
      withdrawalDetails: {
        referenceNumber: "ref-mock-12345",
        amount: 5820.0,
        fee: 15.0,
        status:
          eventType === "settlement.withdrawal.succeeded"
            ? "COMPLETED"
            : eventType === "settlement.withdrawal.failed"
              ? "FAILED"
              : "PENDING",
        bankCode: "BASECPH",
        accountName: "John Doe",
        accountNumber: "0000042001461",
      },
    };
    return {
      ...base,
      withdrawal: {
        withdrawalId: tx.withdrawalId,
        referenceNumber: tx.withdrawalDetails?.referenceNumber,
        amount: tx.withdrawalDetails?.amount,
        fee: tx.withdrawalDetails?.fee,
        status: tx.withdrawalDetails?.status,
        bankCode: tx.withdrawalDetails?.bankCode,
        accountName: tx.withdrawalDetails?.accountName,
        accountNumber: tx.withdrawalDetails?.accountNumber,
      },
    };
  }

  if (eventType === "provider.pdax.event.received") {
    const pe = target.providerEvent ?? {
      provider: "pdax",
      eventId: "ref-mock-12345",
      type: "WITHDRAWAL",
      eventSummary: { eventType: "WITHDRAWAL", eventId: "ref-mock-12345" },
    };
    return {
      ...base,
      provider: pe.provider,
      eventId: pe.eventId,
      eventType: pe.type,
      eventSummary: pe.eventSummary ?? {},
    };
  }

  return {
    ...base,
    ledger: target.project.createdLedger,
    metadataHash: target.project.metadataHash,
    status: target.project.status,
  };
}

function payloadSummary(payload: ReturnType<typeof buildPayload>) {
  const p = payload as Record<string, unknown>;
  const pi = p.paymentIntent as Record<string, unknown> | undefined;
  return {
    id: p.id as string,
    type: p.type as WebhookEventType,
    test: p.test as boolean,
    projectId: (p.project as { id: string }).id,
    ...(p.contractId ? { contractId: p.contractId as string } : {}),
    ...(p.transactionHash ? { transactionHash: p.transactionHash as string } : {}),
    ...(p.ledger !== undefined ? { ledger: p.ledger as number } : {}),
    ...(pi ? { paymentIntentId: pi.id as string } : {}),
    ...(p.quote ? { quoteId: (p.quote as { id: string }).id } : {}),
    ...(p.trade ? { orderId: (p.trade as { orderId: number }).orderId } : {}),
    ...(p.withdrawal
      ? { withdrawalId: (p.withdrawal as { withdrawalId: string }).withdrawalId }
      : {}),
  };
}

function computeSignatureHeader(payload: unknown, secret?: string): string | undefined {
  if (!secret) {
    return undefined;
  }
  const timestamp = Math.floor(Date.now() / 1000);
  const signaturePayload = `${timestamp}.${JSON.stringify(payload)}`;
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(signaturePayload);
  const hash = hmac.digest("hex");
  return `t=${timestamp},v1=${hash}`;
}

function parseRetryAfterSeconds(value: string | null, now = Date.now()) {
  if (!value) {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.min(MAX_RETRY_DELAY_SECONDS, seconds));
  }
  const date = Date.parse(value);
  if (!Number.isFinite(date)) {
    return undefined;
  }
  return Math.max(0, Math.min(MAX_RETRY_DELAY_SECONDS, Math.ceil((date - now) / 1000)));
}

function nextRetryDelaySeconds(attemptCount: number, retryAfterHeader?: string | null) {
  const retryAfter = parseRetryAfterSeconds(retryAfterHeader ?? null);
  if (retryAfter !== undefined) {
    return retryAfter;
  }
  const baseDelay = RETRY_DELAYS_SECONDS[attemptCount] ?? MAX_RETRY_DELAY_SECONDS;
  return Math.min(MAX_RETRY_DELAY_SECONDS, baseDelay * (0.75 + Math.random() * 0.5));
}

function isRetryableWebhookStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

async function fetchWithDeadlines(url: string, init: RequestInit) {
  const controller = new AbortController();
  const connectTimer = setTimeout(() => {
    controller.abort(
      new Error(`Webhook connect deadline exceeded after ${WEBHOOK_CONNECT_TIMEOUT_MS}ms`),
    );
  }, WEBHOOK_CONNECT_TIMEOUT_MS);
  const totalTimer = setTimeout(() => {
    controller.abort(
      new Error(`Webhook total deadline exceeded after ${WEBHOOK_TOTAL_TIMEOUT_MS}ms`),
    );
  }, WEBHOOK_TOTAL_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.reason instanceof Error) {
      throw controller.signal.reason;
    }
    throw error;
  } finally {
    clearTimeout(connectTimer);
    clearTimeout(totalTimer);
  }
}

export const sendTest = action({
  args: {
    projectId: v.id("projects"),
    eventType: v.union(
      v.literal("contract.event"),
      v.literal("transaction.succeeded"),
      v.literal("transaction.failed"),
      v.literal("project.registered"),
      v.literal("project.updated"),
      v.literal("payment.created"),
      v.literal("payment.succeeded"),
      v.literal("payment.failed"),
      v.literal("payment_access.activated"),
      v.literal("settlement.quote.created"),
      v.literal("settlement.trade.executed"),
      v.literal("settlement.withdrawal.pending"),
      v.literal("settlement.withdrawal.succeeded"),
      v.literal("settlement.withdrawal.failed"),
      v.literal("provider.pdax.event.received"),
    ),
    contractEventId: v.optional(v.id("contractEvents")),
    paymentIntentId: v.optional(v.id("paymentIntents")),
    settlementQuoteId: v.optional(v.id("settlementQuotes")),
    settlementTransactionId: v.optional(v.id("settlementTransactions")),
    providerEventId: v.optional(v.id("providerEvents")),
    correlationId: v.optional(v.string()),
    traceparent: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ deliveryId: WebhookDeliveryId; status: "success" | "failed" }> => {
    const correlationId = testCorrelationId(args.correlationId);
    const identity = await requireIdentity(ctx);
    const target: DeliveryTarget = await ctx.runQuery(
      internal.webhook_endpoints.query.getDeliveryTarget,
      {
        projectId: args.projectId,
        eventType: args.eventType,
        contractEventId: args.contractEventId,
        paymentIntentId: args.paymentIntentId,
        ownerTokenIdentifier: identity.tokenIdentifier,
        ownerSubject: identity.subject,
      },
    );

    const quote = args.settlementQuoteId
      ? await ctx.runQuery(internal.settlement_quotes.query.getById, { id: args.settlementQuoteId })
      : null;
    const tx = args.settlementTransactionId
      ? await ctx.runQuery(internal.settlement_transactions.query.getById, {
          id: args.settlementTransactionId,
        })
      : null;
    const pEvent = args.providerEventId
      ? await ctx.runQuery(internal.provider_events.mutation.getById, { id: args.providerEventId })
      : null;

    const payload = buildPayload(
      {
        ...target,
        settlementQuote: quote,
        settlementTransaction: tx,
        providerEvent: pEvent,
      },
      args.eventType,
      true,
      undefined,
      correlationId,
    );
    const signatureHeader = computeSignatureHeader(payload, target.endpoint.signingSecret);
    const deliveryId: WebhookDeliveryId = await ctx.runMutation(
      internal.webhook_deliveries.mutation.createPending,
      {
        projectId: args.projectId,
        endpointId: target.endpoint._id,
        eventType: args.eventType,
        destinationHost: target.endpoint.destinationHost,
        payloadSummary: payloadSummary(payload),
        paymentIntentId: args.paymentIntentId,
        correlationId,
      },
    );

    await ctx.runMutation(internal.webhook_deliveries.mutation.startAttempt, {
      deliveryId,
      attemptCount: 1,
    });

    const startTime = Date.now();
    try {
      const response = await fetchWithDeadlines(target.endpoint.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "Velo-Webhook/1.0",
          "x-velo-event": args.eventType,
          "x-velo-delivery": deliveryId,
          "x-correlation-id": correlationId,
          ...(signatureHeader ? { "x-velo-signature": signatureHeader } : {}),
        },
        body: JSON.stringify(payload),
      });
      const responseTimeMs = Date.now() - startTime;
      await ctx.runMutation(telemetryRef, {
        kind: "span",
        name: "velo.dependency.call",
        operation: "webhook_delivery",
        stage: "webhook_network",
        outcome: response.ok ? "success" : "error",
        requestCorrelationId: correlationId,
        journeyCorrelationId: correlationId,
        durationMs: responseTimeMs,
        ...(!response.ok ? { errorCode: "dependency_unavailable" } : {}),
      });
      const status = response.ok ? "success" : "failed";

      await ctx.runMutation(internal.webhook_deliveries.mutation.finish, {
        deliveryId,
        status,
        httpStatus: response.status,
        errorMessage: response.ok ? undefined : `Endpoint returned HTTP ${response.status}`,
        responseTimeMs,
      });

      return { deliveryId, status };
    } catch {
      const responseTimeMs = Date.now() - startTime;
      await ctx.runMutation(internal.webhook_deliveries.mutation.finish, {
        deliveryId,
        status: "failed",
        errorMessage: "webhook_network_error",
        responseTimeMs,
      });
      return { deliveryId, status: "failed" };
    }
  },
});

export const trigger = internalAction({
  args: {
    projectId: v.id("projects"),
    eventType: v.union(
      v.literal("contract.event"),
      v.literal("transaction.succeeded"),
      v.literal("transaction.failed"),
      v.literal("project.registered"),
      v.literal("project.updated"),
      v.literal("payment.created"),
      v.literal("payment.succeeded"),
      v.literal("payment.failed"),
      v.literal("payment_access.activated"),
      v.literal("settlement.quote.created"),
      v.literal("settlement.trade.executed"),
      v.literal("settlement.withdrawal.pending"),
      v.literal("settlement.withdrawal.succeeded"),
      v.literal("settlement.withdrawal.failed"),
      v.literal("provider.pdax.event.received"),
    ),
    contractEventId: v.optional(v.id("contractEvents")),
    paymentIntentId: v.optional(v.id("paymentIntents")),
    settlementQuoteId: v.optional(v.id("settlementQuotes")),
    settlementTransactionId: v.optional(v.id("settlementTransactions")),
    providerEventId: v.optional(v.id("providerEvents")),
    deliveryId: v.optional(v.id("webhookDeliveries")),
    attemptCount: v.optional(v.number()),
    correlationId: v.optional(v.string()),
    traceparent: v.optional(v.string()),
    nextAttemptAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const target = await ctx.runQuery(internal.webhook_endpoints.query.getDeliveryTargetInternal, {
      projectId: args.projectId,
      eventType: args.eventType,
      contractEventId: args.contractEventId,
      paymentIntentId: args.paymentIntentId,
    });
    if (!target) {
      return;
    }

    let deliveryId = args.deliveryId;
    const attemptCount = args.attemptCount ?? 1;
    let overrideEventId: string | undefined = undefined;
    const correlationId = testCorrelationId(
      args.correlationId ?? target.paymentIntent?.correlationId,
    );
    const traceparent = args.traceparent ?? target.paymentIntent?.traceparent;

    const sourceIdentity = [
      args.contractEventId,
      args.paymentIntentId,
      args.settlementQuoteId,
      args.settlementTransactionId,
      args.providerEventId,
    ]
      .filter(Boolean)
      .join(":");
    const immutableEventKey = [
      args.projectId,
      args.eventType,
      sourceIdentity || crypto.randomUUID(),
    ]
      .filter(Boolean)
      .join(":");

    if (deliveryId) {
      const existingDelivery = await ctx.runQuery(internal.webhook_deliveries.query.getDelivery, {
        deliveryId,
      });
      if (existingDelivery?.payloadSummary?.id) {
        overrideEventId = existingDelivery.payloadSummary.id;
      }
      if (
        !existingDelivery ||
        existingDelivery.status !== "pending" ||
        existingDelivery.deadLetter
      ) {
        return;
      }
    }

    const quote = args.settlementQuoteId
      ? await ctx.runQuery(internal.settlement_quotes.query.getById, { id: args.settlementQuoteId })
      : null;
    const tx = args.settlementTransactionId
      ? await ctx.runQuery(internal.settlement_transactions.query.getById, {
          id: args.settlementTransactionId,
        })
      : null;
    const pEvent = args.providerEventId
      ? await ctx.runQuery(internal.provider_events.mutation.getById, { id: args.providerEventId })
      : null;

    const payload = buildPayload(
      {
        ...target,
        settlementQuote: quote,
        settlementTransaction: tx,
        providerEvent: pEvent,
      },
      args.eventType,
      false,
      overrideEventId ?? crypto.createHash("sha256").update(immutableEventKey).digest("hex"),
      correlationId,
    );
    const signatureHeader = computeSignatureHeader(payload, target.endpoint.signingSecret);

    if (!deliveryId) {
      // This is the first attempt, create the pending log
      deliveryId = await ctx.runMutation(internal.webhook_deliveries.mutation.createPending, {
        projectId: args.projectId,
        endpointId: target.endpoint._id,
        eventType: args.eventType,
        destinationHost: target.endpoint.destinationHost,
        payloadSummary: payloadSummary(payload),
        paymentIntentId: args.paymentIntentId,
        correlationId,
        deliveryKey: `${immutableEventKey}:${target.endpoint._id}:1`,
        schemaVersion: "1",
        eventKey: immutableEventKey,
      });
    }

    const leaseToken = crypto.randomUUID();
    const claim = await ctx.runMutation(internal.webhook_deliveries.mutation.claimAttempt, {
      deliveryId,
      leaseToken,
      attemptCount,
    });
    if (!claim.claimed) return;
    const leaseGeneration = claim.leaseGeneration;
    await ctx.scheduler.runAfter(WEBHOOK_DELIVERY_LEASE_MS, internal.webhookDelivery.trigger, {
      ...args,
      deliveryId,
      attemptCount: attemptCount + 1,
    });

    const startTime = Date.now();
    try {
      const response = await fetchWithDeadlines(target.endpoint.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "Velo-Webhook/1.0",
          "x-velo-event": args.eventType,
          "x-velo-delivery": String(deliveryId),
          ...(correlationId ? { "x-correlation-id": correlationId } : {}),
          ...(traceparent ? { traceparent } : {}),
          ...(signatureHeader ? { "x-velo-signature": signatureHeader } : {}),
        },
        body: JSON.stringify(payload),
      });
      const responseTimeMs = Date.now() - startTime;
      await ctx.runMutation(telemetryRef, {
        kind: "span",
        name: "velo.dependency.call",
        operation: "webhook_delivery",
        stage: "webhook_network",
        outcome: response.ok ? "success" : "error",
        requestCorrelationId: correlationId,
        journeyCorrelationId: correlationId,
        traceparent,
        durationMs: responseTimeMs,
        ...(!response.ok ? { errorCode: "dependency_unavailable" } : {}),
      });

      if (response.ok) {
        await ctx.runMutation(internal.webhook_deliveries.mutation.finish, {
          deliveryId,
          status: "success",
          httpStatus: response.status,
          responseTimeMs,
          leaseToken,
          leaseGeneration,
        });
      } else {
        const errorMessage = `Endpoint returned HTTP ${response.status}`;
        const retryableStatus = isRetryableWebhookStatus(response.status);
        if (retryableStatus && attemptCount < MAX_WEBHOOK_ATTEMPTS) {
          const delaySeconds = nextRetryDelaySeconds(
            attemptCount,
            response.headers.get("retry-after"),
          );
          const nextAttemptAt = Date.now() + delaySeconds * 1000;
          await ctx.runMutation(internal.webhook_deliveries.mutation.logAttemptFailure, {
            deliveryId,
            httpStatus: response.status,
            errorMessage,
            responseTimeMs,
            nextAttemptAt,
            leaseToken,
            leaseGeneration,
          });
          await ctx.runMutation(internal.webhook_deliveries.mutation.scheduleRetry, {
            delaySeconds,
            projectId: args.projectId,
            eventType: args.eventType,
            contractEventId: args.contractEventId,
            paymentIntentId: args.paymentIntentId,
            settlementQuoteId: args.settlementQuoteId,
            settlementTransactionId: args.settlementTransactionId,
            providerEventId: args.providerEventId,
            deliveryId,
            attemptCount: attemptCount + 1,
            correlationId,
            nextAttemptAt,
          });
        } else {
          await ctx.runMutation(internal.webhook_deliveries.mutation.finish, {
            deliveryId,
            status: "failed",
            httpStatus: response.status,
            errorMessage,
            responseTimeMs,
            deadLetter: retryableStatus,
            leaseToken,
            leaseGeneration,
          });
        }
      }
    } catch {
      const responseTimeMs = Date.now() - startTime;
      const errorMessage = "webhook_network_error";
      await ctx.runMutation(telemetryRef, {
        kind: "span",
        name: "velo.dependency.call",
        operation: "webhook_delivery",
        stage: "webhook_network",
        outcome: "error",
        errorCode: "dependency_unavailable",
        requestCorrelationId: correlationId,
        journeyCorrelationId: correlationId,
        traceparent,
        durationMs: responseTimeMs,
      });

      if (attemptCount < MAX_WEBHOOK_ATTEMPTS) {
        const delaySeconds = nextRetryDelaySeconds(attemptCount);
        const nextAttemptAt = Date.now() + delaySeconds * 1000;
        await ctx.runMutation(internal.webhook_deliveries.mutation.logAttemptFailure, {
          deliveryId,
          errorMessage,
          responseTimeMs,
          nextAttemptAt,
          leaseToken,
          leaseGeneration,
        });
        await ctx.runMutation(internal.webhook_deliveries.mutation.scheduleRetry, {
          delaySeconds,
          projectId: args.projectId,
          eventType: args.eventType,
          contractEventId: args.contractEventId,
          paymentIntentId: args.paymentIntentId,
          settlementQuoteId: args.settlementQuoteId,
          settlementTransactionId: args.settlementTransactionId,
          providerEventId: args.providerEventId,
          deliveryId,
          attemptCount: attemptCount + 1,
          correlationId,
          nextAttemptAt,
        });
      } else {
        await ctx.runMutation(internal.webhook_deliveries.mutation.finish, {
          deliveryId,
          status: "failed",
          errorMessage,
          responseTimeMs,
          deadLetter: true,
          leaseToken,
          leaseGeneration,
        });
      }
    }
  },
});
