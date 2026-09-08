#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseTestnetSorobanTransactionEnvelope } from "../packages/stellar/src/transaction-envelope.ts";
import {
  assertValidContractId,
  assertValidPublicKey,
  assertValidTransactionHash,
} from "../packages/stellar/src/validation.ts";
import { readRepositoryState } from "./gas-d2-qualification.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULT_REPORT_PATH = "docs/instawards/Velo-Instawards-Deliverable-2-Smoke-Run.json";
export const DEFAULT_DEPLOYMENT_NAME = "dev:capable-kingfisher-697";
export const TESTNET_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
export const SMOKE_REPORT_SCHEMA_VERSION = 1;
export const OPERATOR_SNAPSHOT_SCHEMA_VERSION = 1;
export const DEFAULT_POLL_LIMIT = 30;
export const DEFAULT_POLL_INTERVAL_MS = 10_000;
const MAX_OPERATOR_RESPONSE_BYTES = 256 * 1_024;
const MAX_REPORT_BYTES = 256 * 1_024;
const MAX_TIMEOUT_MS = 120_000;
const API_KEY_PATTERN = /^tk_live_[a-f0-9]{32}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const SAFE_LABEL_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const RESULT_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const EXECUTION_STATUSES = new Set([
  "claimed",
  "submission_unknown",
  "submitted",
  "succeeded",
  "failed",
  "cancelled",
]);
const SAFE_API_ERROR_CODES = new Set([
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
]);

const usage = `Run the D2 live Testnet smoke workflow.

Usage:
  node --experimental-strip-types scripts/gas-d2-smoke.mjs --mode preflight [--output <path>]
  node --experimental-strip-types scripts/gas-d2-smoke.mjs --mode execute [--output <path>]
  node --experimental-strip-types scripts/gas-d2-smoke.mjs --mode verify --report <path>

Modes:
  preflight  Validate private operator inputs and deployment readiness; never sponsor.
  execute    Run preflight, one allowed invocation, replay, and policy denial.
  verify     Validate a previously written sanitized report; never contact the deployment.

The execute/preflight modes read private values from environment variables or the
documented *_FILE alternatives. They never write those values, XDR, raw responses,
credentials, or exception messages to the report.
`;

