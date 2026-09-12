/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";

import { api, internal } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

function asWallet(t: ReturnType<typeof convexTest>, ownerAddress: string) {
  return t.withIdentity({
    subject: ownerAddress,
    issuer: "http://localhost:3000",
    tokenIdentifier: `http://localhost:3000|${ownerAddress}`,
  });
}

test("webhook endpoint secret rotation", async () => {
  const t = convexTest(schema, modules);

  const ownerAddress = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
  const owner = asWallet(t, ownerAddress);

  // Create a draft project
  const projectId = await owner.mutation(api.projects.mutation.createDraft, {
    name: "Merchant Store",
    slug: "merchant-store",
    description: "Accepting USDC on Stellar",
    metadataJson: "{}",
    metadataHash: "0000000000000000000000000000000000000000000000000000000000000000",
    ownerAddress,
  });

  // Save webhook settings (this creates the endpoint and generates a secret)
  await owner.mutation(api.webhook_endpoints.mutation.saveSettings, {
    projectId,
    url: "https://api.example.com/webhook",
    enabled: true,
    eventTypes: ["payment.succeeded"],
  });

  const settings = await owner.query(api.webhook_endpoints.query.getSettings, {
    projectId,
  });
  expect(settings).toBeDefined();
  expect(settings?.signingSecret).toBeDefined();
  const initialSecret = settings!.signingSecret;

  // Rotate secret
  await owner.mutation(api.webhook_endpoints.mutation.rotateSecret, {
    projectId,
  });

  const settingsRotated = await owner.query(api.webhook_endpoints.query.getSettings, {
    projectId,
  });
  expect(settingsRotated?.signingSecret).toBeDefined();
  expect(settingsRotated!.signingSecret).not.toBe(initialSecret);
});

