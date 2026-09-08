/// <reference types="vite/client" />

import { buildTestnetFeeBumpTransaction, quoteTestnetFeeBump } from "@repo/stellar/fee-bump";
import {
  GAS_TEST_CONTRACT_ID,
  GAS_TEST_RELAYER_KEYPAIR,
  buildGasTestEnvelope,
} from "@repo/stellar/test-fixtures";
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";

import type { DataModel, Id } from "../../_generated/dataModel";
import type { TestConvexForDataModelAndIdentity } from "convex-test";

import { internal } from "../../_generated/api";
import { GAS_ACCOUNTING_BLOCK_REASONS, GAS_LIFECYCLE_STATES, GAS_NETWORK } from "../../gas/types";
import schema from "../../schema";

const modules = import.meta.glob("../../**/*.ts");
type TestContext = TestConvexForDataModelAndIdentity<DataModel>;

const OWNER = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
const NOW = Date.parse("2026-09-03T12:34:56.789Z");
const INNER_XDR = buildGasTestEnvelope();
const QUOTE = quoteTestnetFeeBump(INNER_XDR);
const INNER_HASH = QUOTE.innerTransactionHash;
const OUTER = buildTestnetFeeBumpTransaction(
  INNER_XDR,
  QUOTE.baseFeeStroops,
  QUOTE.outerMaxFeeStroops,
  {
    publicKey: GAS_TEST_RELAYER_KEYPAIR.publicKey(),
    sign: (payload) => GAS_TEST_RELAYER_KEYPAIR.sign(Buffer.from(payload)),
  },
);

async function withFixedTime<T>(callback: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  try {
    return await callback();
  } finally {
    vi.useRealTimers();
  }
}

type SettlementCase = {
  projectId: Id<"projects">;
  attemptId: Id<"gasExecutionAttempts">;
  policyId: Id<"gasPolicies">;
};