export function parseSmokeArgs(values) {
  let mode = "preflight";
  let outputPath = DEFAULT_REPORT_PATH;
  let reportPath = null;
  let pollLimit = DEFAULT_POLL_LIMIT;
  let pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;

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
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed < 0) {
        throw new Error(`${argument} must be a non-negative safe integer`);
      }
      if (argument === "--poll-limit") pollLimit = parsed;
      else pollIntervalMs = parsed;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${argument}`);
  }

  return { help: false, mode, outputPath, reportPath, pollLimit, pollIntervalMs };
}

export async function loadSmokeConfig(
  env = process.env,
  { readPrivateFile = (filePath) => readFile(filePath, "utf8") } = {},
) {
  const mode = env.VELO_GAS_D2_MODE ?? "preflight";
  const missing = [];
  const readInput = async (name, fileName) => {
    const direct = env[name];
    if (typeof direct === "string" && direct.trim() !== "") return direct.trim();
    const filePath = env[fileName];
    if (typeof filePath !== "string" || filePath.trim() === "") {
      missing.push(name);
      return null;
    }
    try {
      const value = await readPrivateFile(filePath.trim());
      if (typeof value !== "string" || value.trim() === "") missing.push(name);
      return typeof value === "string" ? value.trim() : null;
    } catch {
      missing.push(name);
      return null;
    }
  };

  const apiOrigin = env.VELO_GAS_D2_API_ORIGIN?.trim() || null;
  const projectId = env.VELO_GAS_D2_PROJECT_ID?.trim() || null;
  const rpcUrl = env.VELO_GAS_D2_RPC_URL?.trim() || null;
  const snapshotUrl = env.VELO_GAS_D2_OPERATOR_SNAPSHOT_URL?.trim() || null;
  const provenanceUrl = env.VELO_GAS_D2_PROVENANCE_URL?.trim() || null;
  const operatorToken = env.VELO_GAS_D2_OPERATOR_TOKEN?.trim() || null;
  const apiKey =
    mode === "preflight"
      ? null
      : await readInput("VELO_GAS_D2_API_KEY", "VELO_GAS_D2_API_KEY_FILE");
  const allowedXdr = await readInput("VELO_GAS_D2_ALLOWED_XDR", "VELO_GAS_D2_ALLOWED_XDR_FILE");
  const deniedXdr = await readInput("VELO_GAS_D2_DENIED_XDR", "VELO_GAS_D2_DENIED_XDR_FILE");

  for (const [name, value] of [
    ["VELO_GAS_D2_API_ORIGIN", apiOrigin],
    ["VELO_GAS_D2_PROJECT_ID", projectId],
    ["VELO_GAS_D2_RPC_URL", rpcUrl],
    ["VELO_GAS_D2_OPERATOR_SNAPSHOT_URL", snapshotUrl],
    ["VELO_GAS_D2_PROVENANCE_URL", provenanceUrl],
    ["VELO_GAS_D2_OPERATOR_TOKEN", operatorToken],
  ]) {
    if (!value) missing.push(name);
  }

  return {
    ok: missing.length === 0,
    missing: [...new Set(missing)],
    config: {
      mode,
      apiOrigin,
      apiKey,
      projectId,
      rpcUrl,
      snapshotUrl,
      provenanceUrl,
      operatorToken,
      allowedXdr,
      deniedXdr,
      deploymentName: env.VELO_GAS_D2_DEPLOYMENT_NAME?.trim() || DEFAULT_DEPLOYMENT_NAME,
      expectedSourceCommit: env.VELO_GAS_D2_EXPECTED_SOURCE_COMMIT?.trim() || null,
      timeoutMs: boundedInteger(env.VELO_GAS_D2_TIMEOUT_MS, 30_000, 1_000, MAX_TIMEOUT_MS),
      pollLimit: boundedInteger(env.VELO_GAS_D2_POLL_LIMIT, DEFAULT_POLL_LIMIT, 0, 120),
      pollIntervalMs: boundedInteger(
        env.VELO_GAS_D2_POLL_INTERVAL_MS,
        DEFAULT_POLL_INTERVAL_MS,
        0,
        60_000,
      ),
    },
  };
}

export function createSmokeDependencies({
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  wait = defaultWait,
  repositoryState = () => readRepositoryState(repositoryRoot),
} = {}) {
  return {
    fetchImpl,
    now,
    wait,
    repositoryState,
    readSnapshot: (config, scope) => readOperatorSnapshot(config, scope, { fetchImpl }),
    readProvenance: (config) => readDeploymentProvenance(config, { fetchImpl }),
    probeNetwork: (config) => probeTestnetNetwork(config, { fetchImpl }),
    deriveFacts: deriveFactsFromXdr,
  };
}

export async function runPreflight({ config, dependencies = createSmokeDependencies() }) {
  const startedAt = timestamp(dependencies.now);
  const checks = [];
  const facts = {
    allowed: await deriveFactsSafely(config?.allowedXdr, dependencies.deriveFacts),
    denied: await deriveFactsSafely(config?.deniedXdr, dependencies.deriveFacts),
  };

  addCheck(checks, "allowed_invocation_valid", facts.allowed.ok, facts.allowed.code);
  addCheck(checks, "denied_invocation_valid", facts.denied.ok, facts.denied.code);

  let snapshot = null;
  let provenance = null;
  let network = null;
  if (facts.allowed.ok && facts.denied.ok && config) {
    const snapshotRead = await safelyRead(() =>
      dependencies.readSnapshot(config, { phase: "preflight" }),
    );
    snapshot = snapshotRead.ok
      ? isNormalizedSnapshot(snapshotRead.value)
        ? snapshotRead
        : normalizeSnapshot(snapshotRead.value, { phase: "preflight", projectId: config.projectId })
      : snapshotRead;
    const provenanceRead = await safelyRead(() => dependencies.readProvenance(config));
    provenance = provenanceRead.ok
      ? isNormalizedProvenance(provenanceRead.value)
        ? provenanceRead
        : normalizeProvenance(provenanceRead.value, config)
      : provenanceRead;
    network = await safelyRead(() => dependencies.probeNetwork(config));
  }

  addCheck(checks, "operator_snapshot_available", snapshot?.ok === true, snapshot?.code);
  addCheck(
    checks,
    "deployment_identity",
    snapshot?.ok === true &&
      snapshot.value.deployment.deploymentId === config.deploymentName &&
      snapshot.value.deployment.environment === "development",
    "deployment_identity_mismatch",
  );
  addCheck(
    checks,
    "backend_signer_ready",
    snapshot?.ok === true && snapshot.value.signer.status === "ready",
    "signer_not_ready",
  );
  addCheck(
    checks,
    "testnet_custody_and_funding",
    snapshot?.ok === true &&
      snapshot.value.signer.network === "testnet" &&
      snapshot.value.signer.funded &&
      snapshot.value.user.funded,
    "funding_not_verified",
  );
  addCheck(
    checks,
    "testnet_rpc_network",
    network?.ok === true && network.value.passphrase === TESTNET_NETWORK_PASSPHRASE,
    network?.code ?? "wrong_network",
  );
  addCheck(
    checks,
    "source_provenance_verified",
    provenance?.ok === true && provenance.value.verified,
    provenance?.code ?? "source_provenance_unverified",
  );

  const policy = snapshot?.ok === true ? snapshot.value.policy : null;
  const allowedTarget = facts.allowed.ok ? facts.allowed.value.targetContractIds[0] : null;
  const deniedTarget = facts.denied.ok ? facts.denied.value.targetContractIds[0] : null;
  addCheck(
    checks,
    "allowed_policy_eligible",
    Boolean(
      policy?.enabled &&
      policy.network === "testnet" &&
      allowedTarget &&
      policy.allowedContractIds.includes(allowedTarget),
    ),
    "allowed_policy_denied",
  );
  addCheck(
    checks,
    "denied_target_not_whitelisted",
    Boolean(policy && deniedTarget && !policy.allowedContractIds.includes(deniedTarget)),
    "denied_target_is_whitelisted",
  );
  addCheck(
    checks,
    "user_wallet_matches_invocations",
    Boolean(
      snapshot?.ok === true &&
      facts.allowed.ok &&
      facts.denied.ok &&
      snapshot.value.user.publicKey === facts.allowed.value.sourceWallet &&
      snapshot.value.user.publicKey === facts.denied.value.sourceWallet,
    ),
    "user_wallet_mismatch",
  );
  addCheck(
    checks,
    "distinct_test_transactions",
    facts.allowed.ok &&
      facts.denied.ok &&
      facts.allowed.value.transactionHash !== facts.denied.value.transactionHash,
    "transaction_identity_collision",
  );

  const ok = checks.every((check) => check.status === "passed");
  return {
    ok,
    startedAt,
    completedAt: timestamp(dependencies.now),
    checks,
    facts: ok ? { allowed: facts.allowed.value, denied: facts.denied.value } : null,
    deployment: ok ? summarizeDeployment(snapshot.value, provenance.value) : null,
    snapshot: ok ? snapshot.value : null,
    provenance: ok ? provenance.value : null,
  };
}

export async function runSmokeExecution({
  config,
  dependencies = createSmokeDependencies(),
  pollLimit = config?.pollLimit ?? DEFAULT_POLL_LIMIT,
  pollIntervalMs = config?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
}) {
  const startedAt = timestamp(dependencies.now);
  const repositoryBefore = await safeRepositoryState(dependencies.repositoryState);
  const preflight = await runPreflight({ config, dependencies });
  const base = {
    schemaVersion: SMOKE_REPORT_SCHEMA_VERSION,
    mode: "execute",
    startedAt,
    repository: { before: repositoryBefore },
    deployment: preflight.deployment,
    preflight: summarizePreflight(preflight),
  };

  if (!preflight.ok) {
    return await finishReport(
      { ...base, status: "incomplete", failure: "preflight_failed" },
      dependencies,
    );
  }
  if (!config?.apiKey || !API_KEY_PATTERN.test(config.apiKey)) {
    return await finishReport(
      { ...base, status: "incomplete", failure: "api_credentials_unavailable" },
      dependencies,
    );
  }

  const runId = randomUUID();
  const allowedIdempotencyKey = `d2-smoke-${runId}-allowed`;
  const deniedIdempotencyKey = `d2-smoke-${runId}-denied`;
  const allowedIdempotencyKeyHash = sha256Hex(allowedIdempotencyKey);
  const deniedIdempotencyKeyHash = sha256Hex(deniedIdempotencyKey);
  const allowedFacts = preflight.facts.allowed;
  const deniedFacts = preflight.facts.denied;
  const allowedSponsor = await callGasRoute(config, "/api/gas/sponsor", {
    idempotencyKey: allowedIdempotencyKey,
    correlationId: `d2-${runId}-allowed-sponsor`,
    body: { transactionXdr: config.allowedXdr },
    expected: "sponsor",
    dependencies,
  });
  if (allowedSponsor.kind !== "reservation") {
    return await finishReport(
      { ...base, status: "incomplete", failure: allowedSponsor.code },
      dependencies,
    );
  }
  if (allowedSponsor.value.transactionHash !== allowedFacts.transactionHash) {
    return await finishReport(
      { ...base, status: "incomplete", failure: "sponsor_hash_mismatch" },
      dependencies,
    );
  }

  const requestId = allowedSponsor.value.requestId;
  const initialSubmit = await callGasRoute(config, "/api/gas/submit", {
    correlationId: `d2-${runId}-allowed-submit`,
    body: {
      requestId,
      transactionHash: allowedFacts.transactionHash,
      transactionXdr: config.allowedXdr,
    },
    expected: "submit",
    dependencies,
  });
  const execution = await pollExecution({
    config,
    dependencies,
    initialSubmit,
    requestId,
    transactionHash: allowedFacts.transactionHash,
    pollLimit,
    pollIntervalMs,
    runId,
  });
  if (!execution.ok) {
    return await finishReport(
      {
        ...base,
        status: "incomplete",
        failure: execution.code,
        execution: summarizeExecutionAttempt(
          execution.dto,
          requestId,
          allowedFacts.transactionHash,
        ),
      },
      dependencies,
    );
  }

  const settledSnapshotResult = await readScopedSnapshot(config, dependencies, {
    phase: "after-settlement",
    requestId,
    transactionHash: allowedFacts.transactionHash,
    idempotencyKeyHash: allowedIdempotencyKeyHash,
  });
  if (!settledSnapshotResult.ok) {
    return await finishReport(
      { ...base, status: "incomplete", failure: settledSnapshotResult.code },
      dependencies,
    );
  }
  const settledEvidence = correlateSettledExecution(execution.dto, settledSnapshotResult.value);
  if (!settledEvidence.ok) {
    return await finishReport(
      { ...base, status: "incomplete", failure: settledEvidence.code },
      dependencies,
    );
  }

  const beforeReplay = await readScopedSnapshot(config, dependencies, {
    phase: "before-replay",
    requestId,
    transactionHash: allowedFacts.transactionHash,
    idempotencyKeyHash: allowedIdempotencyKeyHash,
  });
  if (!beforeReplay.ok) {
    return await finishReport(
      { ...base, status: "incomplete", failure: beforeReplay.code },
      dependencies,
    );
  }
  const replay = await callGasRoute(config, "/api/gas/submit", {
    correlationId: `d2-${runId}-allowed-replay`,
    body: {
      requestId,
      transactionHash: allowedFacts.transactionHash,
      transactionXdr: config.allowedXdr,
    },
    expected: "submit",
    dependencies,
  });
  const afterReplay = await readScopedSnapshot(config, dependencies, {
    phase: "after-replay",
    requestId,
    transactionHash: allowedFacts.transactionHash,
    idempotencyKeyHash: allowedIdempotencyKeyHash,
  });
  const replayComparison =
    replay.kind === "execution" && afterReplay.ok
      ? compareReplaySnapshots(beforeReplay.value, afterReplay.value, replay.value, execution.dto)
      : {
          ok: false,
          sameAttemptIdentity: false,
          sameSendCount: false,
          sameSettledFee: false,
          sameAccounting: false,
          code: replay.code ?? afterReplay.code,
        };

  const denialBefore = await readScopedSnapshot(config, dependencies, {
    phase: "before-denial",
    transactionHash: deniedFacts.transactionHash,
    idempotencyKeyHash: deniedIdempotencyKeyHash,
  });
  if (!denialBefore.ok) {
    return await finishReport(
      { ...base, status: "incomplete", failure: denialBefore.code },
      dependencies,
    );
  }
  const deniedSponsor = await callGasRoute(config, "/api/gas/sponsor", {
    idempotencyKey: deniedIdempotencyKey,
    correlationId: `d2-${runId}-denied-sponsor`,
    body: { transactionXdr: config.deniedXdr },
    expected: "sponsor",
    dependencies,
  });
  const denialAfter = await readScopedSnapshot(config, dependencies, {
    phase: "after-denial",
    transactionHash: deniedFacts.transactionHash,
    idempotencyKeyHash: deniedIdempotencyKeyHash,
  });
  const denialVerification =
    denialAfter.ok && deniedSponsor.kind === "error"
      ? verifyPolicyDenial(
          deniedSponsor,
          denialBefore.value,
          denialAfter.value,
          deniedFacts.transactionHash,
        )
      : { ok: false, code: deniedSponsor.code ?? denialAfter.code };

  const report = {
    ...base,
    status:
      settledEvidence.ok && replayComparison.ok && denialVerification.ok ? "passed" : "incomplete",
    ...(settledEvidence.ok ? { execution: settledEvidence.value } : {}),
    replay: {
      httpStatus: replay.kind === "execution" ? replay.httpStatus : null,
      sameAttemptIdentity: replayComparison.sameAttemptIdentity,
      sameSendCount: replayComparison.sameSendCount,
      sameSettledFee: replayComparison.sameSettledFee,
      sameAccounting: replayComparison.sameAccounting,
      status: replayComparison.ok ? "passed" : "incomplete",
    },
    denial: {
      transactionHash: deniedFacts.transactionHash,
      expectedCode: "contract_not_whitelisted",
      returnedCode: deniedSponsor.kind === "error" ? deniedSponsor.code : null,
      httpStatus: deniedSponsor.httpStatus ?? null,
      noExecutionAttempt: denialVerification.noExecutionAttempt ?? false,
      noReservedExposure: denialVerification.noReservedExposure ?? false,
      accountingUnchanged: denialVerification.accountingUnchanged ?? false,
      status: denialVerification.ok ? "passed" : "incomplete",
    },
  };
  return await finishReport(report, dependencies);
}

export function verifySmokeReport(report) {
  const failures = [];
  if (!isRecord(report) || report.schemaVersion !== SMOKE_REPORT_SCHEMA_VERSION)
    failures.push("invalid_report_schema");
  if (report?.status !== "passed") failures.push("report_not_passed");
  if (
    !isRecord(report?.deployment) ||
    report.deployment.network !== "testnet" ||
    !report.deployment.provenanceVerified ||
    !COMMIT_PATTERN.test(report.deployment.deployedSourceCommit)
  )
    failures.push("deployment_evidence_missing");
  if (
    report?.preflight?.status !== "passed" ||
    !Array.isArray(report.preflight.checks) ||
    report.preflight.checks.some((check) => check?.status !== "passed")
  )
    failures.push("preflight_evidence_invalid");
  if (!isRecord(report?.execution)) failures.push("execution_evidence_missing");
  if (
    report?.execution &&
    (!nonEmpty(report.execution.requestId) ||
      report.execution.status !== "succeeded" ||
      !Number.isSafeInteger(report.execution.sendCount) ||
      report.execution.sendCount < 1 ||
      !isHash(report.execution.innerTransactionHash) ||
      !isHash(report.execution.outerTransactionHash) ||
      !isPublicKey(report.execution.feeSource) ||
      !isDecimal(report.execution.reservedStroops) ||
      !isDecimal(report.execution.chargedStroops) ||
      !Number.isSafeInteger(report.execution.ledger) ||
      report.execution.ledger <= 0 ||
      report.execution.resultCode !== "txFeeBumpInnerSuccess" ||
      report.execution.innerResultCode !== "txSuccess")
  )
    failures.push("ledger_evidence_invalid");
  if (
    report?.execution &&
    report.execution.explorerUrl !==
      `https://stellar.expert/explorer/testnet/tx/${report.execution.outerTransactionHash}`
  )
    failures.push("explorer_link_mismatch");
  if (
    report?.replay?.status !== "passed" ||
    !report.replay.sameAttemptIdentity ||
    !report.replay.sameSendCount ||
    !report.replay.sameSettledFee ||
    !report.replay.sameAccounting
  )
    failures.push("replay_evidence_invalid");
  if (
    report?.denial?.status !== "passed" ||
    !isHash(report.denial.transactionHash) ||
    report.denial.returnedCode !== "contract_not_whitelisted" ||
    !report.denial.noExecutionAttempt ||
    !report.denial.noReservedExposure ||
    !report.denial.accountingUnchanged
  )
    failures.push("denial_evidence_invalid");
  const serialized = JSON.stringify(report);
  if (containsSensitiveData(serialized)) failures.push("sensitive_data_present");
  return { ok: failures.length === 0, failures };
}

