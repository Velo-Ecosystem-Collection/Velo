import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  main,
  recordD4CampaignOutcome,
  validateD4Attempt,
  verifyD4CampaignReport,
} from "./gas-d4-campaign.mjs";

const campaignInputSchema = JSON.parse(
  await readFile(new URL("./gas-d4-campaign-input.schema.json", import.meta.url), "utf8"),
);

const CAMPAIGN = {
  campaignId: "d4-campaign-20260926",
  network: "testnet",
  startedAtUtc: "2026-09-26T02:00:00.000Z",
  sourceCommit: "a".repeat(40),
  webDeploymentId: "web-production",
  convexDeploymentId: "prod:agreeable-salmon-748",
  sdkVersion: "0.1.0-alpha.3",
  sdkArtifact: "workspace-source",
  projects: [
    {
      dappId: "express",
      projectId: "project-testnet-1",
      relayerAddress: `G${"B".repeat(55)}`,
      custodyMode: "managed",
      keyringConfigured: true,
      custodyDeploymentId: "prod:agreeable-salmon-748",
      custodyKeyVersion: "v1",
      provisioningFeatureEnabled: true,
      provisioningStatus: "ready",
      fundingStatus: "verified",
      activationStatus: "enabled",
      observedAtUtc: "2026-09-26T02:00:00.000Z",
    },
    {
      dappId: "nextjs",
      projectId: "project-testnet-2",
      relayerAddress: `G${"E".repeat(55)}`,
      custodyMode: "managed",
      keyringConfigured: true,
      custodyDeploymentId: "prod:agreeable-salmon-748",
      custodyKeyVersion: "v1",
      provisioningFeatureEnabled: true,
      provisioningStatus: "ready",
      fundingStatus: "verified",
      activationStatus: "enabled",
      observedAtUtc: "2026-09-26T02:00:00.000Z",
    },
  ],
};

function successAttempt(overrides = {}) {
  const innerHash = "a".repeat(64);
  const outerHash = "b".repeat(64);
  const relayerAddress = `G${"B".repeat(55)}`;
  return {
    dappId: "express",
    projectId: "project-testnet-1",
    participantAlias: "participant-1",
    scenario: "eligible",
    operationId: "express-order-001",
    outcome: "succeeded",
    requestId: "gas-request-0001",
    innerHash,
    outerHash,
    sourceAccount: `G${"A".repeat(55)}`,
    relayerAddress,
    relayerFeeSource: relayerAddress,
    contractId: `C${"C".repeat(55)}`,
    ledger: 5_000_001,
    closedAtUtc: "2026-09-26T02:01:00.000Z",
    backendStatus: "succeeded",
    innerSucceeded: true,
    reconciliationRequired: false,
    actualFeeStroops: "4796",
    chargedFeeStroops: "4796",
    explorerUrl: `https://stellar.expert/explorer/testnet/tx/${outerHash}`,
    denialCode: null,
    noExecutionAttempt: null,
    noReservedExposure: null,
    ...overrides,
  };
}

function denialAttempt(overrides = {}) {
  return {
    dappId: "nextjs",
    projectId: "project-testnet-2",
    participantAlias: "participant-2",
    scenario: "whitelist_denial",
    operationId: "next-order-denied-001",
    outcome: "expected_denial",
    requestId: null,
    innerHash: "c".repeat(64),
    outerHash: null,
    sourceAccount: `G${"D".repeat(55)}`,
    relayerAddress: `G${"E".repeat(55)}`,
    relayerFeeSource: null,
    contractId: `C${"F".repeat(55)}`,
    ledger: null,
    closedAtUtc: null,
    backendStatus: "denied",
    innerSucceeded: false,
    reconciliationRequired: false,
    actualFeeStroops: null,
    chargedFeeStroops: null,
    explorerUrl: null,
    denialCode: "contract_not_whitelisted",
    noExecutionAttempt: true,
    noReservedExposure: true,
    ...overrides,
  };
}

