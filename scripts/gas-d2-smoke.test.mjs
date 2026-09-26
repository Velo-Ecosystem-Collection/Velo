import assert from "node:assert/strict";
import test from "node:test";

import {
  GAS_TEST_CONTRACT_ID,
  GAS_TEST_SOURCE_KEYPAIR,
} from "../packages/stellar/src/test-fixtures.ts";
import {
  runPreflight,
  runSmokeExecution,
  loadSmokeConfig,
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
  expectedEnvironment: "development",
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
      deploymentId: options.deploymentId ?? CONFIG.deploymentName,
      environment: options.environment ?? "development",
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
  probeTransaction = async () => ({ ok: true, value: { status: "not_found" } }),
  deriveFacts = async (xdr) => {
    if (xdr === CONFIG.allowedXdr) return FACTS.allowed;
    if (xdr === CONFIG.deniedXdr) return FACTS.denied;
    throw new Error("fixture parse failure");
  },
} = {}) {
  return {
    fetchImpl,
    now: () => new Date("2026-09-08T12:00:00.000Z"),
    wait: async () => {},
    repositoryState: async () => ({
      head: "e".repeat(40),
      workingTree: { status: "modified", changedPathCount: 1 },
    }),
    deriveFacts,
    readSnapshot: async (config, scope) => ({ ok: true, value: snapshot(config, scope) }),
    readProvenance: async () => ({ ok: true, value: provenance }),
    probeNetwork: async () => ({ ok: true, value: network }),
    probeTransaction,
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

test("loads an explicit production environment and accepts a matching Testnet deployment", async () => {
  const loaded = await loadSmokeConfig({
    VELO_GAS_D2_MODE: "preflight",
    VELO_GAS_D2_API_ORIGIN: "https://api.example.test",
    VELO_GAS_D2_PROJECT_ID: PROJECT_ID,
    VELO_GAS_D2_RPC_URL: "https://rpc.example.test",
    VELO_GAS_D2_OPERATOR_SNAPSHOT_URL: "https://operator.example.test/snapshot",
    VELO_GAS_D2_PROVENANCE_URL: "https://operator.example.test/provenance",
    VELO_GAS_D2_OPERATOR_TOKEN: "operator-token",
    VELO_GAS_D2_ALLOWED_XDR: "allowed-xdr",
    VELO_GAS_D2_DENIED_XDR: "denied-xdr",
    VELO_GAS_D2_DEPLOYMENT_NAME: "prod:agreeable-salmon-748",
    VELO_GAS_D2_EXPECTED_ENVIRONMENT: "production",
    VELO_GAS_D2_EXPECTED_SOURCE_COMMIT: DEPLOYED_SOURCE_COMMIT,
  });
  assert.equal(loaded.ok, true);
  assert.equal(loaded.config.expectedEnvironment, "production");
  assert.equal(loaded.config.deploymentName, "prod:agreeable-salmon-748");

  const productionConfig = {
    ...CONFIG,
    deploymentName: "prod:agreeable-salmon-748",
    expectedEnvironment: "production",
  };
  const report = await runSmokeExecution({
    config: productionConfig,
    dependencies: makeDependencies({
      snapshot: (_config, scope) =>
        snapshotFor(scope, {
          deploymentId: productionConfig.deploymentName,
          environment: "production",
        }),
      provenance: {
        schemaVersion: 1,
        deploymentId: productionConfig.deploymentName,
        environment: "production",
        network: "testnet",
        verified: true,
        deployedSourceCommit: DEPLOYED_SOURCE_COMMIT,
        verification: "operator-attestation",
      },
    }),
    pollLimit: 3,
    pollIntervalMs: 0,
  });
  assert.equal(report.status, "passed", JSON.stringify(report));
  assert.equal(report.deployment.deploymentId, productionConfig.deploymentName);
  assert.equal(report.deployment.environment, "production");
  assert.equal(verifySmokeReport(report).ok, true);
});

test("rejects deployment identity or environment disagreement, Mainnet, and source mismatch", async () => {
  const productionConfig = {
    ...CONFIG,
    deploymentName: "prod:agreeable-salmon-748",
    expectedEnvironment: "production",
  };
  const productionProvenance = {
    schemaVersion: 1,
    deploymentId: productionConfig.deploymentName,
    environment: "production",
    network: "testnet",
    verified: true,
    deployedSourceCommit: DEPLOYED_SOURCE_COMMIT,
    verification: "operator-attestation",
  };
  const mismatchedEnvironment = await runPreflight({
    config: productionConfig,
    dependencies: makeDependencies({
      snapshot: (_config, scope) =>
        snapshotFor(scope, {
          deploymentId: productionConfig.deploymentName,
          environment: "development",
        }),
      provenance: productionProvenance,
    }),
  });
  assert.equal(mismatchedEnvironment.ok, false);
  assert.equal(
    mismatchedEnvironment.checks.find((check) => check.name === "deployment_identity")?.failure,
    "deployment_identity_mismatch",
  );
  assert.equal(
    mismatchedEnvironment.checks.find((check) => check.name === "deployment_provenance_agreement")
      ?.failure,
    "deployment_provenance_mismatch",
  );

  const mismatchedIdentity = await runPreflight({
    config: productionConfig,
    dependencies: makeDependencies({
      snapshot: (_config, scope) =>
        snapshotFor(scope, {
          deploymentId: "prod:other-deployment",
          environment: "production",
        }),
      provenance: productionProvenance,
    }),
  });
  assert.equal(mismatchedIdentity.ok, false);
  assert.equal(
    mismatchedIdentity.checks.find((check) => check.name === "deployment_provenance_agreement")
      ?.failure,
    "deployment_provenance_mismatch",
  );

  const mainnet = await runPreflight({
    config: productionConfig,
    dependencies: makeDependencies({
      snapshot: (_config, scope) => {
        const snapshot = snapshotFor(scope, {
          deploymentId: productionConfig.deploymentName,
          environment: "production",
        });
        snapshot.deployment.network = "mainnet";
        return snapshot;
      },
      provenance: { ...productionProvenance, network: "mainnet" },
    }),
  });
  assert.equal(mainnet.ok, false);

  const sourceMismatch = await runPreflight({
    config: productionConfig,
    dependencies: makeDependencies({
      snapshot: (_config, scope) =>
        snapshotFor(scope, {
          deploymentId: productionConfig.deploymentName,
          environment: "production",
        }),
      provenance: { ...productionProvenance, deployedSourceCommit: "f".repeat(40) },
    }),
  });
  assert.equal(sourceMismatch.ok, false);
  assert.equal(
    sourceMismatch.checks.find((check) => check.name === "source_provenance_verified")?.failure,
    "source_provenance_mismatch",
  );
});

test("rejects unsupported expected environments and malformed report evidence", async () => {
  const loaded = await loadSmokeConfig({
    VELO_GAS_D2_MODE: "preflight",
    VELO_GAS_D2_EXPECTED_ENVIRONMENT: "staging",
  });
  assert.equal(loaded.ok, false);
  assert.deepEqual(loaded.invalid, ["VELO_GAS_D2_EXPECTED_ENVIRONMENT"]);
  const legacyDefault = await loadSmokeConfig({ VELO_GAS_D2_MODE: "preflight" });
  assert.equal(legacyDefault.config.expectedEnvironment, "development");
  const productionWithoutSource = await loadSmokeConfig({
    VELO_GAS_D2_MODE: "preflight",
    VELO_GAS_D2_EXPECTED_ENVIRONMENT: "production",
  });
  assert.equal(
    productionWithoutSource.invalid.includes("VELO_GAS_D2_EXPECTED_SOURCE_COMMIT"),
    true,
  );
  assert.equal(verifySmokeReport({ status: "passed" }).ok, false);
});

test("blocks a previously submitted invocation during preflight", async () => {
  const preflight = await runPreflight({
    config: CONFIG,
    dependencies: makeDependencies({
      probeTransaction: async (_config, transactionHash) => ({
        ok: true,
        value: { status: transactionHash === ALLOWED_HASH ? "found" : "not_found" },
      }),
    }),
  });

  assert.equal(preflight.ok, false);
  assert.deepEqual(
    preflight.checks.find((check) => check.name === "allowed_transaction_fresh"),
    {
      name: "allowed_transaction_fresh",
      status: "blocked",
      failure: "allowed_transaction_already_submitted",
    },
  );
});

test("blocks an expired invocation before sponsorship", async () => {
  const preflight = await runPreflight({
    config: CONFIG,
    dependencies: makeDependencies({
      deriveFacts: async (xdr) => {
        const facts = xdr === CONFIG.allowedXdr ? FACTS.allowed : FACTS.denied;
        return {
          ...facts,
          ...(xdr === CONFIG.deniedXdr ? { innerMaxTime: 1_757_320_799 } : {}),
        };
      },
    }),
  });

  assert.equal(preflight.ok, false);
  assert.deepEqual(
    preflight.checks.find((check) => check.name === "denied_transaction_fresh"),
    {
      name: "denied_transaction_fresh",
      status: "blocked",
      failure: "denied_invocation_expired",
    },
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
