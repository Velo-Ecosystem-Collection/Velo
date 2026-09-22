/// <reference types="vite/client" />

import {
  buildGasTestEnvelope,
  GAS_TEST_RELAYER_KEYPAIR,
  GAS_TEST_SOURCE_KEYPAIR,
} from "@repo/stellar/test-fixtures";
import { FeeBumpTransaction, Networks, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";

import type { DataModel, Id } from "../../_generated/dataModel";
import type { ActionCtx } from "../../_generated/server";
import type { GasClaimActionArgs, GasExecutionDependencies } from "../../gas/execution_action";
import type { TestnetFeeBumpRpcTransport } from "@repo/stellar/fee-bump-rpc";
import type { TestConvexForDataModelAndIdentity } from "convex-test";

import { api, internal } from "../../_generated/api";
import { executeGasExecution } from "../../gas/execution_action";
import { reconcileGasExecutionBatch } from "../../gas/reconciliation_action";
import { GAS_RELAYER_SIGNERS_ENV } from "../../gas/relayer";
import { GAS_NETWORK } from "../../gas/types";
import schema from "../../schema";
import { gasFixtureContractId, gasMaxTimeEnvelopeFixtures } from "./fixtures";

const modules = import.meta.glob("../../**/*.ts");
type TestContext = TestConvexForDataModelAndIdentity<DataModel>;
type PublicSubmitScope = Parameters<typeof executeGasExecution>[2];

const OWNER = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
const NOW = Date.parse("2026-09-03T23:59:56.789Z");
const API_KEY_HASH = "a".repeat(64);
const SECOND_API_KEY_HASH = "b".repeat(64);
const RELAYER_PUBLIC_KEY = GAS_TEST_RELAYER_KEYPAIR.publicKey();

type ForwardedDependencies = { current: GasExecutionDependencies | undefined };

const forwardedDependencies = vi.hoisted<ForwardedDependencies>(() => ({
  current: undefined,
}));

/**
 * Public submit deliberately has no production dependency injection. This
 * test-only module forwarding preserves its auth/result path while allowing
 * the real execution helper to use deterministic RPC dependencies.
 */
vi.mock("../../gas/execution_action", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../gas/execution_action")>();
  return {
    ...actual,
    executeGasExecution: (
      ctx: ActionCtx,
      args: GasClaimActionArgs,
      providedScope?: PublicSubmitScope,
    ) => actual.executeGasExecution(ctx, args, providedScope, forwardedDependencies.current ?? {}),
  };
});

