import assert from "node:assert/strict";
import test from "node:test";

import {
  CONVEX_DEPLOYMENT_MANIFEST_KIND,
  CONVEX_PRODUCTION_DEPLOYMENT_ID,
  CONVEX_PRODUCTION_PREDICATE_TYPE,
  CONVEX_PRODUCTION_REPOSITORY,
  CONVEX_PRODUCTION_VERIFICATION,
  createConvexDeploymentManifest,
  isValidConvexDeploymentManifest,
  verifyConvexDeploymentAttestation,
} from "./convex-deployment-provenance.mjs";

const SOURCE_COMMIT = "a".repeat(40);

function validManifest(overrides = {}) {
  return createConvexDeploymentManifest({
    sourceCommit: SOURCE_COMMIT,
    sourceRef: "refs/heads/main",
    deploymentId: CONVEX_PRODUCTION_DEPLOYMENT_ID,
    environment: "production",
    network: "testnet",
    repository: CONVEX_PRODUCTION_REPOSITORY,
    workflowRunId: "987654321",
    workflowRunAttempt: "2",
    ...overrides,
  });
}

test("creates a strict Testnet production manifest for the deployed source SHA", () => {
  const manifest = validManifest();
  assert.equal(manifest.kind, CONVEX_DEPLOYMENT_MANIFEST_KIND);
  assert.equal(manifest.sourceCommit, SOURCE_COMMIT);
  assert.equal(manifest.deploymentId, CONVEX_PRODUCTION_DEPLOYMENT_ID);
  assert.equal(manifest.result, "deploy_succeeded");
  assert.equal(isValidConvexDeploymentManifest(manifest), true);
  assert.equal(isValidConvexDeploymentManifest({ ...manifest, extra: "unexpected" }), false);
});

test("refuses to create manifests for a different target, branch, network, or malformed run", () => {
  for (const overrides of [
    { sourceCommit: "not-a-sha" },
    { sourceRef: "refs/heads/feature" },
    { deploymentId: "prod:other-deployment" },
    { environment: "development" },
    { network: "mainnet" },
    { workflowRunId: "0" },
  ]) {
    assert.throws(() => validManifest(overrides), /inputs are invalid/);
  }
});

test("verifies the signed manifest against the exact repository, workflow, ref, and source SHA", async () => {
  let verifierArgs;
  const result = await verifyConvexDeploymentAttestation({
    manifestPath: "/tmp/convex-production-deployment.json",
    expectedDeploymentId: CONVEX_PRODUCTION_DEPLOYMENT_ID,
    expectedSourceCommit: SOURCE_COMMIT,
    readManifest: async () => JSON.stringify(validManifest()),
    runVerifier: async (args) => {
      verifierArgs = args;
      return {
        ok: true,
        stdout: JSON.stringify([
          {
            verificationResult: {
              statement: { predicateType: CONVEX_PRODUCTION_PREDICATE_TYPE },
            },
          },
        ]),
      };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    deploymentId: CONVEX_PRODUCTION_DEPLOYMENT_ID,
    environment: "production",
    network: "testnet",
    sourceCommit: SOURCE_COMMIT,
    verification: CONVEX_PRODUCTION_VERIFICATION,
  });
  assert.deepEqual(verifierArgs, {
    manifestPath: "/tmp/convex-production-deployment.json",
    expectedSourceCommit: SOURCE_COMMIT,
  });
});

test("rejects marker mismatches, unsigned manifests, malformed attestations, and missing files", async () => {
  const mismatch = await verifyConvexDeploymentAttestation({
    manifestPath: "manifest.json",
    expectedSourceCommit: "b".repeat(40),
    readManifest: async () => JSON.stringify(validManifest()),
    runVerifier: async () => {
      throw new Error("must not run for mismatched source");
    },
  });
  assert.deepEqual(mismatch, { ok: false, code: "deployment_attestation_mismatch" });

  const unsigned = await verifyConvexDeploymentAttestation({
    manifestPath: "manifest.json",
    expectedSourceCommit: SOURCE_COMMIT,
    readManifest: async () => JSON.stringify(validManifest()),
    runVerifier: async () => ({ ok: false, stdout: "private verifier details" }),
  });
  assert.deepEqual(unsigned, {
    ok: false,
    code: "deployment_attestation_verification_failed",
  });
  assert.equal(JSON.stringify(unsigned).includes("private verifier details"), false);

  const malformed = await verifyConvexDeploymentAttestation({
    manifestPath: "manifest.json",
    expectedSourceCommit: SOURCE_COMMIT,
    readManifest: async () => JSON.stringify({ ...validManifest(), result: "failed" }),
    runVerifier: async () => ({ ok: true, stdout: "[]" }),
  });
  assert.deepEqual(malformed, { ok: false, code: "deployment_attestation_invalid" });

  const unavailable = await verifyConvexDeploymentAttestation({
    manifestPath: "missing.json",
    expectedSourceCommit: SOURCE_COMMIT,
    readManifest: async () => {
      throw new Error("path is private");
    },
  });
  assert.deepEqual(unavailable, { ok: false, code: "deployment_attestation_unavailable" });
});
