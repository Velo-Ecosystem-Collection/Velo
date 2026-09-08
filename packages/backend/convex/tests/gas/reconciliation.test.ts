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
import type {
  TestnetFeeBumpLookupOutcome,
  TestnetFeeBumpRpcAdapter,
  TestnetFeeBumpSendOutcome,
} from "@repo/stellar/fee-bump-rpc";
import type { TestConvexForDataModelAndIdentity } from "convex-test";

import { internal } from "../../_generated/api";
import { deriveGasTransactionFacts } from "../../gas/envelope";
import {
  reconcileGasExecutionBatch,
  reconcileGasExecutionOperator,
} from "../../gas/reconciliation_action";
import {
  GAS_RECONCILIATION_LOOKUP_CLASSIFICATIONS,
  GAS_LIFECYCLE_STATES,
  GAS_NETWORK,
} from "../../gas/types";
import schema from "../../schema";

const modules = import.meta.glob("../../**/*.ts");
type TestContext = TestConvexForDataModelAndIdentity<DataModel>;

const OWNER = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
const NOW = Date.parse("2026-09-03T12:34:56.789Z");
const INNER_XDR = buildGasTestEnvelope();
const INNER_FACTS = deriveGasTransactionFacts(INNER_XDR);
const QUOTE = quoteTestnetFeeBump(INNER_XDR);
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

