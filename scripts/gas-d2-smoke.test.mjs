import assert from "node:assert/strict";
import test from "node:test";

import {
  GAS_TEST_CONTRACT_ID,
  GAS_TEST_SOURCE_KEYPAIR,
} from "../packages/stellar/src/test-fixtures.ts";
import {
  runPreflight,
  runSmokeExecution,
  verifySmokeReport,
  writeSmokeReport,
} from "./gas-d2-smoke.mjs";

const API_KEY = `tk_live_${"a".repeat(32)}`;
const PROJECT_ID = "project-d2-smoke";
const USER_PUBLIC_KEY = GAS_TEST_SOURCE_KEYPAIR.publicKey();
const RELAYER_PUBLIC_KEY = GAS_TEST_SOURCE_KEYPAIR.publicKey();
const ALLOWED_HASH = "a".repeat(64);
const DENIED_HASH = "b".repeat(64);
const OUTER_HASH = "c".repeat(64);
const DEPLOYED_SOURCE_COMMIT = "d".repeat(40);

const CONFIG = {
  mode: "execute",
  apiOrigin: "https://dev.example.test",
  apiKey: API_KEY,
  projectId: PROJECT_ID,
  rpcUrl: "https://rpc.example.test",
  snapshotUrl: "https://operator.example.test/snapshot",
  provenanceUrl: "https://operator.example.test/provenance",
  operatorToken: "operator-token-is-never-persisted",
  allowedXdr: "allowed-xdr-is-never-persisted",
  deniedXdr: "denied-xdr-is-never-persisted",
  deploymentName: "dev:capable-kingfisher-697",
  expectedSourceCommit: DEPLOYED_SOURCE_COMMIT,
  timeoutMs: 1_000,
  pollLimit: 3,
  pollIntervalMs: 0,
};

const FACTS = {
  allowed: {
    sourceWallet: USER_PUBLIC_KEY,
    transactionHash: ALLOWED_HASH,
    innerMaxFeeStroops: "1000",
    targetContractIds: [GAS_TEST_CONTRACT_ID],
  },
  denied: {
    sourceWallet: USER_PUBLIC_KEY,
    transactionHash: DENIED_HASH,
    innerMaxFeeStroops: "1000",
    targetContractIds: [GAS_TEST_CONTRACT_ID.replace(/.$/, "A")],
  },
};

const RECONCILED_EXECUTION = {
  requestId: "d2-smoke-request-001",
  innerTransactionHash: ALLOWED_HASH,
  outerTransactionHash: OUTER_HASH,
  status: "succeeded",
  sendCount: 1,
  reservedStroops: "1100",
  actualFeeStroops: "175",
  reconciliationRequired: false,
  feeSource: RELAYER_PUBLIC_KEY,
  ledgerEvidence: {
    outerTransactionHash: OUTER_HASH,
    innerTransactionHash: ALLOWED_HASH,
    feeSource: RELAYER_PUBLIC_KEY,
    ledger: 123,
    resultCode: "txFeeBumpInnerSuccess",
    innerResultCode: "txSuccess",
    chargedStroops: "175",
  },
};

function snapshotFor(scope, options = {}) {
  const terminal =
    scope.phase === "after-settlement" ||
    scope.phase === "before-replay" ||
    scope.phase === "after-replay";
  const denied = scope.phase === "before-denial" || scope.phase === "after-denial";
  return {
    schemaVersion: 1,
    scope: {
      projectId: PROJECT_ID,
      phase: scope.phase,
      ...(scope.requestId ? { requestId: scope.requestId } : {}),
      ...(scope.transactionHash ? { transactionHash: scope.transactionHash } : {}),
      ...(scope.idempotencyKeyHash ? { idempotencyKeyHash: scope.idempotencyKeyHash } : {}),
    },
    deployment: {
      deploymentId: CONFIG.deploymentName,
      environment: "development",
      network: "testnet",
    },
    signer: {
      status: options.signerStatus ?? "ready",
      network: "testnet",
      publicKey: RELAYER_PUBLIC_KEY,
      funded: true,
      balanceStroops: "100000000",
    },
    user: { publicKey: USER_PUBLIC_KEY, funded: true, balanceStroops: "1000000" },
    policy: { enabled: true, network: "testnet", allowedContractIds: [GAS_TEST_CONTRACT_ID] },
    accounting: {
      accountingDayKey: "2026-09-08",
      outstandingHoldsStroops: "0",
      dailyConfirmedSpendStroops: terminal ? "175" : "0",
    },
    execution: terminal
      ? {
          ...RECONCILED_EXECUTION,
          requestId: scope.requestId ?? RECONCILED_EXECUTION.requestId,
          ledgerEvidence: { ...RECONCILED_EXECUTION.ledgerEvidence },
        }
      : null,
    decision:
      denied && scope.phase === "after-denial"
        ? {
            decisionCode: "rejected",
            rejectionCode: "contract_not_whitelisted",
            reservedExposureStroops: "0",
          }
        : null,
    reservedExposureStroops: "0",
  };
}

