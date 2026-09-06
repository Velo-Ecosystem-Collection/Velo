/// <reference types="vite/client" />

import {
  buildGasTestEnvelope,
  GAS_TEST_RELAYER_KEYPAIR,
  GAS_TEST_SOURCE_KEYPAIR,
  keypairForLabel,
} from "@repo/stellar/test-fixtures";
import { Networks, Transaction, xdr } from "@stellar/stellar-sdk";
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";

import type { DataModel, Id } from "../../_generated/dataModel";
import type {
  TestnetFeeBumpRpcAdapter,
  TestnetFeeBumpRpcAuthorizationHook,
} from "@repo/stellar/fee-bump-rpc";
import type { TestConvexForDataModelAndIdentity } from "convex-test";

import { api, internal } from "../../_generated/api";
import { executeGasExecution } from "../../gas/execution_action";
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

function nestedFeeBumpResult(
  innerTransactionHash: string,
  outcome: "success" | "failed",
  innerCode: "txSuccess" | "txBadSeq",
): xdr.TransactionResult {
  const innerResult = new xdr.InnerTransactionResult({
    feeCharged: new xdr.Int64("187"),
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
    feeCharged: new xdr.Int64("187"),
    result:
      outcome === "success"
        ? xdr.TransactionResultResult.txFeeBumpInnerSuccess(innerResultPair)
        : xdr.TransactionResultResult.txFeeBumpInnerFailed(innerResultPair),
    ext: new xdr.TransactionResultExt(0),
  });
}

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

async function executeWithTransport(
  t: TestContext,
  apiKeyHash: string,
  requestId: string,
  transactionHash: string,
  transactionXdr: string,
  transport: {
    getNetwork: () => Promise<unknown>;
    sendTransaction: (transaction: { hash(): Buffer }) => Promise<unknown>;
    getTransaction: (hash: string) => Promise<unknown>;
  },
) {
  const result = await t.action(async (ctx) => {
    const execution = await executeGasExecution(
      ctx,
      { apiKeyHash, requestId, transactionHash, transactionXdr },
      undefined,
      { rpcTransport: transport },
    );
    return execution.status === "claimed" ? execution.execution : execution;
  });
  return result;
}

async function executeWithAdapterFactory(
  t: TestContext,
  apiKeyHash: string,
  requestId: string,
  transactionHash: string,
  transactionXdr: string,
  rpcAdapterFactory: (
    authorizeSend: TestnetFeeBumpRpcAuthorizationHook,
  ) => TestnetFeeBumpRpcAdapter,
) {
  const result = await t.action(async (ctx) => {
    const execution = await executeGasExecution(
      ctx,
      { apiKeyHash, requestId, transactionHash, transactionXdr },
      undefined,
      { rpcAdapterFactory },
    );
    return execution.status === "claimed" ? execution.execution : execution;
  });
  return result;
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
    expect(malformed).toEqual({ status: "invalid_request" });
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

test("public submit sends a new claim and replays one safe DTO without new exposure", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const { projectId } = await createScope(t, { suffix: "public-submit" });
    const transactionXdr = gasMaxTimeEnvelopeFixtures.unbounded;
    const sponsored = await sponsor(t, transactionXdr, "public-submit-idempotency");
    expect(sponsored.status).toBe("success");
    if (sponsored.status !== "success") throw new Error("Expected a sponsor reservation");
    const transactionHash = sponsored.reservation.transactionHash;
    if (transactionHash === null) throw new Error("Expected a reservation transaction hash");

    await withSignerConfiguration([projectId], async () => {
      let sendCalls = 0;
      const firstClaim = await t.action(async (ctx) =>
        executeGasExecution(
          ctx,
          {
            apiKeyHash: API_KEY_HASH,
            requestId: ` ${sponsored.reservation.requestId} `,
            transactionHash: transactionHash.toUpperCase(),
            transactionXdr: ` ${transactionXdr} `,
          },
          undefined,
          {
            rpcTransport: {
              getNetwork: async () => ({ passphrase: Networks.TESTNET }),
              sendTransaction: async (outer) => {
                sendCalls += 1;
                return {
                  status: "PENDING",
                  hash: outer.hash().toString("hex"),
                  latestLedger: 99,
                  latestLedgerCloseTime: NOW,
                };
              },
              getTransaction: async (hash) => ({
                status: "NOT_FOUND",
                txHash: hash,
                latestLedger: 99,
                latestLedgerCloseTime: NOW,
                oldestLedger: 1,
                oldestLedgerCloseTime: NOW,
              }),
            },
          },
        ),
      );
      const first = firstClaim.status === "claimed" ? firstClaim.execution : firstClaim;
      if (firstClaim.status !== "claimed") throw new Error("Expected a submitted claim");
      const expected = {
        object: "gas_submit_result",
        requestId: sponsored.reservation.requestId,
        transactionHash,
        outerTransactionHash: firstClaim.outerTransactionHash,
        status: "submitted",
        reservedStroops: "200",
        actualFeeStroops: null,
        expiresAt: new Date(NOW + 15 * 60 * 1_000).toISOString(),
        reconciliationRequired: false,
      };
      expect(first).toEqual(expected);
      expect(sendCalls).toBe(1);
      expect(Object.keys(first).sort()).toEqual(Object.keys(expected).sort());

      const afterClaim = await readState(t, projectId);
      expect(afterClaim.attempts).toHaveLength(1);
      expect(afterClaim.attempts[0]).toMatchObject({
        outerTransactionHash: firstClaim.outerTransactionHash,
        outerFeeStroops: 200n,
        sendCount: 1,
        firstPossibleSendAt: NOW,
        nextCheckAt: NOW,
        reconciliationDeadlineAt: NOW + 24 * 60 * 60 * 1_000,
        reconciliationRequired: false,
        latestSendClassification: {
          status: "pending",
          outerTransactionHash: firstClaim.outerTransactionHash,
          sendCount: 1,
          recordedAt: NOW,
        },
      });
      expect(afterClaim.policy?.outstandingHoldsStroops).toBe(200n);
      expect(afterClaim.logs[0]?.lifecycle).toBe("submitted");

      const beforeReplay = await readState(t, projectId);
      const previousSignerRegistry = process.env[GAS_RELAYER_SIGNERS_ENV];
      process.env[GAS_RELAYER_SIGNERS_ENV] = "[]";
      try {
        const replayWithoutCustody = await t.action(api.gas.public_api.submit, {
          apiKeyHash: API_KEY_HASH,
          requestId: sponsored.reservation.requestId,
          transactionHash,
          transactionXdr,
        });
        expect(replayWithoutCustody).toEqual(expected);
      } finally {
        if (previousSignerRegistry === undefined) delete process.env[GAS_RELAYER_SIGNERS_ENV];
        else process.env[GAS_RELAYER_SIGNERS_ENV] = previousSignerRegistry;
      }
      expect(await readState(t, projectId)).toEqual(beforeReplay);

      const replay = await t.action(api.gas.public_api.submit, {
        apiKeyHash: API_KEY_HASH,
        requestId: sponsored.reservation.requestId,
        transactionHash,
        transactionXdr,
      });
      expect(replay).toEqual(expected);
      expect(await readState(t, projectId)).toEqual(beforeReplay);

      const noXdrStatus = await t.action(api.gas.public_api.submit, {
        apiKeyHash: API_KEY_HASH,
        requestId: sponsored.reservation.requestId,
        transactionHash,
      });
      expect(noXdrStatus).toEqual(expected);
      expect(await readState(t, projectId)).toEqual(beforeReplay);

      const invalidResupply = await t.action(api.gas.public_api.submit, {
        apiKeyHash: API_KEY_HASH,
        requestId: sponsored.reservation.requestId,
        transactionHash,
        transactionXdr: gasMaxTimeEnvelopeFixtures.later,
      });
      expect(invalidResupply).toEqual({ status: "invalid_lifecycle" });
      expect(await readState(t, projectId)).toEqual(beforeReplay);
    });
  });
});

