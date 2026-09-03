/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";

import type { DataModel, Id } from "../../_generated/dataModel";
import type { TestConvexForDataModelAndIdentity } from "convex-test";

import { api, internal } from "../../_generated/api";
import { GAS_NETWORK, GAS_SUPPORTED_OPERATION } from "../../gas/types";
import schema from "../../schema";

const modules = import.meta.glob("../../**/*.ts");
type TestContext = TestConvexForDataModelAndIdentity<DataModel>;

const OWNER = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
const WALLET = "GBNHK3TLWWXBCEGNFHB45Z66R4AI5YUALKUFBP4WF7YK5JLZIAAG2DLI";
const CONTRACT_ID = "CC7RENKPGXGF6MMEMGJ4YWUBOBGQYOCGG33PNSONQF56UMMAQ22TWH6R";
const NOW = Date.parse("2026-09-03T12:34:56.789Z");
const API_KEY_HASH = "a".repeat(64);
const OTHER_API_KEY_HASH = "b".repeat(64);
const TRANSACTION_HASH = "1".repeat(64);
const OTHER_TRANSACTION_HASH = "2".repeat(64);

type Scope = Readonly<{
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
  options: { apiKeyHash?: string; projectSuffix?: string } = {},
): Promise<Scope> {
  const apiKeyHash = options.apiKeyHash ?? API_KEY_HASH;
  const projectSuffix = options.projectSuffix ?? apiKeyHash.slice(0, 6);
  return await t.run(async (ctx) => {
    const projectId = await ctx.db.insert("projects", {
      name: `Gas Submit ${projectSuffix}`,
      slug: `gas-submit-${projectSuffix}`,
      description: "Gas submit test project",
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
      label: "Gas submit test key",
      createdAt: NOW,
      requestCount: 0,
      revoked: false,
    });
    return { projectId, apiKeyId, apiKeyHash };
  });
}

async function createPolicy(
  t: TestContext,
  projectId: Id<"projects">,
  options: { enabled?: boolean; dailyReservedStroops?: bigint; dailyWindowKey?: string } = {},
): Promise<Id<"gasPolicies">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("gasPolicies", {
      projectId,
      enabled: options.enabled ?? true,
      network: GAS_NETWORK,
      dailyCapStroops: 10_000n,
      dailyReservedStroops: options.dailyReservedStroops ?? 0n,
      dailyWindowKey: options.dailyWindowKey ?? "2026-09-03",
      walletHourlyLimit: 10,
      allowedContractIds: [CONTRACT_ID],
      createdAt: NOW,
      updatedAt: NOW,
    }),
  );
}

async function reserve(
  t: TestContext,
  scope: Scope,
  overrides: Partial<{
    idempotencyKeyHash: string;
    requestFingerprint: string;
    transactionHash: string;
  }> = {},
) {
  return await t.mutation(internal.gas.admission.reserve, {
    apiKeyId: scope.apiKeyId,
    projectId: scope.projectId,
    apiKeyHash: scope.apiKeyHash,
    idempotencyKeyHash: overrides.idempotencyKeyHash ?? "c".repeat(64),
    requestFingerprint: overrides.requestFingerprint ?? "d".repeat(64),
    network: GAS_NETWORK,
    operation: GAS_SUPPORTED_OPERATION,
    sourceWallet: WALLET,
    targetContractIds: [CONTRACT_ID],
    transactionHash: overrides.transactionHash ?? TRANSACTION_HASH,
    innerMaxFeeStroops: 100n,
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
    bucket: await ctx.db
      .query("rateLimitBuckets")
      .withIndex("by_scope_key", (q) => q.eq("scopeKey", `gas:${projectId}:wallet:${WALLET}`))
      .unique(),
  }));
}

async function setReservationExpiry(
  t: TestContext,
  projectId: Id<"projects">,
  requestId: string,
  expiresAt: number,
): Promise<void> {
  await t.run(async (ctx) => {
    const reservation = await ctx.db
      .query("gasLogs")
      .withIndex("by_project_id_and_request_id", (q) =>
        q.eq("projectId", projectId).eq("requestId", requestId),
      )
      .unique();
    if (!reservation) throw new Error("Missing test reservation");
    await ctx.db.patch(reservation._id, { expiresAt });
  });
}

