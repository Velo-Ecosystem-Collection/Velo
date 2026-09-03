/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { expect, test } from "vitest";

import type { DataModel, Id } from "../../_generated/dataModel";
import type { TestConvexForDataModelAndIdentity } from "convex-test";

import { api } from "../../_generated/api";
import { GAS_NETWORK } from "../../gas/types";
import schema from "../../schema";
import { gasEnvelopeFixtures, gasMaxTimeEnvelopeFixtures } from "./fixtures";

const modules = import.meta.glob("../../**/*.ts");

const OWNER = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
const CONTRACT_ID = "CC7RENKPGXGF6MMEMGJ4YWUBOBGQYOCGG33PNSONQF56UMMAQ22TWH6R";
const API_KEY_HASH = "a".repeat(64);
const REVOKED_API_KEY_HASH = "b".repeat(64);
type TestContext = TestConvexForDataModelAndIdentity<DataModel>;

type GasScope = Readonly<{ projectId: Id<"projects">; apiKeyHash: string }>;

async function createScope(
  t: TestContext,
  options: { apiKeyHash?: string; paymentAccessActive?: boolean } = {},
): Promise<GasScope> {
  const apiKeyHash = options.apiKeyHash ?? API_KEY_HASH;
  return await t.run(async (ctx) => {
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      name: "Gas Sponsor Action Project",
      slug: `gas-sponsor-action-${apiKeyHash.slice(0, 8)}`,
      description: "Gas sponsor action test project",
      metadataJson: "{}",
      metadataHash: "0".repeat(64),
      ownerAddress: OWNER,
      ownerTokenIdentifier: `http://localhost:3000|${OWNER}`,
      status: "draft",
      paymentAccessActive: options.paymentAccessActive ?? false,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("apiKeys", {
      projectId,
      keyHash: apiKeyHash,
      prefix: "tk_live_test",
      label: "Gas sponsor test key",
      createdAt: now,
      requestCount: 0,
      revoked: false,
    });
    return { projectId, apiKeyHash };
  });
}

