/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";

import { api } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");
const OWNER = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
const EDITOR = "GDFWQCS3C72IWT5QV6CJYCMCQZ4WQ2QELSE6ABWI5Q3XRZ6BPGRS6LZV";
const VIEWER = "GAK3Z7ISF6GOZP3F7EUZJ3JEXQ6MXDFX7B6GSQXKXKXL6JL6Y4JR6OIK";
const CONTRACT = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

function asWallet(t: ReturnType<typeof convexTest>, address: string) {
  return t.withIdentity({
    subject: address,
    issuer: "http://localhost:3000",
    tokenIdentifier: `http://localhost:3000|${address}`,
  });
}

async function createProject(owner: ReturnType<typeof asWallet>) {
  return await owner.mutation(api.projects.mutation.createDraft, {
    name: "Sprint 6",
    slug: `sprint-6-${Math.random().toString(36).slice(2)}`,
    description: "Project Playground",
    metadataJson: "{}",
    metadataHash: "0".repeat(64),
    ownerAddress: OWNER,
  });
}

test("owner manages editor/viewer access and roles are enforced", async () => {
  const t = convexTest(schema, modules);
  const owner = asWallet(t, OWNER);
  const editor = asWallet(t, EDITOR);
  const viewer = asWallet(t, VIEWER);
  const projectId = await createProject(owner);

  await owner.mutation(api.playground_projects.mutations.upsertMember, {
    projectId,
    walletAddress: EDITOR,
    role: "editor",
  });
  await owner.mutation(api.playground_projects.mutations.upsertMember, {
    projectId,
    walletAddress: VIEWER,
    role: "viewer",
  });

  const savedContractId = await editor.mutation(api.playground_projects.mutations.saveContract, {
    projectId,
    network: "testnet",
    contractId: CONTRACT,
    displayName: "Treasury",
    description: "",
    tags: ["demo"],
    wasmHash: "a".repeat(64),
    specHash: "b".repeat(64),
  });
  expect(savedContractId).toBeTruthy();

  await expect(
    viewer.mutation(api.playground_projects.mutations.saveContract, {
      projectId,
      network: "testnet",
      contractId: CONTRACT,
      displayName: "Nope",
      description: "",
      tags: [],
      wasmHash: "a".repeat(64),
      specHash: "b".repeat(64),
    }),
  ).rejects.toThrow("Editor access required");

  expect(
    await viewer.query(api.playground_projects.queries.listContracts, { projectId }),
  ).toHaveLength(1);
});

test("requests are versioned and variables resolve without cross-network fallback", async () => {
  const t = convexTest(schema, modules);
  const owner = asWallet(t, OWNER);
  const projectId = await createProject(owner);
  const savedContractId = await owner.mutation(api.playground_projects.mutations.saveContract, {
    projectId,
    network: "testnet",
    contractId: CONTRACT,
    displayName: "Treasury",
    description: "",
    tags: [],
    wasmHash: "a".repeat(64),
    specHash: "b".repeat(64),
  });

  await owner.mutation(api.playground_projects.mutations.upsertVariable, {
    projectId,
    network: "testnet",
    name: "TREASURY",
    kind: "address",
    value: OWNER,
  });
  await expect(
    owner.mutation(api.playground_projects.mutations.upsertVariable, {
      projectId,
      network: "testnet",
      name: "PRIVATE_KEY",
      kind: "string",
      value: "Bearer abcdefghijklmnopqrstuvwxyz",
    }),
  ).rejects.toThrow("secret");

  const created = await owner.mutation(api.playground_projects.mutations.createRequest, {
    projectId,
    savedContractId,
    name: "Pay treasury",
    functionName: "pay",
    argumentTemplateJson: JSON.stringify({
      recipient: { $variable: "TREASURY" },
      amount: "10",
    }),
    sourceStrategy: "connected_wallet",
    settings: { baseFee: "100", cpuInstructions: 0 },
    tags: [],
  });
  const updated = await owner.mutation(api.playground_projects.mutations.updateRequest, {
    requestId: created.requestId,
    argumentTemplateJson: JSON.stringify({
      recipient: { $variable: "TREASURY" },
      amount: "20",
    }),
    sourceStrategy: "connected_wallet",
    settings: { baseFee: "100", cpuInstructions: 0 },
    tags: ["v2"],
  });
  expect(updated.version).toBe(2);

  const preview = await owner.query(api.playground_projects.queries.previewVariables, {
    projectId,
    network: "testnet",
    argumentTemplateJson: JSON.stringify({ recipient: { $variable: "TREASURY" } }),
  });
  expect(preview.resolvedArguments).toEqual({ recipient: OWNER });
  expect(preview.resolutionHash).toMatch(/^[a-f0-9]{64}$/);
  await owner.mutation(api.playground_projects.mutations.upsertVariable, {
    projectId,
    network: "testnet",
    name: "UNUSED_REVISION",
    kind: "string",
    value: "changed",
  });
  const invalidated = await owner.query(api.playground_projects.queries.previewVariables, {
    projectId,
    network: "testnet",
    argumentTemplateJson: JSON.stringify({ recipient: { $variable: "TREASURY" } }),
  });
  expect(invalidated.resolutionHash).not.toBe(preview.resolutionHash);

  const missing = await owner.query(api.playground_projects.queries.previewVariables, {
    projectId,
    network: "mainnet",
    argumentTemplateJson: JSON.stringify({ recipient: { $variable: "TREASURY" } }),
  });
  expect(missing.issues[0]?.path).toBe("$.recipient");
});