async function createProject(t: TestContext, suffix: string): Promise<Id<"projects">> {
  return await t.run(async (ctx) => {
    const projectId = await ctx.db.insert("projects", {
      name: `Reconciliation ${suffix}`,
      slug: `reconciliation-${suffix}`,
      description: "Gas reconciliation test project",
      metadataJson: "{}",
      metadataHash: "0".repeat(64),
      ownerAddress: OWNER,
      ownerTokenIdentifier: `http://localhost:3000|${OWNER}`,
      status: "draft",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await ctx.db.insert("gasExecutionAttempts", {
      projectId,
      network: GAS_NETWORK,
      requestId: `reconciliation-${suffix}`,
      idempotencyKeyHash: "a".repeat(64),
      requestFingerprint: "b".repeat(64),
      innerTransactionHash: INNER_FACTS.transactionHash,
      sourceWallet: INNER_FACTS.sourceWallet,
      targetContractIds: [GAS_TEST_CONTRACT_ID],
      innerMaxFeeStroops: INNER_FACTS.innerMaxFeeStroops,
      originalReservationStroops: 200n,
      reservationCreatedAt: NOW,
      reservationExpiresAt: NOW + 15 * 60 * 1_000,
      accountingDayKey: "2026-09-03",
      lifecycle: GAS_LIFECYCLE_STATES.submitted,
      approvedHoldStroops: QUOTE.outerMaxFeeStroops,
      feeCeilingStroops: QUOTE.outerMaxFeeStroops,
      relayerPublicKey: GAS_TEST_RELAYER_KEYPAIR.publicKey(),
      outerTransactionHash: OUTER.outerTransactionHash,
      outerFeeStroops: OUTER.outerMaxFeeStroops,
      leaseGeneration: 1,
      sendCount: 1,
      nextCheckAt: NOW,
      firstPossibleSendAt: NOW,
      reconciliationDeadlineAt: NOW + 24 * 60 * 60 * 1_000,
      reconciliationRequired: false,
      createdAt: NOW,
      updatedAt: NOW,
    });
    return projectId;
  });
}

async function createProjects(
  t: TestContext,
  count: number,
  prefix = "reconciliation-batch",
): Promise<Id<"projects">[]> {
  const projectIds: Id<"projects">[] = [];
  for (let index = 0; index < count; index += 1) {
    projectIds.push(await createProject(t, `${prefix}-${index}`));
  }
  return projectIds;
}

async function getAttempt(
  t: TestContext,
  projectId: Id<"projects">,
  requestId = "reconciliation-one",
) {
  return await t.run(async (ctx) =>
    ctx.db
      .query("gasExecutionAttempts")
      .withIndex("by_project_id_and_request_id", (q) =>
        q.eq("projectId", projectId).eq("requestId", requestId),
      )
      .unique(),
  );
}

function foundEvidence(
  overrides: Partial<{
    outerTransactionHash: string;
    innerTransactionHash: string;
    feeSource: string;
    ledger: number;
    resultCode: string;
    innerResultCode: string;
    chargedStroops: bigint;
  }> = {},
) {
  return {
    outerTransactionHash: OUTER.outerTransactionHash,
    innerTransactionHash: INNER_FACTS.transactionHash,
    feeSource: GAS_TEST_RELAYER_KEYPAIR.publicKey(),
    ledger: 42,
    resultCode: "txFeeBumpInnerSuccess",
    innerResultCode: "txSuccess",
    chargedStroops: 187n,
    ...overrides,
  };
}

function rpcFoundEvidence(): TestnetFeeBumpLookupOutcome {
  const evidence = foundEvidence();
  return {
    status: "found",
    outerTransactionHash: evidence.outerTransactionHash,
    innerTransactionHash: evidence.innerTransactionHash,
    feeSource: evidence.feeSource,
    feeStroops: evidence.chargedStroops,
    ledger: evidence.ledger,
    resultCode: evidence.resultCode,
    innerResultCode: evidence.innerResultCode,
  };
}

function adapterFactory(
  lookup: (url: string | undefined) => Promise<TestnetFeeBumpLookupOutcome>,
  urls: string[],
): (url: string | undefined) => TestnetFeeBumpRpcAdapter {
  return (url: string | undefined) => {
    urls.push(url ?? "default");
    return {
      send: async (): Promise<TestnetFeeBumpSendOutcome> => ({
        status: "pending",
        outerTransactionHash: OUTER.outerTransactionHash,
      }),
      lookup: async () => await lookup(url),
    };
  };
}

test("claims at most 25 due attempts, leases independently, and recovers after a crash", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const projectId = await createProject(t, "one");

    const first = await t.mutation(internal.gas.reconciliation.claimDue, { limit: 25 });
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      outerTransactionHash: OUTER.outerTransactionHash,
      reconciliationLeaseGeneration: 1,
      pollCount: 1,
    });
    expect(await t.mutation(internal.gas.reconciliation.claimDue, { limit: 25 })).toEqual([]);

    vi.advanceTimersByTime(30_001);
    const recovered = await t.mutation(internal.gas.reconciliation.claimDue, { limit: 25 });
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({ reconciliationLeaseGeneration: 2, pollCount: 2 });
    expect(
      await t.mutation(internal.gas.reconciliation.recordOutcome, {
        executionAttemptId: first[0]!.executionAttemptId,
        projectId,
        outerTransactionHash: first[0]!.outerTransactionHash,
        reconciliationLeaseToken: first[0]!.reconciliationLeaseToken,
        reconciliationLeaseGeneration: first[0]!.reconciliationLeaseGeneration,
        outcome: { status: "not_found" },
      }),
    ).toEqual({ status: "invalid_lifecycle" });
    expect(projectId).toBeDefined();
  });
});