async function createCase(
  t: TestContext,
  options: {
    requestId?: string;
    accountingDayKey?: string;
    policyDayKey?: string;
    confirmedSpendStroops?: bigint;
    outstandingHoldsStroops?: bigint;
    approvedHoldStroops?: bigint;
    evidence?: {
      resultCode?: string;
      innerResultCode?: string;
      chargedStroops?: bigint;
    };
    withAudit?: boolean;
    unsent?: boolean;
    expired?: boolean;
    submissionUnknown?: boolean;
  } = {},
): Promise<SettlementCase> {
  const requestId = options.requestId ?? "settlement-one";
  const accountingDayKey = options.accountingDayKey ?? "2026-09-03";
  const policyDayKey = options.policyDayKey ?? accountingDayKey;
  const confirmedSpendStroops = options.confirmedSpendStroops ?? 0n;
  const approvedHoldStroops = options.approvedHoldStroops ?? QUOTE.outerMaxFeeStroops;
  const outstandingHoldsStroops = options.outstandingHoldsStroops ?? approvedHoldStroops;
  const reservationCreatedAt = options.expired ? NOW - 901_000 : NOW;
  const reservationExpiresAt = options.expired ? NOW - 1 : NOW + 900_000;
  const resultCode = options.evidence?.resultCode ?? "txFeeBumpInnerSuccess";
  const innerResultCode = options.evidence?.innerResultCode ?? "txSuccess";
  const chargedStroops = options.evidence?.chargedStroops ?? 187n;
  const outer = OUTER.outerTransactionHash;

  return await t.run(async (ctx) => {
    const projectId = await ctx.db.insert("projects", {
      name: `Settlement ${requestId}`,
      slug: `settlement-${requestId}`,
      description: "Gas settlement test project",
      metadataJson: "{}",
      metadataHash: "0".repeat(64),
      ownerAddress: OWNER,
      ownerTokenIdentifier: `http://localhost:3000|${OWNER}`,
      status: "draft",
      createdAt: NOW,
      updatedAt: NOW,
    });
    const policyId = await ctx.db.insert("gasPolicies", {
      projectId,
      enabled: true,
      network: GAS_NETWORK,
      dailyCapStroops: 10_000n,
      dailyReservedStroops: confirmedSpendStroops + outstandingHoldsStroops,
      dailyWindowKey: policyDayKey,
      outstandingHoldsStroops,
      dailyConfirmedSpendStroops: confirmedSpendStroops,
      accountingState: "initialized",
      walletHourlyLimit: 10,
      allowedContractIds: [GAS_TEST_CONTRACT_ID],
      createdAt: NOW,
      updatedAt: NOW,
    });
    await ctx.db.insert("gasDailyAccounting", {
      projectId,
      accountingDayKey: accountingDayKey,
      confirmedSpendStroops,
      createdAt: NOW,
      updatedAt: NOW,
    });

    const unsent = options.unsent === true;
    const attemptId = await ctx.db.insert("gasExecutionAttempts", {
      projectId,
      network: GAS_NETWORK,
      requestId,
      idempotencyKeyHash: "a".repeat(64),
      requestFingerprint: "b".repeat(64),
      innerTransactionHash: INNER_HASH,
      sourceWallet: GAS_TEST_RELAYER_KEYPAIR.publicKey(),
      targetContractIds: [GAS_TEST_CONTRACT_ID],
      innerMaxFeeStroops: 100n,
      originalReservationStroops: 200n,
      reservationCreatedAt,
      reservationExpiresAt,
      accountingDayKey,
      lifecycle: unsent
        ? GAS_LIFECYCLE_STATES.claimed
        : options.submissionUnknown
          ? GAS_LIFECYCLE_STATES.submissionUnknown
          : GAS_LIFECYCLE_STATES.submitted,
      approvedHoldStroops,
      feeCeilingStroops: approvedHoldStroops,
      relayerPublicKey: GAS_TEST_RELAYER_KEYPAIR.publicKey(),
      ...(unsent ? {} : { outerTransactionHash: outer, outerFeeStroops: QUOTE.outerMaxFeeStroops }),
      ...(unsent
        ? {
            leaseToken: "active-lease",
            leaseGeneration: 1,
            leaseExpiresAt: options.expired ? undefined : NOW + 30_000,
            sendCount: 0,
            nextCheckAt: NOW,
            reconciliationRequired: false,
          }
        : {
            leaseGeneration: 1,
            sendCount: 1,
            nextCheckAt: NOW,
            firstPossibleSendAt: NOW,
            reconciliationDeadlineAt: NOW + 24 * 60 * 60 * 1_000,
            reconciliationRequired: true,
            verifiedLedgerEvidence: {
              outerTransactionHash: outer,
              innerTransactionHash: INNER_HASH,
              feeSource: GAS_TEST_RELAYER_KEYPAIR.publicKey(),
              ledger: 42,
              resultCode,
              innerResultCode,
              chargedStroops,
              observedAt: NOW,
            },
          }),
      createdAt: NOW,
      updatedAt: NOW,
    });

    if (options.withAudit !== false) {
      await ctx.db.insert("gasLogs", {
        projectId,
        requestId,
        idempotencyKeyHash: "a".repeat(64),
        requestFingerprint: "b".repeat(64),
        transactionHash: INNER_HASH,
        sourceWallet: GAS_TEST_RELAYER_KEYPAIR.publicKey(),
        targetContractIds: [GAS_TEST_CONTRACT_ID],
        innerMaxFeeStroops: 100n,
        reservedStroops: 200n,
        decisionCode: "reserved",
        lifecycle: unsent
          ? "claimed"
          : options.submissionUnknown
            ? "submission_unknown"
            : "submitted",
        expiresAt: reservationExpiresAt,
        retentionExpiresAt: NOW + 30 * 24 * 60 * 60 * 1_000,
        createdAt: NOW,
        updatedAt: NOW,
      });
    }
    return { projectId, attemptId, policyId };
  });
}

