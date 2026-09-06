/// <reference types="vite/client" />

import { buildGasTestEnvelope, GAS_TEST_RELAYER_KEYPAIR } from "@repo/stellar/test-fixtures";
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";

import type { DataModel, Id } from "../../_generated/dataModel";
import type { TestConvexForDataModelAndIdentity } from "convex-test";

import { api, internal } from "../../_generated/api";
import { GAS_RELAYER_SIGNERS_ENV } from "../../gas/relayer";
import { GAS_NETWORK } from "../../gas/types";
import schema from "../../schema";
import { gasMaxTimeEnvelopeFixtures } from "./fixtures";

const modules = import.meta.glob("../../**/*.ts");
type TestContext = TestConvexForDataModelAndIdentity<DataModel>;

const OWNER = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
const API_KEY_HASH = "a".repeat(64);
const NOW = Date.parse("2026-09-03T12:34:56.789Z");
const RELAYER_PUBLIC_KEY = GAS_TEST_RELAYER_KEYPAIR.publicKey();

async function withFixedTime<T>(callback: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  try {
    return await callback();
  } finally {
    vi.useRealTimers();
  }
}

async function withSignerConfiguration<T>(
  projectIds: readonly Id<"projects">[],
  callback: () => Promise<T>,
): Promise<T> {
  const previous = process.env[GAS_RELAYER_SIGNERS_ENV];
  process.env[GAS_RELAYER_SIGNERS_ENV] = JSON.stringify(
    projectIds.map((projectId) => ({
      projectId,
      network: GAS_NETWORK,
      secretKey: GAS_TEST_RELAYER_KEYPAIR.secret(),
    })),
  );
  try {
    return await callback();
  } finally {
    if (previous === undefined) delete process.env[GAS_RELAYER_SIGNERS_ENV];
    else process.env[GAS_RELAYER_SIGNERS_ENV] = previous;
  }
}