afterEach(() => {
  forwardedDependencies.current = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Scope = Readonly<{
  projectId: Id<"projects">;
  apiKeyId: Id<"apiKeys">;
  apiKeyHash: string;
}>;

type ScopeOptions = Readonly<{
  apiKeyHash?: string;
  dailyCapStroops?: bigint;
  suffix: string;
}>;

async function withFixedTime<T>(callback: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  return await callback();
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

async function createScope(t: TestContext, options: ScopeOptions): Promise<Scope> {
  const apiKeyHash = options.apiKeyHash ?? API_KEY_HASH;
  return await t.run(async (ctx) => {
    const projectId = await ctx.db.insert("projects", {
      name: `Gas integration ${options.suffix}`,
      slug: `gas-integration-${options.suffix}`,
      description: "Integrated Gas relayer test project",
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
      label: "Gas integration test key",
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
      allowedContractIds: [gasFixtureContractId],
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
      .take(25),
    attempts: await ctx.db
      .query("gasExecutionAttempts")
      .withIndex("by_project_id_and_request_id", (q) => q.eq("projectId", projectId))
      .take(25),
    daily: await ctx.db
      .query("gasDailyAccounting")
      .withIndex("by_project_id_and_accounting_day_key", (q) => q.eq("projectId", projectId))
      .take(25),
    bucket: await ctx.db
      .query("rateLimitBuckets")
      .withIndex("by_scope_key", (q) =>
        q.eq("scopeKey", `gas:${projectId}:wallet:${GAS_TEST_SOURCE_KEYPAIR.publicKey()}`),
      )
      .unique(),
  }));
}

async function sponsor(
  t: TestContext,
  scope: Scope,
  transactionXdr: string,
  idempotencyKey: string,
) {
  return await t.action(api.gas.public_api.sponsor, {
    apiKeyHash: scope.apiKeyHash,
    idempotencyKey,
    transactionXdr,
  });
}

async function submit(
  t: TestContext,
  scope: Scope,
  requestId: string,
  transactionHash: string,
  transactionXdr: string | undefined,
  dependencies: GasExecutionDependencies,
) {
  const previous = forwardedDependencies.current;
  forwardedDependencies.current = dependencies;
  try {
    return await t.action(api.gas.public_api.submit, {
      apiKeyHash: scope.apiKeyHash,
      requestId,
      transactionHash,
      ...(transactionXdr === undefined ? {} : { transactionXdr }),
    });
  } finally {
    forwardedDependencies.current = previous;
  }
}

async function reconcile(
  t: TestContext,
  dependencies: Parameters<typeof reconcileGasExecutionBatch>[2],
  limit = 25,
) {
  return await t.action(async (ctx) => await reconcileGasExecutionBatch(ctx, limit, dependencies));
}

function nestedFeeBumpResult(
  innerTransactionHash: string,
  outcome: "success" | "failed",
  innerCode: "txSuccess" | "txBadSeq",
  feeStroops = 187n,
): string {
  const innerResult = new xdr.InnerTransactionResult({
    feeCharged: new xdr.Int64(feeStroops.toString()),
    result:
      innerCode === "txSuccess"
        ? xdr.InnerTransactionResultResult.txSuccess([])
        : xdr.InnerTransactionResultResult.txBadSeq(),
    ext: new xdr.InnerTransactionResultExt(0),
  });
  const innerResultPair = new xdr.InnerTransactionResultPair({
    transactionHash: Buffer.from(innerTransactionHash, "hex"),
    result: innerResult,
  });
  return new xdr.TransactionResult({
    feeCharged: new xdr.Int64(feeStroops.toString()),
    result:
      outcome === "success"
        ? xdr.TransactionResultResult.txFeeBumpInnerSuccess(innerResultPair)
        : xdr.TransactionResultResult.txFeeBumpInnerFailed(innerResultPair),
    ext: new xdr.TransactionResultExt(0),
  }).toXDR("base64");
}

type SendMode = "pending" | "duplicate" | "retry_later" | "timeout";
type LookupMode = "success" | "failure" | "not_found";

type TransportHarness = Readonly<{
  transport: TestnetFeeBumpRpcTransport;
  getSendCalls: () => number;
  getLookupCalls: () => number;
  getOuterHash: () => string | undefined;
  getSignedOuterXdr: () => string | undefined;
}>;

function createTransport(
  innerTransactionHash: string,
  options: Readonly<{
    sendMode?: SendMode | ((sendCount: number) => SendMode);
    lookupMode?: LookupMode;
    lookupFeeStroops?: bigint;
  }> = {},
): TransportHarness {
  let sendCalls = 0;
  let lookupCalls = 0;
  let outerHash: string | undefined;
  let signedOuterXdr: string | undefined;
  const sendMode = options.sendMode ?? "pending";
  const lookupMode = options.lookupMode ?? "success";
  const lookupFeeStroops = options.lookupFeeStroops ?? 187n;

  const transport: TestnetFeeBumpRpcTransport = {
    getNetwork: async () => ({ passphrase: Networks.TESTNET }),
    sendTransaction: async (transaction) => {
      sendCalls += 1;
      outerHash = transaction.hash().toString("hex");
      signedOuterXdr = (transaction as unknown as { toEnvelope: () => string }).toEnvelope();
      const mode = typeof sendMode === "function" ? sendMode(sendCalls) : sendMode;
      if (mode === "timeout") {
        throw Object.assign(new Error("provider body must not persist"), {
          name: "TimeoutError",
        });
      }
      const statuses: Record<Exclude<SendMode, "timeout">, string> = {
        pending: "PENDING",
        duplicate: "DUPLICATE",
        retry_later: "TRY_AGAIN_LATER",
      };
      return {
        status: statuses[mode],
        hash: outerHash,
        latestLedger: 99,
        latestLedgerCloseTime: NOW,
        providerBody: "provider-secret-body",
      };
    },
    getTransaction: async (hash) => {
      lookupCalls += 1;
      if (lookupMode === "not_found") {
        return {
          status: "NOT_FOUND",
          txHash: hash,
          latestLedger: 99,
          latestLedgerCloseTime: NOW,
          oldestLedger: 1,
          oldestLedgerCloseTime: NOW,
        };
      }
      if (signedOuterXdr === undefined) throw new Error("Missing captured signed FeeBump");
      const failed = lookupMode === "failure";
      return {
        status: failed ? "FAILED" : "SUCCESS",
        txHash: hash,
        latestLedger: 99,
        latestLedgerCloseTime: NOW,
        oldestLedger: 1,
        oldestLedgerCloseTime: NOW,
        ledger: 42,
        createdAt: NOW,
        applicationOrder: 1,
        feeBump: true,
        envelopeXdr: signedOuterXdr,
        resultXdr: nestedFeeBumpResult(
          innerTransactionHash,
          failed ? "failed" : "success",
          failed ? "txBadSeq" : "txSuccess",
          lookupFeeStroops,
        ),
        resultMetaXdr: signedOuterXdr,
        providerBody: "provider-secret-body",
      };
    },
  };

  return {
    transport,
    getSendCalls: () => sendCalls,
    getLookupCalls: () => lookupCalls,
    getOuterHash: () => outerHash,
    getSignedOuterXdr: () => signedOuterXdr,
  };
}

async function assertNoSecrets(value: unknown, secrets: readonly string[]): Promise<void> {
  const serialized = JSON.stringify(value, (_key, nestedValue: unknown) =>
    typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue,
  );
  for (const secret of secrets) expect(serialized).not.toContain(secret);
}

async function scheduledFunctions(t: TestContext) {
  return await t.run(async (ctx) => await ctx.db.system.query("_scheduled_functions").take(25));
}

test("integrates accepted sponsorship, reconciliation, settlement, and terminal replay", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const scope = await createScope(t, { suffix: "accepted" });
    const transactionXdr = gasMaxTimeEnvelopeFixtures.unbounded;
    const sponsored = await sponsor(t, scope, transactionXdr, "integration-accepted");
    expect(sponsored).toMatchObject({ status: "success", replayed: false });
    if (sponsored.status !== "success" || sponsored.reservation.transactionHash === null) {
      throw new Error("Expected a public sponsor reservation");
    }

    const transactionHash = sponsored.reservation.transactionHash;
    const transport = createTransport(transactionHash);
    const dependencies: GasExecutionDependencies = {
      rpcTransport: transport.transport,
      clock: () => Date.now(),
      random: () => 0,
    };
    const submitted = await withSignerConfiguration([scope.projectId], () =>
      submit(
        t,
        scope,
        sponsored.reservation.requestId,
        transactionHash,
        transactionXdr,
        dependencies,
      ),
    );
    expect(submitted).toMatchObject({
      object: "gas_submit_result",
      status: "submitted",
      transactionHash,
      reservedStroops: "200",
      actualFeeStroops: null,
      reconciliationRequired: false,
    });
    expect(transport.getSendCalls()).toBe(1);

    const signedOuterXdr = transport.getSignedOuterXdr();
    const outerHash = transport.getOuterHash();
    if (signedOuterXdr === undefined || outerHash === undefined) {
      throw new Error("Expected the transport to capture the signed FeeBump");
    }
    const outer = new FeeBumpTransaction(signedOuterXdr, Networks.TESTNET);
    const inner = TransactionBuilder.fromXDR(transactionXdr, Networks.TESTNET);
    expect(outer.innerTransaction.toXDR()).toBe(inner.toXDR());
    expect(outer.innerTransaction.hash().toString("hex")).toBe(transactionHash);
    expect(outer.hash().toString("hex")).toBe(outerHash);
    expect(outer.fee).toBe("200");
    expect(outer.feeSource).toBe(RELAYER_PUBLIC_KEY);

    const reconciled = await reconcile(t, { rpcTransport: transport.transport });
    expect(reconciled).toMatchObject({ claimed: 1, recorded: 1, verified: 1, exhausted: 0 });
    expect(transport.getLookupCalls()).toBe(1);

    const settledState = await readState(t, scope.projectId);
    expect(settledState.attempts).toHaveLength(1);
    expect(settledState.attempts[0]).toMatchObject({
      lifecycle: "succeeded",
      outerTransactionHash: outerHash,
      outerFeeStroops: 200n,
      actualFeeStroops: 187n,
      sendCount: 1,
      settledAt: NOW,
    });
    expect(settledState.policy).toMatchObject({
      outstandingHoldsStroops: 0n,
      dailyConfirmedSpendStroops: 187n,
      dailyReservedStroops: 187n,
    });

    const beforeReplay = await readState(t, scope.projectId);
    const replay = await submit(
      t,
      scope,
      sponsored.reservation.requestId,
      transactionHash,
      undefined,
      dependencies,
    );
    expect(replay).toMatchObject({
      object: "gas_submit_result",
      status: "succeeded",
      outerTransactionHash: outerHash,
      reservedStroops: "200",
      actualFeeStroops: "187",
      reconciliationRequired: false,
    });
    expect(await readState(t, scope.projectId)).toEqual(beforeReplay);
    expect(transport.getSendCalls()).toBe(1);
  });
});

test("charges a trusted fee-bearing inner failure once and replays failed", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const scope = await createScope(t, { suffix: "failure" });
    const transactionXdr = gasMaxTimeEnvelopeFixtures.unbounded;
    const sponsored = await sponsor(t, scope, transactionXdr, "integration-failure");
    expect(sponsored.status).toBe("success");
    if (sponsored.status !== "success" || sponsored.reservation.transactionHash === null) {
      throw new Error("Expected a public sponsor reservation");
    }

    const transactionHash = sponsored.reservation.transactionHash;
    const transport = createTransport(transactionHash, {
      lookupMode: "failure",
      lookupFeeStroops: 199n,
    });
    const result = await withSignerConfiguration([scope.projectId], () =>
      submit(t, scope, sponsored.reservation.requestId, transactionHash, transactionXdr, {
        rpcTransport: transport.transport,
        clock: () => Date.now(),
        random: () => 0,
      }),
    );
    expect(result).toMatchObject({ status: "submitted", actualFeeStroops: null });

    const reconciled = await reconcile(t, { rpcTransport: transport.transport });
    expect(reconciled).toMatchObject({ claimed: 1, verified: 1 });
    const state = await readState(t, scope.projectId);
    expect(state.attempts[0]).toMatchObject({
      lifecycle: "failed",
      actualFeeStroops: 199n,
      settledAt: NOW,
    });
    expect(state.policy).toMatchObject({
      outstandingHoldsStroops: 0n,
      dailyConfirmedSpendStroops: 199n,
      dailyReservedStroops: 199n,
    });

    const replay = await submit(
      t,
      scope,
      sponsored.reservation.requestId,
      transactionHash,
      undefined,
      {},
    );
    expect(replay).toMatchObject({ status: "failed", actualFeeStroops: "199" });
    expect(transport.getSendCalls()).toBe(1);
    expect(transport.getLookupCalls()).toBe(1);
  });
});

