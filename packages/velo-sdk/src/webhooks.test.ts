import crypto from "crypto";
import assert from "node:assert/strict";
import test from "node:test";

import { Velo } from "./client.ts";
import { VeloWebhookSignatureVerificationError } from "./errors.ts";
import { verifyWebhookSignature } from "./webhooks.ts";

function generateTestSignatureHeader(payload: string, secret: string, timestamp: number): string {
  const signaturePayload = `${timestamp}.${payload}`;
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(signaturePayload);
  const hash = hmac.digest("hex");
  return `t=${timestamp},v1=${hash}`;
}

const webhookSecret = "whsec_testsecret12345";

function baseEvent(type: string, extra: Record<string, unknown> = {}) {
  return {
    version: "1",
    id: "evt_sprint8",
    type,
    test: true,
    sentAt: new Date().toISOString(),
    project: {
      id: "proj_123",
      registryProjectId: "reg_123",
      name: "Test Project",
      slug: "test-project",
    },
    ...extra,
  };
}

async function verifyObject(event: Record<string, unknown>) {
  const payload = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  return verifyWebhookSignature({
    payload,
    signature: generateTestSignatureHeader(payload, webhookSecret, timestamp),
    secret: webhookSecret,
  });
}

test("verifyWebhookSignature parses valid signature and payload", async () => {
  const secret = "whsec_testsecret12345";
  const payload = JSON.stringify({
    id: "evt_123",
    type: "payment.succeeded",
    test: true,
    sentAt: new Date().toISOString(),
    project: {
      id: "proj_123",
      registryProjectId: "reg_123",
      name: "Test Project",
      slug: "test-project",
    },
    paymentIntent: {
      id: "pi_123",
      amount: "10.00",
      asset: "USDC",
      receiverAddress: "GBA...",
      merchantName: "Merchant Name",
      description: "Test description",
      status: "paid",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const signatureHeader = generateTestSignatureHeader(payload, secret, timestamp);

  // Directly calling verifyWebhookSignature helper
  const event = await verifyWebhookSignature({
    payload,
    signature: signatureHeader,
    secret,
  });

  assert.equal(event.id, "evt_123");
  assert.equal(event.version, "1");
  assert.equal(event.type, "payment.succeeded");
  assert.equal(event.test, true);
  if (event.type === "payment.succeeded") {
    assert.equal(event.paymentIntent.id, "pi_123");
    assert.equal(event.paymentIntent.amount, "10.00");
  } else {
    assert.fail("Event type should be payment.succeeded");
  }

  // Testing Velo static verification
  const staticEvent = await Velo.webhooks.verify({
    payload,
    signature: signatureHeader,
    secret,
  });
  assert.equal(staticEvent.id, "evt_123");

  // Testing Velo instance verification
  const velo = new Velo({ apiKey: "test-key" });
  const instanceEvent = await velo.webhooks.verify({
    payload,
    signature: signatureHeader,
    secret,
  });
  assert.equal(instanceEvent.id, "evt_123");
});

test("verifyWebhookSignature normalizes a signed legacy event to version 1", async () => {
  const legacy = baseEvent("settlement.trade.executed", {
    trade: { orderId: 42, quoteId: "quote_42", status: "successful" },
  });
  delete (legacy as { version?: string }).version;

  const event = await verifyObject(legacy);
  assert.equal(event.version, "1");
  assert.equal(event.type, "settlement.trade.executed");
  if (event.type === "settlement.trade.executed") assert.equal(event.trade.orderId, 42);
});

test("verifyWebhookSignature accepts settlement and provider event payloads", async () => {
  const withdrawal = await verifyObject(
    baseEvent("settlement.withdrawal.pending", {
      withdrawal: {
        withdrawalId: "withdrawal_123",
        referenceNumber: "ref_123",
        amount: 5_820,
        status: "PENDING",
      },
    }),
  );
  assert.equal(withdrawal.type, "settlement.withdrawal.pending");
  if (withdrawal.type === "settlement.withdrawal.pending") {
    assert.equal(withdrawal.withdrawal.withdrawalId, "withdrawal_123");
  }

  const provider = await verifyObject(
    baseEvent("provider.pdax.event.received", {
      provider: "pdax",
      eventId: "pdax_evt_123",
      eventType: "WITHDRAWAL",
      rawEvent: { status: "COMPLETED" },
    }),
  );
  assert.equal(provider.type, "provider.pdax.event.received");
  if (provider.type === "provider.pdax.event.received") {
    assert.equal(provider.eventId, "pdax_evt_123");
  }
});

test("verifyWebhookSignature rejects signed malformed events", async () => {
  await assert.rejects(
    () => verifyObject(baseEvent("settlement.trade.executed", { trade: { quoteId: "q_1" } })),
    (err: unknown) => {
      assert.equal(err instanceof VeloWebhookSignatureVerificationError, true);
      assert.match((err as Error).message, /trade fields are invalid/);
      return true;
    },
  );
});

test("verifyWebhookSignature verifies HMAC before rejecting unsupported versions", async () => {
  const unsupported = baseEvent("settlement.trade.executed", {
    version: "2",
    trade: { orderId: 42, quoteId: "quote_42" },
  });
  const payload = JSON.stringify(unsupported);
  const timestamp = Math.floor(Date.now() / 1000);

  await assert.rejects(
    () =>
      verifyWebhookSignature({
        payload,
        signature: generateTestSignatureHeader(payload, "wrong-secret", timestamp),
        secret: webhookSecret,
      }),
    (err: unknown) => {
      assert.equal((err as Error).message, "Signature mismatch");
      return true;
    },
  );

  await assert.rejects(
    () =>
      verifyWebhookSignature({
        payload,
        signature: generateTestSignatureHeader(payload, webhookSecret, timestamp),
        secret: webhookSecret,
      }),
    (err: unknown) => {
      assert.match((err as Error).message, /unsupported version 2/);
      return true;
    },
  );
});

test("verifyWebhookSignature rejects missing signature header", async () => {
  const secret = "whsec_testsecret12345";
  const payload = JSON.stringify({ type: "payment.succeeded" });

  await assert.rejects(
    () => verifyWebhookSignature({ payload, signature: null, secret }),
    (err: unknown) => {
      assert.equal(err instanceof VeloWebhookSignatureVerificationError, true);
      assert.equal(
        (err as VeloWebhookSignatureVerificationError).message,
        "Missing signature header",
      );
      return true;
    },
  );
});

test("verifyWebhookSignature rejects malformed headers", async () => {
  const secret = "whsec_testsecret12345";
  const payload = JSON.stringify({ type: "payment.succeeded" });

  await assert.rejects(
    () => verifyWebhookSignature({ payload, signature: "invalid-header", secret }),
    (err: unknown) => {
      assert.equal(err instanceof VeloWebhookSignatureVerificationError, true);
      assert.equal(
        (err as VeloWebhookSignatureVerificationError).message,
        "Invalid signature header format",
      );
      return true;
    },
  );

  await assert.rejects(
    () => verifyWebhookSignature({ payload, signature: "t=123", secret }),
    (err: unknown) => {
      assert.equal(err instanceof VeloWebhookSignatureVerificationError, true);
      assert.equal(
        (err as VeloWebhookSignatureVerificationError).message,
        "Invalid signature header format",
      );
      return true;
    },
  );
});

test("verifyWebhookSignature rejects noncanonical or duplicate header values", async () => {
  const secret = "whsec_testsecret12345";
  const payload = JSON.stringify({ type: "payment.succeeded" });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = generateTestSignatureHeader(payload, secret, timestamp).split(",")[1];
  assert.ok(signature);

  for (const signatureHeader of [
    `t=${timestamp}suffix,${signature}`,
    `t=0${timestamp},${signature}`,
    `t=${timestamp},${signature},t=${timestamp}`,
    `t=${timestamp},${signature},v1=${"0".repeat(64)}`,
  ]) {
    await assert.rejects(
      () => verifyWebhookSignature({ payload, signature: signatureHeader, secret }),
      (error: unknown) => {
        assert.equal(error instanceof VeloWebhookSignatureVerificationError, true);
        assert.equal((error as Error).message, "Invalid signature header format");
        return true;
      },
    );
  }
});

test("verifyWebhookSignature rejects invalid freshness tolerances", async () => {
  const payload = JSON.stringify({ type: "payment.succeeded" });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = generateTestSignatureHeader(payload, webhookSecret, timestamp);

  for (const toleranceSeconds of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(
      () => verifyWebhookSignature({ payload, signature, secret: webhookSecret, toleranceSeconds }),
      (error: unknown) => {
        assert.equal(error instanceof VeloWebhookSignatureVerificationError, true);
        assert.equal(
          (error as Error).message,
          "Timestamp tolerance must be a finite non-negative number",
        );
        return true;
      },
    );
  }
});

test("verifyWebhookSignature rejects invalid runtime inputs and oversized headers", async () => {
  const payload = JSON.stringify({ type: "payment.succeeded" });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = generateTestSignatureHeader(payload, webhookSecret, timestamp);

  for (const params of [
    null,
    { payload: 1, signature, secret: webhookSecret },
    { payload, signature, secret: null },
    { payload, signature: `${signature},${"x".repeat(512)}`, secret: webhookSecret },
  ]) {
    await assert.rejects(
      () => verifyWebhookSignature(params as never),
      VeloWebhookSignatureVerificationError,
    );
  }
});

test("verifyWebhookSignature accepts a replay within tolerance for caller deduplication", async () => {
  const event = baseEvent("payment.succeeded", {
    paymentIntent: {
      id: "pi_replayed",
      amount: "10.00",
      asset: "USDC",
      merchantName: "Example",
      status: "paid",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  });
  const payload = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = generateTestSignatureHeader(payload, webhookSecret, timestamp);
  const params = { payload, signature, secret: webhookSecret };

  const first = await verifyWebhookSignature(params);
  const replay = await verifyWebhookSignature(params);
  assert.equal(first.id, replay.id);
});

test("verifyWebhookSignature rejects expired timestamps", async () => {
  const secret = "whsec_testsecret12345";
  const payload = JSON.stringify({ type: "payment.succeeded" });
  const timestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago (tolerance default is 5 mins)
  const signatureHeader = generateTestSignatureHeader(payload, secret, timestamp);

  await assert.rejects(
    () => verifyWebhookSignature({ payload, signature: signatureHeader, secret }),
    (err: unknown) => {
      assert.equal(err instanceof VeloWebhookSignatureVerificationError, true);
      assert.match((err as VeloWebhookSignatureVerificationError).message, /timestamp expired/);
      return true;
    },
  );
});

test("verifyWebhookSignature rejects future timestamps", async () => {
  const secret = "whsec_testsecret12345";
  const payload = JSON.stringify({ type: "payment.succeeded" });
  const timestamp = Math.floor(Date.now() / 1000) + 600; // 10 minutes in the future
  const signatureHeader = generateTestSignatureHeader(payload, secret, timestamp);

  await assert.rejects(
    () => verifyWebhookSignature({ payload, signature: signatureHeader, secret }),
    (err: unknown) => {
      assert.equal(err instanceof VeloWebhookSignatureVerificationError, true);
      assert.match((err as VeloWebhookSignatureVerificationError).message, /timestamp expired/);
      return true;
    },
  );
});

test("verifyWebhookSignature rejects signature mismatch", async () => {
  const secret = "whsec_testsecret12345";
  const payload = JSON.stringify({ type: "payment.succeeded" });
  const timestamp = Math.floor(Date.now() / 1000);
  const signatureHeader = generateTestSignatureHeader(payload, secret, timestamp);

  // Mismatched secret
  await assert.rejects(
    () =>
      verifyWebhookSignature({ payload, signature: signatureHeader, secret: "whsec_wrongsecret" }),
    (err: unknown) => {
      assert.equal(err instanceof VeloWebhookSignatureVerificationError, true);
      assert.equal((err as VeloWebhookSignatureVerificationError).message, "Signature mismatch");
      return true;
    },
  );

  // Mismatched payload (tampering)
  await assert.rejects(
    () =>
      verifyWebhookSignature({ payload: payload + "altered", signature: signatureHeader, secret }),
    (err: unknown) => {
      assert.equal(err instanceof VeloWebhookSignatureVerificationError, true);
      assert.equal((err as VeloWebhookSignatureVerificationError).message, "Signature mismatch");
      return true;
    },
  );
});