async function state(t: TestContext, projectId: Id<"projects">) {
  return await t.run(async (ctx) => ({
    policy: await ctx.db.get(
      "gasPolicies",
      (await ctx.db
        .query("gasPolicies")
        .withIndex("by_project_id", (q) => q.eq("projectId", projectId))
        .unique())!._id,
    ),
    attempt: await ctx.db
      .query("gasExecutionAttempts")
      .withIndex("by_project_id_and_request_id", (q) => q.eq("projectId", projectId))
      .unique(),
    daily: await ctx.db
      .query("gasDailyAccounting")
      .withIndex("by_project_id_and_accounting_day_key", (q) => q.eq("projectId", projectId))
      .collect(),
    logs: await ctx.db
      .query("gasLogs")
      .withIndex("by_project_id_and_created_at", (q) => q.eq("projectId", projectId))
      .collect(),
  }));
}

test("settles success and fee-bearing failure exactly once, including the audit row", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const success = await createCase(t, { requestId: "settlement-success" });
    const first = await t.mutation(internal.gas.settlement.settle, {
      executionAttemptId: success.attemptId,
      projectId: success.projectId,
    });
    expect(first).toEqual({
      status: "settled",
      lifecycle: "succeeded",
      actualFeeStroops: 187n,
      idempotent: false,
    });
    const beforeReplay = await state(t, success.projectId);
    expect(beforeReplay.attempt).toMatchObject({
      lifecycle: "succeeded",
      actualFeeStroops: 187n,
      settledAt: NOW,
      reconciliationRequired: false,
    });
    expect(beforeReplay.policy).toMatchObject({
      outstandingHoldsStroops: 0n,
      dailyConfirmedSpendStroops: 187n,
      dailyReservedStroops: 187n,
    });
    expect(beforeReplay.daily[0]?.confirmedSpendStroops).toBe(187n);
    expect(beforeReplay.logs[0]).toMatchObject({ lifecycle: "succeeded", actualFeeStroops: 187n });

    expect(
      await t.mutation(internal.gas.settlement.settle, {
        executionAttemptId: success.attemptId,
        projectId: success.projectId,
      }),
    ).toEqual({
      status: "settled",
      lifecycle: "succeeded",
      actualFeeStroops: 187n,
      idempotent: true,
    });
    expect(await state(t, success.projectId)).toEqual(beforeReplay);

    const failure = await createCase(t, {
      requestId: "settlement-failure",
      evidence: {
        resultCode: "txFeeBumpInnerFailed",
        innerResultCode: "txContractFailed",
        chargedStroops: 199n,
      },
    });
    expect(
      await t.mutation(internal.gas.settlement.settle, {
        executionAttemptId: failure.attemptId,
        projectId: failure.projectId,
      }),
    ).toEqual({
      status: "settled",
      lifecycle: "failed",
      actualFeeStroops: 199n,
      idempotent: false,
    });
  });
});

test("reconciliation retains a receipt and settles it in the same fenced mutation", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const example = await createCase(t, { requestId: "reconciliation-settlement" });
    await t.run(async (ctx) => {
      await ctx.db.patch(example.attemptId, { verifiedLedgerEvidence: undefined });
    });

    const [claim] = await t.mutation(internal.gas.reconciliation.claimDue, { limit: 25 });
    if (!claim) throw new Error("Expected a reconciliation claim");
    const result = await t.mutation(internal.gas.reconciliation.recordOutcome, {
      executionAttemptId: claim.executionAttemptId,
      projectId: example.projectId,
      outerTransactionHash: claim.outerTransactionHash,
      reconciliationLeaseToken: claim.reconciliationLeaseToken,
      reconciliationLeaseGeneration: claim.reconciliationLeaseGeneration,
      outcome: {
        status: "found",
        evidence: {
          outerTransactionHash: OUTER.outerTransactionHash,
          innerTransactionHash: INNER_HASH,
          feeSource: GAS_TEST_RELAYER_KEYPAIR.publicKey(),
          ledger: 42,
          resultCode: "txFeeBumpInnerSuccess",
          innerResultCode: "txSuccess",
          chargedStroops: 187n,
        },
      },
    });
    expect(result).toMatchObject({
      status: "recorded",
      verified: true,
      execution: {
        status: "succeeded",
        actualFeeStroops: "187",
      },
    });
    expect((await state(t, example.projectId)).policy).toMatchObject({
      outstandingHoldsStroops: 0n,
      dailyConfirmedSpendStroops: 187n,
    });
  });
});