test("retains uncertain exposure through restart and authenticated replay without a fourth send", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const scope = await createScope(t, { suffix: "uncertain" });
    const transactionXdr = gasMaxTimeEnvelopeFixtures.unbounded;
    const sponsored = await sponsor(t, scope, transactionXdr, "integration-uncertain");
    expect(sponsored.status).toBe("success");
    if (sponsored.status !== "success" || sponsored.reservation.transactionHash === null) {
      throw new Error("Expected a public sponsor reservation");
    }

    const transactionHash = sponsored.reservation.transactionHash;
    const transport = createTransport(transactionHash, {
      sendMode: "timeout",
    });
    const dependencies: GasExecutionDependencies = {
      rpcTransport: transport.transport,
      clock: () => Date.now(),
      sleep: async (milliseconds) => {
        vi.advanceTimersByTime(milliseconds);
      },
      random: () => 0,
    };
    const uncertain = await withSignerConfiguration([scope.projectId], () =>
      submit(
        t,
        scope,
        sponsored.reservation.requestId,
        transactionHash,
        transactionXdr,
        dependencies,
      ),
    );
    expect(uncertain).toMatchObject({
      status: "submission_unknown",
      reconciliationRequired: true,
      actualFeeStroops: null,
    });
    const afterTimeout = await readState(t, scope.projectId);
    const pinnedOuterHash = afterTimeout.attempts[0]?.outerTransactionHash;
    expect(afterTimeout.attempts[0]).toMatchObject({
      lifecycle: "submission_unknown",
      sendCount: 3,
      outerFeeStroops: 200n,
    });
    expect(pinnedOuterHash).toEqual(expect.any(String));
    expect(afterTimeout.policy?.outstandingHoldsStroops).toBe(200n);

    vi.setSystemTime(NOW + 30_001);
    expect(await t.mutation(internal.gas.execution.recoverAbandoned, { limit: 25 })).toBe(1);
    const afterRecovery = await readState(t, scope.projectId);
    expect(afterRecovery.attempts[0]).toMatchObject({
      lifecycle: "submission_unknown",
      sendCount: 3,
      outerTransactionHash: pinnedOuterHash,
      reconciliationRequired: true,
    });
    expect(afterRecovery.attempts[0]?.leaseToken).toBeUndefined();

    const noXdrRecovery = await submit(
      t,
      scope,
      sponsored.reservation.requestId,
      transactionHash,
      undefined,
      dependencies,
    );
    expect(noXdrRecovery).toMatchObject({ status: "submission_unknown" });
    const resupply = await withSignerConfiguration([scope.projectId], () =>
      submit(
        t,
        scope,
        sponsored.reservation.requestId,
        transactionHash,
        transactionXdr,
        dependencies,
      ),
    );
    expect(resupply).toMatchObject({
      status: "submission_unknown",
      outerTransactionHash: pinnedOuterHash,
    });
    expect(transport.getSendCalls()).toBe(3);

    const reconciled = await reconcile(t, { rpcTransport: transport.transport });
    expect(reconciled).toMatchObject({ claimed: 1, verified: 1 });
    const settled = await readState(t, scope.projectId);
    expect(settled.attempts[0]).toMatchObject({
      lifecycle: "succeeded",
      sendCount: 3,
      outerTransactionHash: pinnedOuterHash,
      actualFeeStroops: 187n,
    });
    expect(settled.policy?.outstandingHoldsStroops).toBe(0n);
    expect(transport.getLookupCalls()).toBe(1);
  });
});

