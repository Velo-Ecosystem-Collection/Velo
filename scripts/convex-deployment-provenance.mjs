#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CONVEX_PRODUCTION_REPOSITORY = "Velo-Ecosystem-Collection/Velo";
export const CONVEX_PRODUCTION_WORKFLOW = "Velo-Ecosystem-Collection/Velo/.github/workflows/ci.yml";
export const CONVEX_PRODUCTION_DEPLOYMENT_ID = "prod:agreeable-salmon-748";
export const CONVEX_PRODUCTION_PREDICATE_TYPE = "https://slsa.dev/provenance/v1";
export const CONVEX_PRODUCTION_VERIFICATION = "github-artifact-attestation";
export const CONVEX_DEPLOYMENT_MANIFEST_KIND = "velo_convex_production_deployment";

const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const RUN_ID_PATTERN = /^[1-9][0-9]{0,19}$/;
const RUN_ATTEMPT_PATTERN = /^[1-9][0-9]{0,5}$/;
const MANIFEST_MAX_BYTES = 16 * 1024;
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function createConvexDeploymentManifest({
  sourceCommit,
  sourceRef,
  deploymentId,
  environment,
  network,
  repository,
  workflowRunId,
  workflowRunAttempt,
}) {
  if (
    !COMMIT_PATTERN.test(sourceCommit ?? "") ||
    sourceRef !== "refs/heads/main" ||
    deploymentId !== CONVEX_PRODUCTION_DEPLOYMENT_ID ||
    environment !== "production" ||
    network !== "testnet" ||
    repository !== CONVEX_PRODUCTION_REPOSITORY ||
    !RUN_ID_PATTERN.test(workflowRunId ?? "") ||
    !RUN_ATTEMPT_PATTERN.test(workflowRunAttempt ?? "")
  ) {
    throw new Error("Production deployment manifest inputs are invalid");
  }

  return {
    schemaVersion: 1,
    kind: CONVEX_DEPLOYMENT_MANIFEST_KIND,
    provider: "convex",
    repository,
    sourceCommit,
    sourceRef,
    deploymentId,
    environment,
    network,
    result: "deploy_succeeded",
    workflowRunId,
    workflowRunAttempt,
  };
}

export async function verifyConvexDeploymentAttestation({
  manifestPath,
  expectedDeploymentId = CONVEX_PRODUCTION_DEPLOYMENT_ID,
  expectedSourceCommit,
  readManifest = readBoundedManifest,
  runVerifier = runGitHubAttestationVerifier,
}) {
  if (
    typeof manifestPath !== "string" ||
    manifestPath.trim() === "" ||
    expectedDeploymentId !== CONVEX_PRODUCTION_DEPLOYMENT_ID ||
    !COMMIT_PATTERN.test(expectedSourceCommit ?? "")
  ) {
    return { ok: false, code: "deployment_attestation_configuration_invalid" };
  }

  let manifest;
  try {
    const serialized = await readManifest(manifestPath);
    if (
      typeof serialized !== "string" ||
      Buffer.byteLength(serialized, "utf8") > MANIFEST_MAX_BYTES
    ) {
      return { ok: false, code: "deployment_attestation_invalid" };
    }
    manifest = JSON.parse(serialized);
  } catch {
    return { ok: false, code: "deployment_attestation_unavailable" };
  }

  if (!isValidConvexDeploymentManifest(manifest)) {
    return { ok: false, code: "deployment_attestation_invalid" };
  }
  if (
    manifest.deploymentId !== expectedDeploymentId ||
    manifest.sourceCommit !== expectedSourceCommit
  ) {
    return { ok: false, code: "deployment_attestation_mismatch" };
  }

  let verification;
  try {
    verification = await runVerifier({ manifestPath, expectedSourceCommit });
  } catch {
    return { ok: false, code: "deployment_attestation_verification_failed" };
  }
  if (!verification?.ok || !hasVerifiedSlsaStatement(verification.stdout)) {
    return { ok: false, code: "deployment_attestation_verification_failed" };
  }

  return {
    ok: true,
    value: {
      deploymentId: manifest.deploymentId,
      environment: manifest.environment,
      network: manifest.network,
      sourceCommit: manifest.sourceCommit,
      verification: CONVEX_PRODUCTION_VERIFICATION,
    },
  };
}