async function finishReport(report, dependencies) {
  const repositoryAfter = await safeRepositoryState(dependencies.repositoryState);
  const completedAt = timestamp(dependencies.now);
  const safeReport = {
    ...report,
    completedAt,
    repository: { ...report.repository, after: repositoryAfter },
  };
  return safeReport;
}

async function pollExecution({
  config,
  dependencies,
  initialSubmit,
  requestId,
  transactionHash,
  pollLimit,
  pollIntervalMs,
  runId,
}) {
  let response = initialSubmit;
  for (let attempt = 0; attempt <= pollLimit; attempt += 1) {
    if (response.kind === "execution") {
      const dto = response.value;
      if (dto.status === "succeeded") {
        if (
          dto.outerTransactionHash &&
          dto.actualFeeStroops !== null &&
          !dto.reconciliationRequired
        )
          return { ok: true, dto };
        return { ok: false, code: "settlement_evidence_incomplete", dto };
      }
      if (dto.status === "failed" || dto.status === "cancelled")
        return { ok: false, code: "execution_not_successful", dto };
    } else if (
      response.kind === "error" &&
      response.code !== "dependency_unavailable" &&
      response.code !== "handoff_unavailable"
    ) {
      return { ok: false, code: response.code };
    }
    if (attempt === pollLimit)
      return {
        ok: false,
        code: "polling_exhausted",
        dto: response.kind === "execution" ? response.value : null,
      };
    await dependencies.wait(pollIntervalMs);
    response = await callGasRoute(config, "/api/gas/submit", {
      correlationId: `d2-${runId}-allowed-poll-${attempt + 1}`,
      body: { requestId, transactionHash },
      expected: "submit",
      dependencies,
    });
  }
  return { ok: false, code: "polling_exhausted" };
}