test("fences concurrent duplicate submits and duplicate RPC acceptance to one settlement", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const scope = await createScope(t, { suffix: "contention" });
    const transactionXdr = gasMaxTimeEnvelopeFixtures.unbounded;
    const sponsored = await sponsor(t, scope, transactionXdr, "integration-contention");
    expect(sponsored.status).toBe("success");
    if (sponsored.status !== "success" || sponsored.reservation.transactionHash === null) {
      throw new Error("Expected a public sponsor reservation");
    }

    const transactionHash = sponsored.reservation.transactionHash;
    const transport = createTransport(transactionHash, {
      sendMode: "duplicate",
    });
    const dependencies: GasExecutionDependencies = {
      rpcTransport: transport.transport,
      clock: () => Date.now(),
      random: () => 0,
    };
    const results = await withSignerConfiguration([scope.projectId], () =>
      Promise.all([
        submit(
          t,
          scope,
          sponsored.reservation.requestId,
          transactionHash,
          transactionXdr,
          dependencies,
        ),
        submit(
          t,
          scope,
          sponsored.reservation.requestId,
          transactionHash,
          transactionXdr,
          dependencies,
        ),
      ]),
    );
    expect(results[0]).toMatchObject({ status: "submitted" });
    expect(results[1]).toMatchObject({ status: expect.stringMatching(/^(claimed|submitted)$/) });
    expect(transport.getSendCalls()).toBe(1);

    const beforeReconciliation = await readState(t, scope.projectId);
    expect(beforeReconciliation.attempts).toHaveLength(1);
    const attempt = beforeReconciliation.attempts[0];
    if (
      !attempt ||
      attempt.outerTransactionHash === undefined ||
      attempt.leaseToken === undefined
    ) {
      throw new Error("Expected one pinned execution attempt");
    }
    expect(attempt.latestSendClassification).toMatchObject({ status: "duplicate", sendCount: 1 });
    expect(beforeReconciliation.policy).toMatchObject({ outstandingHoldsStroops: 200n });
    expect(beforeReconciliation.bucket?.tokens).toBe(1);

    expect(await reconcile(t, { rpcTransport: transport.transport })).toMatchObject({
      claimed: 1,
      verified: 1,
    });
    const afterSettlement = await readState(t, scope.projectId);
    expect(afterSettlement.attempts[0]).toMatchObject({
      lifecycle: "succeeded",
      actualFeeStroops: 187n,
      settledAt: NOW,
    });
    expect(afterSettlement.policy).toMatchObject({
      outstandingHoldsStroops: 0n,
      dailyConfirmedSpendStroops: 187n,
    });

    const staleWorker = await t.mutation(internal.gas.execution.recordSendOutcome, {
      executionAttemptId: attempt._id,
      projectId: scope.projectId,
      outerTransactionHash: attempt.outerTransactionHash,
      sendCount: 1,
      leaseToken: attempt.leaseToken,
      leaseGeneration: attempt.leaseGeneration,
      classification: {
        status: "duplicate",
        outerTransactionHash: attempt.outerTransactionHash,
        sendCount: 1,
      },
    });
    expect(staleWorker).toEqual({ status: "invalid_lifecycle" });
    expect(
      await t.mutation(internal.gas.settlement.settle, {
        executionAttemptId: attempt._id,
        projectId: scope.projectId,
      }),
    ).toEqual({
      status: "settled",
      lifecycle: "succeeded",
      actualFeeStroops: 187n,
      idempotent: true,
    });
    expect(await readState(t, scope.projectId)).toEqual(afterSettlement);
  });
});