test("execution history is idempotent and public shares expire or revoke", async () => {
  const t = convexTest(schema, modules);
  const owner = asWallet(t, OWNER);
  const projectId = await createProject(owner);
  const now = Date.now();

  await expect(
    owner.mutation(api.playground_projects.mutations.recordExecution, {
      projectId,
      idempotencyKey: "forged",
      kind: "simulation",
      journeyCorrelationId: "journey-forged",
      requestCorrelationId: "request-forged",
      network: "testnet",
      contractId: CONTRACT,
      functionName: "hello",
      sourceAccount: OWNER,
      status: "success",
      startedAt: now,
      completedAt: now,
      wasmHash: "a".repeat(64),
      persistenceProof: "forged-browser-claim",
    }),
  ).rejects.toThrow("persistence");

  const first = await owner.mutation(api.playground_projects.mutations.recordExecution, {
    projectId,
    idempotencyKey: "journey-1:simulation",
    kind: "simulation",
    journeyCorrelationId: "journey-1",
    requestCorrelationId: "request-1",
    network: "testnet",
    contractId: CONTRACT,
    functionName: "hello",
    sourceAccount: OWNER,
    status: "success",
    startedAt: now,
    completedAt: now + 10,
    wasmHash: "a".repeat(64),
    fee: "100",
  });
  const duplicate = await owner.mutation(api.playground_projects.mutations.recordExecution, {
    projectId,
    idempotencyKey: "journey-1:simulation",
    kind: "simulation",
    journeyCorrelationId: "journey-1",
    requestCorrelationId: "request-1",
    network: "testnet",
    contractId: CONTRACT,
    functionName: "hello",
    sourceAccount: OWNER,
    status: "success",
    startedAt: now,
    completedAt: now + 10,
    wasmHash: "a".repeat(64),
    fee: "100",
  });
  expect(duplicate).toBe(first);

  const share = await owner.mutation(api.playground_projects.mutations.createShare, {
    projectId,
    visibility: "public_unlisted",
    includeArguments: false,
    snapshotJson: JSON.stringify({
      schemaVersion: 1,
      network: "testnet",
      contractId: CONTRACT,
      wasmHash: "a".repeat(64),
      functionName: "hello",
    }),
  });
  expect(
    (await t.query(api.playground_projects.queries.getPublicShare, { token: share.token }))
      ?.snapshot,
  ).not.toHaveProperty("argumentTemplate");

  await owner.mutation(api.playground_projects.mutations.revokeShare, {
    shareId: share.shareId,
  });
  expect(
    await t.query(api.playground_projects.queries.getPublicShare, { token: share.token }),
  ).toBeNull();
});
