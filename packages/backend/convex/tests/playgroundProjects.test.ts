import { Keypair } from "@repo/stellar";
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";

import { api } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");
const OWNER = Keypair.random().publicKey();
const EDITOR = Keypair.random().publicKey();
const VIEWER = Keypair.random().publicKey();
const CONTRACT = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

function asWallet(t: ReturnType<typeof convexTest>, address: string) {
  return t.withIdentity({
    subject: address,
    issuer: "http://localhost:3000",
    tokenIdentifier: `http://localhost:3000|${address}`,
  });
}

async function createProject(owner: ReturnType<typeof asWallet>, name = "Sprint 6") {
  return await owner.mutation(api.projects.mutation.createDraft, {
    name,
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
  await expect(
    viewer.query(api.playground_projects.queries.listMembers, { projectId }),
  ).rejects.toThrow("Owner access required");
});

test("membership updates require valid addresses, preserve rows, and grant project discovery", async () => {
  const t = convexTest(schema, modules);
  const owner = asWallet(t, OWNER);
  const editor = asWallet(t, EDITOR);
  const otherProjectId = await createProject(owner, "Sprint 6 other");
  const projectId = await createProject(owner);

  await expect(
    owner.mutation(api.playground_projects.mutations.upsertMember, {
      projectId,
      walletAddress: "G" + "A".repeat(55),
      role: "viewer",
    }),
  ).rejects.toThrow("Invalid Stellar public key");
  await expect(
    owner.mutation(api.playground_projects.mutations.upsertMember, {
      projectId,
      walletAddress: OWNER,
      role: "viewer",
    }),
  ).rejects.toThrow("Project owner role cannot be changed");

  const membershipId = await owner.mutation(api.playground_projects.mutations.upsertMember, {
    projectId,
    walletAddress: EDITOR,
    role: "viewer",
  });
  const duplicateMembershipId = await owner.mutation(
    api.playground_projects.mutations.upsertMember,
    {
      projectId,
      walletAddress: EDITOR.toLowerCase(),
      role: "editor",
    },
  );
  expect(duplicateMembershipId).toBe(membershipId);
  expect(await editor.query(api.projects.query.getById, { id: projectId })).toMatchObject({
    _id: projectId,
    role: "editor",
    isOwner: false,
  });
  expect(await editor.query(api.projects.query.listByOwner, {})).toEqual(
    expect.arrayContaining([expect.objectContaining({ _id: projectId, role: "editor" })]),
  );

  await expect(
    editor.mutation(api.playground_projects.mutations.upsertMember, {
      projectId,
      walletAddress: VIEWER,
      role: "viewer",
    }),
  ).rejects.toThrow("Owner access required");
  await expect(
    owner.mutation(api.playground_projects.mutations.removeMember, {
      projectId: otherProjectId,
      membershipId,
    }),
  ).rejects.toThrow("Member not found");

  await owner.mutation(api.playground_projects.mutations.removeMember, {
    projectId,
    membershipId,
  });
  expect(await editor.query(api.projects.query.getById, { id: projectId })).toBeNull();
  expect(await editor.query(api.projects.query.listByOwner, {})).toEqual([]);

  const retainedMembershipId = await owner.mutation(
    api.playground_projects.mutations.upsertMember,
    { projectId, walletAddress: EDITOR, role: "editor" },
  );
  await t.run(async (ctx) => {
    await ctx.db.patch(projectId, { retiredAt: Date.now() });
  });
  await expect(
    owner.mutation(api.playground_projects.mutations.upsertMember, {
      projectId,
      walletAddress: VIEWER,
      role: "viewer",
    }),
  ).rejects.toThrow("Project is retired");
  await expect(
    owner.mutation(api.playground_projects.mutations.removeMember, {
      projectId,
      membershipId: retainedMembershipId,
    }),
  ).rejects.toThrow("Project is retired");
  expect(await editor.query(api.projects.query.getById, { id: projectId })).toBeNull();
});

test("the project owner's membership row cannot be changed or removed", async () => {
  const t = convexTest(schema, modules);
  const owner = asWallet(t, OWNER);
  const projectId = await createProject(owner);
  const ownerMembershipId = await t.run(
    async (ctx) =>
      await ctx.db.insert("projectMemberships", {
        projectId,
        walletAddress: OWNER,
        role: "owner",
        addedBy: OWNER,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
  );

  await expect(
    owner.mutation(api.playground_projects.mutations.upsertMember, {
      projectId,
      walletAddress: OWNER,
      role: "viewer",
    }),
  ).rejects.toThrow("Project owner role cannot be changed");
  await expect(
    owner.mutation(api.playground_projects.mutations.removeMember, {
      projectId,
      membershipId: ownerMembershipId,
    }),
  ).rejects.toThrow("Project owner cannot be removed");
});

test("shared members can read project contract and event details while Registry writes stay owner-only", async () => {
  const t = convexTest(schema, modules);
  const owner = asWallet(t, OWNER);
  const editor = asWallet(t, EDITOR);
  const viewer = asWallet(t, VIEWER);
  const outsider = asWallet(t, Keypair.random().publicKey());
  const projectId = await createProject(owner);
  const now = Date.now();

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
  await t.run(async (ctx) => {
    await ctx.db.patch(projectId, { status: "registered", registryProjectId: 42 });
    await ctx.db.insert("projectContracts", {
      projectId,
      ownerAddress: OWNER,
      registryProjectId: 42,
      contractId: CONTRACT,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("contractEvents", {
      eventKey: "test-event-key",
      eventId: "test-event",
      projectId,
      network: "testnet",
      contractId: CONTRACT,
      transactionHash: "a".repeat(64),
      ledger: 7,
      topic: '["transfer"]',
      topics: ["transfer"],
      type: "contract",
      raw: {},
      observedAt: now,
    });
  });

  for (const wallet of [owner, editor, viewer]) {
    expect(
      await wallet.query(api.project_contracts.query.listByProject, { projectId }),
    ).toHaveLength(1);
    expect(
      await wallet.query(api.contract_events.query.listByProject, { projectId, limit: 10 }),
    ).toMatchObject({ events: [expect.objectContaining({ eventId: "test-event" })] });
  }
  expect(await outsider.query(api.project_contracts.query.listByProject, { projectId })).toBeNull();
  expect(
    await outsider.query(api.contract_events.query.listByProject, { projectId, limit: 10 }),
  ).toBeNull();

  await expect(
    editor.mutation(api.project_contracts.mutation.markAddPending, {
      projectId,
      contractId: "CB" + "A".repeat(54),
      transactionHash: "b".repeat(64),
    }),
  ).rejects.toThrow("Unauthorized");
  await expect(
    viewer.mutation(api.project_contracts.mutation.markAddPending, {
      projectId,
      contractId: "CB" + "A".repeat(54),
      transactionHash: "b".repeat(64),
    }),
  ).rejects.toThrow("Unauthorized");
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
