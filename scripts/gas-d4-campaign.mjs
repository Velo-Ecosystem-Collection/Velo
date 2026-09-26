import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPORT_KIND = "velo_gas_d4_campaign";
const REPORT_SCHEMA_VERSION = 1;
const MAX_REPORT_BYTES = 10 * 1024 * 1024;
const SAFE_LABEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SENSITIVE_LABEL =
  /(?:tk_(?:live|test)|tg_test)_[a-f0-9]{32}|S[A-Z2-7]{55}|Bearer\s+\S+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/i;
const HASH = /^[a-f0-9]{64}$/;
const PUBLIC_ACCOUNT = /^G[A-Z2-7]{55}$/;
const PUBLIC_CONTRACT = /^C[A-Z2-7]{55}$/;
const STROOPS = /^(?:0|[1-9][0-9]*)$/;
const SDK_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const EXECUTION_STATUSES = new Set([
  "claimed",
  "submission_unknown",
  "submitted",
  "succeeded",
  "failed",
  "cancelled",
]);
const DENIAL_CODES = new Set([
  "contract_not_whitelisted",
  "daily_cap_exceeded",
  "wallet_rate_limited",
  "policy_disabled",
  "policy_denied",
]);
const HISTORICAL_REPORTS = new Set([
  "Velo-Instawards-Deliverable-2-Smoke-Run.json",
  "Velo-Instawards-Deliverable-3-Smoke-Run.json",
]);
const CAMPAIGN_FIELDS = [
  "campaignId",
  "network",
  "startedAtUtc",
  "sourceCommit",
  "webDeploymentId",
  "convexDeploymentId",
  "sdkVersion",
  "sdkArtifact",
  "projects",
];
const PROJECT_FIELDS = [
  "dappId",
  "projectId",
  "relayerAddress",
  "custodyMode",
  "keyringConfigured",
  "custodyDeploymentId",
  "custodyKeyVersion",
  "provisioningFeatureEnabled",
  "provisioningStatus",
  "fundingStatus",
  "activationStatus",
  "observedAtUtc",
];
const ATTEMPT_FIELDS = [
  "dappId",
  "projectId",
  "participantAlias",
  "scenario",
  "operationId",
  "outcome",
  "requestId",
  "innerHash",
  "outerHash",
  "sourceAccount",
  "relayerAddress",
  "relayerFeeSource",
  "contractId",
  "ledger",
  "closedAtUtc",
  "backendStatus",
  "innerSucceeded",
  "reconciliationRequired",
  "actualFeeStroops",
  "chargedFeeStroops",
  "explorerUrl",
  "denialCode",
  "noExecutionAttempt",
  "noReservedExposure",
];
const REPORT_FIELDS = [
  "reportKind",
  "schemaVersion",
  "campaign",
  "updatedAtUtc",
  "attempts",
  "counts",
];
const CSV_FIELDS = [
  "dappId",
  "projectId",
  "participantAlias",
  "scenario",
  "operationId",
  "requestId",
  "innerHash",
  "outerHash",
  "sourceAccount",
  "relayerAddress",
  "relayerFeeSource",
  "contractId",
  "ledger",
  "closedAtUtc",
  "backendStatus",
  "innerSucceeded",
  "reconciliationRequired",
  "actualFeeStroops",
  "chargedFeeStroops",
  "explorerUrl",
  "custodyMode",
  "keyringConfigured",
  "custodyDeploymentId",
  "custodyKeyVersion",
  "provisioningFeatureEnabled",
  "provisioningStatus",
  "fundingStatus",
  "activationStatus",
  "projectObservedAtUtc",
  "validationStatus",
];
const USAGE = `Record one sanitized D4 Gas outcome without submitting a transaction.

Usage:
  node --experimental-strip-types scripts/gas-d4-campaign.mjs --json <report.json> --csv <successes.csv> < <outcome.json>

Input schema: scripts/gas-d4-campaign-input.schema.json
The recorder never accepts signed XDR. It checks consistency only; reviewers
must verify backend and Testnet ledger evidence independently.`;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function isUtcTimestamp(value) {
  if (typeof value !== "string" || !ISO_UTC.test(value)) return false;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return false;
  const normalized = parsed.toISOString();
  return normalized === value || normalized.replace(".000Z", "Z") === value;
}