test("records duplicate, rejection, retry, timeout, and malformed send classifications", async () => {
  await withFixedTime(async () => {
    const cases = [
      {
        id: "duplicate",
        response: (hash: string) => ({
          status: "DUPLICATE",
          hash,
          latestLedger: 99,
          latestLedgerCloseTime: NOW,
        }),
        expectedStatus: "submitted",
        expectedClassification: "duplicate",
      },
      {
        id: "rejection",
        response: (hash: string) => ({
          status: "ERROR",
          hash,
          latestLedger: 99,
          latestLedgerCloseTime: NOW,
        }),
        expectedStatus: "submission_unknown",
        expectedClassification: "rejected",
      },
      {
        id: "retry-later",
        response: (hash: string) => ({
          status: "TRY_AGAIN_LATER",
          hash,
          latestLedger: 99,
          latestLedgerCloseTime: NOW,
        }),
        expectedStatus: "submission_unknown",
        expectedClassification: "retry_later",
      },
      {
        id: "timeout",
        response: (_hash: string) => {
          throw Object.assign(new Error("provider detail"), { name: "TimeoutError" });
        },
        expectedStatus: "submission_unknown",
        expectedClassification: "unknown",
      },
      {
        id: "malformed",
        response: (_hash: string) => ({ body: "must not persist" }),
        expectedStatus: "submission_unknown",
        expectedClassification: "unknown",
      },
      {
        id: "hash-mismatch",
        response: (_hash: string) => ({
          status: "PENDING",
          hash: "f".repeat(64),
          latestLedger: 99,
          latestLedgerCloseTime: NOW,
        }),
        expectedStatus: "submission_unknown",
        expectedClassification: "unknown",
      },
    ] as const;

    for (const sendCase of cases) {
      const t = convexTest(schema, modules);
      const scope = await createScope(t, { suffix: `classification-${sendCase.id}` });
      const sponsored = await sponsor(
        t,
        gasMaxTimeEnvelopeFixtures.unbounded,
        `classification-${sendCase.id}`,
        scope.apiKeyHash,
      );
      expect(sponsored.status).toBe("success");
      if (sponsored.status !== "success") throw new Error("Expected a reservation");
      const transactionHash = sponsored.reservation.transactionHash;
      if (transactionHash === null) throw new Error("Expected a transaction hash");

      let sendCalls = 0;
      const result = await withSignerConfiguration([scope.projectId], () =>
        executeWithTransport(
          t,
          scope.apiKeyHash,
          sponsored.reservation.requestId,
          transactionHash,
          gasMaxTimeEnvelopeFixtures.unbounded,
          {
            getNetwork: async () => ({ passphrase: Networks.TESTNET }),
            sendTransaction: async (outer) => {
              sendCalls += 1;
              return sendCase.response(outer.hash().toString("hex"));
            },
            getTransaction: async (hash) => ({
              status: "NOT_FOUND",
              txHash: hash,
              latestLedger: 99,
              latestLedgerCloseTime: NOW,
              oldestLedger: 1,
              oldestLedgerCloseTime: NOW,
            }),
          },
        ),
      );

      expect(result).toMatchObject({ status: sendCase.expectedStatus });
      expect(sendCalls).toBe(1);
      const state = await readState(t, scope.projectId);
      expect(state.attempts[0]).toMatchObject({
        sendCount: 1,
        lifecycle: sendCase.expectedStatus,
        outerFeeStroops: 200n,
        latestSendClassification: {
          status: sendCase.expectedClassification,
          sendCount: 1,
        },
      });
      expect(state.logs[0]?.lifecycle).toBe(sendCase.expectedStatus);
    }
  });
});