async function createPolicy(t: TestContext, projectId: Id<"projects">, enabled = true) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("gasPolicies", {
      projectId,
      enabled,
      network: GAS_NETWORK,
      dailyCapStroops: 10_000n,
      dailyReservedStroops: 0n,
      dailyWindowKey: new Date(now).toISOString().slice(0, 10),
      walletHourlyLimit: 10,
      allowedContractIds: [CONTRACT_ID],
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function readGasState(t: TestContext, projectId: Id<"projects">) {
  return await t.run(async (ctx) => ({
    policy: await ctx.db
      .query("gasPolicies")
      .withIndex("by_project_id", (q) => q.eq("projectId", projectId))
      .unique(),
    logs: await ctx.db
      .query("gasLogs")
      .withIndex("by_project_id_and_created_at", (q) => q.eq("projectId", projectId))
      .collect(),
    buckets: await ctx.db.query("rateLimitBuckets").collect(),
  }));
}

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

test("valid signed Testnet sponsor requests reserve once from derived facts", async () => {
  const t = convexTest(schema, modules);
  const scope = await createScope(t, { paymentAccessActive: false });
  await createPolicy(t, scope.projectId);

  const result = await t.action(api.gas.public_api.sponsor, {
    apiKeyHash: scope.apiKeyHash,
    idempotencyKey: " sponsor-valid-1 ",
    transactionXdr: `  ${gasMaxTimeEnvelopeFixtures.unbounded}  `,
  });

  expect(result.status).toBe("success");
  if (result.status !== "success") throw new Error("Expected a sponsor reservation");
  expect(result.replayed).toBe(false);
  expect(result.reservation).toMatchObject({
    transactionHash: "3c5c8dfa2e616feb24cde207380b4c6ba0c8618d88d430e15df522940720ab08",
    sourceWallet: "GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57",
    targetContractIds: [CONTRACT_ID],
    innerMaxFeeStroops: "100",
    reservedStroops: "200",
    decisionCode: "reserved",
    rejectionCode: null,
    lifecycle: "reserved",
  });

  const state = await readGasState(t, scope.projectId);
  expect(state.logs).toHaveLength(1);
  expect(state.policy?.dailyReservedStroops).toBe(200n);
  expect(state.buckets).toHaveLength(1);
  expect(state.buckets[0]?.tokens).toBe(1);
  expect(state.logs[0]?.idempotencyKeyHash).toBe(await sha256("sponsor-valid-1"));
  expect(state.logs[0]?.requestFingerprint).toBe(
    await sha256(gasMaxTimeEnvelopeFixtures.unbounded),
  );
  expect(state.logs[0]).not.toHaveProperty("transactionXdr");

  const serialized = JSON.stringify(result);
  expect(serialized).not.toContain(scope.projectId);
  expect(serialized).not.toContain("sponsor-valid-1");
  expect(serialized).not.toContain(gasMaxTimeEnvelopeFixtures.unbounded);
  expect(serialized).not.toContain(await sha256("sponsor-valid-1"));
  expect(serialized).not.toContain(await sha256(gasMaxTimeEnvelopeFixtures.unbounded));
});

test("policy denial returns a redacted typed decision without accounting writes", async () => {
  const t = convexTest(schema, modules);
  const scope = await createScope(t);
  await createPolicy(t, scope.projectId, false);

  const result = await t.action(api.gas.public_api.sponsor, {
    apiKeyHash: scope.apiKeyHash,
    idempotencyKey: "sponsor-denied-1",
    transactionXdr: gasMaxTimeEnvelopeFixtures.unbounded,
  });

  expect(result).toMatchObject({
    status: "rejected",
    replayed: false,
    rejectionCode: "policy_disabled",
    decision: {
      transactionHash: null,
      reservedStroops: null,
      expiresAt: null,
      decisionCode: "rejected",
      rejectionCode: "policy_disabled",
      lifecycle: "rejected",
    },
  });
  if (result.status !== "rejected") throw new Error("Expected a policy rejection");
  expect(result.decision).not.toHaveProperty("projectId");
  expect(result.decision).not.toHaveProperty("idempotencyKeyHash");
  expect(result.decision).not.toHaveProperty("requestFingerprint");

  const state = await readGasState(t, scope.projectId);
  expect(state.policy?.dailyReservedStroops).toBe(0n);
  expect(state.buckets).toHaveLength(0);
  expect(state.logs).toHaveLength(1);
});

test("replay returns the original reservation while changed requests and transactions conflict", async () => {
  const t = convexTest(schema, modules);
  const scope = await createScope(t);
  await createPolicy(t, scope.projectId);

  const first = await t.action(api.gas.public_api.sponsor, {
    apiKeyHash: scope.apiKeyHash,
    idempotencyKey: "sponsor-replay-1",
    transactionXdr: gasMaxTimeEnvelopeFixtures.unbounded,
  });
  const replay = await t.action(api.gas.public_api.sponsor, {
    apiKeyHash: scope.apiKeyHash,
    idempotencyKey: " sponsor-replay-1 ",
    transactionXdr: gasMaxTimeEnvelopeFixtures.unbounded,
  });
  const changedRequest = await t.action(api.gas.public_api.sponsor, {
    apiKeyHash: scope.apiKeyHash,
    idempotencyKey: "sponsor-replay-1",
    transactionXdr: gasMaxTimeEnvelopeFixtures.later,
  });
  const duplicateTransaction = await t.action(api.gas.public_api.sponsor, {
    apiKeyHash: scope.apiKeyHash,
    idempotencyKey: "sponsor-replay-2",
    transactionXdr: gasMaxTimeEnvelopeFixtures.unbounded,
  });

  expect(first).toMatchObject({ status: "success", replayed: false });
  expect(replay).toMatchObject({ status: "success", replayed: true });
  expect(changedRequest).toEqual({ status: "idempotency_key_conflict" });
  expect(duplicateTransaction).toEqual({ status: "duplicate_transaction" });
  if (first.status !== "success" || replay.status !== "success") {
    throw new Error("Expected sponsor reservations");
  }
  expect(replay.reservation).toEqual(first.reservation);
  expect((await readGasState(t, scope.projectId)).logs).toHaveLength(1);
});

test("invalid, wrong-network, unsupported, unknown-key, and revoked-key requests do not write", async () => {
  const t = convexTest(schema, modules);
  const scope = await createScope(t);
  await createPolicy(t, scope.projectId);
  const revokedScope = await createScope(t, { apiKeyHash: REVOKED_API_KEY_HASH });

  await t.run(async (ctx) => {
    const revokedKey = await ctx.db
      .query("apiKeys")
      .withIndex("by_key_hash", (q) => q.eq("keyHash", REVOKED_API_KEY_HASH))
      .unique();
    if (!revokedKey) throw new Error("Missing revoked test key");
    await ctx.db.patch(revokedKey._id, { revoked: true });
  });

  const cases = [
    { key: "f".repeat(64), xdr: "not-an-xdr", status: "unauthorized" },
    {
      key: revokedScope.apiKeyHash,
      xdr: gasMaxTimeEnvelopeFixtures.unbounded,
      status: "unauthorized",
    },
    { key: scope.apiKeyHash, xdr: "not-an-xdr", status: "invalid_request" },
    {
      key: scope.apiKeyHash,
      xdr: gasEnvelopeFixtures.find(
        (fixture) => fixture.id === "gas-envelope-mainnet-signed-soroban",
      )!.xdr,
      status: "wrong_network",
    },
    {
      key: scope.apiKeyHash,
      xdr: gasEnvelopeFixtures.find((fixture) => fixture.id === "gas-envelope-unsigned-soroban")!
        .xdr,
      status: "invalid_signature",
    },
    {
      key: scope.apiKeyHash,
      xdr: gasEnvelopeFixtures.find((fixture) => fixture.id === "gas-envelope-classic-payment")!
        .xdr,
      status: "unsupported_transaction",
    },
  ] as const;

  for (const [index, request] of cases.entries()) {
    await expect(
      t.action(api.gas.public_api.sponsor, {
        apiKeyHash: request.key,
        idempotencyKey: `sponsor-invalid-${index}`,
        transactionXdr: request.xdr,
      }),
    ).resolves.toEqual({ status: request.status });
  }

  const state = await readGasState(t, scope.projectId);
  expect(state.logs).toHaveLength(0);
  expect(state.policy?.dailyReservedStroops).toBe(0n);
  expect(state.buckets).toHaveLength(0);
});
