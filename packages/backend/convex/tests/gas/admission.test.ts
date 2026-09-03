/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";

import type { DataModel, Id } from "../../_generated/dataModel";
import type { TestConvexForDataModelAndIdentity } from "convex-test";

import { internal } from "../../_generated/api";
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
const FIRST_IDEMPOTENCY_HASH = "c".repeat(64);
const SECOND_IDEMPOTENCY_HASH = "d".repeat(64);
const FIRST_FINGERPRINT = "e".repeat(64);
const SECOND_FINGERPRINT = "f".repeat(64);
const FIRST_TRANSACTION_HASH = "1".repeat(64);
const SECOND_TRANSACTION_HASH = "2".repeat(64);

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
      name: `Gas Admission ${projectSuffix}`,
      slug: `gas-admission-${projectSuffix}`,
      description: "Gas admission test project",
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
      label: "Gas admission test key",
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
  options: {
    enabled?: boolean;
    dailyCapStroops?: bigint;
    dailyReservedStroops?: bigint;
    dailyWindowKey?: string;
    walletHourlyLimit?: number;
    allowedContractIds?: string[];
  } = {},
): Promise<Id<"gasPolicies">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("gasPolicies", {
      projectId,
      enabled: options.enabled ?? true,
      network: GAS_NETWORK,
      dailyCapStroops: options.dailyCapStroops ?? 10_000n,
      dailyReservedStroops: options.dailyReservedStroops ?? 0n,
      dailyWindowKey: options.dailyWindowKey ?? "2026-09-03",
      walletHourlyLimit: options.walletHourlyLimit ?? 10,
      allowedContractIds: options.allowedContractIds ?? [CONTRACT_ID],
      createdAt: NOW,
      updatedAt: NOW,
    }),
  );
}

function admissionArgs(
  scope: Scope,
  overrides: Partial<{
    apiKeyId: Id<"apiKeys">;
    projectId: Id<"projects">;
    apiKeyHash: string;
    idempotencyKeyHash: string;
    requestFingerprint: string;
    network: string;
    operation: string;
    sourceWallet: string;
    targetContractIds: string[];
    transactionHash: string;
    innerMaxFeeStroops: bigint;
    innerMaxTime: number;
  }> = {},
) {
  return {
    apiKeyId: scope.apiKeyId,
    projectId: scope.projectId,
    apiKeyHash: scope.apiKeyHash,
    idempotencyKeyHash: FIRST_IDEMPOTENCY_HASH,
    requestFingerprint: FIRST_FINGERPRINT,
    network: GAS_NETWORK,
    operation: GAS_SUPPORTED_OPERATION,
    sourceWallet: WALLET,
    targetContractIds: [CONTRACT_ID],
    transactionHash: FIRST_TRANSACTION_HASH,
    innerMaxFeeStroops: 50n,
    ...overrides,
  };
}

async function readAdmissionState(t: TestContext, projectId: Id<"projects">) {
  return await t.run(async (ctx) => ({
    policy: await ctx.db
      .query("gasPolicies")
      .withIndex("by_project_id", (q) => q.eq("projectId", projectId))
      .unique(),
    bucket: await ctx.db
      .query("rateLimitBuckets")
      .withIndex("by_scope_key", (q) => q.eq("scopeKey", `gas:${projectId}:wallet:${WALLET}`))
      .unique(),
    logs: await ctx.db
      .query("gasLogs")
      .withIndex("by_project_id_and_created_at", (q) => q.eq("projectId", projectId))
      .collect(),
  }));
}

test("first reservation stores exact inner fee plus overhead and consumes one wallet unit", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const scope = await createScope(t);
    await createPolicy(t, scope.projectId);

    const result = await t.mutation(
      internal.gas.admission.reserve,
      admissionArgs(scope, { innerMaxFeeStroops: 50n }),
    );

    expect(result.status).toBe("decision");
    if (result.status !== "decision") throw new Error("Expected a decision");
    expect(result.replayed).toBe(false);
    expect(result.log).toMatchObject({
      transactionHash: FIRST_TRANSACTION_HASH,
      sourceWallet: WALLET,
      targetContractIds: [CONTRACT_ID],
      innerMaxFeeStroops: "50",
      reservedStroops: "150",
      decisionCode: "reserved",
      rejectionCode: null,
      lifecycle: "reserved",
      expiresAt: NOW + 15 * 60_000,
    });
    expect(Object.keys(result.log).sort()).toEqual([
      "actualFeeStroops",
      "createdAt",
      "decisionCode",
      "expiresAt",
      "innerMaxFeeStroops",
      "lifecycle",
      "rejectionCode",
      "requestId",
      "reservedStroops",
      "sourceWallet",
      "targetContractIds",
      "transactionHash",
      "updatedAt",
    ]);

    const state = await readAdmissionState(t, scope.projectId);
    expect(state.policy?.dailyReservedStroops).toBe(150n);
    expect(state.bucket).toMatchObject({ tokens: 1, updatedAt: NOW });
    expect(state.logs).toHaveLength(1);
  });
});