test("simultaneous duplicate executions share one pinned outer identity and one send", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const scope = await createScope(t, { suffix: "simultaneous" });
    const transactionXdr = gasMaxTimeEnvelopeFixtures.unbounded;
    const sponsored = await sponsor(
      t,
      transactionXdr,
      "simultaneous-idempotency",
      scope.apiKeyHash,
    );
    expect(sponsored.status).toBe("success");
    if (sponsored.status !== "success") throw new Error("Expected a reservation");
    const transactionHash = sponsored.reservation.transactionHash;
    if (transactionHash === null) throw new Error("Expected a transaction hash");

    let sendCalls = 0;
    const transport = {
      getNetwork: async () => ({ passphrase: Networks.TESTNET }),
      sendTransaction: async (outer: { hash(): Buffer }) => {
        sendCalls += 1;
        return {
          status: "PENDING",
          hash: outer.hash().toString("hex"),
          latestLedger: 99,
          latestLedgerCloseTime: NOW,
        };
      },
      getTransaction: async (hash: string) => ({
        status: "NOT_FOUND",
        txHash: hash,
        latestLedger: 99,
        latestLedgerCloseTime: NOW,
        oldestLedger: 1,
        oldestLedgerCloseTime: NOW,
      }),
    };

    const results = await withSignerConfiguration([scope.projectId], () =>
      Promise.all([
        executeWithTransport(
          t,
          scope.apiKeyHash,
          sponsored.reservation.requestId,
          transactionHash,
          transactionXdr,
          transport,
        ),
        executeWithTransport(
          t,
          scope.apiKeyHash,
          sponsored.reservation.requestId,
          transactionHash,
          transactionXdr,
          transport,
        ),
      ]),
    );

    const firstResult = results[0];
    const secondResult = results[1];
    expect(firstResult?.status).toBe("submitted");
    expect(secondResult?.status).toMatch(/^(claimed|submitted)$/);
    if (
      firstResult?.status === "submitted" &&
      (secondResult?.status === "claimed" || secondResult?.status === "submitted")
    ) {
      expect(secondResult.requestId).toBe(firstResult.requestId);
    }
    expect(sendCalls).toBe(1);
    const state = await readState(t, scope.projectId);
    expect(state.attempts).toHaveLength(1);
    expect(state.attempts[0]?.sendCount).toBe(1);
  });
});