async function readScopedSnapshot(config, dependencies, scope) {
  const result = await safelyRead(() => dependencies.readSnapshot(config, scope));
  if (!result.ok) return result;
  if (isNormalizedSnapshot(result.value)) return result;
  const normalized = normalizeSnapshot(result.value, { ...scope, projectId: config.projectId });
  return normalized.ok ? normalized : { ok: false, code: normalized.code };
}

async function callGasRoute(
  config,
  route,
  { body, correlationId, idempotencyKey, expected, dependencies },
) {
  const headers = {
    accept: "application/json",
    authorization: `Bearer ${config.apiKey}`,
    "content-type": "application/json",
    "x-correlation-id": correlationId,
    ...(idempotencyKey === undefined ? {} : { "idempotency-key": idempotencyKey }),
  };
  const result = await boundedFetchJson(
    dependencies.fetchImpl,
    `${config.apiOrigin}${route}`,
    { method: "POST", headers, body: JSON.stringify(body) },
    config.timeoutMs,
  );
  if (!result.ok) return { kind: "transport_error", code: result.code };
  if (result.status >= 400) {
    const error = normalizeApiError(result.value);
    return {
      kind: "error",
      httpStatus: result.status,
      code: error.code,
      requestId: error.requestId,
    };
  }
  if (expected === "sponsor") {
    const reservation = normalizeReservation(result.value);
    return reservation.ok
      ? { kind: "reservation", httpStatus: result.status, value: reservation.value }
      : { kind: "malformed", code: reservation.code };
  }
  const execution = normalizeExecutionDto(result.value);
  return execution.ok
    ? { kind: "execution", httpStatus: result.status, value: execution.value }
    : { kind: "malformed", code: execution.code };
}

