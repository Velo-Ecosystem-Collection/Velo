/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";

import { api, internal } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

async function seedPaymentScope(
  t: ReturnType<typeof convexTest>,
  backend: "convex" | "migrating" | "upstash" = "convex",
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      name: "Action Merchant",
      slug: `action-merchant-${crypto.randomUUID()}`,
      description: "Action test",
      metadataJson: "{}",
      metadataHash: "0".repeat(64),
      ownerAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      status: "registered",
      paymentAccessActive: true,
      defaultPaymentAnchor: "inhouse",
      rateLimitBackend: backend,
      createdAt: now,
      updatedAt: now,
    });
    const apiKeyHash = `hash-${crypto.randomUUID()}`;
    const apiKeyId = await ctx.db.insert("apiKeys", {
      projectId,
      keyHash: apiKeyHash,
      prefix: "tk_live_test",
      label: "Test",
      createdAt: now,
      requestCount: 0,
      revoked: false,
    });
    return { projectId, apiKeyId, apiKeyHash };
  });
}

test("concurrent action retries without a caller idempotency key create one intent", async () => {
  const t = convexTest(schema, modules);
  const { apiKeyHash } = await seedPaymentScope(t);
  const args = {
    apiKeyHash,
    admissionId: "same-admission-id",
    correlationId: "action-retry-0001",
    amount: "10.00",
    asset: "USDC",
  };
  const results = await Promise.all(
    Array.from({ length: 20 }, () => t.action(api.payment_intents.public_api.create, args)),
  );
  expect(results.filter((result) => result.status === "success")).toHaveLength(1);
  expect(results.filter((result) => result.status === "idempotency_replay")).toHaveLength(19);
  const counts = await t.run(async (ctx) => ({
    intents: (await ctx.db.query("paymentIntents").collect()).length,
    idempotency: (await ctx.db.query("paymentIntentIdempotencyKeys").collect()).length,
    routeJobs: (await ctx.db.query("paymentIntentRouteJobs").collect()).length,
  }));
  expect(counts).toEqual({ intents: 1, idempotency: 1, routeJobs: 0 });
});

test("retirement blocks new payment intents but preserves checkout replay and authenticated reads", async () => {
  const t = convexTest(schema, modules);
  const scope = await seedPaymentScope(t);
  const ownerAddress = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
  const owner = t.withIdentity({
    subject: ownerAddress,
    issuer: "http://localhost:3000",
    tokenIdentifier: "http://localhost:3000|" + ownerAddress,
  });
  const args = {
    apiKeyHash: scope.apiKeyHash,
    admissionId: "retirement-existing-checkout",
    correlationId: "retirement-checkout-0001",
    amount: "10.00",
    asset: "USDC",
    idempotencyKey: "checkout-before-retirement",
  };
  const created = await t.action(api.payment_intents.public_api.create, args);
  expect(created.status).toBe("success");
  if (created.status !== "success") throw new Error("Expected a created payment intent");

  await owner.mutation(api.projects.mutation.retire, {
    id: scope.projectId,
    confirmationName: "Action Merchant",
  });

  const replay = await t.action(api.payment_intents.public_api.create, args);
  expect(replay.status).toBe("idempotency_replay");
  const newIntent = await t.action(api.payment_intents.public_api.create, {
    ...args,
    admissionId: "retirement-new-checkout",
    correlationId: "retirement-checkout-0002",
    idempotencyKey: "checkout-after-retirement",
  });
  expect(newIntent.status).toBe("unauthorized");

  const retrieved = await t.action(api.payment_intents.public_api.retrieve, {
    apiKeyHash: scope.apiKeyHash,
    admissionId: "retirement-checkout-read",
    paymentIntentId: created.intent._id,
  });
  expect(retrieved.status).toBe("success");
  if (retrieved.status === "success") expect(retrieved.intent?._id).toBe(created.intent._id);

  await t.mutation(api.payment_intents.mutations.updateStatus, {
    paymentIntentId: created.intent._id,
    status: "pending",
    payerAddress: "GDFX...PAYER",
  });
  const intent = await t.query(api.payment_intents.queries.getPaymentIntent, {
    paymentIntentId: created.intent._id,
  });
  expect(intent?.status).toBe("pending");

  const state = await t.run(async (ctx) => ({
    intents: await ctx.db.query("paymentIntents").collect(),
    revocations: await ctx.db.query("apiKeys").collect(),
  }));
  expect(state.intents).toHaveLength(1);
  expect(state.revocations[0]?.revoked).toBe(false);
});

test("migrating and unconfigured Upstash projects fail closed", async () => {
  const t = convexTest(schema, modules);
  const migrating = await seedPaymentScope(t, "migrating");
  const upstash = await seedPaymentScope(t, "upstash");
  const create = (apiKeyHash: string, admissionId: string) =>
    t.action(api.payment_intents.public_api.create, {
      apiKeyHash,
      admissionId,
      amount: "5.00",
      asset: "USDC",
    });
  expect((await create(migrating.apiKeyHash, "migrating-request")).status).toBe(
    "limiter_unavailable",
  );
  expect((await create(upstash.apiKeyHash, "upstash-request")).status).toBe("limiter_unavailable");
  expect(await t.run(async (ctx) => (await ctx.db.query("paymentIntents").collect()).length)).toBe(
    0,
  );
});

test("cutover enters a fail-closed migrating state before scheduling the backend switch", async () => {
  const t = convexTest(schema, modules);
  const { projectId } = await seedPaymentScope(t);
  const result = await t.mutation(internal.rate_limits.cutover.begin, {
    projectId,
    targetBackend: "upstash",
  });
  expect(result.status).toBe("migrating");
  const state = await t.run(async (ctx) => ({
    project: await ctx.db.get(projectId),
    scheduled: await ctx.db.system.query("_scheduled_functions").collect(),
  }));
  expect(state.project?.rateLimitBackend).toBe("migrating");
  expect(state.scheduled.some((job) => job.name.includes("rate_limits/cutover:finish"))).toBe(true);
});