test("diagnoses inner bad sequence once with bounded lookup evidence and preserves replay", async () => {
  await withFixedTime(async () => {
    const cases = [
      { id: "found", expectedLookup: "found", expectedDisposition: "client_rebuild_required" },
      { id: "not-found", expectedLookup: "not_found", expectedDisposition: "unresolved" },
      { id: "timeout", expectedLookup: "unavailable", expectedDisposition: "unresolved" },
      {
        id: "malformed",
        expectedLookup: "malformed_response",
        expectedDisposition: "unresolved",
      },
      { id: "wrong-network", expectedLookup: "wrong_network", expectedDisposition: "unresolved" },
      { id: "late-lookup", expectedLookup: "not_found", expectedDisposition: "unresolved" },
    ] as const;

    for (const diagnosisCase of cases) {
      vi.setSystemTime(NOW);
      const t = convexTest(schema, modules);
      const scope = await createScope(t, { suffix: `diagnosis-${diagnosisCase.id}` });
      const transactionXdr = gasMaxTimeEnvelopeFixtures.unbounded;
      const sponsored = await sponsor(
        t,
        transactionXdr,
        `diagnosis-${diagnosisCase.id}`,
        scope.apiKeyHash,
      );
      expect(sponsored.status).toBe("success");
      if (sponsored.status !== "success") throw new Error("Expected a reservation");
      const transactionHash = sponsored.reservation.transactionHash;
      if (transactionHash === null) throw new Error("Expected a transaction hash");

      let sendCalls = 0;
      let lookupCalls = 0;
      let networkCalls = 0;
      let sentEnvelopeXdr: string | undefined;
      const transport = {
        getNetwork: async () => {
          networkCalls += 1;
          return {
            passphrase:
              diagnosisCase.id === "wrong-network" && networkCalls > 1
                ? Networks.PUBLIC
                : Networks.TESTNET,
          };
        },
        sendTransaction: async (outer: { hash(): Buffer }) => {
          sendCalls += 1;
          sentEnvelopeXdr = (outer as unknown as { toEnvelope(): string }).toEnvelope();
          return {
            status: "ERROR",
            hash: outer.hash().toString("hex"),
            latestLedger: 99,
            latestLedgerCloseTime: NOW,
            errorResult: nestedFeeBumpResult(transactionHash, "failed", "txBadSeq"),
          };
        },
        getTransaction: async (hash: string) => {
          lookupCalls += 1;
          if (diagnosisCase.id === "late-lookup") {
            await t.run(async (ctx) => {
              const attempt = await ctx.db
                .query("gasExecutionAttempts")
                .withIndex("by_project_id_and_request_id", (q) =>
                  q
                    .eq("projectId", scope.projectId)
                    .eq("requestId", sponsored.reservation.requestId),
                )
                .unique();
              if (!attempt) throw new Error("Missing attempt during lookup");
              await ctx.db.patch(attempt._id, { leaseExpiresAt: NOW - 1 });
            });
            return {
              status: "NOT_FOUND",
              txHash: hash,
              latestLedger: 99,
              latestLedgerCloseTime: NOW,
              oldestLedger: 1,
              oldestLedgerCloseTime: NOW,
            };
          }
          if (diagnosisCase.id === "not-found") {
            return {
              status: "NOT_FOUND",
              txHash: hash,
              latestLedger: 99,
              latestLedgerCloseTime: NOW,
              oldestLedger: 1,
              oldestLedgerCloseTime: NOW,
            };
          }
          if (diagnosisCase.id === "timeout") {
            throw Object.assign(new Error("provider detail"), { name: "TimeoutError" });
          }
          if (diagnosisCase.id === "malformed") {
            return { status: "SUCCESS", txHash: hash };
          }
          if (sentEnvelopeXdr === undefined) throw new Error("Missing sent envelope");
          return {
            status: "FAILED",
            txHash: hash,
            latestLedger: 99,
            latestLedgerCloseTime: NOW,
            oldestLedger: 1,
            oldestLedgerCloseTime: NOW,
            ledger: 42,
            createdAt: NOW,
            applicationOrder: 1,
            feeBump: true,
            envelopeXdr: sentEnvelopeXdr,
            resultXdr: nestedFeeBumpResult(transactionHash, "failed", "txBadSeq"),
            resultMetaXdr: sentEnvelopeXdr,
          };
        },
      };

      const result = await withSignerConfiguration([scope.projectId], () =>
        executeWithTransport(
          t,
          scope.apiKeyHash,
          sponsored.reservation.requestId,
          transactionHash,
          transactionXdr,
          transport,
        ),
      );
      expect(result).toMatchObject({
        status: "submission_unknown",
        transactionHash,
        reservedStroops: "200",
        actualFeeStroops: null,
        reconciliationRequired: false,
      });
      expect(Object.keys(result).sort()).toEqual(
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
      expect(sendCalls).toBe(1);
      expect(lookupCalls).toBe(diagnosisCase.id === "wrong-network" ? 0 : 1);

      const state = await readState(t, scope.projectId);
      const attempt = state.attempts[0];
      if (
        !attempt ||
        attempt.outerTransactionHash === undefined ||
        attempt.leaseToken === undefined
      ) {
        throw new Error("Expected a fenced attempt with a pinned outer hash");
      }
      expect(attempt).toMatchObject({
        lifecycle: "submission_unknown",
        sendCount: 1,
        outerFeeStroops: 200n,
        sequenceDiagnosis: {
          disposition: diagnosisCase.expectedDisposition,
          lookupClassification: diagnosisCase.expectedLookup,
          recordedAt: NOW,
        },
      });
      if (diagnosisCase.id === "late-lookup") {
        expect(attempt.leaseExpiresAt).toBe(NOW - 1);
      }
      expect(state.policy?.outstandingHoldsStroops).toBe(200n);
      expect(state.logs[0]?.lifecycle).toBe("submission_unknown");

      if (diagnosisCase.id === "found") {
        expect(attempt.sequenceDiagnosis).toMatchObject({
          evidence: {
            outerTransactionHash: attempt.outerTransactionHash,
            innerTransactionHash: transactionHash,
            feeSource: RELAYER_PUBLIC_KEY,
            feeStroops: 187n,
            ledger: 42,
            resultCode: "txFeeBumpInnerFailed",
            innerResultCode: "txBadSeq",
          },
        });

        const duplicateDiagnosis = await t.mutation(
          internal.gas.execution.recordSequenceDiagnosis,
          {
            executionAttemptId: attempt._id,
            projectId: scope.projectId,
            outerTransactionHash: attempt.outerTransactionHash,
            sendCount: 1,
            leaseToken: attempt.leaseToken,
            leaseGeneration: attempt.leaseGeneration,
            diagnosis: {
              lookupClassification: "found",
              evidence: {
                outerTransactionHash: attempt.outerTransactionHash,
                innerTransactionHash: transactionHash,
                feeSource: RELAYER_PUBLIC_KEY,
                feeStroops: 187n,
                ledger: 42,
                resultCode: "txFeeBumpInnerFailed",
                innerResultCode: "txBadSeq",
              },
            },
          },
        );
        expect(duplicateDiagnosis).toEqual({
          status: "recorded",
          disposition: "client_rebuild_required",
          idempotent: true,
        });

        const staleDiagnosis = await t.mutation(internal.gas.execution.recordSequenceDiagnosis, {
          executionAttemptId: attempt._id,
          projectId: scope.projectId,
          outerTransactionHash: attempt.outerTransactionHash,
          sendCount: 1,
          leaseToken: "stale-fence",
          leaseGeneration: attempt.leaseGeneration,
          diagnosis: { lookupClassification: "found" },
        });
        expect(staleDiagnosis).toEqual({ status: "invalid_lifecycle" });

        const conflictingDiagnosis = await t.mutation(
          internal.gas.execution.recordSequenceDiagnosis,
          {
            executionAttemptId: attempt._id,
            projectId: scope.projectId,
            outerTransactionHash: attempt.outerTransactionHash,
            sendCount: 1,
            leaseToken: attempt.leaseToken,
            leaseGeneration: attempt.leaseGeneration,
            diagnosis: { lookupClassification: "not_found" },
          },
        );
        expect(conflictingDiagnosis).toEqual({ status: "invalid_lifecycle" });

        await t.run(async (ctx) => {
          await ctx.db.patch(attempt._id, { leaseExpiresAt: NOW - 1 });
        });
        const lateDuplicate = await t.mutation(internal.gas.execution.recordSequenceDiagnosis, {
          executionAttemptId: attempt._id,
          projectId: scope.projectId,
          outerTransactionHash: attempt.outerTransactionHash,
          sendCount: 1,
          leaseToken: attempt.leaseToken,
          leaseGeneration: attempt.leaseGeneration,
          diagnosis: {
            lookupClassification: "found",
            evidence: {
              outerTransactionHash: attempt.outerTransactionHash,
              innerTransactionHash: transactionHash,
              feeSource: RELAYER_PUBLIC_KEY,
              feeStroops: 187n,
              ledger: 42,
              resultCode: "txFeeBumpInnerFailed",
              innerResultCode: "txBadSeq",
            },
          },
        });
        expect(lateDuplicate).toMatchObject({ status: "recorded", idempotent: true });
      }

      const beforeReplay = await readState(t, scope.projectId);
      let replaySendCalls = 0;
      let replayLookupCalls = 0;
      const replay = await withSignerConfiguration([scope.projectId], () =>
        executeWithTransport(
          t,
          scope.apiKeyHash,
          sponsored.reservation.requestId,
          transactionHash,
          transactionXdr,
          {
            getNetwork: async () => ({ passphrase: Networks.PUBLIC }),
            sendTransaction: async () => {
              replaySendCalls += 1;
              throw new Error("replay must not send");
            },
            getTransaction: async () => {
              replayLookupCalls += 1;
              throw new Error("replay must not look up");
            },
          },
        ),
      );
      expect(replay).toEqual(result);
      expect(replaySendCalls).toBe(0);
      expect(replayLookupCalls).toBe(0);
      expect(await readState(t, scope.projectId)).toEqual(beforeReplay);
    }
  });
});

test("keeps distinct same-sequence inner identities independent across source wallets", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const scope = await createScope(t, { suffix: "same-sequence-wallets" });
    const firstXdr = buildGasTestEnvelope({ maxTime: "4102444800" });
    const secondXdr = buildGasTestEnvelope({
      maxTime: "4102444801",
      sourceKeypair: keypairForLabel("gas-alternate-source"),
    });
    const firstSponsored = await sponsor(t, firstXdr, "same-sequence-first", scope.apiKeyHash);
    const secondSponsored = await sponsor(t, secondXdr, "same-sequence-second", scope.apiKeyHash);
    expect(firstSponsored.status).toBe("success");
    expect(secondSponsored.status).toBe("success");
    if (firstSponsored.status !== "success" || secondSponsored.status !== "success") {
      throw new Error("Expected independent reservations");
    }
    const firstHash = firstSponsored.reservation.transactionHash;
    const secondHash = secondSponsored.reservation.transactionHash;
    if (firstHash === null || secondHash === null) throw new Error("Expected transaction hashes");
    expect(firstHash).not.toBe(secondHash);
    expect(new Transaction(secondXdr, Networks.TESTNET).sequence).toBe(
      new Transaction(firstXdr, Networks.TESTNET).sequence,
    );

    let firstOuterHash: string | undefined;
    let secondOuterHash: string | undefined;
    const firstResult = await withSignerConfiguration([scope.projectId], () =>
      executeWithTransport(
        t,
        scope.apiKeyHash,
        firstSponsored.reservation.requestId,
        firstHash,
        firstXdr,
        {
          getNetwork: async () => ({ passphrase: Networks.TESTNET }),
          sendTransaction: async (outer: { hash(): Buffer }) => {
            firstOuterHash = outer.hash().toString("hex");
            return {
              status: "ERROR",
              hash: firstOuterHash,
              latestLedger: 99,
              latestLedgerCloseTime: NOW,
              errorResult: nestedFeeBumpResult(firstHash, "failed", "txBadSeq"),
            };
          },
          getTransaction: async (hash: string) => ({
            status: "NOT_FOUND",
            txHash: hash,
            latestLedger: 99,
            latestLedgerCloseTime: NOW,
            oldestLedger: 1,
            oldestLedgerCloseTime: NOW,
          }),
        },
      ),
    );
    const secondResult = await withSignerConfiguration([scope.projectId], () =>
      executeWithTransport(
        t,
        scope.apiKeyHash,
        secondSponsored.reservation.requestId,
        secondHash,
        secondXdr,
        {
          getNetwork: async () => ({ passphrase: Networks.TESTNET }),
          sendTransaction: async (outer: { hash(): Buffer }) => {
            secondOuterHash = outer.hash().toString("hex");
            return {
              status: "PENDING",
              hash: secondOuterHash,
              latestLedger: 99,
              latestLedgerCloseTime: NOW,
            };
          },
          getTransaction: async (hash: string) => ({
            status: "NOT_FOUND",
            txHash: hash,
            latestLedger: 99,
            latestLedgerCloseTime: NOW,
            oldestLedger: 1,
            oldestLedgerCloseTime: NOW,
          }),
        },
      ),
    );

    expect(firstResult).toMatchObject({ status: "submission_unknown" });
    expect(secondResult).toMatchObject({ status: "submitted" });
    expect(firstOuterHash).toEqual(expect.any(String));
    expect(secondOuterHash).toEqual(expect.any(String));
    expect(firstOuterHash).not.toBe(secondOuterHash);

    const state = await readState(t, scope.projectId);
    expect(state.attempts).toHaveLength(2);
    const firstAttempt = state.attempts.find(
      (attempt) => attempt.innerTransactionHash === firstHash,
    );
    const secondAttempt = state.attempts.find(
      (attempt) => attempt.innerTransactionHash === secondHash,
    );
    expect(firstAttempt).toMatchObject({
      innerTransactionHash: firstHash,
      outerTransactionHash: firstOuterHash,
      sourceWallet: GAS_TEST_SOURCE_KEYPAIR.publicKey(),
      relayerPublicKey: RELAYER_PUBLIC_KEY,
      sendCount: 1,
      sequenceDiagnosis: {
        disposition: "unresolved",
        lookupClassification: "not_found",
      },
    });
    expect(secondAttempt).toMatchObject({
      innerTransactionHash: secondHash,
      outerTransactionHash: secondOuterHash,
      sourceWallet: keypairForLabel("gas-alternate-source").publicKey(),
      relayerPublicKey: RELAYER_PUBLIC_KEY,
      sendCount: 1,
    });
    expect(firstAttempt?.outerTransactionHash).not.toBe(secondAttempt?.outerTransactionHash);
  });
});

