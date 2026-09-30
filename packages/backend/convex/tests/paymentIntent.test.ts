/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";

import type { Doc, Id } from "../_generated/dataModel";

import { api, internal } from "../_generated/api";
import { STATUS_TRANSITIONS } from "../payment_intents/helpers";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

function asWallet(t: ReturnType<typeof convexTest>, ownerAddress: string) {
  return t.withIdentity({
    subject: ownerAddress,
    issuer: "http://localhost:3000",
    tokenIdentifier: `http://localhost:3000|${ownerAddress}`,
  });
}

test("payment intent lifecycle", async () => {
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

  // Verify project defaults to paymentAccessActive undefined/null or false
  let project = await owner.query(api.projects.query.getById, {
    id: projectId,
  });
  expect(project?.paymentAccessActive).toBeFalsy();

  // Activate payment access using the proper mutation
  await owner.mutation(api.projects.mutation.markPaymentAccessActive, {
    id: projectId,
    checkoutCredits: 100,
  });

  const scheduledBeforeCreate = await t.run(
    async (ctx) => await ctx.db.system.query("_scheduled_functions").collect(),
  );

  // Generate API key
  const { rawKey } = await owner.mutation(api.projects.mutation.generateApiKey, {
    id: projectId,
    label: "Main API Key",
  });

  const encoder = new TextEncoder();
  const data = encoder.encode(rawKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const apiKeyHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

  // Verify the key and fetch project data
  const verification = await t.query(api.projects.query.verifyApiKeyAndGetProject, {
    apiKeyHash,
  });
  expect(verification.authorized).toBe(true);
  expect(verification.project?.name).toBe("Merchant Store");
  expect(verification.project?.paymentAccessActive).toBe(true);

  // Create a payment intent using the public mutation
  const { paymentIntentId } = await t.mutation(api.payment_intents.mutations.createPaymentIntent, {
    apiKeyHash,
    correlationId: "pay-2026-lifecycle-0001",
    amount: "150.50",
    asset: "native",
    description: "Order #44591",
    successUrl: "https://merchant.xyz/success",
    cancelUrl: "https://merchant.xyz/cancel",
  });

  const scheduledAfterCreate = await t.run(
    async (ctx) => await ctx.db.system.query("_scheduled_functions").collect(),
  );
  expect(scheduledAfterCreate).toHaveLength(scheduledBeforeCreate.length + 1);
  expect(
    scheduledAfterCreate.some((scheduled) => scheduled.name.includes("billing/shadow:evaluate")),
  ).toBe(true);

  // Retrieve the payment intent
  let intent = await t.query(api.payment_intents.queries.getPaymentIntent, {
    paymentIntentId,
  });
  expect(intent).toBeDefined();
  expect(intent?.status).toBe("created");
  expect(intent?.amount).toBe("150.50");
  expect(intent?.merchantName).toBe("Merchant Store");
  expect(intent?.correlationId).toBe("pay-2026-lifecycle-0001");
  expect(intent?.network).toBe("testnet");
  expect(intent?.intentType).toBe("merchant_payment");

  // Transition to pending state
  const payerAddress = "GDFX...PAYER";
  await t.mutation(api.payment_intents.mutations.updateStatus, {
    paymentIntentId,
    status: "pending",
    payerAddress,
  });

  intent = await t.query(api.payment_intents.queries.getPaymentIntent, {
    paymentIntentId,
  });
  expect(intent?.status).toBe("pending");
  expect(intent?.payerAddress).toBe(payerAddress);

  // Public checkout clients cannot transition directly to paid.
  const txHash = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
  await expect(
    t.mutation(api.payment_intents.mutations.updateStatus, {
      paymentIntentId,
      status: "paid",
      txHash,
    }),
  ).rejects.toThrow("Public mutation cannot mark payment intent paid");

  intent = await t.query(api.payment_intents.queries.getPaymentIntent, {
    paymentIntentId,
  });
  expect(intent?.status).toBe("pending");

  // Verified backend confirmation is the only paid transition.
  await t.mutation(internal.payment_intents.mutations.markVerifiedPaid, {
    paymentIntentId,
    txHash,
    verifiedPayment: {
      source: payerAddress,
      destination: ownerAddress,
      amount: "150.5000000",
      asset: "native",
    },
  });

  intent = await t.query(api.payment_intents.queries.getPaymentIntent, {
    paymentIntentId,
  });
  expect(intent?.status).toBe("paid");
  expect(intent?.txHash).toBe(txHash);

  await owner.mutation(api.webhook_endpoints.mutation.saveSettings, {
    projectId,
    url: "https://api.example.com/webhook",
    enabled: true,
    eventTypes: ["payment.succeeded"],
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200 }) as Response;
  try {
    await t.action(internal.webhookDelivery.trigger, {
      projectId,
      eventType: "payment.succeeded",
      paymentIntentId,
      correlationId: "pay-2026-lifecycle-0001",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const lifecycle = await owner.query(
    api.payment_intents.queries.getProjectPaymentLifecycleByCorrelation,
    {
      projectId,
      correlationId: "pay-2026-lifecycle-0001",
    },
  );
  expect(lifecycle).not.toBeNull();
  if (!lifecycle) throw new Error("expected authorized lifecycle trace");
  expect(lifecycle.paymentIntents).toEqual([
    expect.objectContaining({ id: paymentIntentId, status: "paid", transactionHash: txHash }),
  ]);
  expect(lifecycle.webhookDeliveries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        paymentIntentId,
        eventType: "payment.succeeded",
        status: "success",
      }),
    ]),
  );
  expect(lifecycle.stages.map((stage) => stage.name)).toContain("payment_intent.paid");
  expect(lifecycle.stages.map((stage) => stage.name)).toContain("webhook.success");

  await expect(
    t.query(api.payment_intents.queries.getProjectPaymentLifecycleByCorrelation, {
      projectId,
      correlationId: "pay-2026-lifecycle-0001",
    }),
  ).rejects.toThrow("Not authenticated");

  const otherOwnerAddress = "GBCX...OTHER";
  const otherOwner = asWallet(t, otherOwnerAddress);
  await otherOwner.mutation(api.projects.mutation.createDraft, {
    name: "Other Merchant",
    slug: "other-merchant",
    description: "Cross-project trace access test",
    metadataJson: "{}",
    metadataHash: "1111111111111111111111111111111111111111111111111111111111111111",
    ownerAddress: otherOwnerAddress,
  });
  expect(
    await otherOwner.query(api.payment_intents.queries.getProjectPaymentLifecycleByCorrelation, {
      projectId,
      correlationId: "pay-2026-lifecycle-0001",
    }),
  ).toBeNull();

  // Listing by project
  const intentsList = await owner.query(api.payment_intents.queries.listByProject, {
    projectId,
    limit: 10,
  });
  expect(intentsList.length).toBe(1);
  expect(intentsList[0]._id).toBe(paymentIntentId);
});