function makeDependencies({
  fetchImpl = async (url, init) => fakeFetch(url, init),
  snapshot = (config, scope) => snapshotFor(scope),
  provenance = {
    schemaVersion: 1,
    deploymentId: CONFIG.deploymentName,
    environment: "development",
    network: "testnet",
    verified: true,
    deployedSourceCommit: DEPLOYED_SOURCE_COMMIT,
    verification: "operator-attestation",
  },
  network = { passphrase: "Test SDF Network ; September 2015" },
} = {}) {
  return {
    fetchImpl,
    now: () => new Date("2026-09-08T12:00:00.000Z"),
    wait: async () => {},
    repositoryState: async () => ({
      head: "e".repeat(40),
      workingTree: { status: "modified", changedPathCount: 1 },
    }),
    deriveFacts: async (xdr) => {
      if (xdr === CONFIG.allowedXdr) return FACTS.allowed;
      if (xdr === CONFIG.deniedXdr) return FACTS.denied;
      throw new Error("fixture parse failure");
    },
    readSnapshot: async (config, scope) => ({ ok: true, value: snapshot(config, scope) }),
    readProvenance: async () => ({ ok: true, value: provenance }),
    probeNetwork: async () => ({ ok: true, value: network }),
  };
}

let submitCalls = 0;

async function fakeFetch(url, init) {
  const parsed = new URL(url);
  if (parsed.pathname.endsWith("/sponsor")) {
    const body = JSON.parse(init.body);
    if (body.transactionXdr === CONFIG.deniedXdr) {
      return Response.json(
        {
          error: { code: "contract_not_whitelisted", requestId: init.headers["x-correlation-id"] },
        },
        { status: 403 },
      );
    }
    return Response.json(
      {
        object: "gas_sponsor_reservation",
        requestId: RECONCILED_EXECUTION.requestId,
        replayed: false,
        decision: "reserved",
        transactionHash: ALLOWED_HASH,
        sourceWallet: USER_PUBLIC_KEY,
        targetContractIds: [GAS_TEST_CONTRACT_ID],
        innerMaxFeeStroops: "1000",
        reservedStroops: "1100",
        expiresAt: "2026-09-08T12:15:00.000Z",
      },
      { status: 200 },
    );
  }
  submitCalls += 1;
  const body = JSON.parse(init.body);
  const status = body.transactionXdr && submitCalls === 1 ? "claimed" : "succeeded";
  return Response.json(
    {
      object: "gas_submit_result",
      requestId: RECONCILED_EXECUTION.requestId,
      transactionHash: ALLOWED_HASH,
      outerTransactionHash: OUTER_HASH,
      status,
      reservedStroops: "1100",
      actualFeeStroops: status === "succeeded" ? "175" : null,
      expiresAt: "2026-09-08T12:15:00.000Z",
      reconciliationRequired: status !== "succeeded",
    },
    { status: status === "succeeded" ? 200 : 202 },
  );
}

test.beforeEach(() => {
  submitCalls = 0;
});

test("runs allowed sponsorship, settled replay, and policy denial with scoped evidence", async () => {
  const report = await runSmokeExecution({
    config: CONFIG,
    dependencies: makeDependencies(),
    pollLimit: 3,
    pollIntervalMs: 0,
  });

  assert.equal(report.status, "passed", JSON.stringify(report));
  assert.equal(report.execution.innerTransactionHash, ALLOWED_HASH);
  assert.equal(report.execution.outerTransactionHash, OUTER_HASH);
  assert.equal(report.execution.feeSource, RELAYER_PUBLIC_KEY);
  assert.equal(report.execution.chargedStroops, "175");
  assert.equal(report.execution.ledger, 123);
  assert.equal(report.replay.sameAttemptIdentity, true);
  assert.equal(report.replay.sameSendCount, true);
  assert.equal(report.replay.sameSettledFee, true);
  assert.equal(report.replay.sameAccounting, true);
  assert.equal(report.denial.returnedCode, "contract_not_whitelisted");
  assert.equal(report.denial.noExecutionAttempt, true);
  assert.equal(report.denial.noReservedExposure, true);
  assert.equal(report.denial.accountingUnchanged, true);
  assert.equal(verifySmokeReport(report).ok, true);
});

test("blocks wrong-network and missing signer readiness before sponsorship", async () => {
  const wrongNetwork = await runPreflight({
    config: CONFIG,
    dependencies: makeDependencies({
      network: { passphrase: "Public Global Stellar Network ; September 2015" },
    }),
  });
  assert.equal(wrongNetwork.ok, false);
  assert.equal(
    wrongNetwork.checks.find((check) => check.name === "testnet_rpc_network")?.status,
    "blocked",
  );

  const missingReadiness = await runPreflight({
    config: CONFIG,
    dependencies: makeDependencies({
      snapshot: (config, scope) => snapshotFor(scope, { signerStatus: "disabled" }),
    }),
  });
  assert.equal(missingReadiness.ok, false);
  assert.equal(
    missingReadiness.checks.find((check) => check.name === "backend_signer_ready")?.status,
    "blocked",
  );
});