test("keeps mismatched ledger evidence unresolved", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const scope = await createScope(t, { suffix: "diagnosis-mismatch" });
    const transactionXdr = gasMaxTimeEnvelopeFixtures.unbounded;
    const sponsored = await sponsor(t, transactionXdr, "diagnosis-mismatch", scope.apiKeyHash);
    expect(sponsored.status).toBe("success");
    if (sponsored.status !== "success") throw new Error("Expected a reservation");
    const transactionHash = sponsored.reservation.transactionHash;
    if (transactionHash === null) throw new Error("Expected a transaction hash");

    const result = await withSignerConfiguration([scope.projectId], () =>
      executeWithAdapterFactory(
        t,
        scope.apiKeyHash,
        sponsored.reservation.requestId,
        transactionHash,
        transactionXdr,
        (authorizeSend) => ({
          send: async (request) => {
            if (!(await authorizeSend(request))) throw new Error("authorization denied");
            return {
              status: "rejected" as const,
              outerTransactionHash: request.expectedOuterHash,
              resultCode: "txFeeBumpInnerFailed",
              innerResultCode: "txBadSeq",
            };
          },
          lookup: async (outerTransactionHash) => ({
            status: "found" as const,
            outerTransactionHash,
            innerTransactionHash: "a".repeat(64),
            feeSource: RELAYER_PUBLIC_KEY,
            feeStroops: 187n,
            ledger: 42,
            resultCode: "txFeeBumpInnerFailed",
            innerResultCode: "txBadSeq",
          }),
        }),
      ),
    );
    expect(result).toMatchObject({ status: "submission_unknown" });

    const state = await readState(t, scope.projectId);
    expect(state.attempts[0]?.sequenceDiagnosis).toEqual({
      disposition: "unresolved",
      lookupClassification: "found",
      recordedAt: NOW,
    });
    expect(state.policy?.outstandingHoldsStroops).toBe(200n);
  });
});