async function readOperatorSnapshot(config, scope, { fetchImpl }) {
  const url = scopedUrl(config.snapshotUrl, { projectId: config.projectId, ...scope });
  const result = await boundedFetchJson(
    fetchImpl,
    url,
    {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${config.operatorToken}`,
        "x-gas-d2-purpose": "smoke-evidence",
      },
    },
    config.timeoutMs,
  );
  if (!result.ok) return result;
  if (result.status !== 200) return { ok: false, code: "operator_snapshot_unavailable" };
  return normalizeSnapshot(result.value, { ...scope, projectId: config.projectId });
}

async function readDeploymentProvenance(config, { fetchImpl }) {
  const url = scopedUrl(config.provenanceUrl, {
    projectId: config.projectId,
    deploymentId: config.deploymentName,
  });
  const result = await boundedFetchJson(
    fetchImpl,
    url,
    {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${config.operatorToken}`,
        "x-gas-d2-purpose": "source-provenance",
      },
    },
    config.timeoutMs,
  );
  if (!result.ok) return result;
  if (result.status !== 200) return { ok: false, code: "source_provenance_unavailable" };
  return normalizeProvenance(result.value, config);
}

async function probeTestnetNetwork(config, { fetchImpl }) {
  const result = await boundedFetchJson(
    fetchImpl,
    config.rpcUrl,
    {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getNetwork", params: {} }),
    },
    config.timeoutMs,
  );
  if (!result.ok) return result;
  const passphrase = result.value?.result?.passphrase ?? result.value?.result?.networkPassphrase;
  return typeof passphrase === "string"
    ? { ok: true, value: { passphrase } }
    : { ok: false, code: "malformed_network_response" };
}

function normalizeSnapshot(value, expectedScope) {
  if (!isRecord(value) || value.schemaVersion !== OPERATOR_SNAPSHOT_SCHEMA_VERSION)
    return { ok: false, code: "malformed_operator_snapshot" };
  if (
    !isRecord(value.scope) ||
    value.scope.projectId !== expectedScope.projectId ||
    value.scope.phase !== expectedScope.phase
  )
    return { ok: false, code: "operator_scope_mismatch" };
  for (const field of ["requestId", "transactionHash", "idempotencyKeyHash"]) {
    if (expectedScope[field] !== undefined && value.scope[field] !== expectedScope[field])
      return { ok: false, code: "operator_scope_mismatch" };
  }
  if (
    !isRecord(value.deployment) ||
    !isSafeLabel(value.deployment.deploymentId) ||
    !isSafeLabel(value.deployment.environment) ||
    value.deployment.network !== "testnet"
  )
    return { ok: false, code: "malformed_deployment_snapshot" };
  if (
    !isRecord(value.signer) ||
    !isPublicKey(value.signer.publicKey) ||
    (value.signer.status !== "ready" && value.signer.status !== "disabled") ||
    value.signer.network !== "testnet" ||
    typeof value.signer.funded !== "boolean" ||
    !isPositiveDecimal(value.signer.balanceStroops)
  )
    return { ok: false, code: "malformed_signer_snapshot" };
  if (
    !isRecord(value.user) ||
    !isPublicKey(value.user.publicKey) ||
    typeof value.user.funded !== "boolean" ||
    !isPositiveDecimal(value.user.balanceStroops)
  )
    return { ok: false, code: "malformed_user_snapshot" };
  if (
    !isRecord(value.policy) ||
    typeof value.policy.enabled !== "boolean" ||
    value.policy.network !== "testnet" ||
    !Array.isArray(value.policy.allowedContractIds) ||
    value.policy.allowedContractIds.some((id) => !isContractId(id))
  )
    return { ok: false, code: "malformed_policy_snapshot" };
  if (
    !isRecord(value.accounting) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value.accounting.accountingDayKey) ||
    !isDecimal(value.accounting.outstandingHoldsStroops) ||
    !isDecimal(value.accounting.dailyConfirmedSpendStroops)
  )
    return { ok: false, code: "malformed_accounting_snapshot" };
  const execution = normalizeSnapshotExecution(value.execution);
  if (!execution.ok) return execution;
  const decision = normalizeSnapshotDecision(value.decision);
  if (!decision.ok) return decision;
  if (!isDecimal(value.reservedExposureStroops))
    return { ok: false, code: "malformed_exposure_snapshot" };
  return {
    ok: true,
    value: {
      scope: {
        projectId: value.scope.projectId,
        phase: value.scope.phase,
        ...(value.scope.requestId ? { requestId: value.scope.requestId } : {}),
        ...(value.scope.transactionHash ? { transactionHash: value.scope.transactionHash } : {}),
        ...(value.scope.idempotencyKeyHash
          ? { idempotencyKeyHash: value.scope.idempotencyKeyHash }
          : {}),
      },
      deployment: {
        deploymentId: value.deployment.deploymentId,
        environment: value.deployment.environment,
        network: value.deployment.network,
      },
      signer: {
        status: value.signer.status,
        network: value.signer.network,
        publicKey: value.signer.publicKey,
        funded: value.signer.funded,
      },
      user: { publicKey: value.user.publicKey, funded: value.user.funded },
      policy: {
        enabled: value.policy.enabled,
        network: value.policy.network,
        allowedContractIds: [...value.policy.allowedContractIds],
      },
      accounting: {
        accountingDayKey: value.accounting.accountingDayKey,
        outstandingHoldsStroops: value.accounting.outstandingHoldsStroops,
        dailyConfirmedSpendStroops: value.accounting.dailyConfirmedSpendStroops,
      },
      execution: execution.value,
      decision: decision.value,
      reservedExposureStroops: value.reservedExposureStroops,
    },
  };
}

function isNormalizedSnapshot(value) {
  return (
    isRecord(value) &&
    value.schemaVersion === undefined &&
    isRecord(value.scope) &&
    isRecord(value.deployment) &&
    isRecord(value.signer) &&
    isRecord(value.accounting) &&
    Object.prototype.hasOwnProperty.call(value, "reservedExposureStroops")
  );
}

function isNormalizedProvenance(value) {
  return (
    isRecord(value) &&
    value.schemaVersion === undefined &&
    value.verified === true &&
    COMMIT_PATTERN.test(value.deployedSourceCommit) &&
    isSafeLabel(value.deploymentId)
  );
}