function isSafeLabel(value, allowNull = false) {
  return (
    (allowNull && value === null) ||
    (typeof value === "string" && SAFE_LABEL.test(value) && !SENSITIVE_LABEL.test(value))
  );
}

function isHash(value, allowNull = false) {
  return (allowNull && value === null) || (typeof value === "string" && HASH.test(value));
}

function isAccount(value, allowNull = false) {
  return (allowNull && value === null) || (typeof value === "string" && PUBLIC_ACCOUNT.test(value));
}

function isContract(value, allowNull = false) {
  return (
    (allowNull && value === null) || (typeof value === "string" && PUBLIC_CONTRACT.test(value))
  );
}

function isStroops(value, allowNull = false) {
  return (allowNull && value === null) || (typeof value === "string" && STROOPS.test(value));
}

export function validateD4Campaign(campaign) {
  if (!hasExactKeys(campaign, CAMPAIGN_FIELDS)) return false;
  const validMetadata =
    isSafeLabel(campaign.campaignId) &&
    campaign.network === "testnet" &&
    isUtcTimestamp(campaign.startedAtUtc) &&
    typeof campaign.sourceCommit === "string" &&
    /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(campaign.sourceCommit) &&
    isSafeLabel(campaign.webDeploymentId) &&
    isSafeLabel(campaign.convexDeploymentId) &&
    typeof campaign.sdkVersion === "string" &&
    SDK_VERSION.test(campaign.sdkVersion) &&
    (campaign.sdkArtifact === "workspace-source" || campaign.sdkArtifact === "published");
  if (!validMetadata || !Array.isArray(campaign.projects) || campaign.projects.length < 2) {
    return false;
  }

  const dappIds = new Set();
  const projectIds = new Set();
  for (const project of campaign.projects) {
    if (!validateD4Project(project, campaign.convexDeploymentId)) return false;
    if (dappIds.has(project.dappId) || projectIds.has(project.projectId)) return false;
    dappIds.add(project.dappId);
    projectIds.add(project.projectId);
  }
  return true;
}

function validateD4Project(project, convexDeploymentId) {
  if (
    !hasExactKeys(project, PROJECT_FIELDS) ||
    !isSafeLabel(project.dappId) ||
    !isSafeLabel(project.projectId) ||
    !isAccount(project.relayerAddress) ||
    !isUtcTimestamp(project.observedAtUtc) ||
    !["verified", "stale", "insufficient", "unavailable"].includes(project.fundingStatus) ||
    !["enabled", "paused", "disabled"].includes(project.activationStatus)
  ) {
    return false;
  }

  if (project.custodyMode === "managed") {
    return (
      project.keyringConfigured === true &&
      project.custodyDeploymentId === convexDeploymentId &&
      isSafeLabel(project.custodyKeyVersion) &&
      project.provisioningFeatureEnabled === true &&
      ["ready", "pending", "failed"].includes(project.provisioningStatus)
    );
  }

  return (
    project.custodyMode === "legacy" &&
    project.keyringConfigured === null &&
    project.custodyDeploymentId === null &&
    project.custodyKeyVersion === null &&
    project.provisioningFeatureEnabled === null &&
    project.provisioningStatus === "not_applicable"
  );
}