test("blocks execution-hold increases and rejects cross-project or revoked submits before send", async () => {
  await withFixedTime(async () => {
    const transactionXdr = buildGasTestEnvelope({ fee: "200" });

    const capTest = convexTest(schema, modules);
    const capped = await createScope(capTest, { suffix: "cap", dailyCapStroops: 350n });
    const capReservation = await sponsor(capTest, capped, transactionXdr, "integration-cap");
    expect(capReservation.status).toBe("success");
    if (
      capReservation.status !== "success" ||
      capReservation.reservation.transactionHash === null
    ) {
      throw new Error("Expected the cap reservation");
    }
    const capTransactionHash = capReservation.reservation.transactionHash;
    const capTransport = createTransport(capTransactionHash);
    const capBefore = await readState(capTest, capped.projectId);
    const capResult = await withSignerConfiguration([capped.projectId], () =>
      submit(
        capTest,
        capped,
        capReservation.reservation.requestId,
        capTransactionHash,
        transactionXdr,
        { rpcTransport: capTransport.transport },
      ),
    );
    expect(capResult).toEqual({ status: "policy_denied" });
    expect(capTransport.getSendCalls()).toBe(0);
    const capAfter = await readState(capTest, capped.projectId);
    expect(capAfter.attempts).toHaveLength(0);
    expect(capAfter.policy?.dailyReservedStroops).toBe(capBefore.policy?.dailyReservedStroops);

    const t = convexTest(schema, modules);
    const first = await createScope(t, { suffix: "cross-project" });
    const second = await createScope(t, {
      suffix: "other-project",
      apiKeyHash: SECOND_API_KEY_HASH,
    });
    const firstReservation = await sponsor(
      t,
      first,
      gasMaxTimeEnvelopeFixtures.unbounded,
      "integration-cross",
    );
    expect(firstReservation.status).toBe("success");
    if (
      firstReservation.status !== "success" ||
      firstReservation.reservation.transactionHash === null
    ) {
      throw new Error("Expected the first project reservation");
    }
    const firstTransactionHash = firstReservation.reservation.transactionHash;
    const crossTransport = createTransport(firstTransactionHash);
    const secondBefore = await readState(t, second.projectId);
    const crossProject = await withSignerConfiguration([second.projectId], () =>
      submit(
        t,
        second,
        firstReservation.reservation.requestId,
        firstTransactionHash,
        gasMaxTimeEnvelopeFixtures.unbounded,
        { rpcTransport: crossTransport.transport },
      ),
    );
    expect(crossProject).toEqual({ status: "resource_not_found" });
    expect(crossTransport.getSendCalls()).toBe(0);
    expect(await readState(t, second.projectId)).toEqual(secondBefore);

    const firstBeforeSubstitution = await readState(t, first.projectId);
    const substitutedXdr = await withSignerConfiguration([first.projectId], () =>
      submit(
        t,
        first,
        firstReservation.reservation.requestId,
        firstTransactionHash,
        gasMaxTimeEnvelopeFixtures.later,
        { rpcTransport: crossTransport.transport },
      ),
    );
    expect(substitutedXdr).toEqual({ status: "invalid_lifecycle" });
    expect(crossTransport.getSendCalls()).toBe(0);
    expect(await readState(t, first.projectId)).toEqual(firstBeforeSubstitution);

    await t.run(async (ctx) => await ctx.db.patch(first.apiKeyId, { revoked: true }));
    const revoked = await submit(
      t,
      first,
      firstReservation.reservation.requestId,
      firstTransactionHash,
      gasMaxTimeEnvelopeFixtures.unbounded,
      { rpcTransport: crossTransport.transport },
    );
    expect(revoked).toEqual({ status: "unauthorized" });
    expect(crossTransport.getSendCalls()).toBe(0);
  });
});