function normalizeSnapshotExecution(value) {
  if (value === null) return { ok: true, value: null };
  if (
    !isRecord(value) ||
    !isSafeLabel(value.requestId) ||
    !isHash(value.innerTransactionHash) ||
    (value.outerTransactionHash !== null && !isHash(value.outerTransactionHash)) ||
    !EXECUTION_STATUSES.has(value.status) ||
    !Number.isSafeInteger(value.sendCount) ||
    value.sendCount < 0 ||
    !isDecimal(value.reservedStroops) ||
    (value.actualFeeStroops !== null && !isDecimal(value.actualFeeStroops)) ||
    typeof value.reconciliationRequired !== "boolean" ||
    (value.feeSource !== null && !isPublicKey(value.feeSource))
  )
    return { ok: false, code: "malformed_execution_snapshot" };
  const evidence =
    value.ledgerEvidence === null ? null : normalizeLedgerEvidence(value.ledgerEvidence);
  if (value.ledgerEvidence !== null && !evidence.ok) return evidence;
  return {
    ok: true,
    value: {
      requestId: value.requestId,
      innerTransactionHash: value.innerTransactionHash,
      outerTransactionHash: value.outerTransactionHash,
      status: value.status,
      sendCount: value.sendCount,
      reservedStroops: value.reservedStroops,
      actualFeeStroops: value.actualFeeStroops,
      reconciliationRequired: value.reconciliationRequired,
      feeSource: value.feeSource,
      ledgerEvidence: evidence?.value ?? null,
    },
  };
}

function normalizeSnapshotDecision(value) {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (
    !isRecord(value) ||
    (value.decisionCode !== "reserved" && value.decisionCode !== "rejected") ||
    (value.rejectionCode !== null && typeof value.rejectionCode !== "string") ||
    !isDecimal(value.reservedExposureStroops)
  )
    return { ok: false, code: "malformed_decision_snapshot" };
  return {
    ok: true,
    value: {
      decisionCode: value.decisionCode,
      rejectionCode: value.rejectionCode,
      reservedExposureStroops: value.reservedExposureStroops,
    },
  };
}

function normalizeLedgerEvidence(value) {
  if (
    !isRecord(value) ||
    !isHash(value.outerTransactionHash) ||
    !isHash(value.innerTransactionHash) ||
    !isPublicKey(value.feeSource) ||
    !Number.isSafeInteger(value.ledger) ||
    value.ledger <= 0 ||
    !isDecimal(value.chargedStroops) ||
    !RESULT_CODE_PATTERN.test(value.resultCode) ||
    (value.innerResultCode !== undefined && !RESULT_CODE_PATTERN.test(value.innerResultCode))
  )
    return { ok: false, code: "malformed_ledger_evidence" };
  return {
    ok: true,
    value: {
      outerTransactionHash: value.outerTransactionHash,
      innerTransactionHash: value.innerTransactionHash,
      feeSource: value.feeSource,
      ledger: value.ledger,
      resultCode: value.resultCode,
      innerResultCode: value.innerResultCode ?? null,
      chargedStroops: value.chargedStroops,
    },
  };
}

function normalizeProvenance(value, config) {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.deploymentId !== config.deploymentName ||
    value.environment !== "development" ||
    value.network !== "testnet" ||
    value.verified !== true ||
    !COMMIT_PATTERN.test(value.deployedSourceCommit) ||
    !isSafeLabel(value.verification)
  )
    return { ok: false, code: "source_provenance_unverified" };
  if (config.expectedSourceCommit && config.expectedSourceCommit !== value.deployedSourceCommit)
    return { ok: false, code: "source_provenance_mismatch" };
  return {
    ok: true,
    value: {
      deploymentId: value.deploymentId,
      environment: value.environment,
      network: value.network,
      verified: true,
      deployedSourceCommit: value.deployedSourceCommit,
      verification: value.verification,
    },
  };
}

function correlateSettledExecution(dto, snapshot) {
  if (!snapshot.execution || !snapshot.execution.ledgerEvidence)
    return { ok: false, code: "execution_snapshot_missing" };
  const evidence = snapshot.execution.ledgerEvidence;
  const matches =
    snapshot.execution.requestId === dto.requestId &&
    snapshot.execution.innerTransactionHash === dto.transactionHash &&
    snapshot.execution.outerTransactionHash === dto.outerTransactionHash &&
    snapshot.execution.status === "succeeded" &&
    snapshot.execution.reconciliationRequired === false &&
    snapshot.execution.actualFeeStroops === dto.actualFeeStroops &&
    evidence.outerTransactionHash === dto.outerTransactionHash &&
    evidence.innerTransactionHash === dto.transactionHash &&
    evidence.feeSource === snapshot.execution.feeSource &&
    evidence.chargedStroops === dto.actualFeeStroops &&
    evidence.resultCode === "txFeeBumpInnerSuccess" &&
    evidence.innerResultCode === "txSuccess";
  if (!matches) return { ok: false, code: "execution_snapshot_mismatch" };
  return {
    ok: true,
    value: {
      requestId: dto.requestId,
      innerTransactionHash: dto.transactionHash,
      outerTransactionHash: dto.outerTransactionHash,
      feeSource: evidence.feeSource,
      status: dto.status,
      sendCount: snapshot.execution.sendCount,
      reservedStroops: dto.reservedStroops,
      chargedStroops: evidence.chargedStroops,
      actualFeeStroops: dto.actualFeeStroops,
      ledger: evidence.ledger,
      resultCode: evidence.resultCode,
      innerResultCode: evidence.innerResultCode,
      explorerUrl: `https://stellar.expert/explorer/testnet/tx/${dto.outerTransactionHash}`,
      accounting: snapshot.accounting,
    },
  };
}

function compareReplaySnapshots(before, after, replay, initial) {
  const sameAttemptIdentity =
    before.execution?.requestId === after.execution?.requestId &&
    before.execution?.innerTransactionHash === after.execution?.innerTransactionHash &&
    before.execution?.outerTransactionHash === after.execution?.outerTransactionHash &&
    replay.requestId === initial.requestId &&
    replay.transactionHash === initial.transactionHash &&
    replay.outerTransactionHash === initial.outerTransactionHash;
  const sameSendCount = before.execution?.sendCount === after.execution?.sendCount;
  const sameSettledFee =
    before.execution?.actualFeeStroops === after.execution?.actualFeeStroops &&
    before.execution?.actualFeeStroops === initial.actualFeeStroops;
  const sameAccounting = JSON.stringify(before.accounting) === JSON.stringify(after.accounting);
  return {
    ok:
      sameAttemptIdentity &&
      sameSendCount &&
      sameSettledFee &&
      sameAccounting &&
      replay.status === "succeeded",
    sameAttemptIdentity,
    sameSendCount,
    sameSettledFee,
    sameAccounting,
    code: "replay_snapshot_mismatch",
  };
}

