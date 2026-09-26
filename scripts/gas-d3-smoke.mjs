#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  Velo,
  VeloError,
  VeloGasSubmissionUnknownError,
  VeloGasWaitError,
} from "../packages/velo-sdk/src/index.ts";
import { readRepositoryState } from "./gas-d2-qualification.mjs";
import {
  compareReplaySnapshots,
  correlateSettledExecution,
  createSmokeDependencies,
  isExpiredInvocation,
  loadSmokeConfig,
  readScopedSnapshot,
  runPreflight,
  summarizePreflight,
  verifyPolicyDenial,
} from "./gas-d2-smoke.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULT_REPORT_PATH = "docs/instawards/Velo-Instawards-Deliverable-3-Smoke-Run.json";
export const HISTORICAL_D2_REPORT_PATH =
  "docs/instawards/Velo-Instawards-Deliverable-2-Smoke-Run.json";
export const D3_REPORT_KIND = "velo_gas_d3_smoke";
export const D3_REPORT_SCHEMA_VERSION = 1;
export const SDK_SOURCE_ENTRY_POINT = "packages/velo-sdk/src/index.ts";
export const DEFAULT_POLL_LIMIT = 30;
export const DEFAULT_POLL_INTERVAL_MS = 10_000;
export const DEFAULT_TIMEOUT_MS = 30_000;
export const MAX_TIMEOUT_MS = 120_000;
export const MAX_POLL_LIMIT = 120;
export const MAX_POLL_INTERVAL_MS = 60_000;

const SDK_PACKAGE_JSON = path.join(repositoryRoot, "packages", "velo-sdk", "package.json");
const MAX_REPORT_BYTES = 256 * 1_024;
const API_KEY_PATTERN = /^tk_live_[a-f0-9]{32}$/;
const SAFE_LABEL_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const EXECUTION_STATUSES = new Set([
  "claimed",
  "submission_unknown",
  "submitted",
  "succeeded",
  "failed",
  "cancelled",
]);
const SAFE_ERROR_CODES = new Set([
  "invalid_api_key",
  "invalid_request",
  "invalid_signature",
  "wrong_network",
  "unsupported_transaction",
  "idempotency_key_conflict",
  "duplicate_transaction",
  "policy_disabled",
  "contract_not_whitelisted",
  "daily_cap_exceeded",
  "wallet_rate_limited",
  "handoff_unavailable",
  "reservation_expired",
  "invalid_lifecycle",
  "resource_not_found",
  "policy_denied",
  "relayer_unavailable",
  "dependency_unavailable",
  "internal_error",
  "invalid_response",
]);
const TOP_LEVEL_FIELDS = new Set([
  "reportKind",
  "schemaVersion",
  "mode",
  "status",
  "reportIdentity",
  "startedAt",
  "completedAt",
  "sdk",
  "repository",
  "deployment",
  "preflight",
  "dashboard",
  "failure",
  "execution",
  "replay",
  "denial",
  "missingInputs",
  "invalidInputs",
]);

const usage = `Run the D3 SDK-to-dashboard Gas smoke workflow.

Usage:
  node --experimental-strip-types scripts/gas-d3-smoke.mjs [--mode preflight] [--output <path>]
  node --experimental-strip-types scripts/gas-d3-smoke.mjs --mode execute [--output <path>]
  node --experimental-strip-types scripts/gas-d3-smoke.mjs --mode verify --report <path>

Modes:
  preflight  Validate readiness and fresh inputs; never sponsor. This is the default.
  execute    Use the workspace SDK for one allowed sponsorship/submission, observation,
             same-identity replay, and whitelist denial.
  verify     Verify a saved D3 report offline; never contact the deployment.

The D3 environment uses VELO_GAS_D3_* names and maps to the existing D2
configuration loader. Credentials and signed XDR may be supplied through the
documented *_FILE alternatives. Reports never contain credentials, XDR, raw
responses, or exception messages. Set VELO_GAS_D3_EXPECTED_ENVIRONMENT to
development (the default) or production. Production mode requires the exact
deployment name and expected source SHA. Dashboard acceptance remains a separate gate.
`;

const D3_TO_D2_ENV = {
  MODE: "MODE",
  API_ORIGIN: "API_ORIGIN",
  API_KEY: "API_KEY",
  API_KEY_FILE: "API_KEY_FILE",
  PROJECT_ID: "PROJECT_ID",
  ALLOWED_XDR: "ALLOWED_XDR",
  ALLOWED_XDR_FILE: "ALLOWED_XDR_FILE",
  DENIED_XDR: "DENIED_XDR",
  DENIED_XDR_FILE: "DENIED_XDR_FILE",
  RPC_URL: "RPC_URL",
  OPERATOR_SNAPSHOT_URL: "OPERATOR_SNAPSHOT_URL",
  PROVENANCE_URL: "PROVENANCE_URL",
  OPERATOR_TOKEN: "OPERATOR_TOKEN",
  DEPLOYMENT_NAME: "DEPLOYMENT_NAME",
  EXPECTED_ENVIRONMENT: "EXPECTED_ENVIRONMENT",
  EXPECTED_SOURCE_COMMIT: "EXPECTED_SOURCE_COMMIT",
  TIMEOUT_MS: "TIMEOUT_MS",
  POLL_LIMIT: "POLL_LIMIT",
  POLL_INTERVAL_MS: "POLL_INTERVAL_MS",
};