test("bounds concurrent claims and lookup work and schedules only a bounded continuation", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    await createProjects(t, 30, "claims");

    const [first, second] = await Promise.all([
      t.mutation(internal.gas.reconciliation.claimDue, { limit: 25 }),
      t.mutation(internal.gas.reconciliation.claimDue, { limit: 25 }),
    ]);
    const claims = [...first, ...second];
    expect(claims).toHaveLength(30);
    expect(new Set(claims.map((claim) => claim.executionAttemptId)).size).toBe(30);
    expect(first.length).toBeLessThanOrEqual(25);
    expect(second.length).toBeLessThanOrEqual(25);

    const actionContext = convexTest(schema, modules);
    await createProjects(actionContext, 25, "lookups");
    let activeLookups = 0;
    let maximumLookups = 0;
    const result = await actionContext.action(async (ctx) =>
      reconcileGasExecutionBatch(ctx, 25, {
        rpcAdapterFactory: () => ({
          send: async (): Promise<TestnetFeeBumpSendOutcome> => ({
            status: "pending",
            outerTransactionHash: OUTER.outerTransactionHash,
          }),
          lookup: async () => {
            activeLookups += 1;
            maximumLookups = Math.max(maximumLookups, activeLookups);
            await Promise.resolve();
            activeLookups -= 1;
            return rpcFoundEvidence();
          },
        }),
      }),
    );
    expect(result).toMatchObject({ claimed: 25, recorded: 25, verified: 25 });
    expect(maximumLookups).toBe(5);

    const scheduled = await actionContext.run(async (ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(scheduled).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "gas/reconciliation_action:reconcileDue",
          scheduledTime: NOW,
          state: { kind: "pending" },
          args: [{ limit: 25 }],
        }),
      ]),
    );
    expect(JSON.stringify(scheduled)).not.toContain(OUTER.outerTransactionHash);
  });
});

test("stores matching ledger evidence, fences sends, and makes an identical completion idempotent", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const projectId = await createProject(t, "one");
    const [claim] = await t.mutation(internal.gas.reconciliation.claimDue, { limit: 25 });
    if (!claim) throw new Error("Expected a reconciliation claim");
    const result = await t.mutation(internal.gas.reconciliation.recordOutcome, {
      executionAttemptId: claim.executionAttemptId,
      projectId,
      outerTransactionHash: claim.outerTransactionHash,
      reconciliationLeaseToken: claim.reconciliationLeaseToken,
      reconciliationLeaseGeneration: claim.reconciliationLeaseGeneration,
      outcome: { status: "found", evidence: foundEvidence() },
    });
    expect(result).toMatchObject({ status: "recorded", verified: true, exhausted: false });

    const attempt = await getAttempt(t, projectId);
    expect(attempt).toMatchObject({
      lifecycle: "submitted",
      reconciliationRequired: true,
      verifiedLedgerEvidence: {
        outerTransactionHash: OUTER.outerTransactionHash,
        innerTransactionHash: INNER_FACTS.transactionHash,
        feeSource: GAS_TEST_RELAYER_KEYPAIR.publicKey(),
        chargedStroops: 187n,
        observedAt: NOW,
      },
      reconciliationLastOutcome: { status: "found", observedAt: NOW },
    });
    expect(attempt?.leaseToken).toBeUndefined();
    expect(attempt?.actualFeeStroops).toBeUndefined();
    expect(attempt?.settledAt).toBeUndefined();
    if (result.status !== "recorded") throw new Error("Expected recorded evidence");
    expect(result.execution).toMatchObject({
      object: "gas_submit_result",
      status: "submitted",
      reservedStroops: QUOTE.outerMaxFeeStroops.toString(),
      actualFeeStroops: null,
      reconciliationRequired: true,
    });

    const duplicate = await t.mutation(internal.gas.reconciliation.recordOutcome, {
      executionAttemptId: claim.executionAttemptId,
      projectId,
      outerTransactionHash: claim.outerTransactionHash,
      reconciliationLeaseToken: claim.reconciliationLeaseToken,
      reconciliationLeaseGeneration: claim.reconciliationLeaseGeneration,
      outcome: { status: "found", evidence: foundEvidence() },
    });
    expect(duplicate).toMatchObject({ status: "recorded", idempotent: true, verified: true });

    vi.advanceTimersByTime(24 * 60 * 60 * 1_000 + 1);
    expect(
      await t.mutation(internal.gas.reconciliation.claimOperator, {
        projectId,
        requestId: "reconciliation-one",
      }),
    ).toEqual({ status: "already_verified" });
    expect(await t.mutation(internal.gas.execution.recoverAbandoned, { limit: 25 })).toBe(0);
  });
});