export function validateD4Attempt(attempt) {
  const hasValidationStatus =
    isRecord(attempt) && hasExactKeys(attempt, [...ATTEMPT_FIELDS, "validationStatus"]);
  if (!hasExactKeys(attempt, ATTEMPT_FIELDS) && !hasValidationStatus) return false;
  if (
    hasValidationStatus &&
    attempt.validationStatus !==
      (attempt.outcome === "succeeded" ? "locally_consistent" : "not_counted")
  ) {
    return false;
  }
  if (
    !isSafeLabel(attempt.dappId) ||
    !isSafeLabel(attempt.projectId) ||
    !isSafeLabel(attempt.participantAlias) ||
    !isSafeLabel(attempt.scenario) ||
    !isSafeLabel(attempt.operationId) ||
    !["succeeded", "expected_denial", "failed", "unresolved"].includes(attempt.outcome) ||
    !isSafeLabel(attempt.requestId, true) ||
    !isHash(attempt.innerHash, true) ||
    !isHash(attempt.outerHash, true) ||
    !isAccount(attempt.sourceAccount, true) ||
    !isAccount(attempt.relayerAddress, true) ||
    !isAccount(attempt.relayerFeeSource, true) ||
    !isContract(attempt.contractId, true) ||
    !(attempt.ledger === null || (Number.isSafeInteger(attempt.ledger) && attempt.ledger > 0)) ||
    (!isUtcTimestamp(attempt.closedAtUtc) && attempt.closedAtUtc !== null) ||
    !(
      attempt.backendStatus === null ||
      EXECUTION_STATUSES.has(attempt.backendStatus) ||
      attempt.backendStatus === "denied"
    ) ||
    !(attempt.innerSucceeded === null || typeof attempt.innerSucceeded === "boolean") ||
    !(
      attempt.reconciliationRequired === null || typeof attempt.reconciliationRequired === "boolean"
    ) ||
    !isStroops(attempt.actualFeeStroops, true) ||
    !isStroops(attempt.chargedFeeStroops, true) ||
    !(attempt.explorerUrl === null || typeof attempt.explorerUrl === "string") ||
    !(attempt.denialCode === null || DENIAL_CODES.has(attempt.denialCode)) ||
    !(attempt.noExecutionAttempt === null || typeof attempt.noExecutionAttempt === "boolean") ||
    !(attempt.noReservedExposure === null || typeof attempt.noReservedExposure === "boolean")
  ) {
    return false;
  }

  if (attempt.outcome === "succeeded") {
    return (
      attempt.scenario === "eligible" &&
      attempt.requestId !== null &&
      attempt.innerHash !== null &&
      attempt.outerHash !== null &&
      attempt.sourceAccount !== null &&
      attempt.relayerAddress !== null &&
      attempt.relayerFeeSource === attempt.relayerAddress &&
      attempt.contractId !== null &&
      attempt.ledger !== null &&
      attempt.closedAtUtc !== null &&
      attempt.backendStatus === "succeeded" &&
      attempt.innerSucceeded === true &&
      attempt.reconciliationRequired === false &&
      attempt.actualFeeStroops !== null &&
      attempt.actualFeeStroops === attempt.chargedFeeStroops &&
      attempt.explorerUrl === `https://stellar.expert/explorer/testnet/tx/${attempt.outerHash}` &&
      attempt.denialCode === null &&
      attempt.noExecutionAttempt === null &&
      attempt.noReservedExposure === null
    );
  }

  if (attempt.outcome === "expected_denial") {
    return (
      attempt.backendStatus === "denied" &&
      attempt.denialCode !== null &&
      attempt.noExecutionAttempt === true &&
      attempt.noReservedExposure === true &&
      attempt.outerHash === null &&
      attempt.ledger === null &&
      attempt.actualFeeStroops === null &&
      attempt.chargedFeeStroops === null &&
      attempt.explorerUrl === null
    );
  }

  return attempt.outcome === "unresolved"
    ? attempt.backendStatus === null ||
        ["claimed", "submission_unknown", "submitted"].includes(attempt.backendStatus)
    : attempt.backendStatus === "failed" ||
        attempt.backendStatus === "cancelled" ||
        attempt.backendStatus === "denied";
}

function countsFor(attempts) {
  return {
    attempted: attempts.length,
    consistentSuccessCandidates: attempts.filter(
      (attempt) => attempt.validationStatus === "locally_consistent",
    ).length,
    expectedDenials: attempts.filter((attempt) => attempt.outcome === "expected_denial").length,
    unexpectedFailures: attempts.filter((attempt) => attempt.outcome === "failed").length,
    unresolved: attempts.filter((attempt) => attempt.outcome === "unresolved").length,
  };
}