export function parseD3SmokeArgs(values) {
  let mode = "preflight";
  let outputPath = DEFAULT_REPORT_PATH;
  let reportPath = null;
  let pollLimit = null;
  let pollIntervalMs = null;

  for (let index = 0; index < values.length; index += 1) {
    const argument = values[index];
    if (argument === "--help")
      return { help: true, mode, outputPath, reportPath, pollLimit, pollIntervalMs };
    if (argument === "--mode") {
      const value = values[index + 1];
      if (value !== "preflight" && value !== "execute" && value !== "verify") {
        throw new Error("--mode must be preflight, execute, or verify");
      }
      mode = value;
      index += 1;
      continue;
    }
    if (argument === "--output" || argument === "--report") {
      const value = values[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      if (argument === "--output") outputPath = value;
      else reportPath = value;
      index += 1;
      continue;
    }
    if (argument === "--poll-limit" || argument === "--poll-interval-ms") {
      const value = values[index + 1];
      const parsed = parseBoundedInteger(
        value,
        argument === "--poll-limit" ? 0 : 0,
        argument === "--poll-limit" ? MAX_POLL_LIMIT : MAX_POLL_INTERVAL_MS,
      );
      if (parsed === null) throw new Error(`${argument} is outside its bounded range`);
      if (argument === "--poll-limit") pollLimit = parsed;
      else pollIntervalMs = parsed;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${argument}`);
  }

  return { help: false, mode, outputPath, reportPath, pollLimit, pollIntervalMs };
}

export function mapD3EnvironmentToD2(env) {
  const mapped = { ...env, VELO_GAS_D2_MODE: env.VELO_GAS_D3_MODE ?? "preflight" };
  for (const [suffix, d2Suffix] of Object.entries(D3_TO_D2_ENV)) {
    const value = env[`VELO_GAS_D3_${suffix}`];
    if (value !== undefined) mapped[`VELO_GAS_D2_${d2Suffix}`] = value;
  }
  return mapped;
}

export async function loadD3SmokeConfig(
  env = process.env,
  { readPrivateFile = (filePath) => readFile(filePath, "utf8") } = {},
) {
  const mode = env.VELO_GAS_D3_MODE ?? "preflight";
  if (mode !== "preflight" && mode !== "execute" && mode !== "verify") {
    return { ok: false, missing: [], invalid: ["VELO_GAS_D3_MODE"], config: null };
  }
  if (mode === "verify") {
    return { ok: true, missing: [], invalid: [], config: { mode } };
  }

  const invalid = [];
  for (const [name, min, max] of [
    ["VELO_GAS_D3_TIMEOUT_MS", 1_000, MAX_TIMEOUT_MS],
    ["VELO_GAS_D3_POLL_LIMIT", 0, MAX_POLL_LIMIT],
    ["VELO_GAS_D3_POLL_INTERVAL_MS", 0, MAX_POLL_INTERVAL_MS],
  ]) {
    if (env[name] !== undefined && parseBoundedInteger(env[name], min, max) === null) {
      invalid.push(name);
    }
  }

  const loaded = await loadSmokeConfig(mapD3EnvironmentToD2(env), { readPrivateFile });
  const config = loaded.config;
  invalid.push(...loaded.invalid.map((name) => name.replace("VELO_GAS_D2_", "VELO_GAS_D3_")));
  const invalidUrls = [];
  for (const [name, value] of [
    ["VELO_GAS_D3_API_ORIGIN", config.apiOrigin],
    ["VELO_GAS_D3_RPC_URL", config.rpcUrl],
    ["VELO_GAS_D3_OPERATOR_SNAPSHOT_URL", config.snapshotUrl],
    ["VELO_GAS_D3_PROVENANCE_URL", config.provenanceUrl],
  ]) {
    if (value) {
      try {
        normalizeUrl(value, name);
      } catch {
        invalidUrls.push(name);
      }
    }
  }
  if (!isSafeLabel(config.projectId)) invalid.push("VELO_GAS_D3_PROJECT_ID");
  if (!isSafeLabel(config.deploymentName)) invalid.push("VELO_GAS_D3_DEPLOYMENT_NAME");
  if (!["development", "production"].includes(config.expectedEnvironment)) {
    invalid.push("VELO_GAS_D3_EXPECTED_ENVIRONMENT");
  }
  if (config.expectedSourceCommit && !COMMIT_PATTERN.test(config.expectedSourceCommit)) {
    invalid.push("VELO_GAS_D3_EXPECTED_SOURCE_COMMIT");
  }
  if (mode === "execute" && (!config.apiKey || !API_KEY_PATTERN.test(config.apiKey))) {
    invalid.push("VELO_GAS_D3_API_KEY");
  }

  const missing = loaded.missing.map((name) => name.replace("VELO_GAS_D2_", "VELO_GAS_D3_"));
  const normalizedConfig = {
    ...config,
    mode,
  };
  if (invalidUrls.length === 0) {
    normalizedConfig.apiOrigin = config.apiOrigin
      ? normalizeUrl(config.apiOrigin, "VELO_GAS_D3_API_ORIGIN")
      : null;
    normalizedConfig.rpcUrl = config.rpcUrl
      ? normalizeUrl(config.rpcUrl, "VELO_GAS_D3_RPC_URL")
      : null;
    normalizedConfig.snapshotUrl = config.snapshotUrl
      ? normalizeUrl(config.snapshotUrl, "VELO_GAS_D3_OPERATOR_SNAPSHOT_URL")
      : null;
    normalizedConfig.provenanceUrl = config.provenanceUrl
      ? normalizeUrl(config.provenanceUrl, "VELO_GAS_D3_PROVENANCE_URL")
      : null;
  }
  return {
    ok: loaded.ok && invalid.length === 0 && invalidUrls.length === 0,
    missing: [...new Set(missing)],
    invalid: [...new Set([...invalid, ...invalidUrls])],
    config: normalizedConfig,
  };
}

export function createD3SmokeDependencies({
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  wait = async () => {},
  repositoryState = () => readRepositoryState(repositoryRoot),
  sdkFactory = createD3Client,
  withSdkTransport = (callback) => withTemporaryFetch(fetchImpl, callback),
  sdkMetadata = null,
} = {}) {
  return {
    ...createSmokeDependencies({ fetchImpl, now, wait, repositoryState }),
    sdkFactory,
    withSdkTransport,
    sdkMetadata,
  };
}

export function createD3Client(config) {
  return new Velo({
    apiKey: config.apiKey,
    baseUrl: config.apiOrigin,
    environment: "testnet",
    timeoutMs: config.timeoutMs,
    maxRetries: 2,
  });
}

export async function runD3Preflight({ config, dependencies = createD3SmokeDependencies() }) {
  const d2Preflight = await runPreflight({ config, dependencies });
  const d3Checks = [
    {
      name: "sdk_source_entry_point",
      status: SDK_SOURCE_ENTRY_POINT.endsWith("packages/velo-sdk/src/index.ts")
        ? "passed"
        : "blocked",
      ...(SDK_SOURCE_ENTRY_POINT.endsWith("packages/velo-sdk/src/index.ts")
        ? {}
        : { failure: "sdk_source_entry_point_mismatch" }),
    },
  ];
  if (config?.mode === "execute") {
    const credentialsPassed =
      typeof config.apiKey === "string" && API_KEY_PATTERN.test(config.apiKey);
    d3Checks.push({
      name: "sdk_credentials_available",
      status: credentialsPassed ? "passed" : "blocked",
      ...(credentialsPassed ? {} : { failure: "api_credentials_unavailable" }),
    });
  }
  const ok = d2Preflight.ok && d3Checks.every((check) => check.status === "passed");
  return { ...d2Preflight, ok, d3Checks };
}

export async function runD3SmokeExecution({
  config,
  dependencies = createD3SmokeDependencies(),
  pollLimit = config?.pollLimit ?? DEFAULT_POLL_LIMIT,
  pollIntervalMs = config?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
}) {
  const startedAt = timestamp(dependencies.now);
  const reportIdentity = `d3-smoke-${randomUUID()}`;
  const repositoryBefore = await safeRepositoryState(dependencies.repositoryState);
  const preflight = await runD3Preflight({ config, dependencies });
  const sdk = await readSdkMetadata(dependencies.sdkMetadata);
  const base = {
    reportKind: D3_REPORT_KIND,
    schemaVersion: D3_REPORT_SCHEMA_VERSION,
    mode: "execute",
    status: "incomplete",
    reportIdentity,
    startedAt,
    completedAt: null,
    sdk,
    repository: { before: repositoryBefore, after: null },
    deployment: preflight.deployment,
    preflight: { ...summarizePreflight(preflight), d3Checks: preflight.d3Checks },
    dashboard: { status: "pending", reason: "deployed_dashboard_acceptance_pending" },
    failure: null,
    execution: null,
    replay: null,
    denial: null,
  };

  if (!preflight.ok) return finishD3Report({ ...base, failure: "preflight_failed" }, dependencies);
  if (!config?.apiKey || !API_KEY_PATTERN.test(config.apiKey)) {
    return finishD3Report({ ...base, failure: "api_credentials_unavailable" }, dependencies);
  }

  const operationId = `${reportIdentity}:allowed`;
  const denialOperationId = `${reportIdentity}:denied`;
  const allowedFacts = preflight.facts.allowed;
  const deniedFacts = preflight.facts.denied;
  const client = dependencies.sdkFactory(config);
  const recovery = {
    attempted: false,
    reason: null,
    identityOnly: false,
    resubmitted: false,
  };
  const handoffStartedAt = timestamp(dependencies.now);
  let handoffResult;
  try {
    handoffResult = await invokeSdk(dependencies, () =>
      client.gas.sponsorAndSubmit(config.allowedXdr, {
        idempotencyKey: operationId,
        correlationId: `${reportIdentity}:handoff`,
        timeoutMs: config.timeoutMs,
        maxRetries: 2,
      }),
    );
  } catch (error) {
    if (!(error instanceof VeloGasSubmissionUnknownError)) {
      return finishD3Report(
        {
          ...base,
          failure: sdkFailureCode(error),
          execution: { ...emptyExecution(operationId), observation: null },
        },
        dependencies,
      );
    }
    recovery.attempted = true;
    recovery.reason = error.reason;
    recovery.identityOnly = true;
    recovery.resubmitted = false;
    if (!isIdentity(error.recovery, allowedFacts.transactionHash)) {
      return finishD3Report(
        {
          ...base,
          failure: "sdk_recovery_identity_mismatch",
          execution: { ...emptyExecution(operationId), recovery, observation: null },
        },
        dependencies,
      );
    }
    try {
      handoffResult = await invokeSdk(dependencies, () =>
        client.gas.getStatus(error.recovery, {
          correlationId: `${reportIdentity}:recovery`,
          timeoutMs: config.timeoutMs,
        }),
      );
    } catch (recoveryError) {
      return finishD3Report(
        {
          ...base,
          failure: `sdk_recovery_${sdkFailureCode(recoveryError)}`,
          execution: { ...emptyExecution(operationId), recovery, observation: null },
        },
        dependencies,
      );
    }
  }
  const handoffCompletedAt = timestamp(dependencies.now);
  if (!isIdentity(handoffResult, allowedFacts.transactionHash)) {
    return finishD3Report(
      {
        ...base,
        failure: "sdk_receipt_identity_mismatch",
        execution: {
          ...emptyExecution(operationId),
          sdkReceipt: projectSdkReceipt(handoffResult),
          recovery,
          observation: {
            initialStatus: handoffResult?.status ?? null,
            finalStatus: null,
            maxAttempts: 0,
          },
        },
      },
      dependencies,
    );
  }

  const initialResult = handoffResult;
  const identity = {
    requestId: handoffResult.requestId,
    transactionHash: handoffResult.transactionHash,
  };
  const observation = await observeWithSdk({
    client,
    dependencies,
    identity,
    initialResult,
    timeoutMs: config.timeoutMs,
    maxAttempts: Math.max(1, pollLimit),
    initialDelayMs: Math.max(1, pollIntervalMs),
    maxDelayMs: Math.max(1, pollIntervalMs),
    correlationId: `${reportIdentity}:observe`,
  });
  if (!observation.ok) {
    return finishD3Report(
      {
        ...base,
        failure: observation.code,
        execution: {
          ...emptyExecution(operationId),
          sdkReceipt: projectSdkReceipt(observation.result ?? initialResult),
          recovery,
          observation: {
            initialStatus: initialResult.status,
            finalStatus: observation.result?.status ?? null,
            maxAttempts: observation.maxAttempts,
          },
          timing: { startedAt: handoffStartedAt, completedAt: handoffCompletedAt },
        },
      },
      dependencies,
    );
  }
  const settledResult = observation.result;
  if (settledResult.status !== "succeeded") {
    return finishD3Report(
      {
        ...base,
        failure:
          settledResult.status === "failed" || settledResult.status === "cancelled"
            ? "execution_not_successful"
            : "observation_unresolved",
        execution: {
          ...emptyExecution(operationId),
          sdkReceipt: projectSdkReceipt(settledResult),
          recovery,
          observation: {
            initialStatus: initialResult.status,
            finalStatus: settledResult.status,
            maxAttempts: observation.maxAttempts,
          },
          timing: { startedAt: handoffStartedAt, completedAt: handoffCompletedAt },
        },
      },
      dependencies,
    );
  }

  const settledSnapshot = await readScopedSnapshot(config, dependencies, {
    phase: "after-settlement",
    requestId: identity.requestId,
    transactionHash: identity.transactionHash,
    idempotencyKeyHash: sha256Hex(operationId),
  });
  if (!settledSnapshot.ok) {
    return finishD3Report({ ...base, failure: settledSnapshot.code }, dependencies);
  }
  const settledEvidence = correlateSettledExecution(settledResult, settledSnapshot.value);
  if (!settledEvidence.ok) {
    return finishD3Report(
      {
        ...base,
        failure: settledEvidence.code,
        execution: {
          ...emptyExecution(operationId),
          sdkReceipt: projectSdkReceipt(settledResult),
          recovery,
          observation: {
            initialStatus: initialResult.status,
            finalStatus: settledResult.status,
            maxAttempts: observation.maxAttempts,
          },
        },
      },
      dependencies,
    );
  }

  const execution = {
    operationId,
    sdkReceipt: projectSdkReceipt(settledResult),
    backend: projectBackendEvidence(settledEvidence.value),
    recovery,
    observation: {
      initialStatus: initialResult.status,
      finalStatus: settledResult.status,
      maxAttempts: observation.maxAttempts,
    },
    timing: { startedAt: handoffStartedAt, completedAt: handoffCompletedAt },
  };

  const beforeReplay = await readScopedSnapshot(config, dependencies, {
    phase: "before-replay",
    requestId: identity.requestId,
    transactionHash: identity.transactionHash,
    idempotencyKeyHash: sha256Hex(operationId),
  });
  if (!beforeReplay.ok)
    return finishD3Report({ ...base, failure: beforeReplay.code, execution }, dependencies);

  const replay = await sdkReplay({
    client,
    dependencies,
    identity,
    transactionXdr: config.allowedXdr,
    correlationId: `${reportIdentity}:replay`,
    timeoutMs: config.timeoutMs,
  });
  const afterReplay = await readScopedSnapshot(config, dependencies, {
    phase: "after-replay",
    requestId: identity.requestId,
    transactionHash: identity.transactionHash,
    idempotencyKeyHash: sha256Hex(operationId),
  });
  const replayComparison =
    replay.ok && afterReplay.ok
      ? compareReplaySnapshots(beforeReplay.value, afterReplay.value, replay.result, settledResult)
      : {
          ok: false,
          sameAttemptIdentity: false,
          sameSendCount: false,
          sameSettledFee: false,
          sameAccounting: false,
          code: replay.code ?? afterReplay.code,
        };
  const sameReservedExposure =
    beforeReplay.ok &&
    afterReplay.ok &&
    beforeReplay.value.reservedExposureStroops === afterReplay.value.reservedExposureStroops;
  const replayEvidence = {
    status: replayComparison.ok && sameReservedExposure ? "passed" : "incomplete",
    sdkReceipt: replay.result ? projectSdkReceipt(replay.result) : null,
    sameAttemptIdentity: replayComparison.sameAttemptIdentity,
    sameSendCount: replayComparison.sameSendCount,
    sameSettledFee: replayComparison.sameSettledFee,
    sameAccounting: replayComparison.sameAccounting,
    sameReservedExposure,
  };

  const denialBefore = await readScopedSnapshot(config, dependencies, {
    phase: "before-denial",
    transactionHash: deniedFacts.transactionHash,
    idempotencyKeyHash: sha256Hex(denialOperationId),
  });
  if (!denialBefore.ok)
    return finishD3Report(
      { ...base, failure: denialBefore.code, execution, replay: replayEvidence },
      dependencies,
    );

  const denialFreshness = await recheckFreshness(config, dependencies, deniedFacts);
  if (!denialFreshness.ok) {
    return finishD3Report(
      {
        ...base,
        failure: denialFreshness.code,
        execution,
        replay: replayEvidence,
        denial: emptyDenial(deniedFacts.transactionHash, denialFreshness.rechecked),
      },
      dependencies,
    );
  }

  const deniedResponse = await sdkDenial({
    client,
    dependencies,
    transactionXdr: config.deniedXdr,
    idempotencyKey: denialOperationId,
    correlationId: `${reportIdentity}:denial`,
    timeoutMs: config.timeoutMs,
  });
  const denialAfter = await readScopedSnapshot(config, dependencies, {
    phase: "after-denial",
    transactionHash: deniedFacts.transactionHash,
    idempotencyKeyHash: sha256Hex(denialOperationId),
  });
  const denialVerification =
    denialAfter.ok && deniedResponse.kind === "error"
      ? verifyPolicyDenial(
          deniedResponse,
          denialBefore.value,
          denialAfter.value,
          deniedFacts.transactionHash,
        )
      : { ok: false, code: deniedResponse.code ?? denialAfter.code };
  const denial = {
    transactionHash: deniedFacts.transactionHash,
    expectedCode: "contract_not_whitelisted",
    returnedCode: deniedResponse.kind === "error" ? deniedResponse.code : "unexpected_success",
    httpStatus: deniedResponse.httpStatus ?? null,
    freshnessRechecked: true,
    noExecutionAttempt: denialVerification.noExecutionAttempt ?? false,
    noReservedExposure: denialVerification.noReservedExposure ?? false,
    accountingUnchanged: denialVerification.accountingUnchanged ?? false,
    status: denialVerification.ok ? "passed" : "incomplete",
  };
  return finishD3Report(
    {
      ...base,
      status:
        replayEvidence.status === "passed" && denial.status === "passed" ? "passed" : "incomplete",
      failure:
        replayEvidence.status === "passed" && denial.status === "passed"
          ? null
          : (replayComparison.code ?? denialVerification.code),
      execution,
      replay: replayEvidence,
      denial,
    },
    dependencies,
  );
}

export function verifyD3SmokeReport(report) {
  const failures = [];
  if (!isRecord(report)) return { ok: false, failures: ["invalid_report"] };
  addUnexpectedFieldFailure(failures, report, TOP_LEVEL_FIELDS, "report");
  if (report.reportKind !== D3_REPORT_KIND) failures.push("not_a_d3_report");
  if (report.schemaVersion !== D3_REPORT_SCHEMA_VERSION) failures.push("invalid_report_schema");
  if (report.mode !== "preflight" && report.mode !== "execute")
    failures.push("invalid_report_mode");
  if (report.status !== "passed") failures.push("report_not_passed");
  if (
    report.status === "passed" &&
    (report.failure !== null || "missingInputs" in report || "invalidInputs" in report)
  ) {
    failures.push("passed_report_has_configuration_failure");
  }
  if (
    !isSafeLabel(report.reportIdentity) ||
    !isTimestamp(report.startedAt) ||
    !isTimestamp(report.completedAt)
  ) {
    failures.push("report_identity_or_timing_invalid");
  }
  if (!verifySdkMetadata(report.sdk, failures, report.status === "passed"))
    failures.push("sdk_metadata_invalid");
  if (!verifyRepository(report.repository, failures)) failures.push("repository_evidence_invalid");
  if (!verifyDeployment(report.deployment, failures)) failures.push("deployment_evidence_invalid");
  if (!verifyD3Preflight(report.preflight)) failures.push("preflight_evidence_invalid");
  if (
    !isRecord(report.dashboard) ||
    !sameKeys(report.dashboard, ["status", "reason"]) ||
    report.dashboard.status !== "pending" ||
    report.dashboard.reason !== "deployed_dashboard_acceptance_pending"
  )
    failures.push("dashboard_gate_invalid");
  if (report.failure !== null && !isSafeLabel(report.failure))
    failures.push("failure_code_invalid");

  if (report.mode === "preflight") {
    if (report.execution !== null || report.replay !== null || report.denial !== null) {
      failures.push("preflight_contains_execution_evidence");
    }
  } else {
    if (!verifyExecution(report.execution, failures)) failures.push("execution_evidence_invalid");
    if (!verifyReplay(report.replay, report.execution)) failures.push("replay_evidence_invalid");
    if (!verifyDenial(report.denial)) failures.push("denial_evidence_invalid");
  }
  if (containsSensitiveData(JSON.stringify(report))) failures.push("sensitive_data_present");
  return { ok: failures.length === 0, failures: [...new Set(failures)] };
}

export async function writeD3SmokeReport(report, outputPath, cwd = repositoryRoot) {
  const resolvedPath = path.resolve(cwd, outputPath);
  const historicalPath = path.resolve(cwd, HISTORICAL_D2_REPORT_PATH);
  if (resolvedPath === historicalPath)
    throw new Error("Refusing to overwrite the historical D2 report");
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (
    Buffer.byteLength(serialized, "utf8") > MAX_REPORT_BYTES ||
    containsSensitiveData(serialized)
  ) {
    throw new Error("Refusing to write an unsafe D3 smoke report");
  }
  await mkdir(path.dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, serialized, "utf8");
  return resolvedPath;
}

export async function main(values = process.argv.slice(2)) {
  const options = parseD3SmokeArgs(values);
  if (options.help) {
    console.log(usage);
    return 0;
  }
  if (options.mode === "verify") {
    const report = await readD3Report(options.reportPath ?? options.outputPath);
    const result = verifyD3SmokeReport(report);
    console.log(
      `D3 smoke evidence ${result.ok ? "passed" : "incomplete"}; offline report validation only.`,
    );
    return result.ok ? 0 : 1;
  }

  const loaded = await loadD3SmokeConfig({ ...process.env, VELO_GAS_D3_MODE: options.mode });
  const outputPath = process.env.VELO_GAS_D3_REPORT_PATH ?? options.outputPath;
  let report;
  if (!loaded.ok || !loaded.config) {
    const now = new Date().toISOString();
    const repository = {
      before: await safeRepositoryState(() => readRepositoryState(repositoryRoot)),
      after: await safeRepositoryState(() => readRepositoryState(repositoryRoot)),
    };
    report = createConfigurationReport({
      mode: options.mode,
      missingInputs: loaded.missing,
      invalidInputs: loaded.invalid,
      startedAt: now,
      completedAt: now,
      repository,
    });
  } else {
    const config = {
      ...loaded.config,
      ...(options.pollLimit === null ? {} : { pollLimit: options.pollLimit }),
      ...(options.pollIntervalMs === null ? {} : { pollIntervalMs: options.pollIntervalMs }),
    };
    const dependencies = createD3SmokeDependencies();
    report =
      options.mode === "preflight"
        ? await runD3PreflightReport({ config, dependencies })
        : await runD3SmokeExecution({ config, dependencies });
  }
  await writeD3SmokeReport(report, outputPath, repositoryRoot);
  console.log(`D3 smoke ${report.status}; sanitized report written to ${outputPath}.`);
  return report.status === "passed" ? 0 : 1;
}

async function runD3PreflightReport({ config, dependencies }) {
  const startedAt = timestamp(dependencies.now);
  const before = await safeRepositoryState(dependencies.repositoryState);
  const preflight = await runD3Preflight({ config, dependencies });
  const after = await safeRepositoryState(dependencies.repositoryState);
  const sdk = await readSdkMetadata(dependencies.sdkMetadata);
  return {
    reportKind: D3_REPORT_KIND,
    schemaVersion: D3_REPORT_SCHEMA_VERSION,
    mode: "preflight",
    status: preflight.ok ? "passed" : "incomplete",
    reportIdentity: `d3-preflight-${randomUUID()}`,
    startedAt,
    completedAt: timestamp(dependencies.now),
    sdk,
    repository: { before, after },
    deployment: preflight.deployment,
    preflight: { ...summarizePreflight(preflight), d3Checks: preflight.d3Checks },
    dashboard: { status: "pending", reason: "deployed_dashboard_acceptance_pending" },
    failure: preflight.ok ? null : "preflight_failed",
    execution: null,
    replay: null,
    denial: null,
  };
}

function createConfigurationReport({
  mode,
  missingInputs,
  invalidInputs,
  startedAt,
  completedAt,
  repository,
}) {
  return {
    reportKind: D3_REPORT_KIND,
    schemaVersion: D3_REPORT_SCHEMA_VERSION,
    mode,
    status: "incomplete",
    reportIdentity: `d3-config-${randomUUID()}`,
    startedAt,
    completedAt,
    sdk: { version: "unresolved", sourceEntryPoint: SDK_SOURCE_ENTRY_POINT },
    repository,
    deployment: null,
    preflight: {
      status: "blocked",
      checks: [],
      allowedTransactionHash: null,
      deniedTransactionHash: null,
      d3Checks: [],
    },
    dashboard: { status: "pending", reason: "deployed_dashboard_acceptance_pending" },
    failure: invalidInputs.length > 0 ? "configuration_invalid" : "configuration_missing",
    ...(missingInputs.length > 0 ? { missingInputs: [...missingInputs] } : {}),
    ...(invalidInputs.length > 0 ? { invalidInputs: [...invalidInputs] } : {}),
    execution: null,
    replay: null,
    denial: null,
  };
}

async function observeWithSdk({
  client,
  dependencies,
  identity,
  initialResult,
  timeoutMs,
  maxAttempts,
  initialDelayMs,
  maxDelayMs,
  correlationId,
}) {
  if (
    initialResult.status === "succeeded" ||
    initialResult.status === "failed" ||
    initialResult.status === "cancelled"
  ) {
    return { ok: true, result: initialResult, maxAttempts: 0 };
  }
  try {
    const result = await invokeSdk(dependencies, () =>
      client.gas.waitForResult(identity, {
        timeoutMs,
        maxAttempts,
        initialDelayMs,
        maxDelayMs,
        correlationId,
      }),
    );
    return { ok: true, result, maxAttempts };
  } catch (error) {
    if (error instanceof VeloGasWaitError) {
      return { ok: false, code: `sdk_wait_${error.reason}`, result: null, maxAttempts };
    }
    return {
      ok: false,
      code: `sdk_observation_${sdkFailureCode(error)}`,
      result: null,
      maxAttempts,
    };
  }
}

async function sdkReplay({
  client,
  dependencies,
  identity,
  transactionXdr,
  correlationId,
  timeoutMs,
}) {
  try {
    const result = await invokeSdk(dependencies, () =>
      client.gas.submit({ ...identity, transactionXdr }, { correlationId, timeoutMs }),
    );
    return { ok: true, result };
  } catch (error) {
    if (
      error instanceof VeloGasSubmissionUnknownError &&
      isIdentity(error.recovery, identity.transactionHash)
    ) {
      try {
        const result = await invokeSdk(dependencies, () =>
          client.gas.getStatus(error.recovery, { correlationId, timeoutMs }),
        );
        return { ok: true, result };
      } catch (recoveryError) {
        return { ok: false, code: `sdk_replay_${sdkFailureCode(recoveryError)}` };
      }
    }
    return { ok: false, code: `sdk_replay_${sdkFailureCode(error)}` };
  }
}

async function sdkDenial({
  client,
  dependencies,
  transactionXdr,
  idempotencyKey,
  correlationId,
  timeoutMs,
}) {
  try {
    const value = await invokeSdk(dependencies, () =>
      client.gas.sponsor(transactionXdr, { idempotencyKey, correlationId, timeoutMs }),
    );
    return { kind: "reservation", httpStatus: 200, code: "unexpected_success", value };
  } catch (error) {
    return {
      kind: "error",
      httpStatus: error instanceof VeloError ? (error.status ?? null) : null,
      code: apiErrorCode(error),
    };
  }
}

async function recheckFreshness(config, dependencies, facts) {
  if (isExpiredInvocation({ ok: true, value: facts }, dependencies.now)) {
    return { ok: false, code: "denied_invocation_expired", rechecked: true };
  }
  try {
    const result = await dependencies.probeTransaction(config, facts.transactionHash);
    if (result?.ok === true && result.value?.status === "not_found")
      return { ok: true, rechecked: true };
    if (result?.ok === true && result.value?.status === "found") {
      return { ok: false, code: "denied_transaction_already_submitted", rechecked: true };
    }
    return {
      ok: false,
      code: result?.code ?? "denied_transaction_status_unavailable",
      rechecked: true,
    };
  } catch {
    return { ok: false, code: "denied_transaction_status_unavailable", rechecked: true };
  }
}

function emptyExecution(operationId) {
  return {
    operationId,
    sdkReceipt: null,
    backend: null,
    recovery: { attempted: false, reason: null, identityOnly: false, resubmitted: false },
    observation: null,
    timing: null,
  };
}

function emptyDenial(transactionHash, freshnessRechecked) {
  return {
    transactionHash,
    expectedCode: "contract_not_whitelisted",
    returnedCode: null,
    httpStatus: null,
    freshnessRechecked,
    noExecutionAttempt: false,
    noReservedExposure: false,
    accountingUnchanged: false,
    status: "incomplete",
  };
}

function projectSdkReceipt(value) {
  if (!isRecord(value)) return null;
  return {
    requestId: value.requestId ?? null,
    innerTransactionHash: value.transactionHash ?? null,
    outerTransactionHash: value.outerTransactionHash ?? null,
    status: value.status ?? null,
    reservedStroops: value.reservedStroops ?? null,
    actualFeeStroops: value.actualFeeStroops ?? null,
    reconciliationRequired: value.reconciliationRequired ?? null,
  };
}

function projectBackendEvidence(value) {
  return {
    requestId: value.requestId,
    innerTransactionHash: value.innerTransactionHash,
    outerTransactionHash: value.outerTransactionHash,
    status: value.status,
    sendCount: value.sendCount,
    reservedStroops: value.reservedStroops,
    chargedStroops: value.chargedStroops,
    actualFeeStroops: value.actualFeeStroops,
    reconciliationRequired: false,
    feeSource: value.feeSource,
    ledger: value.ledger,
    resultCode: value.resultCode,
    innerResultCode: value.innerResultCode,
    accounting: value.accounting,
  };
}

function verifyExecution(value, failures) {
  if (
    !isRecord(value) ||
    !sameKeys(value, ["operationId", "sdkReceipt", "backend", "recovery", "observation", "timing"])
  )
    return false;
  if (
    !isSafeLabel(value.operationId) ||
    !verifyReceipt(value.sdkReceipt) ||
    !verifyBackend(value.backend)
  )
    return false;
  if (!sameExecutionIdentity(value.sdkReceipt, value.backend))
    failures.push("receipt_ledger_identity_mismatch");
  if (value.sdkReceipt.status !== "succeeded" || value.backend.status !== "succeeded")
    failures.push("execution_not_settled");
  if (
    !value.recovery ||
    !sameKeys(value.recovery, ["attempted", "reason", "identityOnly", "resubmitted"]) ||
    typeof value.recovery.attempted !== "boolean" ||
    typeof value.recovery.identityOnly !== "boolean" ||
    value.recovery.resubmitted !== false
  )
    return false;
  if (value.recovery.attempted && !isSafeLabel(value.recovery.reason)) return false;
  if (
    !value.observation ||
    !sameKeys(value.observation, ["initialStatus", "finalStatus", "maxAttempts"]) ||
    !EXECUTION_STATUSES.has(value.observation.initialStatus) ||
    value.observation.finalStatus !== "succeeded" ||
    !Number.isSafeInteger(value.observation.maxAttempts) ||
    value.observation.maxAttempts < 0
  )
    return false;
  if (
    !value.timing ||
    !sameKeys(value.timing, ["startedAt", "completedAt"]) ||
    !isTimestamp(value.timing.startedAt) ||
    !isTimestamp(value.timing.completedAt)
  )
    return false;
  return true;
}

function verifyReplay(value, execution) {
  if (
    !isRecord(value) ||
    !sameKeys(value, [
      "status",
      "sdkReceipt",
      "sameAttemptIdentity",
      "sameSendCount",
      "sameSettledFee",
      "sameAccounting",
      "sameReservedExposure",
    ])
  )
    return false;
  if (value.status !== "passed" || !verifyReceipt(value.sdkReceipt)) return false;
  for (const key of [
    "sameAttemptIdentity",
    "sameSendCount",
    "sameSettledFee",
    "sameAccounting",
    "sameReservedExposure",
  ]) {
    if (value[key] !== true) return false;
  }
  return (
    sameExecutionIdentity(value.sdkReceipt, execution?.backend) &&
    value.sdkReceipt.actualFeeStroops === execution?.sdkReceipt?.actualFeeStroops
  );
}

function verifyDenial(value) {
  return (
    isRecord(value) &&
    sameKeys(value, [
      "transactionHash",
      "expectedCode",
      "returnedCode",
      "httpStatus",
      "freshnessRechecked",
      "noExecutionAttempt",
      "noReservedExposure",
      "accountingUnchanged",
      "status",
    ]) &&
    isHash(value.transactionHash) &&
    value.expectedCode === "contract_not_whitelisted" &&
    value.returnedCode === "contract_not_whitelisted" &&
    value.httpStatus === 403 &&
    value.freshnessRechecked === true &&
    value.noExecutionAttempt === true &&
    value.noReservedExposure === true &&
    value.accountingUnchanged === true &&
    value.status === "passed"
  );
}

function verifyReceipt(value) {
  return (
    isRecord(value) &&
    sameKeys(value, [
      "requestId",
      "innerTransactionHash",
      "outerTransactionHash",
      "status",
      "reservedStroops",
      "actualFeeStroops",
      "reconciliationRequired",
    ]) &&
    isSafeLabel(value.requestId) &&
    isHash(value.innerTransactionHash) &&
    isHash(value.outerTransactionHash) &&
    value.status === "succeeded" &&
    isDecimal(value.reservedStroops) &&
    isDecimal(value.actualFeeStroops) &&
    value.reconciliationRequired === false
  );
}

function verifyBackend(value) {
  return (
    isRecord(value) &&
    sameKeys(value, [
      "requestId",
      "innerTransactionHash",
      "outerTransactionHash",
      "status",
      "sendCount",
      "reservedStroops",
      "chargedStroops",
      "actualFeeStroops",
      "reconciliationRequired",
      "feeSource",
      "ledger",
      "resultCode",
      "innerResultCode",
      "accounting",
    ]) &&
    isSafeLabel(value.requestId) &&
    isHash(value.innerTransactionHash) &&
    isHash(value.outerTransactionHash) &&
    value.status === "succeeded" &&
    Number.isSafeInteger(value.sendCount) &&
    value.sendCount >= 1 &&
    isDecimal(value.reservedStroops) &&
    isDecimal(value.chargedStroops) &&
    isDecimal(value.actualFeeStroops) &&
    value.reconciliationRequired === false &&
    isPublicKey(value.feeSource) &&
    Number.isSafeInteger(value.ledger) &&
    value.ledger > 0 &&
    value.resultCode === "txFeeBumpInnerSuccess" &&
    value.innerResultCode === "txSuccess" &&
    verifyAccounting(value.accounting)
  );
}

function verifyAccounting(value) {
  return (
    isRecord(value) &&
    sameKeys(value, [
      "accountingDayKey",
      "outstandingHoldsStroops",
      "dailyConfirmedSpendStroops",
    ]) &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.accountingDayKey) &&
    isDecimal(value.outstandingHoldsStroops) &&
    isDecimal(value.dailyConfirmedSpendStroops)
  );
}

function sameExecutionIdentity(receipt, backend) {
  return (
    isRecord(receipt) &&
    isRecord(backend) &&
    receipt.requestId === backend.requestId &&
    receipt.innerTransactionHash === backend.innerTransactionHash &&
    receipt.outerTransactionHash === backend.outerTransactionHash &&
    receipt.status === backend.status &&
    receipt.actualFeeStroops === backend.actualFeeStroops &&
    backend.chargedStroops === receipt.actualFeeStroops
  );
}

function verifySdkMetadata(value, failures, requireResolvedVersion = false) {
  if (
    !isRecord(value) ||
    !sameKeys(value, ["version", "sourceEntryPoint"]) ||
    (!isSafeLabel(value.version) && value.version !== "unresolved") ||
    value.sourceEntryPoint !== SDK_SOURCE_ENTRY_POINT
  ) {
    failures.push("sdk_metadata_shape_invalid");
    return false;
  }
  if (requireResolvedVersion && value.version === "unresolved") {
    failures.push("sdk_version_unresolved");
    return false;
  }
  return true;
}

function verifyRepository(value) {
  return (
    isRecord(value) &&
    sameKeys(value, ["before", "after"]) &&
    verifyRepositoryState(value.before) &&
    verifyRepositoryState(value.after)
  );
}

function verifyRepositoryState(value) {
  return (
    isRecord(value) &&
    sameKeys(value, ["head", "workingTree"]) &&
    (value.head === "unresolved" || COMMIT_PATTERN.test(value.head)) &&
    isRecord(value.workingTree) &&
    sameKeys(value.workingTree, ["status", "changedPathCount"]) &&
    ["clean", "modified", "unresolved"].includes(value.workingTree.status) &&
    (value.workingTree.changedPathCount === null ||
      (Number.isSafeInteger(value.workingTree.changedPathCount) &&
        value.workingTree.changedPathCount >= 0))
  );
}

function verifyDeployment(value) {
  return (
    isRecord(value) &&
    sameKeys(value, [
      "deploymentId",
      "environment",
      "network",
      "deployedSourceCommit",
      "provenanceVerified",
      "provenanceVerification",
    ]) &&
    isSafeLabel(value.deploymentId) &&
    (value.environment === "development" || value.environment === "production") &&
    value.network === "testnet" &&
    COMMIT_PATTERN.test(value.deployedSourceCommit) &&
    value.provenanceVerified === true &&
    isSafeLabel(value.provenanceVerification)
  );
}

function verifyD3Preflight(value) {
  if (
    !isRecord(value) ||
    !sameKeys(value, [
      "status",
      "checks",
      "allowedTransactionHash",
      "deniedTransactionHash",
      "d3Checks",
    ]) ||
    value.status !== "passed" ||
    !Array.isArray(value.checks) ||
    !Array.isArray(value.d3Checks)
  )
    return false;
  for (const check of [...value.checks, ...value.d3Checks]) {
    if (
      !isRecord(check) ||
      !sameKeys(check, ["name", "status"]) ||
      !isSafeLabel(check.name) ||
      check.status !== "passed"
    )
      return false;
  }
  if (
    !isHash(value.allowedTransactionHash) ||
    !isHash(value.deniedTransactionHash) ||
    value.allowedTransactionHash === value.deniedTransactionHash
  )
    return false;
  return true;
}

function addUnexpectedFieldFailure(failures, value, allowed, label) {
  if (!isRecord(value)) return;
  for (const key of Object.keys(value))
    if (!allowed.has(key)) failures.push(`${label}_unexpected_field`);
}

function sameKeys(value, keys) {
  if (!isRecord(value)) return false;
  const expected = new Set(keys);
  const actual = Object.keys(value);
  return actual.length === expected.size && actual.every((key) => expected.has(key));
}

function isIdentity(value, expectedTransactionHash) {
  return (
    isRecord(value) &&
    isSafeLabel(value.requestId) &&
    value.transactionHash === expectedTransactionHash &&
    isHash(value.transactionHash)
  );
}

function isHash(value) {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function isPublicKey(value) {
  return typeof value === "string" && /^[GC][A-Z2-7]{55}$/.test(value);
}

function isDecimal(value) {
  if (typeof value !== "string" || !DECIMAL_PATTERN.test(value) || value.length > 19) return false;
  try {
    return BigInt(value) <= 2n ** 63n - 1n;
  } catch {
    return false;
  }
}

function isSafeLabel(value) {
  return typeof value === "string" && SAFE_LABEL_PATTERN.test(value);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimestamp(value) {
  if (typeof value !== "string") return false;
  try {
    return value === new Date(value).toISOString();
  } catch {
    return false;
  }
}

function parseBoundedInteger(value, minimum, maximum) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function normalizeUrl(value, name) {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new Error(name);
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new Error(`${name} must use HTTPS without credentials or fragments`);
  }
}

function isLoopback(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

async function invokeSdk(dependencies, callback) {
  return dependencies.withSdkTransport(callback);
}

async function withTemporaryFetch(fetchImpl, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function readSdkMetadata(override) {
  if (override) return override;
  try {
    const packageJson = JSON.parse(await readFile(SDK_PACKAGE_JSON, "utf8"));
    return {
      version: typeof packageJson.version === "string" ? packageJson.version : "unresolved",
      sourceEntryPoint: SDK_SOURCE_ENTRY_POINT,
    };
  } catch {
    return { version: "unresolved", sourceEntryPoint: SDK_SOURCE_ENTRY_POINT };
  }
}

async function readD3Report(reportPath, cwd = repositoryRoot) {
  const resolvedPath = path.resolve(cwd, reportPath);
  const contents = await readFile(resolvedPath, "utf8");
  if (Buffer.byteLength(contents, "utf8") > MAX_REPORT_BYTES)
    throw new Error("D3 smoke report is too large");
  return JSON.parse(contents);
}

async function finishD3Report(report, dependencies) {
  return {
    ...report,
    completedAt: timestamp(dependencies.now),
    repository: {
      ...report.repository,
      after: await safeRepositoryState(dependencies.repositoryState),
    },
  };
}

function apiErrorCode(error) {
  return error instanceof VeloError &&
    typeof error.code === "string" &&
    SAFE_ERROR_CODES.has(error.code)
    ? error.code
    : "unexpected_api_error";
}

function sdkFailureCode(error) {
  if (error instanceof VeloGasSubmissionUnknownError) return `submission_unknown_${error.reason}`;
  if (error instanceof VeloGasWaitError) return `wait_${error.reason}`;
  if (
    error instanceof VeloError &&
    typeof error.code === "string" &&
    SAFE_ERROR_CODES.has(error.code)
  )
    return error.code;
  return "request_failed";
}

function sha256Hex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function timestamp(now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

async function safeRepositoryState(reader) {
  try {
    return await reader();
  } catch {
    return { head: "unresolved", workingTree: { status: "unresolved", changedPathCount: null } };
  }
}

function containsSensitiveData(value) {
  return /tk_(?:live|test)_[a-z0-9]+|transactionXdr|allowedXdr|deniedXdr|operatorToken|apiKey|secret|authorization|raw response|provider body|exception message|signed xdr/i.test(
    value,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exitCode = await main();
  } catch {
    console.error(
      "D3 smoke could not complete; no command output, credentials, XDR, or exception message was persisted.",
    );
    process.exitCode = 1;
  }
}
