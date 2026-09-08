/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";

import type { DataModel, Doc, Id } from "../../_generated/dataModel";
import type { TestConvexForDataModelAndIdentity } from "convex-test";

import { internal } from "../../_generated/api";
import { GAS_DECISION_CODES, GAS_LIFECYCLE_STATES, GAS_NETWORK } from "../../gas/types";
import schema from "../../schema";

const modules = import.meta.glob("../../**/*.ts");
type TestContext = TestConvexForDataModelAndIdentity<DataModel>;

const NOW = Date.parse("2026-09-03T12:34:56.789Z");
const RETENTION_PERIOD_MS = 30 * 24 * 60 * 60 * 1_000;
const RETENTION_WORKER_NAME = "gas/retention:expireLogs";

type GasLogInput = Omit<Doc<"gasLogs">, "_id" | "_creationTime">;

async function withFixedTime<T>(callback: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  try {
    return await callback();
  } finally {
    vi.useRealTimers();
  }
}

async function createProject(t: TestContext): Promise<Id<"projects">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("projects", {
      name: "Gas retention test project",
      slug: "gas-retention-test",
      description: "Gas retention tests",
      metadataJson: "{}",
      metadataHash: "0".repeat(64),
      ownerAddress: "gas-retention-owner",
      status: "draft",
      createdAt: NOW,
      updatedAt: NOW,
    }),
  );
}

function logInput(
  projectId: Id<"projects">,
  requestId: string,
  options: Pick<GasLogInput, "lifecycle" | "retentionExpiresAt" | "expiresAt"> &
    Partial<Pick<GasLogInput, "reservedStroops">>,
): GasLogInput {
  const createdAt = options.retentionExpiresAt - RETENTION_PERIOD_MS;
  const isRejected = options.lifecycle === GAS_LIFECYCLE_STATES.rejected;
  return {
    projectId,
    requestId,
    idempotencyKeyHash: `idempotency-${requestId}`,
    requestFingerprint: `fingerprint-${requestId}`,
    decisionCode: isRejected ? GAS_DECISION_CODES.rejected : GAS_DECISION_CODES.reserved,
    ...(isRejected ? { rejectionCode: "policy_disabled" as const } : {}),
    lifecycle: options.lifecycle,
    expiresAt: options.expiresAt,
    ...(options.reservedStroops === undefined ? {} : { reservedStroops: options.reservedStroops }),
    retentionExpiresAt: options.retentionExpiresAt,
    createdAt,
    updatedAt: createdAt,
  };
}

async function createPolicy(
  t: TestContext,
  projectId: Id<"projects">,
  outstandingHoldsStroops: bigint,
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("gasPolicies", {
      projectId,
      enabled: true,
      network: GAS_NETWORK,
      dailyCapStroops: 1_000n,
      dailyReservedStroops: outstandingHoldsStroops,
      dailyWindowKey: "2026-09-03",
      outstandingHoldsStroops,
      dailyConfirmedSpendStroops: 0n,
      accountingState: "initialized",
      walletHourlyLimit: 10,
      allowedContractIds: [],
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
}

async function insertLogs(t: TestContext, logs: readonly GasLogInput[]): Promise<void> {
  await t.run(async (ctx) => {
    for (const log of logs) await ctx.db.insert("gasLogs", log);
  });
}

async function readLogs(t: TestContext): Promise<Doc<"gasLogs">[]> {
  return await t.run(async (ctx) =>
    ctx.db.query("gasLogs").withIndex("by_retention_expires_at").collect(),
  );
}

test("deletes logs at or before retention expiry regardless of lifecycle or reservation expiry", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const projectId = await createProject(t);

    await insertLogs(t, [
      logInput(projectId, "eligible-reserved", {
        lifecycle: GAS_LIFECYCLE_STATES.reserved,
        expiresAt: NOW + 60 * 60_000,
        retentionExpiresAt: NOW - 1,
      }),
      logInput(projectId, "eligible-rejected", {
        lifecycle: GAS_LIFECYCLE_STATES.rejected,
        expiresAt: NOW + 60 * 60_000,
        retentionExpiresAt: NOW,
      }),
      logInput(projectId, "eligible-expired", {
        lifecycle: GAS_LIFECYCLE_STATES.expired,
        expiresAt: NOW + 60 * 60_000,
        retentionExpiresAt: NOW,
      }),
      logInput(projectId, "future-retention-expired-reservation", {
        lifecycle: GAS_LIFECYCLE_STATES.reserved,
        expiresAt: NOW - 1,
        retentionExpiresAt: NOW + 1,
      }),
    ]);

    const deleted = await t.mutation(internal.gas.retention.expireLogs, {});

    expect(deleted).toBe(3);
    expect((await readLogs(t)).map((log) => log.requestId)).toEqual([
      "future-retention-expired-reservation",
    ]);
  });
});

