/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";

import type { DataModel, Id } from "../../_generated/dataModel";
import type { TestConvexForDataModelAndIdentity } from "convex-test";

import { api, internal } from "../../_generated/api";
import { GAS_NETWORK, GAS_SUPPORTED_OPERATION } from "../../gas/types";
import schema from "../../schema";
import {
  gasEnvelopeFixtures,
  gasMalformedInputFixtures,
  gasMaxTimeEnvelopeFixtures,
} from "./fixtures";

const modules = import.meta.glob("../../**/*.ts");

const OWNER = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
const CONTRACT_ID = "CC7RENKPGXGF6MMEMGJ4YWUBOBGQYOCGG33PNSONQF56UMMAQ22TWH6R";
const NON_WHITELISTED_CONTRACT_ID = "CA7QYNF7SOWQ3LLQ6ZMPD6PTQVVBYV3R6DR2ICR6UBZMWRXZPPTD3FVO";
const SOURCE_WALLET = "GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57";
const NOW = Date.parse("2026-09-03T12:34:56.789Z");
const API_KEY_HASH = "a".repeat(64);
const REVOKED_API_KEY_HASH = "b".repeat(64);
const UNKNOWN_API_KEY_HASH = "f".repeat(64);
type TestContext = TestConvexForDataModelAndIdentity<DataModel>;

type GasScope = Readonly<{
  projectId: Id<"projects">;
  apiKeyId: Id<"apiKeys">;
  apiKeyHash: string;
}>;

async function withFixedTime<T>(callback: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  try {
    return await callback();
  } finally {
    vi.useRealTimers();
  }
}

async function createScope(
  t: TestContext,
  options: {
    apiKeyHash?: string;
    paymentAccessActive?: boolean;
    projectSuffix?: string;
  } = {},
): Promise<GasScope> {
  const apiKeyHash = options.apiKeyHash ?? API_KEY_HASH;
  const projectSuffix = options.projectSuffix ?? apiKeyHash.slice(0, 8);
  return await t.run(async (ctx) => {
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      name: "Gas Sponsor Action Project",
      slug: `gas-sponsor-action-${projectSuffix}`,
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
    const apiKeyId = await ctx.db.insert("apiKeys", {
      projectId,
      keyHash: apiKeyHash,
      prefix: "tk_live_test",
      label: "Gas sponsor test key",
      createdAt: now,
      requestCount: 0,
      revoked: false,
    });
    return { projectId, apiKeyId, apiKeyHash };
  });
}

type PolicyOverrides = Readonly<{
  dailyCapStroops?: bigint;
  dailyReservedStroops?: bigint;
  walletHourlyLimit?: number;
  allowedContractIds?: string[];
}>;

async function createPolicy(
  t: TestContext,
  projectId: Id<"projects">,
  enabled = true,
  overrides: PolicyOverrides = {},
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("gasPolicies", {
      projectId,
      enabled,
      network: GAS_NETWORK,
      dailyCapStroops: overrides.dailyCapStroops ?? 10_000n,
      dailyReservedStroops: overrides.dailyReservedStroops ?? 0n,
      dailyWindowKey: new Date(now).toISOString().slice(0, 10),
      walletHourlyLimit: overrides.walletHourlyLimit ?? 10,
      allowedContractIds: overrides.allowedContractIds ?? [CONTRACT_ID],
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
    buckets: (await ctx.db.query("rateLimitBuckets").collect()).filter((bucket) =>
      bucket.scopeKey.startsWith(`gas:${projectId}:`),
    ),
  }));
}

async function readGasAccounting(t: TestContext, projectId: Id<"projects">) {
  const state = await readGasState(t, projectId);
  return { policy: state.policy, buckets: state.buckets };
}

function envelopeXdr(id: string): string {
  const fixture = gasEnvelopeFixtures.find((candidate) => candidate.id === id);
  if (!fixture) throw new Error(`Missing envelope fixture: ${id}`);
  return fixture.xdr;
}