async function withOutput(callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "velo-d4-campaign-"));
  try {
    return await callback({
      jsonPath: path.join(directory, "transactions.json"),
      csvPath: path.join(directory, "transactions.csv"),
      directory,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("records only consistent settled Testnet successes and exports sanitized CSV", async () => {
  assert.equal(validateD4Attempt(successAttempt()), true);
  await withOutput(async ({ jsonPath, csvPath }) => {
    const report = await recordD4CampaignOutcome(
      { campaign: CAMPAIGN, attempt: successAttempt() },
      { jsonPath, csvPath, now: new Date("2026-09-26T02:02:00.000Z") },
    );
    assert.equal(verifyD4CampaignReport(report).ok, true);
    assert.deepEqual(report.counts, {
      attempted: 1,
      consistentSuccessCandidates: 1,
      expectedDenials: 0,
      unexpectedFailures: 0,
      unresolved: 0,
    });
    const json = await readFile(jsonPath, "utf8");
    const csv = await readFile(csvPath, "utf8");
    assert.equal(json.includes("transactionXdr"), false);
    assert.equal(json.includes("privateKey"), false);
    assert.equal(JSON.parse(json).campaign.projects[0].custodyKeyVersion, "v1");
    assert.equal(csv.includes("stellar.expert/explorer/testnet/tx/"), true);
    assert.equal(csv.includes("4796"), true);
    assert.equal(csv.includes("custodyDeploymentId"), true);
    assert.equal((await stat(jsonPath)).mode & 0o777, 0o600);
    assert.equal((await stat(csvPath)).mode & 0o777, 0o600);
  });
});

test("expected denials are retained but never counted as successes", async () => {
  await withOutput(async ({ jsonPath, csvPath }) => {
    const report = await recordD4CampaignOutcome(
      { campaign: CAMPAIGN, attempt: denialAttempt() },
      { jsonPath, csvPath },
    );
    assert.deepEqual(report.counts, {
      attempted: 1,
      consistentSuccessCandidates: 0,
      expectedDenials: 1,
      unexpectedFailures: 0,
      unresolved: 0,
    });
    assert.equal((await readFile(csvPath, "utf8")).trim().split("\n").length, 1);
  });
});

test("reconciliation, fee source, exact fee, and explorer identity are required", () => {
  const mismatches = [
    { reconciliationRequired: true },
    { relayerFeeSource: `G${"C".repeat(55)}` },
    { chargedFeeStroops: "4797" },
    { explorerUrl: "https://stellar.expert/explorer/public/tx/" + "b".repeat(64) },
  ];
  for (const mismatch of mismatches) {
    assert.equal(validateD4Attempt(successAttempt(mismatch)), false);
  }
});

test("unknown fields and Mainnet evidence are rejected", async () => {
  assert.equal(validateD4Attempt({ ...successAttempt(), signedXdr: "not-persisted" }), false);
  assert.equal(
    validateD4Attempt(
      successAttempt({ participantAlias: "tk_test_0123456789abcdef0123456789abcdef" }),
    ),
    false,
  );
  assert.equal(
    validateD4Attempt(
      successAttempt({ participantAlias: "tg_test_0123456789abcdef0123456789abcdef" }),
    ),
    false,
  );
  assert.equal(validateD4Attempt(successAttempt({ operationId: `S${"A".repeat(55)}` })), false);
  await withOutput(async ({ jsonPath, csvPath }) => {
    await assert.rejects(
      recordD4CampaignOutcome(
        { campaign: { ...CAMPAIGN, network: "mainnet" }, attempt: successAttempt() },
        { jsonPath, csvPath },
      ),
      /invalid_campaign/,
    );
  });
});

test("campaign input schema blocks Gas API keys in labels", () => {
  const sensitivePattern = new RegExp(campaignInputSchema.$defs.label.not.pattern);
  assert.equal(sensitivePattern.test(`tk_live_${"a".repeat(32)}`), true);
  assert.equal(sensitivePattern.test(`tg_test_${"a".repeat(32)}`), true);
});

test("duplicate operation IDs and settled hashes cannot enter the counted set", async () => {
  await withOutput(async ({ jsonPath, csvPath }) => {
    await recordD4CampaignOutcome(
      { campaign: CAMPAIGN, attempt: successAttempt() },
      { jsonPath, csvPath },
    );
    const repeatedOutcome = await recordD4CampaignOutcome(
      { campaign: CAMPAIGN, attempt: successAttempt() },
      { jsonPath, csvPath },
    );
    assert.equal(repeatedOutcome.counts.attempted, 1);

    await assert.rejects(
      recordD4CampaignOutcome(
        {
          campaign: CAMPAIGN,
          attempt: successAttempt({
            operationId: "express-order-002",
            innerHash: "c".repeat(64),
          }),
        },
        { jsonPath, csvPath },
      ),
      /duplicate_settled_hash/,
    );
    await assert.rejects(
      recordD4CampaignOutcome(
        {
          campaign: CAMPAIGN,
          attempt: successAttempt({ actualFeeStroops: "5000", chargedFeeStroops: "5000" }),
        },
        { jsonPath, csvPath },
      ),
      /duplicate_operation_id/,
    );
  });
});

test("invalid calendar dates cannot enter campaign metadata", () => {
  assert.equal(
    verifyD4CampaignReport({
      reportKind: "velo_gas_d4_campaign",
      schemaVersion: 1,
      campaign: { ...CAMPAIGN, startedAtUtc: "2026-02-30T00:00:00.000Z" },
      updatedAtUtc: "2026-09-26T02:02:00.000Z",
      attempts: [],
      counts: {
        attempted: 0,
        consistentSuccessCandidates: 0,
        expectedDenials: 0,
        unexpectedFailures: 0,
        unresolved: 0,
      },
    }).ok,
    false,
  );
});

test("CLI reads one sanitized outcome from stdin and writes both exports", async () => {
  await withOutput(async ({ jsonPath, csvPath }) => {
    const originalLog = console.log;
    const originalError = console.error;
    console.log = () => undefined;
    console.error = () => undefined;
    try {
      const exitCode = await main(["--json", jsonPath, "--csv", csvPath], {
        readStdin: async () => JSON.stringify({ campaign: CAMPAIGN, attempt: denialAttempt() }),
        now: () => new Date("2026-09-26T02:03:00.000Z"),
      });
      assert.equal(exitCode, 0);
      const report = JSON.parse(await readFile(jsonPath, "utf8"));
      assert.equal(report.counts.expectedDenials, 1);
      assert.equal((await readFile(csvPath, "utf8")).trim().split("\n").length, 1);
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
  });
});

test("campaign metadata cannot change midway and historical smoke files are protected", async () => {
  await withOutput(async ({ jsonPath, csvPath, directory }) => {
    await recordD4CampaignOutcome(
      { campaign: CAMPAIGN, attempt: successAttempt() },
      { jsonPath, csvPath },
    );
    await assert.rejects(
      recordD4CampaignOutcome(
        { campaign: { ...CAMPAIGN, webDeploymentId: "other-web" }, attempt: denialAttempt() },
        { jsonPath, csvPath },
      ),
      /campaign_metadata_mismatch/,
    );
    await assert.rejects(
      recordD4CampaignOutcome(
        { campaign: CAMPAIGN, attempt: denialAttempt() },
        {
          jsonPath: path.join(directory, "Velo-Instawards-Deliverable-2-Smoke-Run.json"),
          csvPath,
        },
      ),
      /historical_report_protected/,
    );
    await assert.rejects(
      recordD4CampaignOutcome(
        {
          campaign: {
            ...CAMPAIGN,
            projects: CAMPAIGN.projects.map((project, index) =>
              index === 0
                ? { ...project, custodyDeploymentId: "dev:capable-kingfisher-697" }
                : project,
            ),
          },
          attempt: denialAttempt(),
        },
        { jsonPath: path.join(directory, "other-report.json"), csvPath },
      ),
      /invalid_campaign/,
    );
    await assert.rejects(
      recordD4CampaignOutcome(
        {
          campaign: CAMPAIGN,
          attempt: successAttempt({
            relayerAddress: `G${"C".repeat(55)}`,
            relayerFeeSource: `G${"C".repeat(55)}`,
          }),
        },
        { jsonPath: path.join(directory, "mismatched-project.json"), csvPath },
      ),
      /unsafe_report/,
    );
  });
});

test("managed and legacy project custody metadata are both supported", async () => {
  const legacyProject = {
    ...CAMPAIGN.projects[0],
    custodyMode: "legacy",
    keyringConfigured: null,
    custodyDeploymentId: null,
    custodyKeyVersion: null,
    provisioningFeatureEnabled: null,
    provisioningStatus: "not_applicable",
  };
  const campaign = { ...CAMPAIGN, projects: [legacyProject, CAMPAIGN.projects[1]] };
  await withOutput(async ({ jsonPath, csvPath }) => {
    const report = await recordD4CampaignOutcome(
      { campaign, attempt: successAttempt() },
      { jsonPath, csvPath },
    );
    assert.equal(verifyD4CampaignReport(report).ok, true);
  });
});