test("deletes mixed D1 and execution-owned audit rows while retaining D2 recovery state", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const projectId = await createProject(t);
    const innerTransactionHash = "c".repeat(64);
    const outerTransactionHash = "d".repeat(64);
    const relayerPublicKey = "GAS-TEST-RELAYER";

    await t.run(async (ctx) => {
      await ctx.db.insert("gasExecutionAttempts", {
        projectId,
        network: GAS_NETWORK,
        requestId: "execution-owned-audit",
        idempotencyKeyHash: "a".repeat(64),
        requestFingerprint: "b".repeat(64),
        innerTransactionHash,
        sourceWallet: "GAS-TEST-WALLET",
        targetContractIds: ["GAS-TEST-CONTRACT"],
        innerMaxFeeStroops: 100n,
        originalReservationStroops: 200n,
        reservationCreatedAt: NOW,
        reservationExpiresAt: NOW + 900_000,
        accountingDayKey: "2026-09-03",
        lifecycle: GAS_LIFECYCLE_STATES.submissionUnknown,
        approvedHoldStroops: 300n,
        feeCeilingStroops: 300n,
        relayerPublicKey,
        outerTransactionHash,
        outerFeeStroops: 300n,
        leaseGeneration: 2,
        sendCount: 1,
        nextCheckAt: NOW,
        firstPossibleSendAt: NOW,
        reconciliationDeadlineAt: NOW + 24 * 60 * 60 * 1_000,
        reconciliationRequired: true,
        verifiedLedgerEvidence: {
          outerTransactionHash,
          innerTransactionHash,
          feeSource: relayerPublicKey,
          ledger: 42,
          resultCode: "txFeeBumpInnerSuccess",
          innerResultCode: "txSuccess",
          chargedStroops: 187n,
          observedAt: NOW,
        },
        createdAt: NOW,
        updatedAt: NOW,
      });
      await ctx.db.insert("gasLogs", {
        projectId,
        requestId: "execution-owned-audit",
        idempotencyKeyHash: "a".repeat(64),
        requestFingerprint: "b".repeat(64),
        transactionHash: innerTransactionHash,
        sourceWallet: "GAS-TEST-WALLET",
        targetContractIds: ["GAS-TEST-CONTRACT"],
        innerMaxFeeStroops: 100n,
        reservedStroops: 200n,
        decisionCode: GAS_DECISION_CODES.reserved,
        lifecycle: GAS_LIFECYCLE_STATES.submissionUnknown,
        expiresAt: NOW + 900_000,
        retentionExpiresAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      });
    });
    await insertLogs(t, [
      logInput(projectId, "legacy-rejected", {
        lifecycle: GAS_LIFECYCLE_STATES.rejected,
        expiresAt: NOW + 900_000,
        retentionExpiresAt: NOW,
      }),
    ]);

    const deleted = await t.mutation(internal.gas.retention.expireLogs, { limit: 100 });
    expect(deleted).toBe(2);
    expect(await readLogs(t)).toEqual([]);

    const attempt = await t.run(async (ctx) =>
      ctx.db
        .query("gasExecutionAttempts")
        .withIndex("by_project_id_and_request_id", (q) =>
          q.eq("projectId", projectId).eq("requestId", "execution-owned-audit"),
        )
        .unique(),
    );
    expect(attempt).toMatchObject({
      outerTransactionHash,
      innerTransactionHash,
      reconciliationRequired: true,
      verifiedLedgerEvidence: { chargedStroops: 187n },
    });
    expect(attempt).not.toHaveProperty("transactionXdr");
    expect(attempt).not.toHaveProperty("signature");
    expect(attempt).not.toHaveProperty("providerPayload");
  });
});