function malformedXdr(id: string): string {
  const fixture = gasMalformedInputFixtures.find((candidate) => candidate.id === id);
  if (!fixture || fixture.category !== "xdr") throw new Error(`Missing XDR fixture: ${id}`);
  return fixture.value;
}

function assertResultRedacted(result: unknown, values: readonly string[]): void {
  const serialized = JSON.stringify(result);
  for (const value of values) {
    expect(serialized).not.toContain(value);
  }
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
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const scope = await createScope(t);
    await createPolicy(t, scope.projectId);

    const first = await t.action(api.gas.public_api.sponsor, {
      apiKeyHash: scope.apiKeyHash,
      idempotencyKey: "sponsor-replay-1",
      transactionXdr: gasMaxTimeEnvelopeFixtures.unbounded,
    });
    const afterFirst = await readGasState(t, scope.projectId);
    const replay = await t.action(api.gas.public_api.sponsor, {
      apiKeyHash: scope.apiKeyHash,
      idempotencyKey: " sponsor-replay-1 ",
      transactionXdr: gasMaxTimeEnvelopeFixtures.unbounded,
    });
    expect(await readGasState(t, scope.projectId)).toEqual(afterFirst);

    const changedRequest = await t.action(api.gas.public_api.sponsor, {
      apiKeyHash: scope.apiKeyHash,
      idempotencyKey: "sponsor-replay-1",
      transactionXdr: gasMaxTimeEnvelopeFixtures.later,
    });
    expect(changedRequest).toEqual({ status: "idempotency_key_conflict" });
    expect(await readGasState(t, scope.projectId)).toEqual(afterFirst);

    const duplicateTransaction = await t.action(api.gas.public_api.sponsor, {
      apiKeyHash: scope.apiKeyHash,
      idempotencyKey: "sponsor-replay-2",
      transactionXdr: gasMaxTimeEnvelopeFixtures.unbounded,
    });
    expect(duplicateTransaction).toEqual({ status: "duplicate_transaction" });
    expect(await readGasState(t, scope.projectId)).toEqual(afterFirst);

    expect(first).toMatchObject({ status: "success", replayed: false });
    expect(replay).toMatchObject({ status: "success", replayed: true });
    if (first.status !== "success" || replay.status !== "success") {
      throw new Error("Expected sponsor reservations");
    }
    expect(replay.reservation).toEqual(first.reservation);
    expect((await readGasState(t, scope.projectId)).logs).toHaveLength(1);
  });
});