test("active submit handoff is repeat-safe and performs no writes", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const scope = await createScope(t);
    await createPolicy(t, scope.projectId);
    const reservation = await reserve(t, scope);
    expect(reservation.status).toBe("decision");
    if (reservation.status !== "decision") throw new Error("Expected a reservation");

    const before = await readState(t, scope.projectId);
    const first = await t.action(api.gas.public_api.submit, {
      apiKeyHash: scope.apiKeyHash,
      requestId: reservation.log.requestId,
      transactionHash: TRANSACTION_HASH.toUpperCase(),
    });
    const replay = await t.action(api.gas.public_api.submit, {
      apiKeyHash: scope.apiKeyHash,
      requestId: reservation.log.requestId,
      transactionHash: TRANSACTION_HASH,
    });

    expect(first).toEqual({ status: "handoff_unavailable" });
    expect(replay).toEqual(first);
    expect(await readState(t, scope.projectId)).toEqual(before);
  });
});

test("unknown and cross-project request IDs return the same project-safe result", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const firstScope = await createScope(t, { projectSuffix: "first" });
    const secondScope = await createScope(t, {
      apiKeyHash: OTHER_API_KEY_HASH,
      projectSuffix: "second",
    });
    await createPolicy(t, firstScope.projectId);
    await createPolicy(t, secondScope.projectId);
    const secondReservation = await reserve(t, secondScope);
    expect(secondReservation.status).toBe("decision");
    if (secondReservation.status !== "decision") throw new Error("Expected a reservation");

    const crossProject = await t.action(api.gas.public_api.submit, {
      apiKeyHash: firstScope.apiKeyHash,
      requestId: secondReservation.log.requestId,
      transactionHash: TRANSACTION_HASH,
    });
    const unknown = await t.action(api.gas.public_api.submit, {
      apiKeyHash: firstScope.apiKeyHash,
      requestId: "request-does-not-exist",
      transactionHash: TRANSACTION_HASH,
    });

    expect(crossProject).toEqual({ status: "resource_not_found" });
    expect(unknown).toEqual(crossProject);
    expect((await readState(t, firstScope.projectId)).logs).toHaveLength(0);
  });
});

test("hash mismatches and rejected reservations return stable lifecycle conflicts", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const scope = await createScope(t);
    await createPolicy(t, scope.projectId);
    const reservation = await reserve(t, scope);
    expect(reservation.status).toBe("decision");
    if (reservation.status !== "decision") throw new Error("Expected a reservation");

    const mismatch = await t.action(api.gas.public_api.submit, {
      apiKeyHash: scope.apiKeyHash,
      requestId: reservation.log.requestId,
      transactionHash: OTHER_TRANSACTION_HASH,
    });
    expect(mismatch).toEqual({ status: "invalid_lifecycle" });

    const rejectedScope = await createScope(t, {
      apiKeyHash: OTHER_API_KEY_HASH,
      projectSuffix: "rejected",
    });
    await createPolicy(t, rejectedScope.projectId, { enabled: false });
    const rejected = await reserve(t, rejectedScope);
    expect(rejected.status).toBe("decision");
    if (rejected.status !== "decision") throw new Error("Expected a rejected decision");

    const rejectedSubmit = await t.action(api.gas.public_api.submit, {
      apiKeyHash: rejectedScope.apiKeyHash,
      requestId: rejected.log.requestId,
      transactionHash: TRANSACTION_HASH,
    });
    expect(rejectedSubmit).toEqual({ status: "invalid_lifecycle" });
  });
});