export function isValidConvexDeploymentManifest(value) {
  if (!isRecord(value)) return false;
  const expectedKeys = [
    "schemaVersion",
    "kind",
    "provider",
    "repository",
    "sourceCommit",
    "sourceRef",
    "deploymentId",
    "environment",
    "network",
    "result",
    "workflowRunId",
    "workflowRunAttempt",
  ];
  return (
    Object.keys(value).length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(value, key)) &&
    value.schemaVersion === 1 &&
    value.kind === CONVEX_DEPLOYMENT_MANIFEST_KIND &&
    value.provider === "convex" &&
    value.repository === CONVEX_PRODUCTION_REPOSITORY &&
    COMMIT_PATTERN.test(value.sourceCommit ?? "") &&
    value.sourceRef === "refs/heads/main" &&
    value.deploymentId === CONVEX_PRODUCTION_DEPLOYMENT_ID &&
    value.environment === "production" &&
    value.network === "testnet" &&
    value.result === "deploy_succeeded" &&
    RUN_ID_PATTERN.test(value.workflowRunId ?? "") &&
    RUN_ATTEMPT_PATTERN.test(value.workflowRunAttempt ?? "")
  );
}

async function runGitHubAttestationVerifier({ manifestPath, expectedSourceCommit }) {
  const result = spawnSync(
    "gh",
    [
      "attestation",
      "verify",
      path.resolve(repositoryRoot, manifestPath),
      "--repo",
      CONVEX_PRODUCTION_REPOSITORY,
      "--signer-workflow",
      CONVEX_PRODUCTION_WORKFLOW,
      "--source-ref",
      "refs/heads/main",
      "--source-digest",
      expectedSourceCommit,
      "--predicate-type",
      CONVEX_PRODUCTION_PREDICATE_TYPE,
      "--format",
      "json",
    ],
    { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 2 * 1024 * 1024, timeout: 30_000 },
  );
  return { ok: result.status === 0, stdout: result.stdout ?? "" };
}

function hasVerifiedSlsaStatement(stdout) {
  try {
    const result = JSON.parse(stdout);
    return (
      Array.isArray(result) &&
      result.some(
        (entry) =>
          entry?.verificationResult?.statement?.predicateType === CONVEX_PRODUCTION_PREDICATE_TYPE,
      )
    );
  } catch {
    return false;
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readBoundedManifest(manifestPath) {
  const details = await stat(manifestPath);
  if (details.size > MANIFEST_MAX_BYTES) throw new Error("Manifest too large");
  return readFile(manifestPath, "utf8");
}

async function createFromEnvironment(outputPath) {
  const manifest = createConvexDeploymentManifest({
    sourceCommit: process.env.GITHUB_SHA,
    sourceRef: process.env.GITHUB_REF,
    deploymentId: process.env.CONVEX_PRODUCTION_DEPLOYMENT_ID,
    environment: process.env.CONVEX_PRODUCTION_DEPLOYMENT_ENVIRONMENT,
    network: process.env.CONVEX_PRODUCTION_STELLAR_NETWORK,
    repository: process.env.GITHUB_REPOSITORY,
    workflowRunId: process.env.GITHUB_RUN_ID,
    workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT,
  });
  const resolvedOutputPath = path.resolve(repositoryRoot, outputPath);
  await writeFile(resolvedOutputPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return manifest;
}

async function verifyFromArgs(manifestPath, expectedSourceCommit) {
  const result = await verifyConvexDeploymentAttestation({ manifestPath, expectedSourceCommit });
  if (!result.ok) throw new Error(result.code);
  return {
    verified: true,
    ...result.value,
  };
}

async function main(args = process.argv.slice(2)) {
  const [command, ...rest] = args;
  if (command === "create") {
    const outputIndex = rest.indexOf("--output");
    const outputPath = outputIndex >= 0 ? rest[outputIndex + 1] : null;
    if (!outputPath || rest.length !== 2) throw new Error("create requires --output <path>");
    const manifest = await createFromEnvironment(outputPath);
    process.stdout.write(`${JSON.stringify({ created: true, ...manifest })}\n`);
    return 0;
  }
  if (command === "verify") {
    const manifestIndex = rest.indexOf("--manifest");
    const commitIndex = rest.indexOf("--source-commit");
    const manifestPath = manifestIndex >= 0 ? rest[manifestIndex + 1] : null;
    const expectedSourceCommit = commitIndex >= 0 ? rest[commitIndex + 1] : null;
    if (!manifestPath || !expectedSourceCommit || rest.length !== 4) {
      throw new Error("verify requires --manifest <path> and --source-commit <sha>");
    }
    const result = await verifyFromArgs(manifestPath, expectedSourceCommit);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }
  throw new Error("Use create or verify");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exitCode = await main();
  } catch {
    process.stderr.write("Convex deployment provenance operation failed.\n");
    process.exitCode = 1;
  }
}