test("same idempotency key and fingerprint replays without a second write", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const scope = await createScope(t);
    await createPolicy(t, scope.projectId);

    const args = admissionArgs(scope);
    const first = await t.mutation(internal.gas.admission.reserve, args);
    const beforeReplay = await readAdmissionState(t, scope.projectId);
    const replay = await t.mutation(internal.gas.admission.reserve, args);
    const afterReplay = await readAdmissionState(t, scope.projectId);

    expect(first.status).toBe("decision");
    expect(replay).toMatchObject({ status: "decision", replayed: true });
    if (first.status !== "decision" || replay.status !== "decision") {
      throw new Error("Expected decisions");
    }
    expect(replay.log.requestId).toBe(first.log.requestId);
    expect(afterReplay).toEqual(beforeReplay);
  });
});

test("same idempotency key with a different fingerprint conflicts without a write", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const scope = await createScope(t);
    await createPolicy(t, scope.projectId);
    await t.mutation(internal.gas.admission.reserve, admissionArgs(scope));
    const beforeConflict = await readAdmissionState(t, scope.projectId);

    const conflict = await t.mutation(
      internal.gas.admission.reserve,
      admissionArgs(scope, { requestFingerprint: SECOND_FINGERPRINT }),
    );

    expect(conflict).toEqual({ status: "idempotency_key_conflict" });
    expect(await readAdmissionState(t, scope.projectId)).toEqual(beforeConflict);
  });
});

test("a duplicate reserved transaction hash conflicts after idempotency resolution", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const scope = await createScope(t);
    await createPolicy(t, scope.projectId);
    await t.mutation(internal.gas.admission.reserve, admissionArgs(scope));

    const duplicate = await t.mutation(
      internal.gas.admission.reserve,
      admissionArgs(scope, {
        idempotencyKeyHash: SECOND_IDEMPOTENCY_HASH,
        requestFingerprint: SECOND_FINGERPRINT,
      }),
    );

    expect(duplicate).toEqual({ status: "duplicate_transaction" });
    expect((await readAdmissionState(t, scope.projectId)).logs).toHaveLength(1);
  });
});

test("policy denial is replayable, redacted, and consumes neither budget nor wallet quota", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const scope = await createScope(t);
    await createPolicy(t, scope.projectId, { enabled: false });

    const result = await t.mutation(internal.gas.admission.reserve, admissionArgs(scope));

    expect(result).toMatchObject({ status: "decision", replayed: false });
    if (result.status !== "decision") throw new Error("Expected a decision");
    expect(result.log).toMatchObject({
      transactionHash: null,
      reservedStroops: null,
      expiresAt: null,
      innerMaxFeeStroops: "50",
      decisionCode: "rejected",
      rejectionCode: "policy_disabled",
      lifecycle: "rejected",
    });
    const state = await readAdmissionState(t, scope.projectId);
    expect(state.policy?.dailyReservedStroops).toBe(0n);
    expect(state.bucket).toBeNull();
    expect(state.logs).toHaveLength(1);

    const replay = await t.mutation(internal.gas.admission.reserve, admissionArgs(scope));
    expect(replay).toMatchObject({ status: "decision", replayed: true });
    expect((await readAdmissionState(t, scope.projectId)).logs).toHaveLength(1);
  });
});

test("a formerly denied request can be retried with a new key after policy correction", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const scope = await createScope(t);
    const policyId = await createPolicy(t, scope.projectId, { enabled: false });

    const denied = await t.mutation(internal.gas.admission.reserve, admissionArgs(scope));
    expect(denied.status).toBe("decision");

    await t.run(async (ctx) => {
      await ctx.db.patch(policyId, { enabled: true, updatedAt: NOW });
    });
    const approved = await t.mutation(
      internal.gas.admission.reserve,
      admissionArgs(scope, {
        idempotencyKeyHash: SECOND_IDEMPOTENCY_HASH,
        requestFingerprint: SECOND_FINGERPRINT,
      }),
    );

    expect(approved).toMatchObject({ status: "decision", replayed: false });
    if (approved.status !== "decision") throw new Error("Expected approval");
    expect(approved.log.transactionHash).toBe(FIRST_TRANSACTION_HASH);
    expect((await readAdmissionState(t, scope.projectId)).logs).toHaveLength(2);
  });
});