test("trusts a fee-bearing inner failure and rejects every normalized evidence mismatch", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const failureProject = await createProject(t, "fee-bearing-failure");
    const [failureClaim] = await t.mutation(internal.gas.reconciliation.claimDue, { limit: 25 });
    if (!failureClaim) throw new Error("Expected a failure reconciliation claim");
    const failure = await t.mutation(internal.gas.reconciliation.recordOutcome, {
      executionAttemptId: failureClaim.executionAttemptId,
      projectId: failureProject,
      outerTransactionHash: failureClaim.outerTransactionHash,
      reconciliationLeaseToken: failureClaim.reconciliationLeaseToken,
      reconciliationLeaseGeneration: failureClaim.reconciliationLeaseGeneration,
      outcome: {
        status: "found",
        evidence: foundEvidence({
          resultCode: "txFeeBumpInnerFailed",
          innerResultCode: "txContractFailed",
          chargedStroops: 199n,
        }),
      },
    });
    expect(failure).toMatchObject({ status: "recorded", verified: true });

    const malformedCases: Array<Parameters<typeof foundEvidence>[0]> = [
      { outerTransactionHash: "c".repeat(64) },
      { innerTransactionHash: "d".repeat(64) },
      { feeSource: OWNER },
      { ledger: 0 },
      { resultCode: "not a result code" },
      { resultCode: "txFeeBumpInnerSuccess", innerResultCode: "txContractFailed" },
      { chargedStroops: -1n },
    ];
    for (const [index, evidenceOverrides] of malformedCases.entries()) {
      const projectId = await createProject(t, `malformed-${index}`);
      const [claim] = await t.mutation(internal.gas.reconciliation.claimDue, { limit: 25 });
      if (!claim) throw new Error("Expected a malformed-evidence claim");
      const result = await t.mutation(internal.gas.reconciliation.recordOutcome, {
        executionAttemptId: claim.executionAttemptId,
        projectId,
        outerTransactionHash: claim.outerTransactionHash,
        reconciliationLeaseToken: claim.reconciliationLeaseToken,
        reconciliationLeaseGeneration: claim.reconciliationLeaseGeneration,
        outcome: { status: "found", evidence: foundEvidence(evidenceOverrides) },
      });
      expect(result).toMatchObject({ status: "recorded", verified: false });
      expect(
        (await getAttempt(t, projectId, `reconciliation-malformed-${index}`))
          ?.verifiedLedgerEvidence,
      ).toBe(undefined);
      expect(
        (await getAttempt(t, projectId, `reconciliation-malformed-${index}`))
          ?.reconciliationLastOutcome,
      ).toMatchObject({ status: "malformed_response", observedAt: NOW });
    }
  });
});

test("keeps mismatched and malformed evidence unresolved with bounded backoff", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const projectId = await createProject(t, "one");
    const [claim] = await t.mutation(internal.gas.reconciliation.claimDue, { limit: 25 });
    if (!claim) throw new Error("Expected a reconciliation claim");

    const mismatch = await t.mutation(internal.gas.reconciliation.recordOutcome, {
      executionAttemptId: claim.executionAttemptId,
      projectId,
      outerTransactionHash: claim.outerTransactionHash,
      reconciliationLeaseToken: claim.reconciliationLeaseToken,
      reconciliationLeaseGeneration: claim.reconciliationLeaseGeneration,
      outcome: {
        status: "found",
        evidence: foundEvidence({ innerTransactionHash: "c".repeat(64) }),
      },
    });
    expect(mismatch).toMatchObject({ status: "recorded", verified: false, exhausted: false });
    expect((await getAttempt(t, projectId))?.reconciliationLastOutcome).toMatchObject({
      status: GAS_RECONCILIATION_LOOKUP_CLASSIFICATIONS.malformedResponse,
      observedAt: NOW,
    });
    expect((await getAttempt(t, projectId))?.nextCheckAt).toBe(NOW + 60_000);

    vi.advanceTimersByTime(60_001);
    const [secondClaim] = await t.mutation(internal.gas.reconciliation.claimDue, { limit: 25 });
    if (!secondClaim) throw new Error("Expected a second reconciliation claim");
    const notFound = await t.mutation(internal.gas.reconciliation.recordOutcome, {
      executionAttemptId: secondClaim.executionAttemptId,
      projectId,
      outerTransactionHash: secondClaim.outerTransactionHash,
      reconciliationLeaseToken: secondClaim.reconciliationLeaseToken,
      reconciliationLeaseGeneration: secondClaim.reconciliationLeaseGeneration,
      outcome: { status: "not_found" },
    });
    expect(notFound).toMatchObject({ status: "recorded", verified: false });
    expect((await getAttempt(t, projectId))?.nextCheckAt).toBe(NOW + 60_001 + 120_000);
    expect((await getAttempt(t, projectId))?.verifiedLedgerEvidence).toBeUndefined();
  });
});

