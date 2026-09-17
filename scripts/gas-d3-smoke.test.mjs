import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  GAS_TEST_CONTRACT_ID,
  GAS_TEST_SOURCE_KEYPAIR,
} from "../packages/stellar/src/test-fixtures.ts";
import {
  D3_REPORT_KIND,
  D3_REPORT_SCHEMA_VERSION,
  DEFAULT_REPORT_PATH,
  HISTORICAL_D2_REPORT_PATH,
  SDK_SOURCE_ENTRY_POINT,
  createD3SmokeDependencies,
  loadD3SmokeConfig,
  main,
  parseD3SmokeArgs,
  runD3SmokeExecution,
  verifyD3SmokeReport,
  writeD3SmokeReport,
} from "./gas-d3-smoke.mjs";

const API_KEY = `tk_live_${"a".repeat(32)}`;
const PROJECT_ID = "project-d3-smoke";
const USER_PUBLIC_KEY = GAS_TEST_SOURCE_KEYPAIR.publicKey();
const RELAYER_PUBLIC_KEY = GAS_TEST_SOURCE_KEYPAIR.publicKey();
const ALLOWED_HASH = "a".repeat(64);
const DENIED_HASH = "b".repeat(64);
const OUTER_HASH = "c".repeat(64);
const DEPLOYED_SOURCE_COMMIT = "d".repeat(40);
const REQUEST_ID = "d3-smoke-request-001";
const EXPIRY = "2026-09-18T12:15:00.000Z";

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