test("distinguishes proven-unsent expiry from possible-send expiry across UTC rollover", async () => {
  await withFixedTime(async () => {
    const unsentContext = convexTest(schema, modules);
    const unsentScope = await createScope(unsentContext, { suffix: "unsent-expiry" });
    const unsentXdr = gasMaxTimeEnvelopeFixtures.unbounded;
    const unsentReservation = await sponsor(
      unsentContext,
      unsentScope,
      unsentXdr,
      "integration-unsent-expiry",
    );
    expect(unsentReservation.status).toBe("success");
    if (unsentReservation.status !== "success") throw new Error("Expected an unsent reservation");
    await withSignerConfiguration([unsentScope.projectId], async () => {
      const claim = await unsentContext.action(internal.gas.execution_action.claim, {
        apiKeyHash: unsentScope.apiKeyHash,
        requestId: unsentReservation.reservation.requestId,
        transactionXdr: unsentXdr,
      });
      expect(claim).toMatchObject({ status: "claimed", sendCount: 0 });
    });
    vi.setSystemTime(NOW + 15 * 60 * 1_000 + 1);
    expect(
      await unsentContext.mutation(internal.gas.execution.recoverAbandoned, { limit: 25 }),
    ).toBe(1);
    expect((await readState(unsentContext, unsentScope.projectId)).attempts[0]).toMatchObject({
      lifecycle: "expired",
      actualFeeStroops: 0n,
      settledAt: NOW + 15 * 60 * 1_000 + 1,
    });
    expect(
      (await readState(unsentContext, unsentScope.projectId)).policy?.outstandingHoldsStroops,
    ).toBe(0n);

    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);
    const scope = await createScope(t, { suffix: "rollover" });
    const transactionXdr = gasMaxTimeEnvelopeFixtures.unbounded;
    const sponsored = await sponsor(t, scope, transactionXdr, "integration-rollover");
    expect(sponsored.status).toBe("success");
    if (sponsored.status !== "success" || sponsored.reservation.transactionHash === null) {
      throw new Error("Expected a rollover reservation");
    }
    const transactionHash = sponsored.reservation.transactionHash;
    const transport = createTransport(transactionHash);
    const dependencies: GasExecutionDependencies = { rpcTransport: transport.transport };
    const submitted = await withSignerConfiguration([scope.projectId], () =>
      submit(
        t,
        scope,
        sponsored.reservation.requestId,
        transactionHash,
        transactionXdr,
        dependencies,
      ),
    );
    expect(submitted).toMatchObject({ status: "submitted" });
    const beforeRollover = await readState(t, scope.projectId);
    expect(beforeRollover.policy?.outstandingHoldsStroops).toBe(200n);

    vi.setSystemTime(NOW + 15 * 60 * 1_000 + 1);
    const expiredPossibleSend = await submit(
      t,
      scope,
      sponsored.reservation.requestId,
      transactionHash,
      undefined,
      dependencies,
    );
    expect(expiredPossibleSend).toMatchObject({ status: "submitted", actualFeeStroops: null });
    expect((await readState(t, scope.projectId)).policy?.outstandingHoldsStroops).toBe(200n);

    expect(await reconcile(t, { rpcTransport: transport.transport })).toMatchObject({
      claimed: 1,
      verified: 1,
    });
    const settled = await readState(t, scope.projectId);
    expect(settled.policy).toMatchObject({
      outstandingHoldsStroops: 0n,
      dailyConfirmedSpendStroops: 0n,
    });
    expect(settled.daily).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountingDayKey: "2026-09-03", confirmedSpendStroops: 187n }),
      ]),
    );
  });
});