test("daily-cap and wallet-quota denials do not consume the other accounting dimension", async () => {
  await withFixedTime(async () => {
    const dailyCapTest = convexTest(schema, modules);
    const dailyScope = await createScope(dailyCapTest, { projectSuffix: "daily-cap" });
    await createPolicy(dailyCapTest, dailyScope.projectId, { dailyCapStroops: 100n });
    const dailyDenied = await dailyCapTest.mutation(
      internal.gas.admission.reserve,
      admissionArgs(dailyScope),
    );
    expect(dailyDenied).toMatchObject({ status: "decision" });
    if (dailyDenied.status !== "decision") throw new Error("Expected daily cap decision");
    expect(dailyDenied.log.rejectionCode).toBe("daily_cap_exceeded");
    expect((await readAdmissionState(dailyCapTest, dailyScope.projectId)).bucket).toBeNull();

    const walletQuotaTest = convexTest(schema, modules);
    const walletScope = await createScope(walletQuotaTest, { projectSuffix: "wallet-quota" });
    await createPolicy(walletQuotaTest, walletScope.projectId, { walletHourlyLimit: 0 });
    const quotaDenied = await walletQuotaTest.mutation(
      internal.gas.admission.reserve,
      admissionArgs(walletScope),
    );
    expect(quotaDenied).toMatchObject({ status: "decision" });
    if (quotaDenied.status !== "decision") throw new Error("Expected quota decision");
    expect(quotaDenied.log.rejectionCode).toBe("wallet_rate_limited");
    expect(
      (await readAdmissionState(walletQuotaTest, walletScope.projectId)).policy
        ?.dailyReservedStroops,
    ).toBe(0n);
  });
});

test("daily and wallet-hour windows roll over from their stored UTC timestamps", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const scope = await createScope(t);
    await createPolicy(t, scope.projectId, {
      dailyCapStroops: 300n,
      dailyReservedStroops: 300n,
      dailyWindowKey: "2026-09-02",
      walletHourlyLimit: 2,
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("rateLimitBuckets", {
        scopeKey: `gas:${scope.projectId}:wallet:${WALLET}`,
        tokens: 2,
        updatedAt: NOW - 60 * 60_000,
      });
    });

    const result = await t.mutation(internal.gas.admission.reserve, admissionArgs(scope));

    expect(result).toMatchObject({ status: "decision" });
    if (result.status !== "decision") throw new Error("Expected rollover approval");
    expect(result.log.decisionCode).toBe("reserved");
    const state = await readAdmissionState(t, scope.projectId);
    expect(state.policy).toMatchObject({
      dailyWindowKey: "2026-09-03",
      dailyReservedStroops: 150n,
    });
    expect(state.bucket).toMatchObject({ tokens: 1, updatedAt: NOW });
  });
});

test("reservation expiry uses the earlier inner maxTime and rejects expired bounds", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const scope = await createScope(t);
    await createPolicy(t, scope.projectId);
    const maxTime = Math.floor((NOW + 30_000) / 1_000);

    const bounded = await t.mutation(
      internal.gas.admission.reserve,
      admissionArgs(scope, { innerMaxTime: maxTime }),
    );
    expect(bounded).toMatchObject({ status: "decision" });
    if (bounded.status !== "decision") throw new Error("Expected bounded decision");
    expect(bounded.log.expiresAt).toBe(maxTime * 1_000);

    const invalid = await t.mutation(
      internal.gas.admission.reserve,
      admissionArgs(scope, {
        idempotencyKeyHash: SECOND_IDEMPOTENCY_HASH,
        requestFingerprint: SECOND_FINGERPRINT,
        transactionHash: SECOND_TRANSACTION_HASH,
        innerMaxTime: Math.floor((NOW - 1_000) / 1_000),
      }),
    );
    expect(invalid).toEqual({ status: "invalid_internal_input" });
    expect((await readAdmissionState(t, scope.projectId)).logs).toHaveLength(1);
  });
});