test("webhook delivery retry and backoff lifecycle", async () => {
  const t = convexTest(schema, modules);

  const ownerAddress = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
  const owner = asWallet(t, ownerAddress);

  const projectId = await owner.mutation(api.projects.mutation.createDraft, {
    name: "Merchant Store Webhooks",
    slug: "merchant-store-webhooks",
    description: "Testing retries",
    metadataJson: "{}",
    metadataHash: "0000000000000000000000000000000000000000000000000000000000000000",
    ownerAddress,
  });

  await owner.mutation(api.webhook_endpoints.mutation.saveSettings, {
    projectId,
    url: "https://api.example.com/webhook",
    enabled: true,
    eventTypes: ["payment.succeeded"],
  });

  // Set up mock fetch that fails
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount++;
    throw new Error("Connection failed");
  };

  try {
    // 1. Initial attempt fails
    await t.action(internal.webhookDelivery.trigger, {
      projectId,
      eventType: "payment.succeeded",
    });

    // Check delivery logs
    let deliveries = await owner.query(api.webhook_deliveries.query.listByProject, {
      projectId,
      limit: 10,
    });
    expect(deliveries.length).toBe(1);
    expect(deliveries[0].status).toBe("pending");
    expect(deliveries[0].attemptCount).toBe(1);
    expect(deliveries[0].errorMessage).toBe("webhook_network_error");

    const deliveryId = deliveries[0]._id;

    // 2. Run a retry (e.g. attempt 2)
    await t.run(async (ctx) => {
      await ctx.db.patch(deliveryId, { nextAttemptAt: Date.now() });
    });
    await t.action(internal.webhookDelivery.trigger, {
      projectId,
      eventType: "payment.succeeded",
      deliveryId,
      attemptCount: 2,
    });

    deliveries = await owner.query(api.webhook_deliveries.query.listByProject, {
      projectId,
      limit: 10,
    });
    expect(deliveries[0].attemptCount).toBe(2);
    expect(deliveries[0].status).toBe("pending");

    // 3. Run final attempt 5 that fails, transitions to failed
    await t.run(async (ctx) => {
      await ctx.db.patch(deliveryId, { nextAttemptAt: Date.now() });
    });
    await t.action(internal.webhookDelivery.trigger, {
      projectId,
      eventType: "payment.succeeded",
      deliveryId,
      attemptCount: 5,
    });

    deliveries = await owner.query(api.webhook_deliveries.query.listByProject, {
      projectId,
      limit: 10,
    });
    expect(deliveries[0].attemptCount).toBe(5);
    expect(deliveries[0].status).toBe("failed");
    expect(deliveries[0].deadLetter).toBe(true);

    const fetchCountAtTerminal = fetchCount;
    await t.action(internal.webhookDelivery.trigger, {
      projectId,
      eventType: "payment.succeeded",
      deliveryId,
      attemptCount: 6,
    });
    expect(fetchCount).toBe(fetchCountAtTerminal);

    // 4. Test a successful delivery
    // Reset mock fetch to succeed
    globalThis.fetch = async () => {
      return {
        ok: true,
        status: 200,
      } as Response;
    };

    // Trigger new webhook delivery
    await t.action(internal.webhookDelivery.trigger, {
      projectId,
      eventType: "payment.succeeded",
    });

    deliveries = await owner.query(api.webhook_deliveries.query.listByProject, {
      projectId,
      limit: 10,
    });
    expect(deliveries[0].status).toBe("success");
    expect(deliveries[0].attemptCount).toBe(1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("scheduled delivery contains invalid legacy endpoints in the retry lifecycle", async () => {
  const t = convexTest(schema, modules);
  const ownerAddress = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
  const owner = asWallet(t, ownerAddress);
  const projectId = await owner.mutation(api.projects.mutation.createDraft, {
    name: "Legacy Webhook Merchant",
    slug: "legacy-webhook-merchant",
    description: "Testing legacy webhook delivery",
    metadataJson: "{}",
    metadataHash: "0000000000000000000000000000000000000000000000000000000000000000",
    ownerAddress,
  });

  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("webhookEndpoints", {
      projectId,
      // Older data can predate the current HTTPS/loopback validation.
      url: "http://localhost:3000/webhook",
      destinationHost: "localhost:3000",
      enabled: true,
      eventTypes: ["payment.succeeded"],
      createdAt: now,
      updatedAt: now,
    });
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("Convex cannot reach localhost");
  };

  try {
    await expect(
      t.action(internal.webhookDelivery.trigger, {
        projectId,
        eventType: "payment.succeeded",
      }),
    ).resolves.toBeNull();

    const deliveries = await owner.query(api.webhook_deliveries.query.listByProject, {
      projectId,
      limit: 10,
    });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe("pending");
    expect(deliveries[0].errorMessage).toBe("webhook_network_error");
    expect(deliveries[0].nextAttemptAt).toBeDefined();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("webhook retry scheduling honors Retry-After for retryable endpoint failures", async () => {
  const t = convexTest(schema, modules);

  const ownerAddress = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
  const owner = asWallet(t, ownerAddress);

  const projectId = await owner.mutation(api.projects.mutation.createDraft, {
    name: "Retry After Merchant",
    slug: "retry-after-merchant",
    description: "Testing retry-after scheduling",
    metadataJson: "{}",
    metadataHash: "0000000000000000000000000000000000000000000000000000000000000000",
    ownerAddress,
  });

  await owner.mutation(api.webhook_endpoints.mutation.saveSettings, {
    projectId,
    url: "https://api.example.com/webhook",
    enabled: true,
    eventTypes: ["payment.succeeded"],
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response("", {
      status: 429,
      headers: { "Retry-After": "7" },
    });
  };

  try {
    const before = Date.now();
    await t.action(internal.webhookDelivery.trigger, {
      projectId,
      eventType: "payment.succeeded",
    });

    const deliveries = await owner.query(api.webhook_deliveries.query.listByProject, {
      projectId,
      limit: 10,
    });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe("pending");
    expect(deliveries[0].httpStatus).toBe(429);
    expect(deliveries[0].nextAttemptAt).toBeGreaterThanOrEqual(before + 7_000);
    expect(deliveries[0].nextAttemptAt).toBeLessThan(before + 8_500);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("webhook delivery preserves correlation ID in storage, payload, and headers", async () => {
  const t = convexTest(schema, modules);
  const ownerAddress = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
  const owner = asWallet(t, ownerAddress);
  const projectId = await owner.mutation(api.projects.mutation.createDraft, {
    name: "Correlation Merchant",
    slug: "correlation-merchant",
    description: "Webhook correlation test",
    metadataJson: "{}",
    metadataHash: "0000000000000000000000000000000000000000000000000000000000000000",
    ownerAddress,
  });
  await owner.mutation(api.webhook_endpoints.mutation.saveSettings, {
    projectId,
    url: "https://api.example.com/webhook",
    enabled: true,
    eventTypes: ["payment.succeeded"],
  });

  const originalFetch = globalThis.fetch;
  let receivedCorrelationId: string | null = null;
  let payloadCorrelationId: string | undefined;
  globalThis.fetch = async (_url, init) => {
    const headers = new Headers(init?.headers);
    receivedCorrelationId = headers.get("x-correlation-id");
    payloadCorrelationId = JSON.parse(String(init?.body)).correlationId;
    return { ok: true, status: 200 } as Response;
  };

  try {
    await owner.action(api.webhookDelivery.sendTest, {
      projectId,
      eventType: "payment.succeeded",
      correlationId: "Bearer tk_live_should_not_echo",
    });
    const generatedCorrelationId = receivedCorrelationId;
    expect(generatedCorrelationId).not.toBe("Bearer tk_live_should_not_echo");
    expect(generatedCorrelationId).toMatch(/^[0-9a-f-]{36}$/);

    await owner.action(api.webhookDelivery.sendTest, {
      projectId,
      eventType: "payment.succeeded",
      correlationId: "pay-2026-webhook-0001",
    });
    const deliveries = await owner.query(api.webhook_deliveries.query.listByProject, {
      projectId,
      limit: 10,
    });
    expect(deliveries[0].correlationId).toBe("pay-2026-webhook-0001");
    expect(receivedCorrelationId).toBe("pay-2026-webhook-0001");
    expect(payloadCorrelationId).toBe("pay-2026-webhook-0001");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