const EXECUTION = {
  requestId: REQUEST_ID,
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
  const settled = ["after-settlement", "before-replay", "after-replay"].includes(scope.phase);
  const denied = ["before-denial", "after-denial"].includes(scope.phase);
  const accountingSpend = settled ? "175" : "0";
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
      accountingDayKey: "2026-09-18",
      outstandingHoldsStroops: "0",
      dailyConfirmedSpendStroops: accountingSpend,
    },
    execution: settled
      ? {
          ...EXECUTION,
          requestId: scope.requestId ?? REQUEST_ID,
          ledgerEvidence: { ...EXECUTION.ledgerEvidence },
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

function makeFixture({
  handoffStatuses = ["claimed"],
  statusSequence = ["submitted", "succeeded"],
  unknownOnFirstHandoff = false,
  networkPassphrase = "Test SDF Network ; September 2015",
  provenanceStatus = 200,
  transactionProbe = () => ({ status: "not_found" }),
  snapshot = snapshotFor,
  malformed = false,
} = {}) {
  const calls = [];
  let handoffCount = 0;
  let statusCount = 0;
  let transactionProbeCount = 0;

  const fetchImpl = async (url, init) => {
    const parsed = new URL(url);
    const request = {
      path: parsed.pathname,
      method: init?.method,
      body: init?.body ? JSON.parse(init.body) : null,
    };
    calls.push(request);
    if (parsed.pathname.endsWith("/snapshot")) {
      const scope = Object.fromEntries(parsed.searchParams.entries());
      return Response.json(
        snapshot({ ...scope, phase: scope.phase }, { requestId: scope.requestId }),
      );
    }
    if (parsed.pathname.endsWith("/provenance")) {
      if (provenanceStatus !== 200)
        return Response.json({ error: "unavailable" }, { status: provenanceStatus });
      return Response.json({
        schemaVersion: 1,
        deploymentId: CONFIG.deploymentName,
        environment: "development",
        network: "testnet",
        verified: true,
        deployedSourceCommit: DEPLOYED_SOURCE_COMMIT,
        verification: "operator-attestation",
      });
    }
    if (parsed.hostname === "rpc.example.test") {
      const method = request.body?.method;
      if (method === "getNetwork")
        return Response.json({ result: { passphrase: networkPassphrase } });
      if (method === "getTransaction") {
        transactionProbeCount += 1;
        const result = transactionProbe(transactionProbeCount, request.body.params.hash);
        if (result.error)
          return Response.json({ error: result.error }, { status: result.status ?? 503 });
        return Response.json({
          result: { status: result.status === "found" ? "SUCCESS" : "NOT_FOUND" },
        });
      }
    }
    if (parsed.pathname.endsWith("/sponsor")) {
      if (request.body.transactionXdr === CONFIG.deniedXdr) {
        return Response.json({ error: { code: "contract_not_whitelisted" } }, { status: 403 });
      }
      return Response.json({
        object: "gas_sponsor_reservation",
        requestId: REQUEST_ID,
        replayed: false,
        decision: "reserved",
        transactionHash: ALLOWED_HASH,
        sourceWallet: USER_PUBLIC_KEY,
        targetContractIds: [GAS_TEST_CONTRACT_ID],
        innerMaxFeeStroops: "1000",
        reservedStroops: "1100",
        expiresAt: EXPIRY,
      });
    }
    if (parsed.pathname.endsWith("/submit")) {
      if (request.body.transactionXdr) {
        handoffCount += 1;
        if (unknownOnFirstHandoff && handoffCount === 1)
          throw new DOMException("request timed out", "AbortError");
        if (malformed && handoffCount === 1) return Response.json({ unexpected: true });
        const status =
          handoffCount > 1
            ? "succeeded"
            : handoffStatuses[Math.min(handoffCount - 1, handoffStatuses.length - 1)];
        return submitResponse(status);
      }
      if (malformed) return Response.json({ unexpected: true });
      const status = statusSequence[Math.min(statusCount++, statusSequence.length - 1)];
      return submitResponse(status);
    }
    throw new Error(`unexpected fixture request ${parsed.pathname}`);
  };

  function submitResponse(status) {
    return Response.json(
      {
        object: "gas_submit_result",
        requestId: REQUEST_ID,
        transactionHash: ALLOWED_HASH,
        outerTransactionHash:
          status === "claimed" || status === "submission_unknown" ? OUTER_HASH : OUTER_HASH,
        status,
        reservedStroops: "1100",
        actualFeeStroops: status === "succeeded" ? "175" : null,
        expiresAt: EXPIRY,
        reconciliationRequired: status !== "succeeded",
      },
      { status: status === "succeeded" ? 200 : 202 },
    );
  }

  const dependencies = createD3SmokeDependencies({
    fetchImpl,
    now: () => new Date("2026-09-18T12:00:00.000Z"),
    wait: async () => {},
    repositoryState: async () => ({
      head: "e".repeat(40),
      workingTree: { status: "modified", changedPathCount: 1 },
    }),
    sdkMetadata: { version: "0.1.0-alpha.2", sourceEntryPoint: SDK_SOURCE_ENTRY_POINT },
  });
  dependencies.deriveFacts = async (xdr) => {
    if (xdr === CONFIG.allowedXdr) return FACTS.allowed;
    if (xdr === CONFIG.deniedXdr) return FACTS.denied;
    throw new Error("fixture parse failure");
  };
  return {
    dependencies,
    calls,
    get handoffCount() {
      return handoffCount;
    },
    get transactionProbeCount() {
      return transactionProbeCount;
    },
  };
}

test("runs pending-to-settled SDK execution, replay, and whitelist denial", async () => {
  const fixture = makeFixture();
  const report = await runD3SmokeExecution({
    config: CONFIG,
    dependencies: fixture.dependencies,
    pollLimit: 3,
    pollIntervalMs: 0,
  });

  assert.equal(report.status, "passed", JSON.stringify(report));
  assert.equal(report.execution.sdkReceipt.status, "succeeded");
  assert.equal(report.execution.sdkReceipt.actualFeeStroops, "175");
  assert.equal(report.execution.backend.chargedStroops, "175");
  assert.equal(report.execution.backend.feeSource, RELAYER_PUBLIC_KEY);
  assert.equal(report.replay.sameAttemptIdentity, true);
  assert.equal(report.replay.sameSendCount, true);
  assert.equal(report.replay.sameSettledFee, true);
  assert.equal(report.replay.sameAccounting, true);
  assert.equal(report.replay.sameReservedExposure, true);
  assert.equal(report.denial.returnedCode, "contract_not_whitelisted");
  assert.equal(report.denial.noExecutionAttempt, true);
  assert.equal(report.denial.noReservedExposure, true);
  assert.equal(report.denial.accountingUnchanged, true);
  assert.equal(verifyD3SmokeReport(report).ok, true, JSON.stringify(verifyD3SmokeReport(report)));
  assert.equal(fixture.handoffCount, 2, "one initial handoff and one same-identity replay");
});

test("accepts an immediately settled SDK result without observing again", async () => {
  const fixture = makeFixture({ handoffStatuses: ["succeeded"] });
  const report = await runD3SmokeExecution({ config: CONFIG, dependencies: fixture.dependencies });
  assert.equal(report.status, "passed", JSON.stringify(report));
  assert.equal(report.execution.observation.maxAttempts, 0);
  assert.equal(
    fixture.calls.filter((call) => call.path.endsWith("/submit") && call.body.transactionXdr)
      .length,
    2,
  );
});

test("recovers an unknown SDK handoff with identity-only requests and never resubmits the XDR", async () => {
  const fixture = makeFixture({ unknownOnFirstHandoff: true, handoffStatuses: ["succeeded"] });
  const report = await runD3SmokeExecution({ config: CONFIG, dependencies: fixture.dependencies });
  assert.equal(report.status, "passed", JSON.stringify(report));
  assert.equal(report.execution.recovery.attempted, true);
  assert.equal(report.execution.recovery.identityOnly, true);
  assert.equal(report.execution.recovery.resubmitted, false);
  const recoveryRequest = fixture.calls.find(
    (call) => call.path.endsWith("/submit") && !call.body.transactionXdr,
  );
  assert.deepEqual(recoveryRequest.body, { requestId: REQUEST_ID, transactionHash: ALLOWED_HASH });
  assert.equal(fixture.handoffCount, 2, "the second XDR-bearing request is the intentional replay");
});

test("stops on unresolved observation and terminal non-success", async () => {
  const unresolved = await runD3SmokeExecution({
    config: CONFIG,
    dependencies: makeFixture({ handoffStatuses: ["claimed"], statusSequence: ["submitted"] })
      .dependencies,
    pollLimit: 2,
    pollIntervalMs: 0,
  });
  assert.equal(unresolved.status, "incomplete");
  assert.equal(unresolved.failure, "observation_unresolved");

  const failed = await runD3SmokeExecution({
    config: CONFIG,
    dependencies: makeFixture({ handoffStatuses: ["failed"] }).dependencies,
  });
  assert.equal(failed.status, "incomplete");
  assert.equal(failed.failure, "execution_not_successful");
});

test("stops before sponsorship for wrong network, expiry, duplicate, and unavailable provenance", async () => {
  const cases = [
    {
      fixture: makeFixture({ networkPassphrase: "Public Global Stellar Network ; September 2015" }),
      failure: "preflight_failed",
    },
    {
      fixture: makeFixture({
        transactionProbe: (_count, hash) =>
          hash === DENIED_HASH ? { status: "not_found" } : { status: "found" },
      }),
      failure: "preflight_failed",
    },
    { fixture: makeFixture({ provenanceStatus: 503 }), failure: "preflight_failed" },
  ];
  for (const { fixture, failure } of cases) {
    const report = await runD3SmokeExecution({
      config: CONFIG,
      dependencies: fixture.dependencies,
    });
    assert.equal(report.status, "incomplete");
    assert.equal(report.failure, failure);
    assert.equal(fixture.handoffCount, 0);
  }
  const expiredFixture = makeFixture();
  expiredFixture.dependencies.deriveFacts = async (xdr) => ({
    ...(xdr === CONFIG.allowedXdr ? FACTS.allowed : FACTS.denied),
    innerMaxTime: 1,
  });
  const expired = await runD3SmokeExecution({
    config: CONFIG,
    dependencies: expiredFixture.dependencies,
  });
  assert.equal(expired.status, "incomplete");
  assert.equal(expiredFixture.handoffCount, 0);
});

test("rechecks denial freshness immediately before the SDK sponsorship request", async () => {
  const fixture = makeFixture({
    transactionProbe: (count, hash) =>
      count >= 3 && hash === DENIED_HASH ? { status: "found" } : { status: "not_found" },
  });
  const report = await runD3SmokeExecution({ config: CONFIG, dependencies: fixture.dependencies });
  assert.equal(report.status, "incomplete");
  assert.equal(report.failure, "denied_transaction_already_submitted");
  assert.equal(report.denial.freshnessRechecked, true);
  assert.equal(fixture.handoffCount, 2);
  assert.equal(
    fixture.calls.filter(
      (call) => call.path.endsWith("/sponsor") && call.body.transactionXdr === CONFIG.deniedXdr,
    ).length,
    0,
    "no denial sponsor after stale recheck",
  );
});

test("rejects receipt/ledger fee mismatches and malformed SDK responses without leaking provider data", async () => {
  const mismatch = makeFixture({
    snapshot: (scope, options) => {
      const value = snapshotFor(scope, options);
      if (scope.phase === "after-settlement") value.execution.ledgerEvidence.chargedStroops = "176";
      return value;
    },
  });
  const mismatched = await runD3SmokeExecution({
    config: CONFIG,
    dependencies: mismatch.dependencies,
  });
  assert.equal(mismatched.status, "incomplete");
  assert.equal(mismatched.failure, "execution_snapshot_mismatch");

  const malformed = await runD3SmokeExecution({
    config: CONFIG,
    dependencies: makeFixture({ malformed: true }).dependencies,
  });
  assert.equal(malformed.status, "incomplete");
  assert.match(malformed.failure, /sdk_recovery|submission_unknown/);
  assert.equal(JSON.stringify(malformed).includes("unexpected"), false);
  assert.equal(JSON.stringify(malformed).includes(CONFIG.allowedXdr), false);
  assert.equal(JSON.stringify(malformed).includes(API_KEY), false);
});

test("validates D3 config bounds and maps D3 names through the D2 loader", async () => {
  const loaded = await loadD3SmokeConfig({
    VELO_GAS_D3_MODE: "preflight",
    VELO_GAS_D3_API_ORIGIN: "http://api.example.test",
    VELO_GAS_D3_PROJECT_ID: PROJECT_ID,
    VELO_GAS_D3_RPC_URL: "https://rpc.example.test",
    VELO_GAS_D3_OPERATOR_SNAPSHOT_URL: "https://operator.example.test/snapshot",
    VELO_GAS_D3_PROVENANCE_URL: "https://operator.example.test/provenance",
    VELO_GAS_D3_OPERATOR_TOKEN: "operator-token",
    VELO_GAS_D3_ALLOWED_XDR: CONFIG.allowedXdr,
    VELO_GAS_D3_DENIED_XDR: CONFIG.deniedXdr,
    VELO_GAS_D3_POLL_LIMIT: "121",
  });
  assert.equal(loaded.ok, false);
  assert.equal(loaded.invalid.includes("VELO_GAS_D3_POLL_LIMIT"), true);
  const unsafeUrl = await loadD3SmokeConfig({
    VELO_GAS_D3_MODE: "preflight",
    VELO_GAS_D3_API_ORIGIN: "https://user:password@example.test",
    VELO_GAS_D3_PROJECT_ID: PROJECT_ID,
    VELO_GAS_D3_RPC_URL: "https://rpc.example.test",
    VELO_GAS_D3_OPERATOR_SNAPSHOT_URL: "https://operator.example.test/snapshot",
    VELO_GAS_D3_PROVENANCE_URL: "https://operator.example.test/provenance",
    VELO_GAS_D3_OPERATOR_TOKEN: "operator-token",
    VELO_GAS_D3_ALLOWED_XDR: CONFIG.allowedXdr,
    VELO_GAS_D3_DENIED_XDR: CONFIG.deniedXdr,
  });
  assert.equal(unsafeUrl.ok, false);
  assert.equal(unsafeUrl.invalid.includes("VELO_GAS_D3_API_ORIGIN"), true);
});

test("uses preflight as the CLI default and verifies reports offline without credentials or network", async () => {
  assert.deepEqual(parseD3SmokeArgs([]), {
    help: false,
    mode: "preflight",
    outputPath: DEFAULT_REPORT_PATH,
    reportPath: null,
    pollLimit: null,
    pollIntervalMs: null,
  });
  assert.equal(parseD3SmokeArgs(["--help"]).help, true);
  const fixture = makeFixture({ handoffStatuses: ["succeeded"] });
  const report = await runD3SmokeExecution({ config: CONFIG, dependencies: fixture.dependencies });
  const directory = await mkdtemp(path.join("/private/tmp", "velo-gas-d3-"));
  const reportPath = path.join(directory, "report.json");
  await writeD3SmokeReport(report, reportPath, "/");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("network must not be used");
  };
  try {
    assert.equal(await main(["--mode", "verify", "--report", reportPath]), 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
  await rm(directory, { recursive: true, force: true });
});

test("rejects tampered, D2, unexpected, sensitive, and historical-report writes", async () => {
  const fixture = makeFixture({ handoffStatuses: ["succeeded"] });
  const report = await runD3SmokeExecution({ config: CONFIG, dependencies: fixture.dependencies });
  assert.equal(
    verifyD3SmokeReport({ ...report, status: "passed", reportKind: "d2_smoke" }).ok,
    false,
  );
  assert.equal(verifyD3SmokeReport({ ...report, unexpected: true }).ok, false);
  assert.equal(
    verifyD3SmokeReport({
      ...report,
      execution: {
        ...report.execution,
        backend: { ...report.execution.backend, actualFeeStroops: "176" },
      },
    }).ok,
    false,
  );
  await assert.rejects(
    writeD3SmokeReport(
      { ...report, leaked: "transactionXdr=secret" },
      "unsafe.json",
      "/private/tmp",
    ),
    /unsafe D3 smoke report/,
  );
  await assert.rejects(
    writeD3SmokeReport(report, HISTORICAL_D2_REPORT_PATH, "/"),
    /historical D2 report/,
  );
  assert.equal(D3_REPORT_KIND, "velo_gas_d3_smoke");
  assert.equal(D3_REPORT_SCHEMA_VERSION, 1);
});

test("does not include secrets or XDR in a saved report", async () => {
  const fixture = makeFixture({ handoffStatuses: ["succeeded"] });
  const report = await runD3SmokeExecution({ config: CONFIG, dependencies: fixture.dependencies });
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes(API_KEY), false);
  assert.equal(serialized.includes(CONFIG.allowedXdr), false);
  assert.equal(serialized.includes(CONFIG.deniedXdr), false);
  assert.equal(serialized.includes("operator-token"), false);
  assert.equal(serialized.includes("exception message"), false);
  assert.equal(await readFile(new URL("data:text/plain,ok"), "utf8").catch(() => "ok"), "ok");
});