test("reconciliation retains an above-ceiling receipt for operator investigation", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const example = await createCase(t, { requestId: "reconciliation-over-ceiling" });
    await t.run(async (ctx) => {
      await ctx.db.patch(example.attemptId, { verifiedLedgerEvidence: undefined });
    });
    const [claim] = await t.mutation(internal.gas.reconciliation.claimDue, { limit: 25 });
    if (!claim) throw new Error("Expected an above-ceiling reconciliation claim");
    const result = await t.mutation(internal.gas.reconciliation.recordOutcome, {
      executionAttemptId: claim.executionAttemptId,
      projectId: example.projectId,
      outerTransactionHash: claim.outerTransactionHash,
      reconciliationLeaseToken: claim.reconciliationLeaseToken,
      reconciliationLeaseGeneration: claim.reconciliationLeaseGeneration,
      outcome: {
        status: "found",
        evidence: {
          outerTransactionHash: OUTER.outerTransactionHash,
          innerTransactionHash: INNER_HASH,
          feeSource: GAS_TEST_RELAYER_KEYPAIR.publicKey(),
          ledger: 42,
          resultCode: "txFeeBumpInnerSuccess",
          innerResultCode: "txSuccess",
          chargedStroops: QUOTE.outerMaxFeeStroops + 1n,
        },
      },
    });
    expect(result).toMatchObject({
      status: "recorded",
      verified: true,
      execution: { status: "submitted", actualFeeStroops: null },
    });
    const settled = await state(t, example.projectId);
    expect(settled.attempt?.verifiedLedgerEvidence?.chargedStroops).toBe(
      QUOTE.outerMaxFeeStroops + 1n,
    );
    expect(settled.attempt?.settledAt).toBeUndefined();
    expect(settled.policy?.accountingBlockReason).toBe(
      GAS_ACCOUNTING_BLOCK_REASONS.feeExceedsApprovedExposure,
    );
  });
});

test("settles zero fees and late receipts against their pinned UTC day", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const zero = await createCase(t, {
      requestId: "settlement-zero",
      evidence: { chargedStroops: 0n },
    });
    expect(
      await t.mutation(internal.gas.settlement.settle, {
        executionAttemptId: zero.attemptId,
        projectId: zero.projectId,
      }),
    ).toMatchObject({ status: "settled", actualFeeStroops: 0n });
    expect((await state(t, zero.projectId)).policy).toMatchObject({
      outstandingHoldsStroops: 0n,
      dailyConfirmedSpendStroops: 0n,
      dailyReservedStroops: 0n,
    });

    const late = await createCase(t, {
      requestId: "settlement-late",
      accountingDayKey: "2026-09-03",
      policyDayKey: "2026-09-03",
      confirmedSpendStroops: 50n,
      evidence: { chargedStroops: 10n },
    });
    vi.setSystemTime(NOW + 24 * 60 * 60 * 1_000);
    expect(
      await t.mutation(internal.gas.settlement.settle, {
        executionAttemptId: late.attemptId,
        projectId: late.projectId,
      }),
    ).toMatchObject({ status: "settled", actualFeeStroops: 10n });
    const lateState = await state(t, late.projectId);
    expect(lateState.policy).toMatchObject({
      dailyWindowKey: "2026-09-04",
      outstandingHoldsStroops: 0n,
      dailyConfirmedSpendStroops: 0n,
      dailyReservedStroops: 0n,
    });
    expect(lateState.daily).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountingDayKey: "2026-09-03", confirmedSpendStroops: 60n }),
        expect.objectContaining({ accountingDayKey: "2026-09-04", confirmedSpendStroops: 0n }),
      ]),
    );
  });
});