async function createScope(
  t: TestContext,
  options: { apiKeyHash?: string; dailyCapStroops?: bigint; suffix: string },
): Promise<{ projectId: Id<"projects">; apiKeyId: Id<"apiKeys">; apiKeyHash: string }> {
  const apiKeyHash = options.apiKeyHash ?? API_KEY_HASH;
  return await t.run(async (ctx) => {
    const projectId = await ctx.db.insert("projects", {
      name: `Gas execution ${options.suffix}`,
      slug: `gas-execution-${options.suffix}`,
      description: "Gas execution claim test project",
      metadataJson: "{}",
      metadataHash: "0".repeat(64),
      ownerAddress: OWNER,
      ownerTokenIdentifier: `http://localhost:3000|${OWNER}`,
      status: "draft",
      paymentAccessActive: false,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const apiKeyId = await ctx.db.insert("apiKeys", {
      projectId,
      keyHash: apiKeyHash,
      prefix: "tk_live_test",
      label: "Gas execution test key",
      createdAt: NOW,
      requestCount: 0,
      revoked: false,
    });
    await ctx.db.insert("gasPolicies", {
      projectId,
      enabled: true,
      network: GAS_NETWORK,
      dailyCapStroops: options.dailyCapStroops ?? 10_000n,
      dailyReservedStroops: 0n,
      dailyWindowKey: "2026-09-03",
      walletHourlyLimit: 10,
      allowedContractIds: ["CAK6TTLMWJI3CDXHUC5ANDEB3BOUFGPQ4XO4JNE7R3VZ4LWLCXRUAQWK"],
      createdAt: NOW,
      updatedAt: NOW,
    });
    await ctx.db.insert("relayerAccounts", {
      projectId,
      publicKey: RELAYER_PUBLIC_KEY,
      network: GAS_NETWORK,
      status: "active",
      createdAt: NOW,
      updatedAt: NOW,
    });
    return { projectId, apiKeyId, apiKeyHash };
  });
}

async function readState(t: TestContext, projectId: Id<"projects">) {
  return await t.run(async (ctx) => ({
    policy: await ctx.db
      .query("gasPolicies")
      .withIndex("by_project_id", (q) => q.eq("projectId", projectId))
      .unique(),
    logs: await ctx.db
      .query("gasLogs")
      .withIndex("by_project_id_and_created_at", (q) => q.eq("projectId", projectId))
      .collect(),
    attempts: await ctx.db
      .query("gasExecutionAttempts")
      .withIndex("by_project_id_and_request_id", (q) => q.eq("projectId", projectId))
      .collect(),
  }));
}

async function sponsor(
  t: TestContext,
  transactionXdr: string,
  idempotencyKey: string,
  apiKeyHash = API_KEY_HASH,
) {
  return await t.action(api.gas.public_api.sponsor, {
    apiKeyHash,
    idempotencyKey,
    transactionXdr,
  });
}

test("claims a reservation once, preserves D1 replay, and fences duplicate workers", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const { projectId } = await createScope(t, { suffix: "claim" });
    const transactionXdr = gasMaxTimeEnvelopeFixtures.unbounded;
    const sponsored = await sponsor(t, transactionXdr, "claim-idempotency");
    expect(sponsored.status).toBe("success");
    if (sponsored.status !== "success") throw new Error("Expected a sponsor reservation");

    await withSignerConfiguration([projectId], async () => {
      const first = await t.action(internal.gas.execution_action.claim, {
        apiKeyHash: API_KEY_HASH,
        requestId: sponsored.reservation.requestId,
        transactionXdr,
      });
      expect(first).toMatchObject({
        status: "claimed",
        replayed: false,
        innerTransactionHash: sponsored.reservation.transactionHash,
        approvedHoldStroops: 200n,
        outerTransactionHash: null,
        leaseGeneration: 1,
        sendCount: 0,
      });
      if (first.status !== "claimed") throw new Error("Expected a claim");
      expect(first.leaseToken).toEqual(expect.any(String));
      expect(first.leaseExpiresAt).toBe(NOW + 30_000);

      const afterClaim = await readState(t, projectId);
      expect(afterClaim.logs[0]).toMatchObject({
        lifecycle: "claimed",
        reservedStroops: 200n,
      });
      expect(afterClaim.policy).toMatchObject({
        dailyReservedStroops: 200n,
        outstandingHoldsStroops: 200n,
        dailyConfirmedSpendStroops: 0n,
        accountingState: "initialized",
      });
      expect(afterClaim.attempts).toHaveLength(1);
      expect(afterClaim.attempts[0]).not.toHaveProperty("transactionXdr");

      const replay = await t.action(api.gas.public_api.sponsor, {
        apiKeyHash: API_KEY_HASH,
        idempotencyKey: "claim-idempotency",
        transactionXdr,
      });
      expect(replay).toMatchObject({
        status: "success",
        replayed: true,
        reservation: { lifecycle: "reserved", reservedStroops: "200" },
      });

      const beforeDuplicate = await readState(t, projectId);
      const duplicate = await t.action(internal.gas.execution_action.claim, {
        apiKeyHash: API_KEY_HASH,
        requestId: sponsored.reservation.requestId,
        transactionXdr,
      });
      expect(duplicate).toMatchObject({
        status: "claimed",
        replayed: true,
        executionAttemptId: first.executionAttemptId,
        leaseToken: null,
        leaseExpiresAt: null,
      });
      expect(await readState(t, projectId)).toEqual(beforeDuplicate);
    });
  });
});