function assertUniqueAttempts(attempts) {
  const operationIds = new Set();
  const innerHashes = new Set();
  const outerHashes = new Set();
  for (const attempt of attempts) {
    if (operationIds.has(attempt.operationId)) throw new Error("duplicate_operation_id");
    operationIds.add(attempt.operationId);
    if (attempt.validationStatus === "locally_consistent") {
      if (innerHashes.has(attempt.innerHash) || outerHashes.has(attempt.outerHash)) {
        throw new Error("duplicate_settled_hash");
      }
      innerHashes.add(attempt.innerHash);
      outerHashes.add(attempt.outerHash);
    }
  }
}

export function verifyD4CampaignReport(report) {
  if (!hasExactKeys(report, REPORT_FIELDS))
    return { ok: false, failures: ["invalid_report_shape"] };
  if (
    report.reportKind !== REPORT_KIND ||
    report.schemaVersion !== REPORT_SCHEMA_VERSION ||
    !validateD4Campaign(report.campaign) ||
    !isUtcTimestamp(report.updatedAtUtc) ||
    !Array.isArray(report.attempts) ||
    !hasExactKeys(report.counts, [
      "attempted",
      "consistentSuccessCandidates",
      "expectedDenials",
      "unexpectedFailures",
      "unresolved",
    ])
  ) {
    return { ok: false, failures: ["invalid_report_metadata"] };
  }
  for (const attempt of report.attempts) {
    if (!validateD4Attempt(attempt)) return { ok: false, failures: ["invalid_attempt"] };
    const project = report.campaign.projects.find((item) => item.projectId === attempt.projectId);
    if (
      !project ||
      project.dappId !== attempt.dappId ||
      project.relayerAddress !== attempt.relayerAddress
    ) {
      return { ok: false, failures: ["attempt_project_mismatch"] };
    }
    if (
      attempt.outcome === "succeeded" &&
      (project.fundingStatus !== "verified" ||
        project.activationStatus !== "enabled" ||
        (project.custodyMode === "managed" && project.provisioningStatus !== "ready"))
    ) {
      return { ok: false, failures: ["project_not_ready_for_success"] };
    }
  }
  try {
    assertUniqueAttempts(report.attempts);
  } catch {
    return { ok: false, failures: ["duplicate_attempt"] };
  }
  const expectedCounts = countsFor(report.attempts);
  if (JSON.stringify(report.counts) !== JSON.stringify(expectedCounts)) {
    return { ok: false, failures: ["invalid_counts"] };
  }
  return { ok: true, failures: [] };
}

function normalizeAttempt(input) {
  if (!validateD4Attempt(input)) throw new Error("invalid_attempt");
  return {
    ...input,
    validationStatus: input.outcome === "succeeded" ? "locally_consistent" : "not_counted",
  };
}

function sameAttempt(left, right) {
  const stable = (value) =>
    JSON.stringify(
      Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, value[key]]),
      ),
    );
  return stable(left) === stable(right);
}

function createReport(campaign, attempts, now = new Date()) {
  const report = {
    reportKind: REPORT_KIND,
    schemaVersion: REPORT_SCHEMA_VERSION,
    campaign,
    updatedAtUtc: now.toISOString(),
    attempts,
    counts: countsFor(attempts),
  };
  assertUniqueAttempts(attempts);
  if (!verifyD4CampaignReport(report).ok) throw new Error("unsafe_report");
  return report;
}

