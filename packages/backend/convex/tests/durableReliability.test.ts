import { convexTest } from "convex-test";
/// <reference types="vite/client" />
import { makeFunctionReference } from "convex/server";
import { expect, test, vi } from "vitest";

import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");
const consumeRateLimit = makeFunctionReference<"mutation">("rate_limits/mutations:consume");
const claimReconciliationPage = makeFunctionReference<"mutation">(
  "payment_reconciliation_jobs/mutations:claimDue",
);
const createDelivery = makeFunctionReference<"mutation">(
  "webhook_deliveries/mutation:createPending",
);
const claimDelivery = makeFunctionReference<"mutation">("webhook_deliveries/mutation:claimAttempt");
const finishDelivery = makeFunctionReference<"mutation">("webhook_deliveries/mutation:finish");

async function projectFixture(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("projects", {
      name: "Reliability",
      slug: `reliability-${now}`,
      description: "test",
      metadataJson: "{}",
      metadataHash: "0".repeat(64),
      ownerAddress: "GAFVCOWZWSJEAFOKBEBO2B4QITJ2YXN6YIYG6BUURQINVDVW4OPS3OL6",
      status: "draft",
      createdAt: now,
      updatedAt: now,
    });
  });
}

test("distributed rate limits are shared by concurrent callers", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-13T00:00:00Z"));
  try {
    const t = convexTest(schema, modules);
    const projectId = await projectFixture(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("apiKeys", {
        projectId,
        keyHash: "shared-rate-key",
        prefix: "tk_live_shared",
        label: "shared",
        createdAt: Date.now(),
        requestCount: 0,
        revoked: false,
      });
    });

    const results = await Promise.all(
      Array.from({ length: 201 }, () =>
        t.mutation(consumeRateLimit, { apiKeyHash: "shared-rate-key" }),
      ),
    );
    expect(results.filter((result) => result.authorized && result.allowed)).toHaveLength(200);
    expect(results.filter((result) => result.authorized && !result.allowed)).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});

test("duplicate delivery triggers share one fenced delivery", async () => {
  const t = convexTest(schema, modules);
  const projectId = await projectFixture(t);
  const endpointId = await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("webhookEndpoints", {
      projectId,
      url: "https://merchant.example/webhook",
      destinationHost: "merchant.example",
      enabled: true,
      eventTypes: ["payment.succeeded"],
      createdAt: now,
      updatedAt: now,
    });
  });
  const args = {
    projectId,
    endpointId,
    eventType: "payment.succeeded",
    destinationHost: "merchant.example",
    payloadSummary: { id: "event-1", type: "payment.succeeded" },
    deliveryKey: "event-1:endpoint-1:1",
    eventKey: "event-1",
    schemaVersion: "1",
  };
  const [first, duplicate] = await Promise.all([
    t.mutation(createDelivery, args),
    t.mutation(createDelivery, args),
  ]);
  expect(duplicate).toBe(first);

  const firstClaim = await t.mutation(claimDelivery, {
    deliveryId: first,
    leaseToken: "delivery-lease-1",
    attemptCount: 1,
  });
  const duplicateClaim = await t.mutation(claimDelivery, {
    deliveryId: first,
    leaseToken: "delivery-lease-2",
    attemptCount: 1,
  });
  expect(firstClaim.claimed).toBe(true);
  expect(duplicateClaim.claimed).toBe(false);

  const staleFinish = await t.mutation(finishDelivery, {
    deliveryId: first,
    status: "success",
    leaseToken: "delivery-lease-2",
    leaseGeneration: firstClaim.leaseGeneration,
  });
  expect(staleFinish).toBe(false);
  expect(
    await t.mutation(finishDelivery, {
      deliveryId: first,
      status: "success",
      leaseToken: "delivery-lease-1",
      leaseGeneration: firstClaim.leaseGeneration,
    }),
  ).toBe(true);
});

test("webhook attempts cannot claim before their retry due time", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-13T00:00:00Z"));
  try {
    const t = convexTest(schema, modules);
    const projectId = await projectFixture(t);
    const endpointId = await t.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert("webhookEndpoints", {
        projectId,
        url: "https://merchant.example/webhook",
        destinationHost: "merchant.example",
        enabled: true,
        eventTypes: ["payment.succeeded"],
        createdAt: now,
        updatedAt: now,
      });
    });
    const deliveryId = await t.mutation(createDelivery, {
      projectId,
      endpointId,
      eventType: "payment.succeeded",
      destinationHost: "merchant.example",
      payloadSummary: { id: "event-due", type: "payment.succeeded" },
      nextAttemptAt: Date.now() + 15_000,
    });

    expect(
      await t.mutation(claimDelivery, {
        deliveryId,
        leaseToken: "too-early",
        attemptCount: 2,
      }),
    ).toEqual({ claimed: false });

    vi.advanceTimersByTime(15_000);
    expect(
      await t.mutation(claimDelivery, {
        deliveryId,
        leaseToken: "on-time",
        attemptCount: 2,
      }),
    ).toEqual({ claimed: true, leaseGeneration: 1 });
  } finally {
    vi.useRealTimers();
  }
});

test("10,000 reconciliation jobs drain in exactly 100 bounded pages", async () => {
  const t = convexTest(schema, modules);
  const projectId = await projectFixture(t);
  const paymentIntentId = await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("paymentIntents", {
      projectId,
      amount: "1.00",
      asset: "USDC",
      receiverAddress: "GAFVCOWZWSJEAFOKBEBO2B4QITJ2YXN6YIYG6BUURQINVDVW4OPS3OL6",
      merchantName: "Reliability",
      status: "pending",
      txHash: "a".repeat(64),
      expiresAt: now + 60_000,
      createdAt: now,
      updatedAt: now,
    });
  });

  for (let page = 0; page < 100; page++) {
    await t.run(async (ctx) => {
      const now = Date.now();
      for (let item = 0; item < 100; item++) {
        await ctx.db.insert("paymentReconciliationJobs", {
          paymentIntentId,
          projectId,
          txHash: `${page}-${item}`.padEnd(64, "0"),
          state: "pending",
          attemptCount: 0,
          nextAttemptAt: now,
          leaseGeneration: 0,
          expiresAt: now + 30 * 60_000,
          createdAt: now,
          updatedAt: now,
        });
      }
    });
  }

  let pages = 0;
  let total = 0;
  while (true) {
    const claimed = await t.mutation(claimReconciliationPage, {
      leaseToken: `page-${pages}`,
      limit: 100,
    });
    if (claimed.length === 0) break;
    expect(claimed.length).toBeLessThanOrEqual(100);
    pages++;
    total += claimed.length;
    await t.run(async (ctx) => {
      for (const job of claimed) await ctx.db.delete(job._id);
    });
  }
  expect(total).toBe(10_000);
  expect(pages).toBe(100);
}, 30_000);