test("crash boundaries preserve either zero sends or durable pinned recovery metadata", async () => {
  await withFixedTime(async () => {
    const cases = [
      { id: "after-signing", expectedLifecycle: "claimed" as const, expectedSendCount: 0 },
      {
        id: "around-authorization-persistence",
        expectedLifecycle: "submission_unknown" as const,
        expectedSendCount: 1,
      },
      {
        id: "before-outcome-persistence",
        expectedLifecycle: "submission_unknown" as const,
        expectedSendCount: 1,
      },
    ] as const;

    for (const crash of cases) {
      vi.setSystemTime(NOW);
      const t = convexTest(schema, modules);
      const scope = await createScope(t, { suffix: `crash-${crash.id}` });
      const sponsored = await sponsor(
        t,
        gasMaxTimeEnvelopeFixtures.unbounded,
        `crash-${crash.id}`,
        scope.apiKeyHash,
      );
      expect(sponsored.status).toBe("success");
      if (sponsored.status !== "success") throw new Error("Expected a reservation");
      const transactionHash = sponsored.reservation.transactionHash;
      if (transactionHash === null) throw new Error("Expected a transaction hash");

      let sendCalls = 0;
      const result = await withSignerConfiguration([scope.projectId], () =>
        executeWithAdapterFactory(
          t,
          scope.apiKeyHash,
          sponsored.reservation.requestId,
          transactionHash,
          gasMaxTimeEnvelopeFixtures.unbounded,
          (authorizeSend) => {
            if (crash.id === "after-signing") {
              throw new Error("simulated crash after signing");
            }
            return {
              send: async (request) => {
                const authorized = await authorizeSend(request);
                if (!authorized) throw new Error("authorization denied");
                if (crash.id === "before-outcome-persistence") sendCalls += 1;
                throw new Error(
                  crash.id === "around-authorization-persistence"
                    ? "simulated authorization acknowledgement loss"
                    : "simulated send acknowledgement loss",
                );
              },
              lookup: async () => ({ status: "not_found" as const }),
            };
          },
        ),
      );

      expect(result).toEqual({ status: "dependency_unavailable" });
      expect(sendCalls).toBe(crash.id === "before-outcome-persistence" ? 1 : 0);
      const state = await readState(t, scope.projectId);
      expect(state.attempts[0]).toMatchObject({
        lifecycle: crash.expectedLifecycle,
        sendCount: crash.expectedSendCount,
      });
      if (crash.expectedSendCount === 0) {
        expect(state.attempts[0]).not.toHaveProperty("outerTransactionHash");
        expect(state.attempts[0]).not.toHaveProperty("outerFeeStroops");
      } else {
        expect(state.attempts[0]).toMatchObject({
          outerTransactionHash: expect.any(String),
          outerFeeStroops: 200n,
          firstPossibleSendAt: NOW,
          reconciliationDeadlineAt: NOW + 24 * 60 * 60 * 1_000,
        });
        expect(state.attempts[0]).not.toHaveProperty("latestSendClassification");
      }
    }
  });
});