function csvCell(value) {
  const text = value === null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(report) {
  const rows = [CSV_FIELDS.join(",")];
  for (const attempt of report.attempts) {
    if (attempt.validationStatus !== "locally_consistent") continue;
    const project = report.campaign.projects.find((item) => item.projectId === attempt.projectId);
    const row = {
      ...attempt,
      custodyMode: project.custodyMode,
      keyringConfigured: project.keyringConfigured,
      custodyDeploymentId: project.custodyDeploymentId,
      custodyKeyVersion: project.custodyKeyVersion,
      provisioningFeatureEnabled: project.provisioningFeatureEnabled,
      provisioningStatus: project.provisioningStatus,
      fundingStatus: project.fundingStatus,
      activationStatus: project.activationStatus,
      projectObservedAtUtc: project.observedAtUtc,
    };
    rows.push(CSV_FIELDS.map((field) => csvCell(row[field])).join(","));
  }
  return `${rows.join("\n")}\n`;
}

function assertSafeOutputPaths(jsonPath, csvPath) {
  const jsonResolved = path.resolve(jsonPath);
  const csvResolved = path.resolve(csvPath);
  if (jsonResolved === csvResolved) throw new Error("output_paths_must_differ");
  for (const reportName of HISTORICAL_REPORTS) {
    if (path.basename(jsonResolved) === reportName || path.basename(csvResolved) === reportName) {
      throw new Error("historical_report_protected");
    }
  }
  return { jsonResolved, csvResolved };
}

async function writeAtomically(filePath, contents) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(tempPath, filePath);
  } finally {
    await rm(tempPath, { force: true });
  }
}

export async function recordD4CampaignOutcome(
  { campaign, attempt },
  { jsonPath, csvPath, now = new Date() },
) {
  if (!validateD4Campaign(campaign)) throw new Error("invalid_campaign");
  const normalizedAttempt = normalizeAttempt(attempt);
  const { jsonResolved, csvResolved } = assertSafeOutputPaths(jsonPath, csvPath);
  let existing = null;
  try {
    const bytes = await readFile(jsonResolved);
    if (bytes.byteLength > MAX_REPORT_BYTES) throw new Error("report_too_large");
    existing = JSON.parse(bytes.toString("utf8"));
    if (!verifyD4CampaignReport(existing).ok) throw new Error("existing_report_invalid");
    if (JSON.stringify(existing.campaign) !== JSON.stringify(campaign)) {
      throw new Error("campaign_metadata_mismatch");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const attempts = [...(existing?.attempts ?? [])];
  const priorAttempt = attempts.find(
    (candidate) => candidate.operationId === normalizedAttempt.operationId,
  );
  if (priorAttempt) {
    if (!sameAttempt(priorAttempt, normalizedAttempt)) throw new Error("duplicate_operation_id");
  } else {
    attempts.push(normalizedAttempt);
  }
  const report = createReport(campaign, attempts, now);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const csv = toCsv(report);
  if (Buffer.byteLength(json, "utf8") > MAX_REPORT_BYTES) throw new Error("report_too_large");
  await writeAtomically(jsonResolved, json);
  await writeAtomically(csvResolved, csv);
  return report;
}

async function readStdin() {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 64 * 1024) throw new Error("input_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseArgs(args) {
  if (args.length === 1 && args[0] === "--help") return { help: true };
  const values = new Map();
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if ((key !== "--json" && key !== "--csv") || !args[index + 1]) {
      throw new Error("invalid_arguments");
    }
    values.set(key, args[++index]);
  }
  if (!values.has("--json") || !values.has("--csv")) throw new Error("invalid_arguments");
  return { help: false, jsonPath: values.get("--json"), csvPath: values.get("--csv") };
}

export async function main(args = process.argv.slice(2), dependencies = {}) {
  try {
    const paths = parseArgs(args);
    if (paths.help) {
      console.log(USAGE);
      return 0;
    }
    const inputText = await (dependencies.readStdin ?? readStdin)();
    const input = JSON.parse(inputText);
    const report = await recordD4CampaignOutcome(input, {
      ...paths,
      now: dependencies.now?.() ?? new Date(),
    });
    console.log(
      `D4 campaign outcome recorded; ${report.counts.consistentSuccessCandidates} locally consistent candidates across ${report.counts.attempted} attempts.`,
    );
    return 0;
  } catch {
    console.error("D4 campaign record rejected; verify the sanitized input and output paths.");
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