function verifyPolicyDenial(response, before, after, transactionHash) {
  const noExecutionAttempt = before.execution === null && after.execution === null;
  const noReservedExposure =
    before.reservedExposureStroops === "0" &&
    after.reservedExposureStroops === "0" &&
    after.decision?.reservedExposureStroops === "0";
  const accountingUnchanged =
    JSON.stringify(before.accounting) === JSON.stringify(after.accounting);
  const ok =
    response.httpStatus === 403 &&
    response.code === "contract_not_whitelisted" &&
    after.scope.transactionHash === transactionHash &&
    after.decision?.decisionCode === "rejected" &&
    after.decision.rejectionCode === "contract_not_whitelisted" &&
    noExecutionAttempt &&
    noReservedExposure &&
    accountingUnchanged;
  return {
    ok,
    code: ok ? null : "policy_denial_evidence_mismatch",
    noExecutionAttempt,
    noReservedExposure,
    accountingUnchanged,
  };
}

function normalizeReservation(value) {
  if (
    !isRecord(value) ||
    value.object !== "gas_sponsor_reservation" ||
    !isSafeLabel(value.requestId) ||
    !isHash(value.transactionHash) ||
    !isPublicKey(value.sourceWallet) ||
    !Array.isArray(value.targetContractIds) ||
    value.targetContractIds.length !== 1 ||
    !value.targetContractIds.every(isContractId) ||
    !isDecimal(value.innerMaxFeeStroops) ||
    !isDecimal(value.reservedStroops) ||
    value.decision !== "reserved" ||
    typeof value.replayed !== "boolean"
  )
    return { ok: false, code: "malformed_sponsor_response" };
  return {
    ok: true,
    value: {
      requestId: value.requestId,
      transactionHash: value.transactionHash,
      sourceWallet: value.sourceWallet,
      targetContractIds: [...value.targetContractIds],
      innerMaxFeeStroops: value.innerMaxFeeStroops,
      reservedStroops: value.reservedStroops,
      replayed: value.replayed,
    },
  };
}

function normalizeExecutionDto(value) {
  if (
    !isRecord(value) ||
    value.object !== "gas_submit_result" ||
    !isSafeLabel(value.requestId) ||
    !isHash(value.transactionHash) ||
    (value.outerTransactionHash !== null && !isHash(value.outerTransactionHash)) ||
    !EXECUTION_STATUSES.has(value.status) ||
    !isDecimal(value.reservedStroops) ||
    (value.actualFeeStroops !== null && !isDecimal(value.actualFeeStroops)) ||
    typeof value.reconciliationRequired !== "boolean"
  )
    return { ok: false, code: "malformed_submit_response" };
  return {
    ok: true,
    value: {
      requestId: value.requestId,
      transactionHash: value.transactionHash,
      outerTransactionHash: value.outerTransactionHash,
      status: value.status,
      reservedStroops: value.reservedStroops,
      actualFeeStroops: value.actualFeeStroops,
      reconciliationRequired: value.reconciliationRequired,
    },
  };
}

function normalizeApiError(value) {
  const error = isRecord(value) && isRecord(value.error) ? value.error : null;
  const code =
    typeof error?.code === "string" && SAFE_API_ERROR_CODES.has(error.code)
      ? error.code
      : "unexpected_api_error";
  return {
    code,
    requestId: typeof error?.requestId === "string" ? error.requestId : null,
  };
}

async function boundedFetchJson(fetchImpl, url, init, timeoutMs) {
  try {
    const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const contentLength = response.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_OPERATOR_RESPONSE_BYTES)
      return { ok: false, code: "response_too_large" };
    const text = await readBoundedResponseText(response, MAX_OPERATOR_RESPONSE_BYTES);
    if (!text.ok) return text;
    let value;
    try {
      value = text.text ? JSON.parse(text.text) : null;
    } catch {
      return { ok: false, code: "malformed_response" };
    }
    return { ok: true, status: response.status, value };
  } catch (error) {
    return {
      ok: false,
      code: error?.name === "TimeoutError" ? "timeout" : "transport_unavailable",
    };
  }
}

async function readBoundedResponseText(response, maxBytes) {
  if (!response.body) return { ok: true, text: "" };
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        return { ok: false, code: "response_too_large" };
      }
      chunks.push(next.value);
    }
  } catch {
    return { ok: false, code: "response_read_failed" };
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, code: "malformed_response" };
  }
}

async function deriveFactsSafely(xdr, deriveFacts) {
  if (typeof xdr !== "string" || xdr.trim() === "")
    return { ok: false, code: "missing_invocation" };
  try {
    const value = await deriveFacts(xdr);
    return { ok: true, value };
  } catch {
    return { ok: false, code: "invalid_invocation" };
  }
}

function deriveFactsFromXdr(xdr) {
  const value = parseTestnetSorobanTransactionEnvelope(xdr);
  return {
    sourceWallet: value.sourceWallet,
    transactionHash: value.transactionHash,
    innerMaxFeeStroops: value.innerMaxFeeStroops.toString(),
    targetContractIds: [...value.targetContractIds],
  };
}

function scopedUrl(base, params) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params))
    if (value !== undefined) url.searchParams.set(key, String(value));
  return url.toString();
}

function summarizeDeployment(snapshot, provenance) {
  return {
    deploymentId: snapshot.deployment.deploymentId,
    environment: snapshot.deployment.environment,
    network: snapshot.deployment.network,
    deployedSourceCommit: provenance.deployedSourceCommit,
    provenanceVerified: provenance.verified,
    provenanceVerification: provenance.verification,
  };
}

function summarizePreflight(preflight) {
  return {
    status: preflight.ok ? "passed" : "blocked",
    checks: preflight.checks.map(({ name, status }) => ({ name, status })),
    allowedTransactionHash: preflight.facts?.allowed.transactionHash ?? null,
    deniedTransactionHash: preflight.facts?.denied.transactionHash ?? null,
  };
}