test("atomically increases the hold to the exact quote and rejects an insufficient cap", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const { projectId } = await createScope(t, { suffix: "increase", dailyCapStroops: 400n });
    const transactionXdr = buildGasTestEnvelope({ fee: "200" });
    const sponsored = await sponsor(t, transactionXdr, "increase-idempotency");
    expect(sponsored.status).toBe("success");
    if (sponsored.status !== "success") throw new Error("Expected a sponsor reservation");

    const claimed = await withSignerConfiguration([projectId], () =>
      t.action(internal.gas.execution_action.claim, {
        apiKeyHash: API_KEY_HASH,
        requestId: sponsored.reservation.requestId,
        transactionXdr,
      }),
    );
    expect(claimed).toMatchObject({ status: "claimed", approvedHoldStroops: 400n });
    expect((await readState(t, projectId)).policy?.outstandingHoldsStroops).toBe(400n);

    const insufficient = await createScope(t, {
      apiKeyHash: "b".repeat(64),
      dailyCapStroops: 350n,
      suffix: "insufficient-cap",
    });
    const insufficientSponsor = await sponsor(
      t,
      transactionXdr,
      "insufficient-cap-idempotency",
      insufficient.apiKeyHash,
    );
    expect(insufficientSponsor.status).toBe("success");
    if (insufficientSponsor.status !== "success") throw new Error("Expected a reservation");
    const denied = await withSignerConfiguration([insufficient.projectId], () =>
      t.action(internal.gas.execution_action.claim, {
        apiKeyHash: insufficient.apiKeyHash,
        requestId: insufficientSponsor.reservation.requestId,
        transactionXdr,
      }),
    );
    expect(denied).toEqual({ status: "policy_denied" });
    expect((await readState(t, insufficient.projectId)).attempts).toHaveLength(0);
  });
});

test("revoked scope, disabled relayers, malformed XDR, and cross-project identity fail closed", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const first = await createScope(t, { suffix: "first" });
    const second = await createScope(t, { apiKeyHash: "c".repeat(64), suffix: "second" });
    const transactionXdr = gasMaxTimeEnvelopeFixtures.unbounded;
    const sponsored = await sponsor(t, transactionXdr, "fail-closed-idempotency");
    expect(sponsored.status).toBe("success");
    if (sponsored.status !== "success") throw new Error("Expected a sponsor reservation");

    await t.run(async (ctx) => {
      await ctx.db.patch(first.apiKeyId, { revoked: true });
    });

    const revoked = await t.action(internal.gas.execution_action.claim, {
      apiKeyHash: first.apiKeyHash,
      requestId: sponsored.reservation.requestId,
      transactionXdr,
    });
    expect(revoked).toEqual({ status: "unauthorized" });

    const crossProject = await withSignerConfiguration([second.projectId], () =>
      t.action(internal.gas.execution_action.claim, {
        apiKeyHash: second.apiKeyHash,
        requestId: sponsored.reservation.requestId,
        transactionXdr,
      }),
    );
    expect(crossProject).toEqual({ status: "resource_not_found" });

    const malformed = await t.action(internal.gas.execution_action.claim, {
      apiKeyHash: second.apiKeyHash,
      requestId: sponsored.reservation.requestId,
      transactionXdr: "not-an-xdr",
    });
    expect(malformed).toEqual({ status: "invalid_internal_input" });
    expect((await readState(t, first.projectId)).attempts).toHaveLength(0);

    await t.run(async (ctx) => {
      const relayer = await ctx.db
        .query("relayerAccounts")
        .withIndex("by_project_id_and_network", (q) =>
          q.eq("projectId", second.projectId).eq("network", GAS_NETWORK),
        )
        .unique();
      if (!relayer) throw new Error("Missing relayer");
      await ctx.db.patch(relayer._id, { status: "disabled" });
    });

    const secondSponsored = await sponsor(
      t,
      transactionXdr,
      "disabled-relayer-idempotency",
      second.apiKeyHash,
    );
    expect(secondSponsored.status).toBe("success");
    if (secondSponsored.status !== "success") throw new Error("Expected a second reservation");
    const disabled = await withSignerConfiguration([second.projectId], () =>
      t.action(internal.gas.execution_action.claim, {
        apiKeyHash: second.apiKeyHash,
        requestId: secondSponsored.reservation.requestId,
        transactionXdr,
      }),
    );
    expect(disabled).toEqual({ status: "relayer_unavailable" });
  });
});