test("expired reservations transition once, release current-day budget, and preserve wallet quota", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const scope = await createScope(t);
    const policyId = await createPolicy(t, scope.projectId);
    const reservation = await reserve(t, scope);
    expect(reservation.status).toBe("decision");
    if (reservation.status !== "decision") throw new Error("Expected a reservation");

    await setReservationExpiry(t, scope.projectId, reservation.log.requestId, NOW - 1);
    const beforeExpiry = await readState(t, scope.projectId);
    expect(beforeExpiry.policy?._id).toBe(policyId);
    expect(beforeExpiry.policy?.dailyReservedStroops).toBe(200n);
    expect(beforeExpiry.bucket?.tokens).toBe(1);

    const first = await t.action(api.gas.public_api.submit, {
      apiKeyHash: scope.apiKeyHash,
      requestId: reservation.log.requestId,
      transactionHash: TRANSACTION_HASH,
    });
    expect(first).toEqual({ status: "reservation_expired" });

    const afterFirst = await readState(t, scope.projectId);
    expect(afterFirst.policy?.dailyReservedStroops).toBe(0n);
    expect(afterFirst.bucket?.tokens).toBe(1);
    expect(afterFirst.logs[0]?.lifecycle).toBe("expired");
    expect(afterFirst.logs[0]?.updatedAt).toBe(NOW);

    const replay = await t.action(api.gas.public_api.submit, {
      apiKeyHash: scope.apiKeyHash,
      requestId: reservation.log.requestId,
      transactionHash: TRANSACTION_HASH,
    });
    expect(replay).toEqual({ status: "reservation_expired" });
    expect(await readState(t, scope.projectId)).toEqual(afterFirst);
  });
});

test("expiry after a UTC rollover does not subtract an old reservation from the new day", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const scope = await createScope(t);
    await createPolicy(t, scope.projectId, {
      dailyWindowKey: "2026-09-03",
    });
    const requestId = "rollover-request";
    await t.run(async (ctx) => {
      await ctx.db.insert("gasLogs", {
        projectId: scope.projectId,
        requestId,
        idempotencyKeyHash: "e".repeat(64),
        requestFingerprint: "f".repeat(64),
        transactionHash: TRANSACTION_HASH,
        sourceWallet: WALLET,
        targetContractIds: [CONTRACT_ID],
        innerMaxFeeStroops: 100n,
        reservedStroops: 200n,
        decisionCode: "reserved",
        lifecycle: "reserved",
        expiresAt: NOW - 1,
        retentionExpiresAt: NOW + 30 * 24 * 60 * 60 * 1_000,
        createdAt: NOW - 24 * 60 * 60 * 1_000,
        updatedAt: NOW - 24 * 60 * 60 * 1_000,
      });
    });

    const before = await readState(t, scope.projectId);
    const result = await t.action(api.gas.public_api.submit, {
      apiKeyHash: scope.apiKeyHash,
      requestId,
      transactionHash: TRANSACTION_HASH,
    });

    expect(result).toEqual({ status: "reservation_expired" });
    const after = await readState(t, scope.projectId);
    expect(after.policy).toEqual(before.policy);
    expect(after.logs[0]?.lifecycle).toBe("expired");
  });
});

test("revoked keys and corrupt accounting fail closed without partial writes", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const scope = await createScope(t);
    const policyId = await createPolicy(t, scope.projectId);
    const reservation = await reserve(t, scope);
    expect(reservation.status).toBe("decision");
    if (reservation.status !== "decision") throw new Error("Expected a reservation");

    await t.run(async (ctx) => {
      const log = await ctx.db
        .query("gasLogs")
        .withIndex("by_project_id_and_request_id", (q) =>
          q.eq("projectId", scope.projectId).eq("requestId", reservation.log.requestId),
        )
        .unique();
      if (!log) throw new Error("Missing test reservation");
      await ctx.db.patch(log._id, { expiresAt: NOW - 1 });
      await ctx.db.patch(policyId, { dailyReservedStroops: 199n });
      await ctx.db.patch(scope.apiKeyId, { revoked: true });
    });
    const beforeRevoked = await readState(t, scope.projectId);
    const revoked = await t.action(api.gas.public_api.submit, {
      apiKeyHash: scope.apiKeyHash,
      requestId: reservation.log.requestId,
      transactionHash: TRANSACTION_HASH,
    });
    expect(revoked).toEqual({ status: "unauthorized" });
    expect(await readState(t, scope.projectId)).toEqual(beforeRevoked);

    await t.run(async (ctx) => {
      await ctx.db.patch(scope.apiKeyId, { revoked: false });
    });
    const beforeCorruptAccounting = await readState(t, scope.projectId);
    const corruptAccounting = await t.action(api.gas.public_api.submit, {
      apiKeyHash: scope.apiKeyHash,
      requestId: reservation.log.requestId,
      transactionHash: TRANSACTION_HASH,
    });
    expect(corruptAccounting).toEqual({ status: "internal_error" });
    expect(await readState(t, scope.projectId)).toEqual(beforeCorruptAccounting);
  });
});
