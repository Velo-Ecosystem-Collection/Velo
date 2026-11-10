/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";

import { api, internal } from "../_generated/api";
import { classifyPollError } from "../contractEventPolling";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

test("contract event poll errors are logged with sanitized categories", () => {
  expect(classifyPollError(new Error("HTTP 429: secret token abc123"))).toBe("rate_limited");
  expect(classifyPollError(new Error("HTTP 503: secret token abc123"))).toBe("rpc_server_error");
  expect(classifyPollError(new Error("fetch failed: secret token abc123"))).toBe("transport_error");
  expect(classifyPollError(new Error("unexpected RPC failure: secret token abc123"))).toBe(
    "unknown",
  );
});

// Mock the runtime subpath imported by Convex actions.
vi.mock("@repo/stellar/transaction-debugger", () => {
  return {
    lookupTestnetTransaction: vi.fn(),
  };
});

function asWallet(t: ReturnType<typeof convexTest>, ownerAddress: string) {
  return t.withIdentity({
    subject: ownerAddress,
    issuer: "http://localhost:3000",
    tokenIdentifier: `http://localhost:3000|${ownerAddress}`,
  });
}

test("reportSubmitted stores status submitted", async () => {
  const t = convexTest(schema, modules);
  const txHash = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";

  const txId = await t.mutation(api.transactions.mutation.reportSubmitted, {
    hash: txHash,
  });
  expect(txId).toBeDefined();

  const cached = await t.query(internal.transactions.query.getCached, {
    hash: txHash,
  });
  expect(cached).not.toBeNull();
  expect(cached?.status).toBe("submitted");
});

test("getPendingPaymentIntents limits return count", async () => {
  const t = convexTest(schema, modules);
  const ownerAddress = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
  const owner = asWallet(t, ownerAddress);

  const projectId = await owner.mutation(api.projects.mutation.createDraft, {
    name: "Merchant Store",
    slug: "merchant-store-limits",
    description: "Accepting USDC on Stellar",
    metadataJson: "{}",
    metadataHash: "0000000000000000000000000000000000000000000000000000000000000000",
    ownerAddress,
  });

  await owner.mutation(api.projects.mutation.markPaymentAccessActive, {
    id: projectId,
    checkoutCredits: 100,
  });

  const { rawKey } = await owner.mutation(api.projects.mutation.generateApiKey, {
    id: projectId,
    label: "Main API Key",
  });

  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(rawKey));
  const apiKeyHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Create three payment intents and mark them pending
  for (let i = 0; i < 3; i++) {
    const { paymentIntentId } = await t.mutation(
      api.payment_intents.mutations.createPaymentIntent,
      {
        apiKeyHash,
        amount: `10.0${i}`,
        asset: "native",
      },
    );
    await t.mutation(api.payment_intents.mutations.updateStatus, {
      paymentIntentId,
      status: "pending",
      payerAddress: "GDFX...PAYER",
      txHash: `hash-${i}`,
    });
  }

  // Fetch with limit = 2
  const pendingIntents = await t.query(internal.payment_intents.scanner.getPendingPaymentIntents, {
    limit: 2,
  });
  expect(pendingIntents.length).toBe(2);
});

test("storePollResult calculates lag metrics and checkpoints cursor", async () => {
  const t = convexTest(schema, modules);
  const ownerAddress = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
  const owner = asWallet(t, ownerAddress);

  const projectId = await owner.mutation(api.projects.mutation.createDraft, {
    name: "Project Lags",
    slug: "project-lags",
    description: "Accepting USDC on Stellar",
    metadataJson: "{}",
    metadataHash: "0000000000000000000000000000000000000000000000000000000000000000",
    ownerAddress,
  });

  const now = Date.now();
  const eventTime = now - 5000; // 5s ago

  // Store poll results
  await t.mutation(internal.contract_events.mutation.storePollResult, {
    projectId,
    latestLedger: 1005,
    cursor: "cursor-12345",
    events: [
      {
        eventId: "event-1",
        contractId: "C1234",
        transactionHash: "tx-hash-1",
        ledger: 1000,
        timestamp: eventTime,
        topic: "transfer",
        topics: ["transfer"],
        type: "transfer",
        raw: {},
      },
    ],
  });

  // Query poller state
  const scope = `project:${projectId}`;
  const poller = await t.query(internal.poller_state.query.getByScope, {
    scope,
  });

  expect(poller).not.toBeNull();
  expect(poller?.cursor).toBe("cursor-12345");
  expect(poller?.lastLedger).toBe(1005);
  // Ledger lag: latestLedger (1005) - event.ledger (1000) = 5
  expect(poller?.ledgerLag).toBe(5);
  // Time lag: now - eventTime = ~5000ms
  expect(poller?.timeLagMs).toBeGreaterThanOrEqual(4000);
});

test("watchTransaction handles fast confirmation successfully", async () => {
  const t = convexTest(schema, modules);
  const ownerAddress = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
  const owner = asWallet(t, ownerAddress);

  const projectId = await owner.mutation(api.projects.mutation.createDraft, {
    name: "Fast Path Merchant",
    slug: "fast-path",
    description: "Accepting USDC on Stellar",
    metadataJson: "{}",
    metadataHash: "0000000000000000000000000000000000000000000000000000000000000000",
    ownerAddress,
  });

  await owner.mutation(api.projects.mutation.markPaymentAccessActive, {
    id: projectId,
    checkoutCredits: 100,
  });

  const { rawKey } = await owner.mutation(api.projects.mutation.generateApiKey, {
    id: projectId,
    label: "Main API Key",
  });

  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(rawKey));
  const apiKeyHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const { paymentIntentId } = await t.mutation(api.payment_intents.mutations.createPaymentIntent, {
    apiKeyHash,
    amount: "20.00",
    asset: "native",
  });

  // Mock lookupTestnetTransaction to return success on-chain
  const stellarMock = await import("@repo/stellar/transaction-debugger");
  vi.mocked(stellarMock.lookupTestnetTransaction).mockResolvedValueOnce({
    status: "success",
    hash: "tx-hash-ok",
    network: "testnet",
    operations: [
      {
        index: 0,
        type: "payment",
        source: "GDFX...PAYER",
        destination: ownerAddress,
        amount: "20.0000000",
        asset: "native",
      },
    ],
    contractCalls: [],
    events: [],
    rawResponse: "{}",
  });

  // Transition status to pending (should schedule watchTransaction, but we test the action directly here)
  await t.mutation(api.payment_intents.mutations.updateStatus, {
    paymentIntentId,
    status: "pending",
    payerAddress: "GDFX...PAYER",
    txHash: "tx-hash-ok",
  });

  // Run watchTransaction action directly
  const watchResult = await t.action(internal.payment_intents.scanner.watchTransaction, {
    paymentIntentId,
    txHash: "tx-hash-ok",
  });

  expect(watchResult.status).toBe("success");

  // Verify status is now paid
  const intent = await t.query(api.payment_intents.queries.getPaymentIntent, {
    paymentIntentId,
  });
  expect(intent?.status).toBe("paid");
});