test("keeps uncertainty held, rejects project mismatches, and settles after audit deletion", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const uncertain = await createCase(t, { requestId: "settlement-uncertain" });
    await t.run(async (ctx) => {
      await ctx.db.patch(uncertain.attemptId, { verifiedLedgerEvidence: undefined });
    });
    expect(
      await t.mutation(internal.gas.settlement.settle, {
        executionAttemptId: uncertain.attemptId,
        projectId: uncertain.projectId,
      }),
    ).toEqual({ status: "not_ready" });
    expect((await state(t, uncertain.projectId)).policy).toMatchObject({
      outstandingHoldsStroops: QUOTE.outerMaxFeeStroops,
      dailyConfirmedSpendStroops: 0n,
    });

    const mismatch = await createCase(t, { requestId: "settlement-mismatch" });
    const wrongProjectId = await t.run(async (ctx) =>
      ctx.db.insert("projects", {
        name: "Wrong project",
        slug: "settlement-wrong-project",
        description: "Project mismatch test",
        metadataJson: "{}",
        metadataHash: "0".repeat(64),
        ownerAddress: OWNER,
        ownerTokenIdentifier: `http://localhost:3000|${OWNER}`,
        status: "draft",
        createdAt: NOW,
        updatedAt: NOW,
      }),
    );
    expect(
      await t.mutation(internal.gas.settlement.settle, {
        executionAttemptId: mismatch.attemptId,
        projectId: wrongProjectId,
      }),
    ).toEqual({ status: "invalid_lifecycle" });
    expect((await state(t, mismatch.projectId)).attempt?.settledAt).toBeUndefined();

    const deletedAudit = await createCase(t, {
      requestId: "settlement-deleted-audit",
      withAudit: false,
      evidence: { chargedStroops: 123n },
    });
    expect(
      await t.mutation(internal.gas.settlement.settle, {
        executionAttemptId: deletedAudit.attemptId,
        projectId: deletedAudit.projectId,
      }),
    ).toMatchObject({ status: "settled", actualFeeStroops: 123n });
    expect((await state(t, deletedAudit.projectId)).logs).toHaveLength(0);
  });
});