function summarizeExecutionAttempt(dto, requestId, transactionHash) {
  return {
    requestId: dto?.requestId ?? requestId,
    innerTransactionHash: dto?.transactionHash ?? transactionHash,
    status: dto?.status ?? null,
    outerTransactionHash: dto?.outerTransactionHash ?? null,
    actualFeeStroops: dto?.actualFeeStroops ?? null,
  };
}

async function safeRepositoryState(reader) {
  try {
    return await reader();
  } catch {
    return { head: "unresolved", workingTree: { status: "unresolved", changedPathCount: null } };
  }
}

async function safelyRead(reader) {
  try {
    const result = await reader();
    return result?.ok === false ? result : { ok: true, value: result?.value ?? result };
  } catch {
    return { ok: false, code: "operator_read_failed" };
  }
}

function addCheck(checks, name, passed, failure) {
  checks.push({
    name,
    status: passed ? "passed" : "blocked",
    ...(passed ? {} : { failure: failure ?? "check_failed" }),
  });
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim() !== "" && value.length <= 255;
}

function isSafeLabel(value) {
  return typeof value === "string" && SAFE_LABEL_PATTERN.test(value);
}

function isHash(value) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) return false;
  try {
    return assertValidTransactionHash(value) === value;
  } catch {
    return false;
  }
}

function isPublicKey(value) {
  if (typeof value !== "string") return false;
  try {
    return assertValidPublicKey(value) === value;
  } catch {
    return false;
  }
}

function isContractId(value) {
  if (typeof value !== "string") return false;
  try {
    return assertValidContractId(value) === value;
  } catch {
    return false;
  }
}

function isDecimal(value) {
  if (typeof value !== "string" || !DECIMAL_PATTERN.test(value) || value.length > 19) return false;
  try {
    return BigInt(value) <= 2n ** 63n - 1n;
  } catch {
    return false;
  }
}

function isPositiveDecimal(value) {
  return isDecimal(value) && BigInt(value) > 0n;
}

function sha256Hex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function timestamp(now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function normalizeUrl(value, name) {
  const url = new URL(value);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  )
    throw new Error(`${name} must use HTTPS without credentials or fragments`);
  return url.toString().replace(/\/$/, "");
}

function containsSensitiveData(value) {
  return /tk_live_[a-f0-9]{32}|secretKey|authorization|transactionXdr|SG[A-Z2-7]{20,}|provider body|raw response/i.test(
    value,
  );
}

async function defaultWait(milliseconds) {
  if (milliseconds <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isLoopback(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export async function writeSmokeReport(report, outputPath, cwd = repositoryRoot) {
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_REPORT_BYTES || containsSensitiveData(serialized))
    throw new Error("Refusing to write an unsafe smoke report");
  const resolvedPath = path.resolve(cwd, outputPath);
  await mkdir(path.dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, serialized, "utf8");
  return resolvedPath;
}

async function readReport(reportPath, cwd = repositoryRoot) {
  const resolvedPath = path.resolve(cwd, reportPath);
  const contents = await readFile(resolvedPath, "utf8");
  if (Buffer.byteLength(contents, "utf8") > MAX_REPORT_BYTES)
    throw new Error("Smoke report is too large");
  return JSON.parse(contents);
}

async function main(values = process.argv.slice(2)) {
  const options = parseSmokeArgs(values);
  if (options.help) {
    console.log(usage);
    return 0;
  }
  if (options.mode === "verify") {
    const report = await readReport(options.reportPath ?? options.outputPath);
    const result = verifySmokeReport(report);
    console.log(
      `D2 smoke evidence ${result.ok ? "passed" : "incomplete"}; report validation is sanitized.`,
    );
    return result.ok ? 0 : 1;
  }

  const loaded = await loadSmokeConfig({ ...process.env, VELO_GAS_D2_MODE: options.mode });
  const outputPath = process.env.VELO_GAS_D2_REPORT_PATH ?? options.outputPath;
  let report;
  if (!loaded.ok) {
    report = {
      schemaVersion: SMOKE_REPORT_SCHEMA_VERSION,
      mode: options.mode,
      status: "incomplete",
      failure: "configuration_missing",
      missingInputs: loaded.missing,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      repository: {
        before: await safeRepositoryState(() => readRepositoryState(repositoryRoot)),
        after: await safeRepositoryState(() => readRepositoryState(repositoryRoot)),
      },
    };
  } else {
    const config = {
      ...loaded.config,
      apiOrigin: normalizeUrl(loaded.config.apiOrigin, "VELO_GAS_D2_API_ORIGIN"),
      rpcUrl: normalizeUrl(loaded.config.rpcUrl, "VELO_GAS_D2_RPC_URL"),
      snapshotUrl: normalizeUrl(loaded.config.snapshotUrl, "VELO_GAS_D2_OPERATOR_SNAPSHOT_URL"),
      provenanceUrl: normalizeUrl(loaded.config.provenanceUrl, "VELO_GAS_D2_PROVENANCE_URL"),
    };
    const dependencies = createSmokeDependencies();
    report =
      options.mode === "preflight"
        ? await runPreflight({ config, dependencies })
        : await runSmokeExecution({
            config,
            dependencies,
            pollLimit: options.pollLimit,
            pollIntervalMs: options.pollIntervalMs,
          });
    if (options.mode === "preflight")
      report = {
        schemaVersion: SMOKE_REPORT_SCHEMA_VERSION,
        mode: "preflight",
        status: report.ok ? "passed" : "incomplete",
        startedAt: report.startedAt,
        completedAt: report.completedAt,
        repository: {
          before: await safeRepositoryState(dependencies.repositoryState),
          after: await safeRepositoryState(dependencies.repositoryState),
        },
        deployment: report.deployment,
        preflight: summarizePreflight(report),
        failure: report.ok ? null : "preflight_failed",
      };
  }
  await writeSmokeReport(report, outputPath, repositoryRoot);
  console.log(`D2 smoke ${report.status}; sanitized report written to ${outputPath}.`);
  return report.status === "passed" ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exitCode = await main();
  } catch {
    console.error(
      "D2 smoke could not complete; no command output, credentials, XDR, or exception message was persisted.",
    );
    process.exitCode = 1;
  }
}