test("uses one configured fallback after unavailable RPC and never trusts wrong-network results", async () => {
  await withFixedTime(async () => {
    const previousPrimary = process.env.STELLAR_RPC_URL;
    const previousFallback = process.env.VELO_GAS_TESTNET_FALLBACK_RPC_URL;
    process.env.STELLAR_RPC_URL = "https://primary.example/rpc";
    process.env.VELO_GAS_TESTNET_FALLBACK_RPC_URL = "https://fallback.example/rpc";
    try {
      const t = convexTest(schema, modules);
      const projectId = await createProject(t, "one");
      const urls: string[] = [];
      const result = await t.action(async (ctx) =>
        reconcileGasExecutionBatch(ctx, 25, {
          rpcAdapterFactory: adapterFactory(
            async (url) =>
              url === "https://primary.example/rpc"
                ? { status: "preflight_failed", code: "network_timeout" }
                : rpcFoundEvidence(),
            urls,
          ),
        }),
      );
      expect(result).toMatchObject({ claimed: 1, recorded: 1, verified: 1 });
      expect(urls).toEqual(["https://primary.example/rpc", "https://fallback.example/rpc"]);
      expect((await getAttempt(t, projectId))?.verifiedLedgerEvidence).toBeDefined();

      const wrongNetworkProject = await createProject(t, "two");
      const wrongUrls: string[] = [];
      const wrong = await t.action(async (ctx) =>
        reconcileGasExecutionBatch(ctx, 25, {
          rpcAdapterFactory: adapterFactory(
            async () => ({ status: "preflight_failed", code: "wrong_network" }),
            wrongUrls,
          ),
        }),
      );
      expect(wrong).toMatchObject({ claimed: 1, recorded: 1, verified: 0 });
      expect(
        (await getAttempt(t, wrongNetworkProject, "reconciliation-two"))?.verifiedLedgerEvidence,
      ).toBeUndefined();
      expect(
        (await getAttempt(t, wrongNetworkProject, "reconciliation-two"))?.reconciliationLastOutcome,
      ).toMatchObject({
        status: "wrong_network",
      });
    } finally {
      if (previousPrimary === undefined) delete process.env.STELLAR_RPC_URL;
      else process.env.STELLAR_RPC_URL = previousPrimary;
      if (previousFallback === undefined) delete process.env.VELO_GAS_TESTNET_FALLBACK_RPC_URL;
      else process.env.VELO_GAS_TESTNET_FALLBACK_RPC_URL = previousFallback;
    }
  });
});