test("failure matrix is authenticated first and never writes", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const scope = await createScope(t);
    await createPolicy(t, scope.projectId);
    const revokedScope = await createScope(t, { apiKeyHash: REVOKED_API_KEY_HASH });
    await createPolicy(t, revokedScope.projectId);

    await t.run(async (ctx) => {
      await ctx.db.patch(revokedScope.apiKeyId, { revoked: true });
    });

    type ExpectedStatus =
      | "unauthorized"
      | "invalid_request"
      | "invalid_signature"
      | "wrong_network"
      | "unsupported_transaction";
    const cases: ReadonlyArray<{
      id: string;
      key: string;
      xdr: string;
      status: ExpectedStatus;
    }> = [
      {
        id: "malformed-key",
        key: "not-a-sha256-hash",
        xdr: envelopeXdr("gas-envelope-mainnet-signed-soroban"),
        status: "unauthorized",
      },
      {
        id: "short-key",
        key: "a".repeat(63),
        xdr: malformedXdr("gas-input-malformed-xdr-text"),
        status: "unauthorized",
      },
      {
        id: "unknown-key",
        key: UNKNOWN_API_KEY_HASH,
        xdr: envelopeXdr("gas-envelope-fee-bump-soroban"),
        status: "unauthorized",
      },
      {
        id: "revoked-key",
        key: revokedScope.apiKeyHash,
        xdr: malformedXdr("gas-input-malformed-xdr-truncated"),
        status: "unauthorized",
      },
      {
        id: "malformed-xdr-text",
        key: scope.apiKeyHash,
        xdr: malformedXdr("gas-input-malformed-xdr-text"),
        status: "invalid_request",
      },
      {
        id: "malformed-xdr-truncated",
        key: scope.apiKeyHash,
        xdr: malformedXdr("gas-input-malformed-xdr-truncated"),
        status: "invalid_request",
      },
      {
        id: "wrong-network",
        key: scope.apiKeyHash,
        xdr: envelopeXdr("gas-envelope-mainnet-signed-soroban"),
        status: "wrong_network",
      },
      {
        id: "unsigned",
        key: scope.apiKeyHash,
        xdr: envelopeXdr("gas-envelope-unsigned-soroban"),
        status: "invalid_signature",
      },
      {
        id: "classic",
        key: scope.apiKeyHash,
        xdr: envelopeXdr("gas-envelope-classic-payment"),
        status: "unsupported_transaction",
      },
      {
        id: "multiple-operations",
        key: scope.apiKeyHash,
        xdr: envelopeXdr("gas-envelope-multi-soroban"),
        status: "unsupported_transaction",
      },
      {
        id: "mixed-operations",
        key: scope.apiKeyHash,
        xdr: envelopeXdr("gas-envelope-mixed-soroban-payment"),
        status: "unsupported_transaction",
      },
      {
        id: "fee-bump",
        key: scope.apiKeyHash,
        xdr: envelopeXdr("gas-envelope-fee-bump-soroban"),
        status: "unsupported_transaction",
      },
    ];

    for (const failure of cases) {
      const idempotencyKey = `sponsor-failure-${failure.id}`;
      const result = await t.action(api.gas.public_api.sponsor, {
        apiKeyHash: failure.key,
        idempotencyKey,
        transactionXdr: failure.xdr,
      });

      expect(result).toEqual({ status: failure.status });
      assertResultRedacted(result, [
        failure.key,
        failure.xdr,
        idempotencyKey,
        await sha256(idempotencyKey),
        await sha256(failure.xdr),
      ]);
    }

    for (const projectId of [scope.projectId, revokedScope.projectId]) {
      const state = await readGasState(t, projectId);
      expect(state.logs).toHaveLength(0);
      expect(state.policy?.dailyReservedStroops).toBe(0n);
      expect(state.buckets).toHaveLength(0);
    }
  });
});

test("public sponsor scope is project-bound and mismatched authority is fail-closed", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const firstScope = await createScope(t, { projectSuffix: "first-project" });
    const secondScope = await createScope(t, {
      apiKeyHash: "c".repeat(64),
      projectSuffix: "second-project",
    });
    await createPolicy(t, firstScope.projectId);
    await createPolicy(t, secondScope.projectId);

    const secondBefore = await readGasState(t, secondScope.projectId);
    const firstResult = await t.action(api.gas.public_api.sponsor, {
      apiKeyHash: firstScope.apiKeyHash,
      idempotencyKey: "sponsor-project-scope-1",
      transactionXdr: gasMaxTimeEnvelopeFixtures.unbounded,
    });

    expect(firstResult).toMatchObject({ status: "success", replayed: false });
    expect((await readGasState(t, firstScope.projectId)).logs).toHaveLength(1);
    expect(await readGasState(t, secondScope.projectId)).toEqual(secondBefore);

    const firstBeforeMismatch = await readGasState(t, firstScope.projectId);
    const secondBeforeMismatch = await readGasState(t, secondScope.projectId);
    const mismatch = await t.mutation(internal.gas.admission.reserve, {
      apiKeyId: firstScope.apiKeyId,
      projectId: secondScope.projectId,
      apiKeyHash: firstScope.apiKeyHash,
      idempotencyKeyHash: "d".repeat(64),
      requestFingerprint: "e".repeat(64),
      network: GAS_NETWORK,
      operation: GAS_SUPPORTED_OPERATION,
      sourceWallet: SOURCE_WALLET,
      targetContractIds: [CONTRACT_ID],
      transactionHash: "1".repeat(64),
      innerMaxFeeStroops: 100n,
    });

    expect(mismatch).toEqual({ status: "unauthorized" });
    expect(await readGasState(t, firstScope.projectId)).toEqual(firstBeforeMismatch);
    expect(await readGasState(t, secondScope.projectId)).toEqual(secondBeforeMismatch);
    assertResultRedacted(mismatch, [String(firstScope.projectId), String(secondScope.projectId)]);
  });
});