test("settles after audit retention cleanup and keeps public, persisted, and scheduled data redacted", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const scope = await createScope(t, { suffix: "redaction" });
    const transactionXdr = gasMaxTimeEnvelopeFixtures.unbounded;
    const sponsored = await sponsor(t, scope, transactionXdr, "integration-redaction");
    expect(sponsored.status).toBe("success");
    if (sponsored.status !== "success" || sponsored.reservation.transactionHash === null) {
      throw new Error("Expected a redaction reservation");
    }

    const transactionHash = sponsored.reservation.transactionHash;
    const providerBody = "provider-secret-body";
    const transport = createTransport(transactionHash, {
      sendMode: "retry_later",
    });
    const dependencies: GasExecutionDependencies = {
      rpcTransport: transport.transport,
      clock: () => Date.now(),
      sleep: async (milliseconds) => {
        vi.advanceTimersByTime(milliseconds);
      },
      random: () => 0,
    };
    const uncertain = await withSignerConfiguration([scope.projectId], () =>
      submit(
        t,
        scope,
        sponsored.reservation.requestId,
        transactionHash,
        transactionXdr,
        dependencies,
      ),
    );
    expect(uncertain).toMatchObject({ status: "submission_unknown" });

    await t.run(async (ctx) => {
      const log = await ctx.db
        .query("gasLogs")
        .withIndex("by_project_id_and_request_id", (q) =>
          q.eq("projectId", scope.projectId).eq("requestId", sponsored.reservation.requestId),
        )
        .unique();
      if (!log) throw new Error("Expected the sponsor audit row");
      await ctx.db.patch(log._id, { retentionExpiresAt: NOW });
    });
    expect(await t.mutation(internal.gas.retention.expireLogs, { limit: 25 })).toBe(1);
    vi.setSystemTime(NOW + 30_001);
    expect(await t.mutation(internal.gas.execution.recoverAbandoned, { limit: 25 })).toBe(1);

    const persistedBeforeSettlement = await readState(t, scope.projectId);
    await assertNoSecrets(persistedBeforeSettlement, [
      transactionXdr,
      providerBody,
      scope.apiKeyHash,
    ]);
    expect(persistedBeforeSettlement.logs).toHaveLength(0);
    expect(persistedBeforeSettlement.attempts[0]).not.toHaveProperty("signedOuterXdr");
    expect(persistedBeforeSettlement.attempts[0]).not.toHaveProperty("transactionXdr");

    expect(await reconcile(t, { rpcTransport: transport.transport }, 1)).toMatchObject({
      claimed: 1,
      verified: 1,
    });
    const terminal = await submit(
      t,
      scope,
      sponsored.reservation.requestId,
      transactionHash,
      undefined,
      {},
    );
    expect(terminal).toMatchObject({
      object: "gas_submit_result",
      status: "succeeded",
      actualFeeStroops: "187",
    });
    await assertNoSecrets(terminal, [transactionXdr, providerBody, scope.apiKeyHash]);
    expect(Object.keys(terminal).sort()).toEqual(
      [
        "actualFeeStroops",
        "expiresAt",
        "object",
        "outerTransactionHash",
        "reconciliationRequired",
        "requestId",
        "reservedStroops",
        "status",
        "transactionHash",
      ].sort(),
    );

    const scheduled = await scheduledFunctions(t);
    expect(scheduled).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "gas/reconciliation_action:reconcileDue",
          args: [{ limit: 1 }],
        }),
      ]),
    );
    await assertNoSecrets(scheduled, [transactionXdr, providerBody, scope.apiKeyHash]);
  });
});