test("reservation expiry ignores later and zero maxTime values in favor of the 15-minute bound", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const scope = await createScope(t);
    await createPolicy(t, scope.projectId);

    const later = await t.mutation(
      internal.gas.admission.reserve,
      admissionArgs(scope, {
        innerMaxTime: Math.floor((NOW + 20 * 60_000) / 1_000),
      }),
    );
    const zero = await t.mutation(
      internal.gas.admission.reserve,
      admissionArgs(scope, {
        idempotencyKeyHash: SECOND_IDEMPOTENCY_HASH,
        requestFingerprint: SECOND_FINGERPRINT,
        transactionHash: SECOND_TRANSACTION_HASH,
        innerMaxTime: 0,
      }),
    );

    expect(later).toMatchObject({ status: "decision" });
    expect(zero).toMatchObject({ status: "decision" });
    if (later.status !== "decision" || zero.status !== "decision") {
      throw new Error("Expected maxTime decisions");
    }
    expect(later.log.expiresAt).toBe(NOW + 15 * 60_000);
    expect(zero.log.expiresAt).toBe(NOW + 15 * 60_000);
  });
});

test("revoked keys and project-scope mismatches are rejected without an audit record", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const scope = await createScope(t);
    const otherScope = await createScope(t, {
      apiKeyHash: OTHER_API_KEY_HASH,
      projectSuffix: "other-project",
    });
    await createPolicy(t, scope.projectId);
    await createPolicy(t, otherScope.projectId);

    await t.run(async (ctx) => {
      await ctx.db.patch(scope.apiKeyId, { revoked: true });
    });
    const revoked = await t.mutation(internal.gas.admission.reserve, admissionArgs(scope));
    expect(revoked).toEqual({ status: "unauthorized" });
    expect((await readAdmissionState(t, scope.projectId)).logs).toHaveLength(0);

    const mismatch = await t.mutation(
      internal.gas.admission.reserve,
      admissionArgs({
        apiKeyId: otherScope.apiKeyId,
        apiKeyHash: otherScope.apiKeyHash,
        projectId: scope.projectId,
      }),
    );
    expect(mismatch).toEqual({ status: "unauthorized" });
    expect((await readAdmissionState(t, scope.projectId)).logs).toHaveLength(0);
  });
});

test("concurrent unique requests admit only the daily-cap boundary", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const scope = await createScope(t);
    await createPolicy(t, scope.projectId, { dailyCapStroops: 300n, walletHourlyLimit: 10 });

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        t.mutation(
          internal.gas.admission.reserve,
          admissionArgs(scope, {
            idempotencyKeyHash: `${index + 3}`.repeat(64 / String(index + 3).length),
            requestFingerprint: `${index + 4}`.repeat(64 / String(index + 4).length),
            transactionHash: `${index + 5}`.repeat(64 / String(index + 5).length),
          }),
        ),
      ),
    );

    expect(
      results.filter(
        (result) => result.status === "decision" && result.log.decisionCode === "reserved",
      ),
    ).toHaveLength(2);
    expect(
      results.filter(
        (result) =>
          result.status === "decision" && result.log.rejectionCode === "daily_cap_exceeded",
      ),
    ).toHaveLength(3);
    const state = await readAdmissionState(t, scope.projectId);
    expect(state.policy?.dailyReservedStroops).toBe(300n);
    expect(state.bucket?.tokens).toBe(2);
  });
});

test("concurrent unique requests admit only the wallet-quota boundary", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const scope = await createScope(t);
    await createPolicy(t, scope.projectId, { dailyCapStroops: 10_000n, walletHourlyLimit: 2 });

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        t.mutation(
          internal.gas.admission.reserve,
          admissionArgs(scope, {
            idempotencyKeyHash: `${index + 3}`.repeat(64 / String(index + 3).length),
            requestFingerprint: `${index + 4}`.repeat(64 / String(index + 4).length),
            transactionHash: `${index + 5}`.repeat(64 / String(index + 5).length),
          }),
        ),
      ),
    );

    expect(
      results.filter(
        (result) => result.status === "decision" && result.log.decisionCode === "reserved",
      ),
    ).toHaveLength(2);
    expect(
      results.filter(
        (result) =>
          result.status === "decision" && result.log.rejectionCode === "wallet_rate_limited",
      ),
    ).toHaveLength(3);
    const state = await readAdmissionState(t, scope.projectId);
    expect(state.policy?.dailyReservedStroops).toBe(300n);
    expect(state.bucket?.tokens).toBe(2);
  });
});