test("allows one operator lookup after deadline without resetting it", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const projectId = await createProject(t, "one");
    await t.run(async (ctx) => {
      const relayerId = await ctx.db.insert("relayerAccounts", {
        projectId,
        publicKey: GAS_TEST_RELAYER_KEYPAIR.publicKey(),
        network: GAS_NETWORK,
        status: "active",
        createdAt: NOW,
        updatedAt: NOW,
      });
      await ctx.db.patch(relayerId, {
        publicKey: OWNER,
        status: "disabled",
        updatedAt: NOW,
      });
      const attempt = await ctx.db
        .query("gasExecutionAttempts")
        .withIndex("by_project_id_and_request_id", (q) =>
          q.eq("projectId", projectId).eq("requestId", "reconciliation-one"),
        )
        .unique();
      if (!attempt) throw new Error("Missing attempt");
      await ctx.db.patch(attempt._id, { reconciliationRequired: true });
      await ctx.db.insert("gasLogs", {
        projectId,
        requestId: attempt.requestId,
        idempotencyKeyHash: attempt.idempotencyKeyHash,
        requestFingerprint: attempt.requestFingerprint,
        transactionHash: attempt.innerTransactionHash,
        sourceWallet: attempt.sourceWallet,
        targetContractIds: attempt.targetContractIds,
        innerMaxFeeStroops: attempt.innerMaxFeeStroops,
        reservedStroops: attempt.originalReservationStroops,
        decisionCode: "reserved",
        lifecycle: "submitted",
        expiresAt: attempt.reservationExpiresAt,
        retentionExpiresAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      });
    });
    expect(await t.mutation(internal.gas.retention.expireLogs, { limit: 25 })).toBe(1);

    vi.advanceTimersByTime(24 * 60 * 60 * 1_000 + 1);
    const originalDeadline = NOW + 24 * 60 * 60 * 1_000;
    expect(await t.mutation(internal.gas.reconciliation.claimDue, { limit: 25 })).toEqual([]);
    expect((await getAttempt(t, projectId))?.reconciliationRequired).toBe(true);
    const result = await t.action(async (ctx) =>
      reconcileGasExecutionOperator(ctx, projectId, "reconciliation-one", {
        rpcAdapterFactory: adapterFactory(async () => rpcFoundEvidence(), []),
      }),
    );
    expect(result).toMatchObject({ status: "recorded", verified: true });
    expect((await getAttempt(t, projectId))?.reconciliationDeadlineAt).toBe(originalDeadline);
    expect((await getAttempt(t, projectId))?.reconciliationRequired).toBe(true);
  });
});

test("parks an unresolved lookup at the 24-hour deadline", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const projectId = await createProject(t, "deadline");
    await t.run(async (ctx) => {
      const attempt = await ctx.db
        .query("gasExecutionAttempts")
        .withIndex("by_project_id_and_request_id", (q) =>
          q.eq("projectId", projectId).eq("requestId", "reconciliation-deadline"),
        )
        .unique();
      if (!attempt) throw new Error("Missing deadline attempt");
      await ctx.db.patch(attempt._id, { reconciliationDeadlineAt: NOW + 10_000 });
    });

    const [claim] = await t.mutation(internal.gas.reconciliation.claimDue, { limit: 25 });
    if (!claim) throw new Error("Expected a deadline reconciliation claim");
    vi.advanceTimersByTime(10_001);
    const result = await t.mutation(internal.gas.reconciliation.recordOutcome, {
      executionAttemptId: claim.executionAttemptId,
      projectId,
      outerTransactionHash: claim.outerTransactionHash,
      reconciliationLeaseToken: claim.reconciliationLeaseToken,
      reconciliationLeaseGeneration: claim.reconciliationLeaseGeneration,
      outcome: { status: "not_found" },
    });
    expect(result).toMatchObject({ status: "recorded", verified: false, exhausted: true });
    expect(await t.mutation(internal.gas.reconciliation.claimDue, { limit: 25 })).toEqual([]);
    expect(
      (await getAttempt(t, projectId, "reconciliation-deadline"))?.reconciliationRequired,
    ).toBe(true);
  });
});

test("operator action rejects a live automatic attempt and never accepts client evidence", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const projectId = await createProject(t, "one");
    const result = await t.action(internal.gas.reconciliation_action.operatorReconcile, {
      projectId,
      requestId: "reconciliation-one",
    });
    expect(result).toEqual({ status: "not_exhausted" });
  });
});