test("rejects malformed API responses without persisting response text", async () => {
  const report = await runSmokeExecution({
    config: CONFIG,
    dependencies: makeDependencies({
      fetchImpl: async () => new Response("provider secret and raw response", { status: 200 }),
    }),
  });
  assert.equal(report.status, "incomplete");
  assert.equal(report.failure, "malformed_response");
  assert.equal(JSON.stringify(report).includes("provider secret"), false);
  assert.equal(JSON.stringify(report).includes(CONFIG.allowedXdr), false);
  assert.equal(JSON.stringify(report).includes(API_KEY), false);
});

test("rejects mismatched ledger evidence and fee snapshots", async () => {
  const report = await runSmokeExecution({
    config: CONFIG,
    dependencies: makeDependencies({
      snapshot: (config, scope) => {
        const snapshot = snapshotFor(scope);
        if (scope.phase === "after-settlement")
          snapshot.execution.ledgerEvidence.chargedStroops = "176";
        return snapshot;
      },
    }),
    pollLimit: 3,
    pollIntervalMs: 0,
  });
  assert.equal(report.status, "incomplete");
  assert.equal(report.failure, "execution_snapshot_mismatch");
});

test("rejects an operator snapshot scoped to a different request identity", async () => {
  const report = await runSmokeExecution({
    config: CONFIG,
    dependencies: makeDependencies({
      snapshot: (config, scope) => {
        const snapshot = snapshotFor(scope);
        if (scope.phase === "after-settlement") snapshot.scope.transactionHash = "e".repeat(64);
        return snapshot;
      },
    }),
    pollLimit: 3,
    pollIntervalMs: 0,
  });
  assert.equal(report.status, "incomplete");
  assert.equal(report.failure, "operator_scope_mismatch");
});

test("preserves the original identity through polling exhaustion and interrupted send recovery", async () => {
  let submitRequestCount = 0;
  const requests = [];
  const report = await runSmokeExecution({
    config: CONFIG,
    dependencies: makeDependencies({
      fetchImpl: async (url, init) => {
        const body = JSON.parse(init.body);
        requests.push({ path: new URL(url).pathname, body });
        if (new URL(url).pathname.endsWith("/sponsor")) return fakeFetch(url, init);
        submitRequestCount += 1;
        if (submitRequestCount === 1) throw new DOMException("timeout", "TimeoutError");
        return Response.json(
          {
            object: "gas_submit_result",
            requestId: RECONCILED_EXECUTION.requestId,
            transactionHash: ALLOWED_HASH,
            outerTransactionHash: OUTER_HASH,
            status: "succeeded",
            reservedStroops: "1100",
            actualFeeStroops: "175",
            expiresAt: "2026-09-08T12:15:00.000Z",
            reconciliationRequired: false,
          },
          { status: 200 },
        );
      },
    }),
    pollLimit: 1,
    pollIntervalMs: 0,
  });
  assert.equal(report.status, "passed", JSON.stringify(report));
  const submitBodiesBeforeReplay = requests
    .filter((request) => request.path.endsWith("/submit"))
    .map((request) => request.body);
  assert.equal(submitBodiesBeforeReplay[0].transactionXdr, CONFIG.allowedXdr);
  assert.equal("transactionXdr" in submitBodiesBeforeReplay[1], false);
  assert.equal(submitBodiesBeforeReplay[1].requestId, RECONCILED_EXECUTION.requestId);
  assert.equal(submitBodiesBeforeReplay[1].transactionHash, ALLOWED_HASH);
});

test("reports polling exhaustion as incomplete and never invents a receipt", async () => {
  const report = await runSmokeExecution({
    config: CONFIG,
    dependencies: makeDependencies({
      fetchImpl: async (url, init) => {
        if (new URL(url).pathname.endsWith("/sponsor")) return fakeFetch(url, init);
        return Response.json(
          {
            object: "gas_submit_result",
            requestId: RECONCILED_EXECUTION.requestId,
            transactionHash: ALLOWED_HASH,
            outerTransactionHash: OUTER_HASH,
            status: "submitted",
            reservedStroops: "1100",
            actualFeeStroops: null,
            expiresAt: "2026-09-08T12:15:00.000Z",
            reconciliationRequired: true,
          },
          { status: 202 },
        );
      },
    }),
    pollLimit: 1,
    pollIntervalMs: 0,
  });
  assert.equal(report.status, "incomplete");
  assert.equal(report.failure, "polling_exhausted");
  assert.equal(report.execution.outerTransactionHash, OUTER_HASH);
  assert.equal(report.execution.actualFeeStroops, null);
});

test("refuses sensitive smoke report content", async () => {
  await assert.rejects(
    writeSmokeReport(
      { status: "incomplete", leaked: "transactionXdr=secret" },
      "gas-d2-smoke-secret-test.json",
      "/private/tmp",
    ),
    /unsafe smoke report/,
  );
});