test("payment intent creation allows omitted redirect urls", async () => {
  const t = convexTest(schema, modules);

  const ownerAddress = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
  const owner = asWallet(t, ownerAddress);
  const projectId = await owner.mutation(api.projects.mutation.createDraft, {
    name: "Merchant Store",
    slug: "merchant-store-no-urls",
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
  const data = encoder.encode(rawKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const apiKeyHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

  const { paymentIntentId } = await t.mutation(api.payment_intents.mutations.createPaymentIntent, {
    apiKeyHash,
    amount: "10.00",
    asset: "native",
    description: "Test payment",
  });

  const intent = await t.query(api.payment_intents.queries.getPaymentIntent, {
    paymentIntentId,
  });
  expect(intent?.amount).toBe("10.00");
  expect(intent?.description).toBe("Test payment");
  expect(intent?.successUrl).toBeUndefined();
  expect(intent?.cancelUrl).toBeUndefined();
});

test("payment intent stats aggregation and scanner execution", async () => {
  const t = convexTest(schema, modules);

  const ownerAddress = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
  const owner = asWallet(t, ownerAddress);
  const projectId = await owner.mutation(api.projects.mutation.createDraft, {
    name: "Merchant Store Stats",
    slug: "merchant-store-stats",
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
  const data = encoder.encode(rawKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const apiKeyHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

  // Create two payment intents
  const { paymentIntentId: pi1 } = await t.mutation(
    api.payment_intents.mutations.createPaymentIntent,
    {
      apiKeyHash,
      amount: "50.00",
      asset: "native",
      description: "First stats payment",
    },
  );

  const { paymentIntentId: pi2 } = await t.mutation(
    api.payment_intents.mutations.createPaymentIntent,
    {
      apiKeyHash,
      amount: "100.00",
      asset: "USDC:GBX",
      description: "Second stats payment",
    },
  );

  // Verify status counts are initially showing created state
  let stats = await owner.query(api.payment_intents.queries.getProjectStats, {
    projectId,
  });
  expect(stats?.counts.total).toBe(2);
  expect(stats?.counts.created).toBe(2);
  expect(stats?.counts.paid).toBe(0);

  // Transition pi1 to pending
  await t.mutation(api.payment_intents.mutations.updateStatus, {
    paymentIntentId: pi1,
    status: "pending",
    payerAddress: "GDFX...PAYER",
    txHash: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  });

  // Transition pi2 to paid through verified backend confirmation.
  await t.mutation(api.payment_intents.mutations.updateStatus, {
    paymentIntentId: pi2,
    status: "pending",
    payerAddress: "GDFX...PAYER",
  });
  await t.mutation(internal.payment_intents.mutations.markVerifiedPaid, {
    paymentIntentId: pi2,
    txHash: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    verifiedPayment: {
      source: "GDFX...PAYER",
      destination: ownerAddress,
      amount: "100.0000000",
      asset: "USDC:GBX",
    },
  });

  // Verify updated status counts and volume
  stats = await owner.query(api.payment_intents.queries.getProjectStats, {
    projectId,
  });
  expect(stats?.counts.paid).toBe(1);
  expect(stats?.counts.pending).toBe(1);

  // Volume should reflect 100 USDC (since only USDC intent was paid)
  expect(stats?.volumes).toContainEqual({ asset: "USDC", volume: 100.0 });
});

async function sha256Hex(value: string) {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function createPaymentReadyProject(
  t: ReturnType<typeof convexTest>,
  args: { ownerAddress: string; name: string; slug: string },
) {
  const owner = asWallet(t, args.ownerAddress);
  const projectId = await owner.mutation(api.projects.mutation.createDraft, {
    name: args.name,
    slug: args.slug,
    description: "Accepting USDC on Stellar",
    metadataJson: "{}",
    metadataHash: "0000000000000000000000000000000000000000000000000000000000000000",
    ownerAddress: args.ownerAddress,
  });

  await owner.mutation(api.projects.mutation.markPaymentAccessActive, {
    id: projectId,
    checkoutCredits: 100,
  });

  const { rawKey } = await owner.mutation(api.projects.mutation.generateApiKey, {
    id: projectId,
    label: "Main API Key",
  });

  return { owner, projectId, apiKeyHash: await sha256Hex(rawKey) };
}

test("public payment intent create is idempotent per project and request", async () => {
  const t = convexTest(schema, modules);
  const { apiKeyHash } = await createPaymentReadyProject(t, {
    ownerAddress: "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP",
    name: "Idempotent Merchant",
    slug: "idempotent-merchant",
  });

  const first = await t.mutation(internal.payment_intents.mutations.createPublicPaymentIntent, {
    apiKeyHash,
    amount: "25.00",
    asset: "native",
    description: "Order #1",
    idempotencyKey: "order-1",
  });
  expect(first.authorized).toBe(true);
  if (!first.authorized || "idempotencyConflict" in first) throw new Error("expected create");

  const replay = await t.mutation(internal.payment_intents.mutations.createPublicPaymentIntent, {
    apiKeyHash,
    amount: "25.00",
    asset: "native",
    description: "Order #1",
    idempotencyKey: "order-1",
  });
  expect(replay.authorized).toBe(true);
  if (!replay.authorized || "idempotencyConflict" in replay) throw new Error("expected replay");
  expect(replay.idempotencyReplay).toBe(true);
  expect(replay.intent._id).toBe(first.intent._id);

  const conflict = await t.mutation(internal.payment_intents.mutations.createPublicPaymentIntent, {
    apiKeyHash,
    amount: "30.00",
    asset: "native",
    description: "Order #1 changed",
    idempotencyKey: "order-1",
  });
  expect(conflict.authorized).toBe(true);
  expect("idempotencyConflict" in conflict && conflict.idempotencyConflict).toBe(true);
});

test("cancelled checkout is terminal and a fresh idempotency key creates a new intent", async () => {
  const t = convexTest(schema, modules);
  const { apiKeyHash } = await createPaymentReadyProject(t, {
    ownerAddress: "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP",
    name: "Cancellation Retry Merchant",
    slug: "cancellation-retry-merchant",
  });
  const create = (idempotencyKey: string) =>
    t.mutation(internal.payment_intents.mutations.createPublicPaymentIntent, {
      apiKeyHash,
      amount: "25.00",
      asset: "native",
      description: "Order #1",
      idempotencyKey,
    });

  const first = await create("order-1-attempt-1");
  if (!first.authorized || "idempotencyConflict" in first) throw new Error("expected create");

  await t.mutation(api.payment_intents.mutations.updateStatus, {
    paymentIntentId: first.intent._id,
    status: "cancelled",
  });

  expect(STATUS_TRANSITIONS.cancelled).toBeUndefined();
  await expect(
    t.mutation(api.payment_intents.mutations.updateStatus, {
      paymentIntentId: first.intent._id,
      status: "pending",
    }),
  ).rejects.toThrow("Invalid status transition: cancelled → pending");

  const replay = await create("order-1-attempt-1");
  if (!replay.authorized || "idempotencyConflict" in replay) throw new Error("expected replay");
  expect(replay.idempotencyReplay).toBe(true);
  expect(replay.intent._id).toBe(first.intent._id);
  expect(replay.intent.status).toBe("cancelled");

  const retry = await create("order-1-attempt-2");
  if (!retry.authorized || "idempotencyConflict" in retry) throw new Error("expected retry");
  expect(retry.idempotencyReplay).toBe(false);
  expect(retry.intent._id).not.toBe(first.intent._id);
  expect(retry.intent.status).toBe("created");
});

test("public retrieve and list are scoped to the API key project", async () => {
  const t = convexTest(schema, modules);
  const projectA = await createPaymentReadyProject(t, {
    ownerAddress: "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP",
    name: "Scoped Merchant A",
    slug: "scoped-merchant-a",
  });
  const projectB = await createPaymentReadyProject(t, {
    ownerAddress: "GBYV7ZZXECJON5RKIW3OUL5NIGKWE6B7VNOQVZ3ZQ7QIT6DXY7H3KGAB",
    name: "Scoped Merchant B",
    slug: "scoped-merchant-b",
  });

  const a1 = await t.mutation(internal.payment_intents.mutations.createPublicPaymentIntent, {
    apiKeyHash: projectA.apiKeyHash,
    amount: "10.00",
    asset: "native",
    description: "A1",
  });
  const a2 = await t.mutation(internal.payment_intents.mutations.createPublicPaymentIntent, {
    apiKeyHash: projectA.apiKeyHash,
    amount: "20.00",
    asset: "native",
    description: "A2",
  });
  const b1 = await t.mutation(internal.payment_intents.mutations.createPublicPaymentIntent, {
    apiKeyHash: projectB.apiKeyHash,
    amount: "30.00",
    asset: "native",
    description: "B1",
  });

  if (!a1.authorized || "idempotencyConflict" in a1) throw new Error("expected a1");
  if (!a2.authorized || "idempotencyConflict" in a2) throw new Error("expected a2");
  if (!b1.authorized || "idempotencyConflict" in b1) throw new Error("expected b1");

  await t.mutation(api.payment_intents.mutations.updateStatus, {
    paymentIntentId: a2.intent._id,
    status: "pending",
    payerAddress: "GDFX...PAYER",
  });

  const ownRetrieve = await t.query(internal.payment_intents.queries.getPublicPaymentIntent, {
    apiKeyHash: projectA.apiKeyHash,
    paymentIntentId: a1.intent._id,
  });
  expect(ownRetrieve.authorized).toBe(true);
  if (!ownRetrieve.authorized) throw new Error("expected auth");
  expect(ownRetrieve.intent?._id).toBe(a1.intent._id);

  const crossRetrieve = await t.query(internal.payment_intents.queries.getPublicPaymentIntent, {
    apiKeyHash: projectA.apiKeyHash,
    paymentIntentId: b1.intent._id,
  });
  expect(crossRetrieve.authorized).toBe(true);
  if (!crossRetrieve.authorized) throw new Error("expected auth");
  expect(crossRetrieve.intent).toBeNull();

  const malformedRetrieve = await t.query(internal.payment_intents.queries.getPublicPaymentIntent, {
    apiKeyHash: projectA.apiKeyHash,
    paymentIntentId: "not-a-valid-id",
  });
  expect(malformedRetrieve.authorized).toBe(true);
  if (!malformedRetrieve.authorized) throw new Error("expected auth");
  expect(malformedRetrieve.intent).toBeNull();

  const list = await t.query(internal.payment_intents.queries.listPublicPaymentIntents, {
    apiKeyHash: projectA.apiKeyHash,
    paginationOpts: { numItems: 20, cursor: null },
  });
  expect(list.authorized).toBe(true);
  if (!list.authorized) throw new Error("expected list");
  expect(list.page.page.map((intent: Doc<"paymentIntents">) => intent._id).sort()).toEqual(
    [a1.intent._id, a2.intent._id].sort(),
  );

  const pendingList = await t.query(internal.payment_intents.queries.listPublicPaymentIntents, {
    apiKeyHash: projectA.apiKeyHash,
    status: "pending",
    paginationOpts: { numItems: 20, cursor: null },
  });
  expect(pendingList.authorized).toBe(true);
  if (!pendingList.authorized) throw new Error("expected pending list");
  expect(pendingList.page.page).toHaveLength(1);
  expect(pendingList.page.page[0]._id).toBe(a2.intent._id);
});

test("payment anchor resolution precedence and mismatch rejections", async () => {
  const t = convexTest(schema, modules);
  const ownerAddress = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
  const owner = asWallet(t, ownerAddress);

  // Helper to generate scoped keys
  const createProjectWithAnchor = async (slug: string, defaultAnchor?: "inhouse" | "pdax") => {
    const projectId = await owner.mutation(api.projects.mutation.createDraft, {
      name: `Anchor Test Project ${slug}`,
      slug,
      description: "Testing payment anchors",
      metadataJson: "{}",
      metadataHash: "0000000000000000000000000000000000000000000000000000000000000000",
      ownerAddress,
      defaultPaymentAnchor: defaultAnchor,
    });

    await owner.mutation(api.projects.mutation.markPaymentAccessActive, {
      id: projectId,
      checkoutCredits: 100,
    });

    return projectId;
  };

  const generateScopedKey = async (
    projectId: Id<"projects">,
    paymentAnchor?: "inhouse" | "pdax",
  ) => {
    const { rawKey } = await owner.mutation(api.projects.mutation.generateApiKey, {
      id: projectId,
      label: `Key-${paymentAnchor || "none"}`,
      paymentAnchor,
    });
    return sha256Hex(rawKey);
  };

  // Case 4: Default fallback is "inhouse" when project default is omitted
  const projDefaultOmitted = await createProjectWithAnchor("default-omitted");
  const keyUnscoped = await generateScopedKey(projDefaultOmitted);

  const resOmitted = await t.mutation(
    internal.payment_intents.mutations.createPublicPaymentIntent,
    {
      apiKeyHash: keyUnscoped,
      amount: "10.00",
      asset: "native",
    },
  );
  expect(resOmitted.authorized).toBe(true);
  if (!resOmitted.authorized || "idempotencyConflict" in resOmitted)
    throw new Error("expected create");
  expect(resOmitted.intent.anchor).toBe("inhouse");

  // Case 3: Omitted key anchor, falls back to project default (e.g., "pdax")
  const projPdaxDefault = await createProjectWithAnchor("pdax-default", "pdax");
  const keyForPdaxDefault = await generateScopedKey(projPdaxDefault);

  const resProjDefault = await t.mutation(
    internal.payment_intents.mutations.createPublicPaymentIntent,
    {
      apiKeyHash: keyForPdaxDefault,
      amount: "20.00",
      asset: "native",
    },
  );
  expect(resProjDefault.authorized).toBe(true);
  if (!resProjDefault.authorized || "idempotencyConflict" in resProjDefault)
    throw new Error("expected create");
  expect(resProjDefault.intent.anchor).toBe("pdax");

  // Case 2: Scoped key (e.g. "pdax") overrides project default (e.g. "inhouse")
  const projInhouseDefault = await createProjectWithAnchor("inhouse-default", "inhouse");
  const keyScopedPdax = await generateScopedKey(projInhouseDefault, "pdax");

  const resScopedKey = await t.mutation(
    internal.payment_intents.mutations.createPublicPaymentIntent,
    {
      apiKeyHash: keyScopedPdax,
      amount: "30.00",
      asset: "native",
    },
  );
  expect(resScopedKey.authorized).toBe(true);
  if (!resScopedKey.authorized || "idempotencyConflict" in resScopedKey)
    throw new Error("expected create");
  expect(resScopedKey.intent.anchor).toBe("pdax");

  // Case 1: Explicit request matches scoped key anchor
  const resExplicitMatch = await t.mutation(
    internal.payment_intents.mutations.createPublicPaymentIntent,
    {
      apiKeyHash: keyScopedPdax,
      amount: "40.00",
      asset: "native",
      anchor: "pdax",
    },
  );
  expect(resExplicitMatch.authorized).toBe(true);
  if (!resExplicitMatch.authorized || "idempotencyConflict" in resExplicitMatch)
    throw new Error("expected create");
  expect(resExplicitMatch.intent.anchor).toBe("pdax");

  // Case 1 Mismatch: Explicit request does not match scoped key anchor (pdax key vs inhouse request)
  await expect(
    t.mutation(internal.payment_intents.mutations.createPublicPaymentIntent, {
      apiKeyHash: keyScopedPdax,
      amount: "50.00",
      asset: "native",
      anchor: "inhouse",
    }),
  ).rejects.toThrow(
    "Anchor mismatch: Requested anchor does not match the API key's scoped anchor.",
  );
});

test("payment.created webhook scheduling is demand-driven", async () => {
  const t = convexTest(schema, modules);
  const ownerAddress = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
  const owner = asWallet(t, ownerAddress);
  const projectId = await owner.mutation(api.projects.mutation.createDraft, {
    name: "Webhook Scheduling Store",
    slug: "webhook-scheduling-store",
    description: "Verifies demand-driven payment webhook scheduling",
    metadataJson: "{}",
    metadataHash: "0".repeat(64),
    ownerAddress,
  });
  await owner.mutation(api.projects.mutation.markPaymentAccessActive, {
    id: projectId,
    checkoutCredits: 100,
  });
  const { rawKey } = await owner.mutation(api.projects.mutation.generateApiKey, {
    id: projectId,
    label: "Webhook scheduling test",
  });
  const apiKeyHash = await sha256Hex(rawKey);
  const scheduledWebhookCount = async () =>
    await t.run(
      async (ctx) =>
        (await ctx.db.system.query("_scheduled_functions").collect()).filter((row) =>
          row.name.includes("webhookDelivery:trigger"),
        ).length,
    );

  const beforeNoEndpoint = await scheduledWebhookCount();
  const noEndpoint = await t.mutation(
    internal.payment_intents.mutations.createPublicPaymentIntentV2,
    {
      apiKeyHash,
      amount: "1.00",
      asset: "native",
      idempotencyKey: "without-webhook",
    },
  );
  expect(noEndpoint.status).toBe("success");
  expect(await scheduledWebhookCount()).toBe(beforeNoEndpoint);

  await owner.mutation(api.webhook_endpoints.mutation.saveSettings, {
    projectId,
    url: "https://merchant.example/webhook",
    enabled: true,
    eventTypes: ["payment.created"],
  });
  const beforeSubscribed = await scheduledWebhookCount();
  const subscribed = await t.mutation(
    internal.payment_intents.mutations.createPublicPaymentIntentV2,
    {
      apiKeyHash,
      amount: "2.00",
      asset: "native",
      idempotencyKey: "with-webhook",
    },
  );
  expect(subscribed.status).toBe("success");
  expect(await scheduledWebhookCount()).toBe(beforeSubscribed + 1);
});

test("public payment intent v2 creates one awaiting route and completes it safely", async () => {
  const t = convexTest(schema, modules);

  const ownerAddress = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
  const owner = asWallet(t, ownerAddress);

  const projectId = await owner.mutation(api.projects.mutation.createDraft, {
    name: "V2 Test Store",
    slug: "v2-test-store",
    description: "Testing V2 PDAX Action",
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
    label: "Key-None",
  });
  const apiKeyHash = await sha256Hex(rawKey);

  const resNoConnection = await t.mutation(
    internal.payment_intents.mutations.createPublicPaymentIntentV2,
    {
      apiKeyHash,
      amount: "10.00",
      asset: "native",
      anchor: "pdax",
    },
  );
  expect(resNoConnection.status).toBe("anchor_not_connected");

  // 2. Connect the PDAX provider connection
  await t.mutation(internal.provider_connections.mutation.upsertInternal, {
    projectId,
    provider: "pdax",
    status: "connected",
  });

  const create = () =>
    t.mutation(internal.payment_intents.mutations.createPublicPaymentIntentV2, {
      apiKeyHash,
      amount: "15.00",
      asset: "USDC",
      anchor: "pdax",
      idempotencyKey: "pdax-hot-key",
    });
  const results = await Promise.all(Array.from({ length: 100 }, create));
  const first = results.find((result) => result.status === "success");
  expect(first?.status).toBe("success");
  if (!first || first.status !== "success") throw new Error("Expected initial creation");
  expect(first.intent.status).toBe("awaiting_route");
  expect(first.intent.receiverAddress).toBeUndefined();
  expect(results.filter((result) => result.status === "success")).toHaveLength(1);
  expect(results.filter((result) => result.status === "idempotency_replay")).toHaveLength(99);

  const counts = await t.run(async (ctx) => ({
    intents: (await ctx.db.query("paymentIntents").collect()).length,
    jobs: (await ctx.db.query("paymentIntentRouteJobs").collect()).length,
  }));
  expect(counts).toEqual({ intents: 1, jobs: 1 });

  const leaseToken = "test-route-lease";
  const claim = await t.mutation(internal.payment_intents.mutations.claimRouteJob, {
    paymentIntentId: first.intent._id,
    leaseToken,
  });
  expect(claim.status).toBe("claimed");
  if (claim.status !== "claimed") throw new Error("Expected route claim");
  expect(
    (
      await t.mutation(internal.payment_intents.mutations.claimProviderRoute, {
        projectId,
        mappedAsset: "USDCXLM",
        leaseToken,
      })
    ).status,
  ).toBe("claimed");
  expect(
    (
      await t.mutation(internal.payment_intents.mutations.completePdaxRoute, {
        paymentIntentId: first.intent._id,
        leaseToken,
        mappedAsset: "USDCXLM",
        address: "G-MOCK-PDAX-DEPOSIT-ADDRESS",
        memo: "123456",
        fromCache: false,
      })
    ).applied,
  ).toBe(true);
  const completed = await t.query(api.payment_intents.queries.getPaymentIntent, {
    paymentIntentId: first.intent._id,
  });
  expect(completed?.status).toBe("created");
  expect(completed?.receiverAddress).toBe("G-MOCK-PDAX-DEPOSIT-ADDRESS");

  const cachedCreate = await t.mutation(
    internal.payment_intents.mutations.createPublicPaymentIntentV2,
    {
      apiKeyHash,
      amount: "16.00",
      asset: "USDC",
      anchor: "pdax",
    },
  );
  if (cachedCreate.status !== "success") throw new Error("Expected cached-route creation");
  expect(cachedCreate.intent.status).toBe("created");
  expect(cachedCreate.intent.receiverAddress).toBe("G-MOCK-PDAX-DEPOSIT-ADDRESS");
  expect(cachedCreate.intent.receiverMemo).toBe("123456");
  expect(cachedCreate.intent.anchorDepositCurrency).toBe("USDCXLM");
  expect(
    await t.run(async (ctx) => (await ctx.db.query("paymentIntentRouteJobs").collect()).length),
  ).toBe(1);

  const failing = await t.mutation(internal.payment_intents.mutations.createPublicPaymentIntentV2, {
    apiKeyHash,
    amount: "20.00",
    asset: "native",
    anchor: "pdax",
    idempotencyKey: "pdax-failing-key",
  });
  if (failing.status !== "success") throw new Error("Expected failing-route fixture intent");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await t.run(async (ctx) => {
      const job = await ctx.db
        .query("paymentIntentRouteJobs")
        .withIndex("by_payment_intent", (q) => q.eq("paymentIntentId", failing.intent._id))
        .unique();
      if (job) await ctx.db.patch(job._id, { nextAttemptAt: 0, leaseExpiresAt: undefined });
    });
    const token = `failure-lease-${attempt}`;
    expect(
      (
        await t.mutation(internal.payment_intents.mutations.claimRouteJob, {
          paymentIntentId: failing.intent._id,
          leaseToken: token,
        })
      ).status,
    ).toBe("claimed");
    await t.mutation(internal.payment_intents.mutations.failPdaxRoute, {
      paymentIntentId: failing.intent._id,
      leaseToken: token,
      errorCode: "provider_timeout",
    });
  }
  expect(
    (
      await t.query(api.payment_intents.queries.getPaymentIntent, {
        paymentIntentId: failing.intent._id,
      })
    )?.status,
  ).toBe("failed");
});

test("cached PDAX route completion does not rewrite shared cache", async () => {
  const t = convexTest(schema, modules);
  const fixture = await t.run(async (ctx) => {
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      name: "Cache Test",
      slug: `cache-test-${now}`,
      description: "test",
      metadataJson: "{}",
      metadataHash: "0".repeat(64),
      ownerAddress: "GTEST",
      status: "draft",
      createdAt: now,
      updatedAt: now,
    });
    const paymentIntentId = await ctx.db.insert("paymentIntents", {
      projectId,
      amount: "1.00",
      asset: "USDC",
      merchantName: "Cache Test",
      status: "awaiting_route",
      anchor: "pdax",
      expiresAt: now + 60_000,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("paymentIntentRouteJobs", {
      paymentIntentId,
      projectId,
      mappedAsset: "USDCXLM",
      state: "leased",
      attempts: 0,
      nextAttemptAt: now,
      leaseToken: "cache-hit-lease",
      leaseExpiresAt: now + 30_000,
      createdAt: now,
      updatedAt: now,
    });
    const cacheId = await ctx.db.insert("pdaxRouteCache", {
      projectId,
      mappedAsset: "USDCXLM",
      address: "G-CACHED-PDAX-ADDRESS",
      memo: "123456",
      expiresAt: now + 60_000,
      updatedAt: now - 1_000,
    });
    return { cacheId, paymentIntentId };
  });

  const cachedBefore = await t.run(async (ctx) => await ctx.db.get(fixture.cacheId));
  const result = await t.mutation(internal.payment_intents.mutations.completePdaxRoute, {
    paymentIntentId: fixture.paymentIntentId,
    leaseToken: "cache-hit-lease",
    mappedAsset: "USDCXLM",
    address: "G-CACHED-PDAX-ADDRESS",
    memo: "123456",
    fromCache: true,
  });
  const cachedAfter = await t.run(async (ctx) => await ctx.db.get(fixture.cacheId));

  expect(result.applied).toBe(true);
  expect(cachedAfter).toEqual(cachedBefore);
});

test("stale PDAX route jobs are recovered after a worker lease is lost", async () => {
  const t = convexTest(schema, modules);
  const fixture = await t.run(async (ctx) => {
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      name: "Route Recovery Test",
      slug: `route-recovery-test-${now}`,
      description: "test",
      metadataJson: "{}",
      metadataHash: "0".repeat(64),
      ownerAddress: "GTEST",
      status: "draft",
      createdAt: now,
      updatedAt: now,
    });
    const paymentIntentId = await ctx.db.insert("paymentIntents", {
      projectId,
      amount: "1.00",
      asset: "USDC",
      merchantName: "Route Recovery Test",
      status: "awaiting_route",
      anchor: "pdax",
      expiresAt: now + 60_000,
      createdAt: now,
      updatedAt: now,
    });
    const jobId = await ctx.db.insert("paymentIntentRouteJobs", {
      paymentIntentId,
      projectId,
      mappedAsset: "USDCXLM",
      state: "leased",
      attempts: 0,
      nextAttemptAt: now - 10_000,
      leaseToken: "lost-worker-lease",
      leaseExpiresAt: now - 1_000,
      createdAt: now,
      updatedAt: now,
    });
    return { jobId };
  });

  const result = await t.mutation(internal.payment_intents.mutations.recoverPdaxRouteJobs, {
    limit: 10,
  });
  const recovered = await t.run(async (ctx) => await ctx.db.get(fixture.jobId));

  expect(result).toEqual({ recovered: 1, expired: 0 });
  expect(recovered?.state).toBe("scheduled");
  expect(recovered?.leaseToken).toBeUndefined();
  expect(recovered?.leaseExpiresAt).toBeUndefined();
});