test("blocks over-ceiling and insufficient-counter settlement without changing exposure", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const over = await createCase(t, {
      requestId: "settlement-over-ceiling",
      evidence: { chargedStroops: QUOTE.outerMaxFeeStroops + 1n },
    });
    const beforeOver = await state(t, over.projectId);
    expect(
      await t.mutation(internal.gas.settlement.settle, {
        executionAttemptId: over.attemptId,
        projectId: over.projectId,
      }),
    ).toEqual({
      status: "blocked",
      reason: GAS_ACCOUNTING_BLOCK_REASONS.feeExceedsApprovedExposure,
    });
    const afterOver = await state(t, over.projectId);
    expect(afterOver.attempt?.lifecycle).toBe("submitted");
    expect(afterOver.attempt?.settledAt).toBeUndefined();
    expect(afterOver.attempt?.verifiedLedgerEvidence?.chargedStroops).toBe(
      QUOTE.outerMaxFeeStroops + 1n,
    );
    expect(afterOver.policy).toMatchObject({
      accountingBlockReason: GAS_ACCOUNTING_BLOCK_REASONS.feeExceedsApprovedExposure,
      outstandingHoldsStroops: beforeOver.policy?.outstandingHoldsStroops,
      dailyReservedStroops: beforeOver.policy?.dailyReservedStroops,
    });

    const insufficient = await createCase(t, {
      requestId: "settlement-insufficient",
      outstandingHoldsStroops: 1n,
      approvedHoldStroops: 200n,
    });
    const result = await t.mutation(internal.gas.settlement.settle, {
      executionAttemptId: insufficient.attemptId,
      projectId: insufficient.projectId,
    });
    expect(result).toEqual({
      status: "blocked",
      reason: GAS_ACCOUNTING_BLOCK_REASONS.inconsistentCounters,
    });
    const insufficientAttempt = (await state(t, insufficient.projectId)).attempt;
    expect(insufficientAttempt?.lifecycle).toBe("submitted");
    expect(insufficientAttempt?.actualFeeStroops).toBeUndefined();
    expect(insufficientAttempt?.settledAt).toBeUndefined();

    const capChanged = await createCase(t, {
      requestId: "settlement-cap-changed",
      evidence: { chargedStroops: 187n },
    });
    await t.run(async (ctx) => {
      const policy = await ctx.db.get("gasPolicies", capChanged.policyId);
      if (!policy) throw new Error("Missing cap-change policy");
      await ctx.db.patch(policy._id, { dailyCapStroops: QUOTE.outerMaxFeeStroops - 1n });
    });
    expect(
      await t.mutation(internal.gas.settlement.settle, {
        executionAttemptId: capChanged.attemptId,
        projectId: capChanged.projectId,
      }),
    ).toEqual({
      status: "blocked",
      reason: GAS_ACCOUNTING_BLOCK_REASONS.inconsistentCounters,
    });
    expect((await state(t, capChanged.projectId)).attempt?.settledAt).toBeUndefined();
  });
});

test("persists overflow as a sponsorship block without rewriting exposure", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const overflow = await createCase(t, {
      requestId: "settlement-overflow",
      withAudit: false,
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(overflow.policyId, { accountingState: undefined });
      for (let index = 0; index < 257; index += 1) {
        await ctx.db.insert("gasLogs", {
          projectId: overflow.projectId,
          requestId: `overflow-${index}`,
          idempotencyKeyHash: `${index.toString(16).padStart(2, "0")}`.padStart(64, "0"),
          requestFingerprint: "b".repeat(64),
          decisionCode: "rejected",
          lifecycle: "rejected",
          retentionExpiresAt: NOW + 30 * 24 * 60 * 60 * 1_000,
          createdAt: NOW,
          updatedAt: NOW,
        });
      }
    });
    expect(
      await t.mutation(internal.gas.settlement.settle, {
        executionAttemptId: overflow.attemptId,
        projectId: overflow.projectId,
      }),
    ).toEqual({ status: "blocked", reason: GAS_ACCOUNTING_BLOCK_REASONS.overflow });
    const result = await state(t, overflow.projectId);
    expect(result.policy).toMatchObject({
      accountingState: "overflow",
      accountingBlockReason: GAS_ACCOUNTING_BLOCK_REASONS.overflow,
      outstandingHoldsStroops: QUOTE.outerMaxFeeStroops,
    });
    expect(result.attempt?.settledAt).toBeUndefined();
  });
});