test("stale, conflicting, and regressive outcome writes are fenced", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const scope = await createScope(t, { suffix: "outcome-fence" });
    const transactionXdr = gasMaxTimeEnvelopeFixtures.unbounded;
    const sponsored = await sponsor(t, transactionXdr, "outcome-fence", scope.apiKeyHash);
    expect(sponsored.status).toBe("success");
    if (sponsored.status !== "success") throw new Error("Expected a reservation");
    const transactionHash = sponsored.reservation.transactionHash;
    if (transactionHash === null) throw new Error("Expected a transaction hash");

    await withSignerConfiguration([scope.projectId], () =>
      executeWithTransport(
        t,
        scope.apiKeyHash,
        sponsored.reservation.requestId,
        transactionHash,
        transactionXdr,
        {
          getNetwork: async () => ({ passphrase: Networks.TESTNET }),
          sendTransaction: async (outer) => ({
            status: "PENDING",
            hash: outer.hash().toString("hex"),
            latestLedger: 99,
            latestLedgerCloseTime: NOW,
          }),
          getTransaction: async (hash) => ({
            status: "NOT_FOUND",
            txHash: hash,
            latestLedger: 99,
            latestLedgerCloseTime: NOW,
            oldestLedger: 1,
            oldestLedgerCloseTime: NOW,
          }),
        },
      ),
    );

    const state = await readState(t, scope.projectId);
    const attempt = state.attempts[0];
    if (
      !attempt ||
      attempt.outerTransactionHash === undefined ||
      attempt.leaseToken === undefined
    ) {
      throw new Error("Expected a pinned submitted attempt");
    }
    const base = {
      executionAttemptId: attempt._id,
      projectId: scope.projectId,
      outerTransactionHash: attempt.outerTransactionHash,
      sendCount: 1,
      leaseToken: attempt.leaseToken,
      leaseGeneration: attempt.leaseGeneration,
    };
    const staleFence = await t.mutation(internal.gas.execution.recordSendOutcome, {
      ...base,
      leaseToken: "stale-fence",
      classification: {
        status: "pending",
        outerTransactionHash: attempt.outerTransactionHash,
        sendCount: 1,
      },
    });
    expect(staleFence).toEqual({ status: "invalid_lifecycle" });

    const conflictingHash = await t.mutation(internal.gas.execution.recordSendOutcome, {
      ...base,
      outerTransactionHash: "f".repeat(64),
      classification: {
        status: "pending",
        outerTransactionHash: "f".repeat(64),
        sendCount: 1,
      },
    });
    expect(conflictingHash).toEqual({ status: "invalid_lifecycle" });

    const regressive = await t.mutation(internal.gas.execution.recordSendOutcome, {
      ...base,
      classification: {
        status: "rejected",
        outerTransactionHash: attempt.outerTransactionHash,
        sendCount: 1,
        resultCode: "txBadSeq",
      },
    });
    expect(regressive).toEqual({ status: "invalid_lifecycle" });
    expect(await readState(t, scope.projectId)).toEqual(state);
  });
});

test("preflight and live authorization failures never send or pin an outer identity", async () => {
  await withFixedTime(async () => {
    const cases = [
      { id: "network-preflight", expected: "wrong_network" as const },
      { id: "policy-change", expected: "policy_denied" as const },
      { id: "credential-revoked", expected: "unauthorized" as const },
      { id: "lease-expired", expected: "invalid_lifecycle" as const },
      { id: "stale-fence", expected: "invalid_lifecycle" as const },
      { id: "relayer-rotated", expected: "relayer_unavailable" as const },
      { id: "expiry-during-preflight", expected: "reservation_expired" as const },
    ];

    for (const failure of cases) {
      vi.setSystemTime(NOW);
      const t = convexTest(schema, modules);
      const scope = await createScope(t, { suffix: `authorization-${failure.id}` });
      const sponsored = await sponsor(
        t,
        gasMaxTimeEnvelopeFixtures.unbounded,
        `authorization-${failure.id}`,
        scope.apiKeyHash,
      );
      expect(sponsored.status).toBe("success");
      if (sponsored.status !== "success") throw new Error("Expected a reservation");
      const transactionHash = sponsored.reservation.transactionHash;
      if (transactionHash === null) throw new Error("Expected a transaction hash");

      let sendCalls = 0;
      const result = await withSignerConfiguration([scope.projectId], async () =>
        executeWithTransport(
          t,
          scope.apiKeyHash,
          sponsored.reservation.requestId,
          transactionHash,
          gasMaxTimeEnvelopeFixtures.unbounded,
          {
            getNetwork: async () => {
              if (failure.id === "policy-change") {
                await t.run(async (ctx) => {
                  const policy = await ctx.db
                    .query("gasPolicies")
                    .withIndex("by_project_id", (q) => q.eq("projectId", scope.projectId))
                    .unique();
                  if (!policy) throw new Error("Missing policy");
                  await ctx.db.patch(policy._id, { enabled: false });
                });
              }
              if (failure.id === "credential-revoked") {
                await t.run(async (ctx) => {
                  await ctx.db.patch(scope.apiKeyId, { revoked: true });
                });
              }
              if (failure.id === "lease-expired" || failure.id === "stale-fence") {
                await t.run(async (ctx) => {
                  const attempt = await ctx.db
                    .query("gasExecutionAttempts")
                    .withIndex("by_project_id_and_request_id", (q) =>
                      q
                        .eq("projectId", scope.projectId)
                        .eq("requestId", sponsored.reservation.requestId),
                    )
                    .unique();
                  if (!attempt) throw new Error("Missing attempt");
                  await ctx.db.patch(attempt._id, {
                    ...(failure.id === "lease-expired"
                      ? { leaseExpiresAt: NOW - 1 }
                      : { leaseGeneration: attempt.leaseGeneration + 1 }),
                  });
                });
              }
              if (failure.id === "relayer-rotated") {
                await t.run(async (ctx) => {
                  const relayer = await ctx.db
                    .query("relayerAccounts")
                    .withIndex("by_project_id_and_network", (q) =>
                      q.eq("projectId", scope.projectId).eq("network", GAS_NETWORK),
                    )
                    .unique();
                  if (!relayer) throw new Error("Missing relayer");
                  await ctx.db.patch(relayer._id, {
                    publicKey: GAS_TEST_SOURCE_KEYPAIR.publicKey(),
                  });
                });
              }
              if (failure.id === "expiry-during-preflight") {
                vi.setSystemTime(NOW + 15 * 60 * 1_000);
              }
              return {
                passphrase:
                  failure.id === "network-preflight"
                    ? "Public Global Stellar Network ; September 2015"
                    : Networks.TESTNET,
              };
            },
            sendTransaction: async (outer) => {
              sendCalls += 1;
              return {
                status: "PENDING",
                hash: outer.hash().toString("hex"),
                latestLedger: 99,
                latestLedgerCloseTime: NOW,
              };
            },
            getTransaction: async (hash) => ({
              status: "NOT_FOUND",
              txHash: hash,
              latestLedger: 99,
              latestLedgerCloseTime: NOW,
              oldestLedger: 1,
              oldestLedgerCloseTime: NOW,
            }),
          },
        ),
      );

      expect(result).toEqual({ status: failure.expected });
      expect(sendCalls).toBe(0);
      const state = await readState(t, scope.projectId);
      expect(state.attempts[0]).toMatchObject({
        lifecycle: "claimed",
        sendCount: 0,
      });
      expect(state.attempts[0]).not.toHaveProperty("outerTransactionHash");
      expect(state.attempts[0]).not.toHaveProperty("outerFeeStroops");
      expect(state.logs[0]?.lifecycle).toBe("claimed");
    }
  });
});