test("deletes bounded pages and schedules immediate continuation for the remainder", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const projectId = await createProject(t);
    const eligibleLogs = Array.from({ length: 105 }, (_, index) =>
      logInput(projectId, `eligible-${index}`, {
        lifecycle: GAS_LIFECYCLE_STATES.expired,
        expiresAt: NOW - 1,
        retentionExpiresAt: NOW,
      }),
    );
    const ineligibleLogs = [
      logInput(projectId, "future-retention-one", {
        lifecycle: GAS_LIFECYCLE_STATES.reserved,
        expiresAt: NOW - 1,
        retentionExpiresAt: NOW + 1,
      }),
      logInput(projectId, "future-retention-two", {
        lifecycle: GAS_LIFECYCLE_STATES.rejected,
        expiresAt: NOW - 1,
        retentionExpiresAt: NOW + 1,
      }),
    ];
    await insertLogs(t, [...eligibleLogs, ...ineligibleLogs]);

    const deleted = await t.mutation(internal.gas.retention.expireLogs, {});

    expect(deleted).toBe(100);
    expect((await readLogs(t)).map((log) => log.requestId)).toHaveLength(7);

    const scheduled = await t.run(async (ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(scheduled).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: RETENTION_WORKER_NAME,
          scheduledTime: NOW,
          state: { kind: "pending" },
        }),
      ]),
    );
    expect(JSON.stringify(scheduled)).not.toMatch(/xdr|signature|secret|provider/i);

    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    expect((await readLogs(t)).map((log) => log.requestId)).toEqual([
      "future-retention-one",
      "future-retention-two",
    ]);
  });
});

test("advances past blocked rows, preserves the sweep cutoff, and reports actual deletions", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const projectId = await createProject(t);

    await insertLogs(t, [
      logInput(projectId, "blocked-one", {
        lifecycle: GAS_LIFECYCLE_STATES.reserved,
        expiresAt: NOW - 1,
        retentionExpiresAt: NOW - 2,
        reservedStroops: 100n,
      }),
      logInput(projectId, "blocked-two", {
        lifecycle: GAS_LIFECYCLE_STATES.reserved,
        expiresAt: NOW - 1,
        retentionExpiresAt: NOW - 2,
        reservedStroops: 100n,
      }),
      logInput(projectId, "eligible-after-blocked", {
        lifecycle: GAS_LIFECYCLE_STATES.expired,
        expiresAt: NOW - 1,
        retentionExpiresAt: NOW - 1,
      }),
    ]);

    const firstPage = await t.mutation(internal.gas.retention.expireLogs, { limit: 2 });
    expect(firstPage).toBe(0);

    await insertLogs(t, [
      logInput(projectId, "added-after-sweep-start", {
        lifecycle: GAS_LIFECYCLE_STATES.expired,
        expiresAt: NOW - 1,
        retentionExpiresAt: NOW + 1,
      }),
    ]);

    vi.setSystemTime(NOW + 1);
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect((await readLogs(t)).map((log) => log.requestId)).toEqual([
      "blocked-one",
      "blocked-two",
      "added-after-sweep-start",
    ]);

    await createPolicy(t, projectId, 200n);
    const repaired = await t.mutation(internal.gas.retention.expireLogs, { limit: 2 });
    expect(repaired).toBe(2);
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(await readLogs(t)).toEqual([]);

    const policy = await t.run(async (ctx) =>
      ctx.db
        .query("gasPolicies")
        .withIndex("by_project_id", (q) => q.eq("projectId", projectId))
        .unique(),
    );
    expect(policy).toMatchObject({
      outstandingHoldsStroops: 0n,
      dailyReservedStroops: 0n,
    });
  });
});

test("rejects invalid retention page sizes while preserving the 100-row maximum", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    for (const limit of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(t.mutation(internal.gas.retention.expireLogs, { limit })).rejects.toThrow(
        "Gas log retention page size",
      );
    }
  });
});