test("cancels only a live unsent claim and expires cleared unsent leases without refunding wallet quota", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const active = await createCase(t, { requestId: "cancel-active", unsent: true });
    await t.run(async (ctx) => {
      await ctx.db.insert("rateLimitBuckets", {
        scopeKey: `gas:${active.projectId}:wallet:${GAS_TEST_RELAYER_KEYPAIR.publicKey()}`,
        tokens: 1,
        updatedAt: NOW,
      });
    });
    const beforeStaleCancel = await state(t, active.projectId);
    expect(
      await t.mutation(internal.gas.settlement.cancel, {
        executionAttemptId: active.attemptId,
        projectId: active.projectId,
        leaseToken: "stale-lease",
        leaseGeneration: 1,
      }),
    ).toEqual({ status: "invalid_lifecycle" });
    expect(await state(t, active.projectId)).toEqual(beforeStaleCancel);
    expect(
      await t.mutation(internal.gas.settlement.cancel, {
        executionAttemptId: active.attemptId,
        projectId: active.projectId,
        leaseToken: "active-lease",
        leaseGeneration: 1,
      }),
    ).toEqual({ status: "cancelled", idempotent: false });
    expect(
      await t.mutation(internal.gas.settlement.cancel, {
        executionAttemptId: active.attemptId,
        projectId: active.projectId,
        leaseToken: "active-lease",
        leaseGeneration: 1,
      }),
    ).toEqual({ status: "cancelled", idempotent: true });
    const cancelled = await state(t, active.projectId);
    expect(cancelled.attempt).toMatchObject({
      lifecycle: "cancelled",
      actualFeeStroops: 0n,
      settledAt: NOW,
    });
    expect(cancelled.attempt?.leaseToken).toBeUndefined();
    expect(cancelled.policy).toMatchObject({
      outstandingHoldsStroops: 0n,
      dailyReservedStroops: 0n,
    });
    expect(cancelled.logs[0]?.lifecycle).toBe("cancelled");
    const bucket = await t.run(async (ctx) =>
      ctx.db
        .query("rateLimitBuckets")
        .withIndex("by_scope_key", (q) =>
          q.eq(
            "scopeKey",
            `gas:${active.projectId}:wallet:${GAS_TEST_RELAYER_KEYPAIR.publicKey()}`,
          ),
        )
        .unique(),
    );
    expect(bucket?.tokens).toBe(1);

    const expired = await createCase(t, {
      requestId: "expire-cleared",
      unsent: true,
      expired: true,
    });
    await t.run(async (ctx) => {
      const attempt = await ctx.db.get("gasExecutionAttempts", expired.attemptId);
      if (!attempt) throw new Error("Missing expired attempt");
      await ctx.db.patch(attempt._id, { leaseToken: undefined, leaseExpiresAt: undefined });
    });
    expect(await t.mutation(internal.gas.execution.recoverAbandoned, { limit: 25 })).toBe(1);
    expect((await state(t, expired.projectId)).attempt).toMatchObject({
      lifecycle: "expired",
      actualFeeStroops: 0n,
      settledAt: NOW,
      leaseGeneration: 2,
    });
    expect((await state(t, expired.projectId)).policy?.outstandingHoldsStroops).toBe(0n);
  });
});

test("settles retained evidence through bounded cursor catch-up without an RPC call", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const first = await createCase(t, { requestId: "catch-up-one" });
    const second = await createCase(t, {
      requestId: "catch-up-two",
      submissionUnknown: true,
    });
    const firstPage = await t.mutation(internal.gas.settlement.catchUp, {
      paginationOpts: { numItems: 1, cursor: null },
    });
    expect(firstPage).toMatchObject({ processed: 1, settled: 1, blocked: 0, invalid: 0 });
    expect(firstPage.isDone).toBe(false);
    const secondPage = await t.mutation(internal.gas.settlement.catchUp, {
      paginationOpts: { numItems: 1, cursor: firstPage.continueCursor },
    });
    expect(secondPage).toMatchObject({ processed: 1, settled: 1, blocked: 0, invalid: 0 });
    expect(secondPage.isDone).toBe(true);
    expect((await state(t, first.projectId)).attempt?.lifecycle).toBe("succeeded");
    expect((await state(t, second.projectId)).attempt?.lifecycle).toBe("succeeded");
    const replayPage = await t.mutation(internal.gas.settlement.catchUp, {
      paginationOpts: { numItems: 1, cursor: secondPage.continueCursor },
    });
    expect(replayPage).toMatchObject({ processed: 0, settled: 0, blocked: 0, invalid: 0 });
    expect(replayPage.isDone).toBe(true);
  });
});
