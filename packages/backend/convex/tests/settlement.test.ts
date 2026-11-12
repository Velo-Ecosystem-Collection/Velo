/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { expect, test } from "vitest";

import { api, internal } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");
const currentOrganization = makeFunctionReference<"query">("organizations/queries:getCurrent");

function asWallet(t: ReturnType<typeof convexTest>, ownerAddress: string) {
  return t.withIdentity({
    subject: ownerAddress,
    issuer: "http://localhost:3000",
    tokenIdentifier: `http://localhost:3000|${ownerAddress}`,
  });
}

test("historical provider, settlement, payment, and billing rows remain readable", async () => {
  const t = convexTest(schema, modules);
  const ownerAddress = "GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR";
  const owner = asWallet(t, ownerAddress);
  const projectId = await owner.mutation(api.projects.mutation.createDraft, {
    name: "Historical Settlement Store",
    slug: "historical-settlement-store",
    description: "Legacy record compatibility fixture",
    metadataJson: "{}",
    metadataHash: "0".repeat(64),
    ownerAddress,
  });
  const organization = await owner.query(currentOrganization, {});

  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const paymentIntentId = await ctx.db.insert("paymentIntents", {
      projectId,
      amount: "10.00",
      asset: "USDC:GISSUER",
      receiverAddress: "G-HISTORICAL-DEPOSIT",
      receiverMemo: "legacy-tag",
      anchorDepositCurrency: "USDCXLM",
      merchantName: "Historical Settlement Store",
      status: "paid",
      anchor: "pdax",
      txHash: "historical-hash",
      verifiedTxHash: "historical-hash",
      expiresAt: now + 60_000,
      createdAt: now,
      updatedAt: now,
    });
    const quoteId = await ctx.db.insert("settlementQuotes", {
      projectId,
      paymentIntentId,
      provider: "pdax",
      quoteId: "historical-quote",
      side: "sell",
      quoteCurrency: "USDCXLM",
      baseCurrency: "PHP",
      quantity: "10",
      price: 58.2,
      totalAmount: 582,
      expiresAt: now + 60_000,
      status: "executed",
      createdAt: now,
    });
    const settlementTransactionId = await ctx.db.insert("settlementTransactions", {
      projectId,
      paymentIntentId,
      provider: "pdax",
      status: "PAYOUT_SUCCEEDED",
      idempotencyId: "historical-settlement-key",
      quoteId: "historical-quote",
      withdrawalId: "historical-withdrawal",
      withdrawalDetails: {
        referenceNumber: "historical-reference",
        amount: 582,
        fee: 15,
        status: "COMPLETED",
        bankCode: "TESTBANK",
        accountName: "Merchant",
        accountNumber: "redacted",
      },
      createdAt: now,
      updatedAt: now,
    });
    const providerConnectionId = await ctx.db.insert("providerConnections", {
      projectId,
      provider: "pdax",
      status: "connected",
      username: "historical-user",
      accessToken: "retained-secret",
      idToken: "retained-id-token",
      refreshToken: "retained-refresh-token",
      tokenExpiresAt: now + 60_000,
      createdAt: now,
      updatedAt: now,
    });
    const providerEventId = await ctx.db.insert("providerEvents", {
      projectId,
      provider: "pdax",
      eventId: "historical-event",
      type: "WITHDRAWAL",
      eventSummary: {
        eventType: "WITHDRAWAL",
        eventId: "historical-event",
        status: "COMPLETED",
      },
      processed: true,
      processingState: "processed",
      createdAt: now,
    });
    const providerOperationId = await ctx.db.insert("providerOperations", {
      projectId,
      provider: "pdax",
      operation: "fiat_withdrawal",
      clientKey: "historical-client-key",
      requestFingerprint: "historical-fingerprint",
      providerKey: "historical-provider-key",
      state: "succeeded",
      attemptCount: 1,
      reconciliationCount: 0,
      nextAttemptAt: now,
      leaseGeneration: 1,
      unresolvedExpiresAt: now + 60_000,
      createdAt: now,
      updatedAt: now,
    });
    const billingEconomicsId = await ctx.db.insert("billingPdaxEconomics", {
      organizationId: organization._id,
      paymentIntentId,
      settlementTransactionId,
      quotedCost: "582",
      actualCost: "15",
      passThroughAmount: "20",
      spread: "3",
      failureCost: "0",
      subsidy: "15",
      currency: "PHP",
      idempotencyKey: "historical-economics-key",
      recordedAt: now,
    });
    return {
      paymentIntentId,
      quoteId,
      settlementTransactionId,
      providerConnectionId,
      providerEventId,
      providerOperationId,
      billingEconomicsId,
    };
  });

  const publicConnection = await owner.query(api.provider_connections.query.getByProject, {
    projectId,
  });
  expect(publicConnection).toMatchObject({ status: "connected", username: "historical-user" });
  expect(publicConnection).not.toHaveProperty("accessToken");
  expect(publicConnection).not.toHaveProperty("idToken");
  expect(publicConnection).not.toHaveProperty("refreshToken");

  const historicalIntent = await owner.query(api.payment_intents.queries.getPaymentIntent, {
    paymentIntentId: ids.paymentIntentId,
  });
  expect(historicalIntent).toMatchObject({
    anchor: "pdax",
    status: "paid",
    txHash: "historical-hash",
  });
  const historicalEvent = await t.query(internal.provider_events.mutation.getByEventId, {
    eventId: "historical-event",
  });
  expect(historicalEvent).toMatchObject({ _id: ids.providerEventId, processed: true });
  const retained = await t.run(async (ctx) => ({
    quote: await ctx.db.get(ids.quoteId),
    settlement: await ctx.db.get(ids.settlementTransactionId),
    providerConnection: await ctx.db.get(ids.providerConnectionId),
    providerOperation: await ctx.db.get(ids.providerOperationId),
    economics: await ctx.db.get(ids.billingEconomicsId),
  }));
  expect(retained.quote?.status).toBe("executed");
  expect(retained.settlement?.status).toBe("PAYOUT_SUCCEEDED");
  expect(retained.providerConnection?.refreshToken).toBe("retained-refresh-token");
  expect(retained.providerOperation?.state).toBe("succeeded");
  expect(retained.economics).toMatchObject({ actualCost: "15", currency: "PHP" });
});

test("queued provider workers return disabled results without network configuration", async () => {
  const t = convexTest(schema, modules);
  expect(await t.action(internal.provider_operations.actions.reconcileDue, { limit: 20 })).toEqual({
    claimed: 0,
    resolved: 0,
  });
  expect(await t.action(internal.provider_events.processing.drain, { limit: 20 })).toEqual({
    claimed: 0,
  });
  expect(await t.action(internal.settlement.actions.pollPendingPayouts, {})).toEqual({
    updated: 0,
    total: 0,
  });
});