test("public submit keeps authorization, policy, custody, and payload failures sanitized", async () => {
  await withFixedTime(async () => {
    const t = convexTest(schema, modules);
    const scope = await createScope(t, { suffix: "public-failures" });
    const transactionXdr = gasMaxTimeEnvelopeFixtures.unbounded;
    const sponsored = await sponsor(t, transactionXdr, "public-failure-idempotency");
    expect(sponsored.status).toBe("success");
    if (sponsored.status !== "success") throw new Error("Expected a sponsor reservation");
    const transactionHash = sponsored.reservation.transactionHash;
    if (transactionHash === null) throw new Error("Expected a reservation transaction hash");

    const before = await readState(t, scope.projectId);
    const oversized = await t.action(api.gas.public_api.submit, {
      apiKeyHash: scope.apiKeyHash,
      requestId: sponsored.reservation.requestId,
      transactionHash,
      transactionXdr: "x".repeat(64 * 1_024 + 1),
    });
    expect(oversized).toEqual({ status: "payload_too_large" });
    expect(await readState(t, scope.projectId)).toEqual(before);

    await t.run(async (ctx) => {
      await ctx.db.patch(scope.apiKeyId, { revoked: true });
    });
    const revoked = await t.action(api.gas.public_api.submit, {
      apiKeyHash: scope.apiKeyHash,
      requestId: sponsored.reservation.requestId,
      transactionHash,
      transactionXdr,
    });
    expect(revoked).toEqual({ status: "unauthorized" });

    await t.run(async (ctx) => {
      await ctx.db.patch(scope.apiKeyId, { revoked: false });
      const policy = await ctx.db
        .query("gasPolicies")
        .withIndex("by_project_id", (q) => q.eq("projectId", scope.projectId))
        .unique();
      if (!policy) throw new Error("Missing policy");
      await ctx.db.patch(policy._id, { enabled: false });
    });

    const denied = await withSignerConfiguration([scope.projectId], () =>
      t.action(api.gas.public_api.submit, {
        apiKeyHash: scope.apiKeyHash,
        requestId: sponsored.reservation.requestId,
        transactionHash,
        transactionXdr,
      }),
    );
    expect(denied).toEqual({ status: "policy_denied" });
    expect((await readState(t, scope.projectId)).attempts).toHaveLength(0);

    await t.run(async (ctx) => {
      const policy = await ctx.db
        .query("gasPolicies")
        .withIndex("by_project_id", (q) => q.eq("projectId", scope.projectId))
        .unique();
      const relayer = await ctx.db
        .query("relayerAccounts")
        .withIndex("by_project_id_and_network", (q) =>
          q.eq("projectId", scope.projectId).eq("network", GAS_NETWORK),
        )
        .unique();
      if (!policy || !relayer) throw new Error("Missing Gas records");
      await ctx.db.patch(policy._id, { enabled: true });
      await ctx.db.patch(relayer._id, { status: "disabled" });
    });

    const unavailable = await withSignerConfiguration([scope.projectId], () =>
      t.action(api.gas.public_api.submit, {
        apiKeyHash: scope.apiKeyHash,
        requestId: sponsored.reservation.requestId,
        transactionHash,
        transactionXdr,
      }),
    );
    expect(unavailable).toEqual({ status: "relayer_unavailable" });
    expect((await readState(t, scope.projectId)).attempts).toHaveLength(0);
  });
});