test("public sponsor policy denials leave policy and wallet accounting unchanged", async () => {
  await withFixedTime(async () => {
    type DenialCode =
      | "policy_disabled"
      | "contract_not_whitelisted"
      | "daily_cap_exceeded"
      | "wallet_rate_limited";
    const cases: ReadonlyArray<{
      id: string;
      rejectionCode: DenialCode;
      setup: (t: TestContext, projectId: Id<"projects">) => Promise<void>;
    }> = [
      {
        id: "disabled-policy",
        rejectionCode: "policy_disabled",
        setup: async (t, projectId) => {
          await createPolicy(t, projectId, false);
        },
      },
      {
        id: "non-whitelisted-contract",
        rejectionCode: "contract_not_whitelisted",
        setup: async (t, projectId) => {
          await createPolicy(t, projectId, true, {
            allowedContractIds: [NON_WHITELISTED_CONTRACT_ID],
          });
        },
      },
      {
        id: "daily-cap-exhausted",
        rejectionCode: "daily_cap_exceeded",
        setup: async (t, projectId) => {
          await createPolicy(t, projectId, true, {
            dailyCapStroops: 200n,
            dailyReservedStroops: 200n,
          });
        },
      },
      {
        id: "wallet-quota-exhausted",
        rejectionCode: "wallet_rate_limited",
        setup: async (t, projectId) => {
          await createPolicy(t, projectId, true, { walletHourlyLimit: 1 });
          await t.run(async (ctx) => {
            await ctx.db.insert("rateLimitBuckets", {
              scopeKey: `gas:${projectId}:wallet:${SOURCE_WALLET}`,
              tokens: 1,
              updatedAt: NOW,
            });
          });
        },
      },
    ];

    for (const denial of cases) {
      const t = convexTest(schema, modules);
      const scope = await createScope(t, { projectSuffix: `denial-${denial.id}` });
      await denial.setup(t, scope.projectId);
      const before = await readGasAccounting(t, scope.projectId);
      const idempotencyKey = `sponsor-denial-${denial.id}`;
      const result = await t.action(api.gas.public_api.sponsor, {
        apiKeyHash: scope.apiKeyHash,
        idempotencyKey,
        transactionXdr: gasMaxTimeEnvelopeFixtures.unbounded,
      });

      expect(result).toMatchObject({
        status: "rejected",
        replayed: false,
        rejectionCode: denial.rejectionCode,
        decision: {
          transactionHash: null,
          reservedStroops: null,
          expiresAt: null,
          decisionCode: "rejected",
          rejectionCode: denial.rejectionCode,
          lifecycle: "rejected",
        },
      });
      expect(await readGasAccounting(t, scope.projectId)).toEqual(before);

      const state = await readGasState(t, scope.projectId);
      expect(state.logs).toHaveLength(1);
      expect(state.logs[0]).toMatchObject({
        decisionCode: "rejected",
        rejectionCode: denial.rejectionCode,
        lifecycle: "rejected",
      });
      expect(state.logs[0]).not.toHaveProperty("transactionHash");
      expect(state.logs[0]).not.toHaveProperty("reservedStroops");
      expect(state.logs[0]).not.toHaveProperty("expiresAt");
      assertResultRedacted(result, [
        scope.apiKeyHash,
        idempotencyKey,
        await sha256(idempotencyKey),
        gasMaxTimeEnvelopeFixtures.unbounded,
        await sha256(gasMaxTimeEnvelopeFixtures.unbounded),
        String(scope.projectId),
      ]);
    }
  });
});
