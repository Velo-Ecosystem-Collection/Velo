/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { expect, test } from "vitest";

import type { DataModel, Doc, Id } from "../../_generated/dataModel";
import type { TestConvexForDataModelAndIdentity } from "convex-test";

import { api, internal } from "../../_generated/api";
import {
  GAS_DECISION_CODES,
  GAS_LIFECYCLE_STATES,
  GAS_NETWORK,
  GAS_POLICY_ERROR_CODES,
  GAS_RELAYER_STATUSES,
} from "../../gas/types";
import schema from "../../schema";

const modules = import.meta.glob("../../**/*.ts");
type TestContext = TestConvexForDataModelAndIdentity<DataModel>;

const OWNER = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
const EDITOR = "GBNHK3TLWWXBCEGNFHB45Z66R4AI5YUALKUFBP4WF7YK5JLZIAAG2DLI";
const VIEWER = "GDFWQCS3C72IWT5QV6CJYCMCQZ4WQ2QELSE6ABWI5Q3XRZ6BPGRS6LZV";
const OTHER_OWNER = "GCZCSOTTJVGJNVXKUUEPGZRWWEB4HOFCQLMZJX6VIP4C4ZURI4HVOIMA";
const CONTRACT_ID = "CC7RENKPGXGF6MMEMGJ4YWUBOBGQYOCGG33PNSONQF56UMMAQ22TWH6R";
const RELAYER_PUBLIC_KEY = "GAI7NKM2MASZ4OJH2LQNMXL4VEUVOWPVDNRVTB6XQRWYYRX3JD4KX4ZI";
const NOW = 1_757_000_000_000;

function asWallet(t: TestContext, address: string) {
  return t.withIdentity({
    subject: address,
    issuer: "http://localhost:3000",
    tokenIdentifier: `http://localhost:3000|${address}`,
  });
}

async function createProject(t: TestContext, ownerAddress = OWNER): Promise<Id<"projects">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("projects", {
      name: `Gas Console ${ownerAddress.slice(1, 7)}`,
      slug: `gas-console-${ownerAddress.slice(1, 7).toLowerCase()}-${Math.random()
        .toString(36)
        .slice(2)}`,
      description: "Gas console test project",
      metadataJson: "{}",
      metadataHash: "0".repeat(64),
      ownerAddress,
      ownerTokenIdentifier: `http://localhost:3000|${ownerAddress}`,
      status: "draft",
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
}

async function addMembership(
  t: TestContext,
  projectId: Id<"projects">,
  walletAddress: string,
  role: "editor" | "viewer",
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("projectMemberships", {
      projectId,
      walletAddress,
      role,
      addedBy: OWNER,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
}

async function addGasLog(
  t: TestContext,
  projectId: Id<"projects">,
  requestId: string,
  createdAt: number,
  includeDerivedFacts = true,
): Promise<Id<"gasLogs">> {
  const input: Omit<Doc<"gasLogs">, "_id" | "_creationTime"> = {
    projectId,
    requestId,
    idempotencyKeyHash: `${requestId}-idempotency-hash`,
    requestFingerprint: `${requestId}-request-fingerprint`,
    decisionCode: GAS_DECISION_CODES.reserved,
    lifecycle: GAS_LIFECYCLE_STATES.reserved,
    retentionExpiresAt: createdAt + 30 * 24 * 60 * 60 * 1000,
    createdAt,
    updatedAt: createdAt + 1,
  };

  if (includeDerivedFacts) {
    Object.assign(input, {
      transactionHash: requestId.padStart(64, "0"),
      sourceWallet: OWNER,
      targetContractIds: [CONTRACT_ID],
      innerMaxFeeStroops: 100n,
      reservedStroops: 200n,
      actualFeeStroops: 150n,
      expiresAt: createdAt + 900_000,
    });
  }

  return await t.run(async (ctx) => ctx.db.insert("gasLogs", input));
}

test("Gas console reads are viewer-scoped and missing records return null", async () => {
  const t = convexTest(schema, modules);
  const owner = asWallet(t, OWNER);
  const viewer = asWallet(t, VIEWER);
  const projectId = await createProject(t);
  await addMembership(t, projectId, VIEWER, "viewer");

  expect(await viewer.query(api.gas.queries.getPolicy, { projectId })).toBeNull();
  expect(await viewer.query(api.gas.queries.getRelayerAccount, { projectId })).toBeNull();
  await expect(t.query(api.gas.queries.getPolicy, { projectId })).rejects.toThrow(
    "Not authenticated",
  );
  await expect(
    asWallet(t, OTHER_OWNER).query(api.gas.queries.getPolicy, { projectId }),
  ).rejects.toThrow("Unauthorized");

  expect(await owner.query(api.gas.queries.getPolicy, { projectId })).toBeNull();
});

test("managed custody status is owner-authorized and never returns encrypted fields", async () => {
  const t = convexTest(schema, modules);
  const owner = asWallet(t, OWNER);
  const viewer = asWallet(t, VIEWER);
  const projectId = await createProject(t);
  await addMembership(t, projectId, VIEWER, "viewer");
  await t.run(async (ctx) => {
    await ctx.db.insert("relayerAccounts", {
      projectId,
      publicKey: RELAYER_PUBLIC_KEY,
      network: GAS_NETWORK,
      status: "active",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await ctx.db.insert("gasRelayerCustody", {
      projectId,
      network: GAS_NETWORK,
      status: "ready",
      attemptToken: "private-token",
      attemptCount: 1,
      publicKey: RELAYER_PUBLIC_KEY,
      deploymentId: "dev:private-deployment",
      keyVersion: "v1",
      nonce: "private-nonce",
      ciphertext: "private-ciphertext",
      authTag: "private-auth-tag",
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  const expected = {
    state: "ready",
    managed: true,
    publicKey: RELAYER_PUBLIC_KEY,
    relayerStatus: "active",
    errorCode: null,
  };
  const result = await owner.query(api.gas.queries.getProvisioningStatus, { projectId });
  expect(result).toEqual(expected);
  expect(await viewer.query(api.gas.queries.getProvisioningStatus, { projectId })).toEqual(
    expected,
  );
  expect(Object.keys(result).sort()).toEqual([
    "errorCode",
    "managed",
    "publicKey",
    "relayerStatus",
    "state",
  ]);
  expect(JSON.stringify(result)).not.toMatch(
    /ciphertext|nonce|authTag|deploymentId|keyVersion|private-token/,
  );
  await expect(
    asWallet(t, OTHER_OWNER).query(api.gas.queries.getProvisioningStatus, { projectId }),
  ).rejects.toThrow("Unauthorized");
});

test("managed sponsorship activation requires the owner and uses only active linked contracts", async () => {
  const t = convexTest(schema, modules);
  const owner = asWallet(t, OWNER);
  const editor = asWallet(t, EDITOR);
  const projectId = await createProject(t);
  await addMembership(t, projectId, EDITOR, "editor");
  await t.run(async (ctx) => {
    await ctx.db.insert("relayerAccounts", {
      projectId,
      publicKey: RELAYER_PUBLIC_KEY,
      network: GAS_NETWORK,
      status: "active",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await ctx.db.insert("gasRelayerCustody", {
      projectId,
      network: GAS_NETWORK,
      status: "ready",
      attemptToken: "private-token",
      attemptCount: 1,
      publicKey: RELAYER_PUBLIC_KEY,
      deploymentId: "dev:private-deployment",
      keyVersion: "v1",
      nonce: "private-nonce",
      ciphertext: "private-ciphertext",
      authTag: "private-auth-tag",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await ctx.db.insert("projectContracts", {
      projectId,
      ownerAddress: OWNER,
      registryProjectId: 7,
      contractId: CONTRACT_ID,
      status: "active",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await ctx.db.insert("projectContracts", {
      projectId,
      ownerAddress: OWNER,
      registryProjectId: 7,
      contractId: "CC3QCZSWY3VBSCFCZOYBBHLMO5OXPWQPNFQHUBNIPOWFTYTBS5Y4AT5N",
      status: "pending_add",
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  expect(await owner.query(api.gas.queries.getManagedActivationReview, { projectId })).toEqual({
    dailyCapStroops: "100000000",
    walletHourlyLimit: 100,
    activeContractIds: [CONTRACT_ID],
    policyEnabled: false,
  });
  await expect(
    editor.mutation(api.gas.mutations.activateManagedSponsorship, { projectId }),
  ).rejects.toThrow("Owner access required");
  await owner.mutation(api.gas.mutations.updatePolicy, {
    projectId,
    enabled: false,
    dailyCapStroops: "100000000",
    walletHourlyLimit: 100,
    allowedContractIds: [],
  });
  await expect(
    editor.mutation(api.gas.mutations.updatePolicy, {
      projectId,
      enabled: true,
      dailyCapStroops: "100000000",
      walletHourlyLimit: 100,
      allowedContractIds: [CONTRACT_ID],
    }),
  ).rejects.toThrow("Review and enable managed sponsorship from the owner controls");

  const activated = await owner.mutation(api.gas.mutations.activateManagedSponsorship, {
    projectId,
  });
  expect(activated).toMatchObject({
    enabled: true,
    dailyCapStroops: "100000000",
    walletHourlyLimit: 100,
    allowedContractIds: [CONTRACT_ID],
  });
});

test("managed activation stays disabled without active contracts and maintenance blocks policy changes", async () => {
  const t = convexTest(schema, modules);
  const owner = asWallet(t, OWNER);
  const projectId = await createProject(t);
  const relayerId = await t.run(async (ctx) => {
    const relayerId = await ctx.db.insert("relayerAccounts", {
      projectId,
      publicKey: RELAYER_PUBLIC_KEY,
      network: GAS_NETWORK,
      status: "active",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await ctx.db.insert("gasRelayerCustody", {
      projectId,
      network: GAS_NETWORK,
      status: "ready",
      attemptToken: "private-token",
      attemptCount: 1,
      publicKey: RELAYER_PUBLIC_KEY,
      deploymentId: "dev:private-deployment",
      keyVersion: "v1",
      nonce: "private-nonce",
      ciphertext: "private-ciphertext",
      authTag: "private-auth-tag",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await ctx.db.insert("projectContracts", {
      projectId,
      ownerAddress: OWNER,
      registryProjectId: 7,
      contractId: CONTRACT_ID,
      status: "pending_add",
      createdAt: NOW,
      updatedAt: NOW,
    });
    return relayerId;
  });

  const activated = await owner.mutation(api.gas.mutations.activateManagedSponsorship, {
    projectId,
  });
  expect(activated).toMatchObject({ enabled: false, allowedContractIds: [] });
  expect(
    await owner.query(api.gas.queries.getManagedActivationReview, { projectId }),
  ).toMatchObject({
    activeContractIds: [],
    policyEnabled: false,
  });

  await t.run(async (ctx) => {
    await ctx.db.insert("gasProjectMaintenance", {
      projectId,
      withdrawalRequestId: "withdrawal-in-progress",
      ownerWallet: OWNER,
      relayerId,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
  await expect(
    owner.mutation(api.gas.mutations.updatePolicy, {
      projectId,
      enabled: false,
      dailyCapStroops: "100000000",
      walletHourlyLimit: 100,
      allowedContractIds: [],
    }),
  ).rejects.toThrow("Gas account maintenance is in progress");
});

test("retired project owners retain a safe relayer funds view", async () => {
  const t = convexTest(schema, modules);
  const owner = asWallet(t, OWNER);
  const projectId = await createProject(t);
  await t.run(async (ctx) => {
    await ctx.db.patch(projectId, { retiredAt: NOW + 1 });
    await ctx.db.insert("relayerAccounts", {
      projectId,
      publicKey: RELAYER_PUBLIC_KEY,
      network: GAS_NETWORK,
      status: "disabled",
      balanceStroops: 55_000_000n,
      balanceUpdatedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await ctx.db.insert("gasRelayerCustody", {
      projectId,
      network: GAS_NETWORK,
      status: "ready",
      attemptToken: "private-token",
      attemptCount: 1,
      publicKey: RELAYER_PUBLIC_KEY,
      deploymentId: "dev:private-deployment",
      keyVersion: "v1",
      nonce: "private-nonce",
      ciphertext: "private-ciphertext",
      authTag: "private-auth-tag",
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
  expect(await owner.query(api.gas.queries.getRelayerFundsForOwner, { projectId })).toMatchObject({
    retired: true,
    managed: true,
    publicKey: RELAYER_PUBLIC_KEY,
    status: "disabled",
    balanceStroops: "55000000",
  });
});

test("Testnet faucet claims are owner-scoped and a request cooldown survives uncertain responses", async () => {
  const t = convexTest(schema, modules);
  const owner = asWallet(t, OWNER);
  const projectId = await createProject(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("relayerAccounts", {
      projectId,
      publicKey: RELAYER_PUBLIC_KEY,
      network: GAS_NETWORK,
      status: "disabled",
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  const first = await owner.mutation(internal.gas.balance_internal.claimFaucetRequest, {
    projectId,
  });
  expect(first.status).toBe("claimed");
  if (first.status !== "claimed") throw new Error("Expected a claimed faucet request");
  expect(
    await asWallet(t, OTHER_OWNER).mutation(internal.gas.balance_internal.claimFaucetRequest, {
      projectId,
    }),
  ).toEqual({ status: "unauthorized" });
  expect(
    await owner.mutation(internal.gas.balance_internal.claimFaucetRequest, { projectId }),
  ).toMatchObject({
    status: "in_progress",
    requestId: first.requestId,
  });

  await owner.mutation(internal.gas.balance_internal.finishFaucetRequest, {
    projectId,
    requestId: first.requestId,
    status: "uncertain",
    checkedAt: Date.now(),
    errorCode: "account_not_found",
  });
  expect(
    await owner.mutation(internal.gas.balance_internal.claimFaucetRequest, { projectId }),
  ).toMatchObject({
    status: "cooldown",
  });
  expect(
    await owner.mutation(internal.gas.balance_internal.claimFaucetCheck, {
      projectId,
      requestId: first.requestId,
    }),
  ).toEqual({ status: "ready", publicKey: RELAYER_PUBLIC_KEY });
});

test("owner withdrawal confirmation pauses sponsorship behind a maintenance lock and safe cancel releases it", async () => {
  const t = convexTest(schema, modules);
  const owner = asWallet(t, OWNER);
  const editor = asWallet(t, EDITOR);
  const projectId = await createProject(t);
  await addMembership(t, projectId, EDITOR, "editor");
  const relayerId = await t.run(async (ctx) => {
    const relayerId = await ctx.db.insert("relayerAccounts", {
      projectId,
      publicKey: RELAYER_PUBLIC_KEY,
      network: GAS_NETWORK,
      status: "active",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await ctx.db.insert("gasRelayerCustody", {
      projectId,
      network: GAS_NETWORK,
      status: "ready",
      attemptToken: "private-token",
      attemptCount: 1,
      publicKey: RELAYER_PUBLIC_KEY,
      deploymentId: "dev:private-deployment",
      keyVersion: "v1",
      nonce: "private-nonce",
      ciphertext: "private-ciphertext",
      authTag: "private-auth-tag",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await ctx.db.insert("gasPolicies", {
      projectId,
      enabled: true,
      network: GAS_NETWORK,
      dailyCapStroops: 100_000_000n,
      dailyReservedStroops: 0n,
      dailyWindowKey: new Date().toISOString().slice(0, 10),
      outstandingHoldsStroops: 0n,
      dailyConfirmedSpendStroops: 0n,
      accountingState: "initialized",
      walletHourlyLimit: 100,
      allowedContractIds: [CONTRACT_ID],
      createdAt: NOW,
      updatedAt: NOW,
    });
    return relayerId;
  });
  const now = Date.now();
  const requestId = "withdrawal-test-request";
  const created = await owner.mutation(internal.gas.balance_internal.createWithdrawalIntent, {
    projectId,
    requestId,
    nonce: "11e1d7e8-9d8d-49ed-8c75-c0e413a265cc",
    amountStroops: "10000000",
    expiresAt: now + 300_000,
  });
  expect(created.status).toBe("ready");
  await owner.mutation(internal.gas.balance_internal.pinWithdrawalConsent, {
    projectId,
    requestId,
    consentDigest: "a".repeat(64),
    preparedConsentHash: "b".repeat(64),
  });
  await expect(
    asWallet(t, OTHER_OWNER).mutation(internal.gas.balance_internal.authorizeWithdrawal, {
      projectId,
      requestId,
      consentDigest: "a".repeat(64),
      consentTransactionHash: "b".repeat(64),
    }),
  ).rejects.toThrow("Owner access required");

  expect(
    await owner.mutation(internal.gas.balance_internal.authorizeWithdrawal, {
      projectId,
      requestId,
      consentDigest: "a".repeat(64),
      consentTransactionHash: "b".repeat(64),
    }),
  ).toEqual({ status: "ready_to_send" });
  const snapshot = await t.run(async (ctx) => ({
    relayer: await ctx.db.get("relayerAccounts", relayerId),
    policy: await ctx.db
      .query("gasPolicies")
      .withIndex("by_project_id", (q) => q.eq("projectId", projectId))
      .unique(),
    locks: await ctx.db
      .query("gasProjectMaintenance")
      .withIndex("by_project_id", (q) => q.eq("projectId", projectId))
      .collect(),
  }));
  expect(snapshot.relayer?.status).toBe("disabled");
  expect(snapshot.policy?.enabled).toBe(false);
  expect(snapshot.locks).toHaveLength(1);
  await expect(
    editor.mutation(api.gas.mutations.updatePolicy, {
      projectId,
      enabled: false,
      dailyCapStroops: "100000000",
      walletHourlyLimit: 100,
      allowedContractIds: [CONTRACT_ID],
    }),
  ).rejects.toThrow("Gas account maintenance is in progress");

  expect(
    await owner.mutation(internal.gas.balance_internal.cancelUnsentWithdrawal, {
      projectId,
      requestId,
    }),
  ).toBe("cancelled");
  const afterCancel = await t.run(async (ctx) =>
    ctx.db
      .query("gasProjectMaintenance")
      .withIndex("by_project_id", (q) => q.eq("projectId", projectId))
      .collect(),
  );
  expect(afterCancel).toHaveLength(0);
});

test("only the owner can retry managed provisioning and legacy relayers are preserved", async () => {
  const t = convexTest(schema, modules);
  const owner = asWallet(t, OWNER);
  const editor = asWallet(t, EDITOR);
  const projectId = await createProject(t);
  await addMembership(t, projectId, EDITOR, "editor");
  await t.run(async (ctx) => {
    await ctx.db.insert("gasRelayerCustody", {
      projectId,
      network: GAS_NETWORK,
      status: "failed",
      attemptToken: "previous-attempt",
      attemptCount: 1,
      errorCode: "configuration_unavailable",
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  await expect(editor.mutation(api.gas.mutations.retryProvisioning, { projectId })).rejects.toThrow(
    "Owner access required",
  );
  expect(await owner.mutation(api.gas.mutations.retryProvisioning, { projectId })).toBe("queued");
  expect(await owner.query(api.gas.queries.getProvisioningStatus, { projectId })).toMatchObject({
    state: "pending",
    managed: true,
    errorCode: null,
  });

  const legacyProjectId = await createProject(t, OTHER_OWNER);
  await t.run(async (ctx) => {
    await ctx.db.insert("relayerAccounts", {
      projectId: legacyProjectId,
      publicKey: RELAYER_PUBLIC_KEY,
      network: GAS_NETWORK,
      status: "active",
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
  expect(
    await asWallet(t, OTHER_OWNER).mutation(api.gas.mutations.retryProvisioning, {
      projectId: legacyProjectId,
    }),
  ).toBe("legacy_relayer_exists");
  expect(
    await t.run(async (ctx) =>
      ctx.db
        .query("gasRelayerCustody")
        .withIndex("by_project_id", (q) => q.eq("projectId", legacyProjectId))
        .take(2),
    ),
  ).toHaveLength(0);
});

test("Gas log pages are project-scoped, newest-first, and cursor-complete", async () => {
  const t = convexTest(schema, modules);
  const viewer = asWallet(t, VIEWER);
  const projectId = await createProject(t);
  const otherProjectId = await createProject(t, OTHER_OWNER);
  await addMembership(t, projectId, VIEWER, "viewer");

  await addGasLog(t, projectId, "project-a-oldest", NOW + 100, false);
  await addGasLog(t, otherProjectId, "project-b-old", NOW + 200);
  await addGasLog(t, projectId, "project-a-second", NOW + 300);
  await addGasLog(t, otherProjectId, "project-b-middle", NOW + 400);
  await addGasLog(t, projectId, "project-a-third", NOW + 500);
  await addGasLog(t, otherProjectId, "project-b-newest", NOW + 600);
  await addGasLog(t, projectId, "project-a-newest", NOW + 700);

  const firstPage = await viewer.query(api.gas.queries.listLogsPage, {
    projectId,
    paginationOpts: { numItems: 2, cursor: null },
  });
  const secondPage = await viewer.query(api.gas.queries.listLogsPage, {
    projectId,
    paginationOpts: { numItems: 2, cursor: firstPage.continueCursor },
  });

  expect(firstPage.page.map((log) => log.requestId)).toEqual([
    "project-a-newest",
    "project-a-third",
  ]);
  expect(secondPage.page.map((log) => log.requestId)).toEqual([
    "project-a-second",
    "project-a-oldest",
  ]);
  expect(secondPage.isDone).toBe(true);
  expect(new Set([...firstPage.page, ...secondPage.page].map((log) => log.requestId)).size).toBe(4);
  expect(firstPage.continueCursor).toEqual(expect.any(String));
  expect(secondPage.continueCursor).toEqual(expect.any(String));
  expect(Object.keys(firstPage).sort()).toEqual([
    "continueCursor",
    "isDone",
    "page",
    "pageStatus",
    "splitCursor",
  ]);
  expect(firstPage.splitCursor).toBeNull();
  expect(firstPage.pageStatus).toBeNull();
});

test("Gas log pages return the exact safe projection with null optionals and decimal stroops", async () => {
  const t = convexTest(schema, modules);
  const viewer = asWallet(t, VIEWER);
  const projectId = await createProject(t);
  await addMembership(t, projectId, VIEWER, "viewer");
  await addGasLog(t, projectId, "gas-log-without-derived-values", NOW, false);
  await addGasLog(t, projectId, "gas-log-with-derived-values", NOW + 100);

  const result = await viewer.query(api.gas.queries.listLogsPage, {
    projectId,
    paginationOpts: { numItems: 10, cursor: null },
  });

  const safeLogKeys = [
    "actualFeeStroops",
    "createdAt",
    "decisionCode",
    "expiresAt",
    "innerMaxFeeStroops",
    "lifecycle",
    "rejectionCode",
    "requestId",
    "reservedStroops",
    "sourceWallet",
    "targetContractIds",
    "transactionHash",
    "updatedAt",
  ];
  expect(result.page).toHaveLength(2);
  expect(result.page[0]).toEqual({
    requestId: "gas-log-with-derived-values",
    transactionHash: "0gas-log-with-derived-values".padStart(64, "0"),
    sourceWallet: OWNER,
    targetContractIds: [CONTRACT_ID],
    innerMaxFeeStroops: "100",
    reservedStroops: "200",
    actualFeeStroops: "150",
    decisionCode: "reserved",
    rejectionCode: null,
    lifecycle: "reserved",
    expiresAt: NOW + 100 + 900_000,
    createdAt: NOW + 100,
    updatedAt: NOW + 101,
  });
  expect(result.page[1]).toEqual({
    requestId: "gas-log-without-derived-values",
    transactionHash: null,
    sourceWallet: null,
    targetContractIds: null,
    innerMaxFeeStroops: null,
    reservedStroops: null,
    actualFeeStroops: null,
    decisionCode: "reserved",
    rejectionCode: null,
    lifecycle: "reserved",
    expiresAt: null,
    createdAt: NOW,
    updatedAt: NOW + 1,
  });
  for (const log of result.page) {
    expect(Object.keys(log).sort()).toEqual(safeLogKeys);
    expect(log).not.toHaveProperty("_id");
    expect(log).not.toHaveProperty("projectId");
    expect(log).not.toHaveProperty("idempotencyKeyHash");
    expect(log).not.toHaveProperty("requestFingerprint");
    expect(log).not.toHaveProperty("retentionExpiresAt");
    expect(log).not.toHaveProperty("rawXdr");
    expect(log).not.toHaveProperty("signature");
    expect(log).not.toHaveProperty("secretKey");
    expect(log).not.toHaveProperty("privateKey");
  }
});

test("Gas log pages fail closed for unauthenticated, non-member, and other-project members", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t);
  const otherProjectId = await createProject(t, OTHER_OWNER);
  await addMembership(t, projectId, VIEWER, "viewer");
  await addGasLog(t, otherProjectId, "other-project-log", NOW);

  const paginationOpts = { numItems: 1, cursor: null };
  await expect(
    t.query(api.gas.queries.listLogsPage, { projectId, paginationOpts }),
  ).rejects.toThrow("Not authenticated");
  await expect(
    asWallet(t, EDITOR).query(api.gas.queries.listLogsPage, { projectId, paginationOpts }),
  ).rejects.toThrow("Unauthorized");
  await expect(
    asWallet(t, OTHER_OWNER).query(api.gas.queries.listLogsPage, { projectId, paginationOpts }),
  ).rejects.toThrow("Unauthorized");
  await expect(
    asWallet(t, VIEWER).query(api.gas.queries.listLogsPage, {
      projectId: otherProjectId,
      paginationOpts,
    }),
  ).rejects.toThrow("Unauthorized");
});

test("Gas log pages reject extra client-supplied authority and secret-looking arguments", async () => {
  const t = convexTest(schema, modules);
  const viewer = asWallet(t, VIEWER);
  const projectId = await createProject(t);
  await addMembership(t, projectId, VIEWER, "viewer");

  const extraArguments = {
    projectId,
    paginationOpts: { numItems: 1, cursor: null },
    walletAddress: OWNER,
    requestedProjectId: projectId,
    includeSecrets: true,
    rawXdr: "must-not-be-accepted",
    secretKey: "must-not-be-accepted",
  };
  await expect(viewer.query(api.gas.queries.listLogsPage, extraArguments)).rejects.toThrow();
});

test("policy upsert enforces editor writes, normalizes values, and preserves accounting", async () => {
  const t = convexTest(schema, modules);
  const owner = asWallet(t, OWNER);
  const editor = asWallet(t, EDITOR);
  const viewer = asWallet(t, VIEWER);
  const projectId = await createProject(t);
  await addMembership(t, projectId, EDITOR, "editor");
  await addMembership(t, projectId, VIEWER, "viewer");

  await expect(
    viewer.mutation(api.gas.mutations.updatePolicy, {
      projectId,
      enabled: true,
      dailyCapStroops: "1000",
      walletHourlyLimit: 1,
      allowedContractIds: [],
    }),
  ).rejects.toThrow("Editor access required");

  const created = await editor.mutation(api.gas.mutations.updatePolicy, {
    projectId,
    enabled: true,
    dailyCapStroops: "1000",
    walletHourlyLimit: 12,
    allowedContractIds: [CONTRACT_ID.toLowerCase(), ` ${CONTRACT_ID} `],
  });
  expect(created).toEqual({
    enabled: true,
    network: GAS_NETWORK,
    dailyCapStroops: "1000",
    dailyReservedStroops: "0",
    dailyWindowKey: new Date(created.createdAt).toISOString().slice(0, 10),
    walletHourlyLimit: 12,
    allowedContractIds: [CONTRACT_ID],
    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
  });
  expect(Object.keys(created).sort()).toEqual([
    "allowedContractIds",
    "createdAt",
    "dailyCapStroops",
    "dailyReservedStroops",
    "dailyWindowKey",
    "enabled",
    "network",
    "updatedAt",
    "walletHourlyLimit",
  ]);

  await t.run(async (ctx) => {
    const policy = await ctx.db
      .query("gasPolicies")
      .withIndex("by_project_id", (q) => q.eq("projectId", projectId))
      .unique();
    if (!policy) throw new Error("Policy was not created");
    await ctx.db.patch(policy._id, {
      dailyReservedStroops: 250n,
      dailyWindowKey: "2026-01-01",
      createdAt: 123,
    });
  });

  const updated = await owner.mutation(api.gas.mutations.updatePolicy, {
    projectId,
    enabled: false,
    dailyCapStroops: "0",
    walletHourlyLimit: 0,
    allowedContractIds: [],
  });
  expect(updated).toMatchObject({
    enabled: false,
    network: GAS_NETWORK,
    dailyCapStroops: "0",
    dailyReservedStroops: "0",
    dailyWindowKey: new Date(updated.updatedAt).toISOString().slice(0, 10),
    walletHourlyLimit: 0,
    allowedContractIds: [],
    createdAt: 123,
  });
  expect(updated.updatedAt).toBeGreaterThanOrEqual(NOW);
  expect(await viewer.query(api.gas.queries.getPolicy, { projectId })).toEqual(updated);
});

test("same-day cap reductions below reserved stroops fail atomically", async () => {
  const t = convexTest(schema, modules);
  const editor = asWallet(t, EDITOR);
  const projectId = await createProject(t);
  await addMembership(t, projectId, EDITOR, "editor");

  const created = await editor.mutation(api.gas.mutations.updatePolicy, {
    projectId,
    enabled: true,
    dailyCapStroops: "1000",
    walletHourlyLimit: 10,
    allowedContractIds: [],
  });
  const currentDayKey = new Date().toISOString().slice(0, 10);
  await t.run(async (ctx) => {
    await ctx.db.patch(
      (
        await ctx.db
          .query("gasPolicies")
          .withIndex("by_project_id", (q) => q.eq("projectId", projectId))
          .take(1)
      )[0]!._id,
      { dailyReservedStroops: 200n, dailyWindowKey: currentDayKey },
    );
  });

  const before = await editor.query(api.gas.queries.getPolicy, { projectId });
  await expect(
    editor.mutation(api.gas.mutations.updatePolicy, {
      projectId,
      enabled: false,
      dailyCapStroops: "199",
      walletHourlyLimit: 0,
      allowedContractIds: [],
    }),
  ).rejects.toMatchObject({
    data: {
      code: GAS_POLICY_ERROR_CODES.dailyCapBelowEffectiveUsage,
      message: "Daily Gas cap cannot be lower than current effective usage.",
    },
  });
  expect(await editor.query(api.gas.queries.getPolicy, { projectId })).toEqual(before);
  expect(created.dailyReservedStroops).toBe("0");
});

test("policy writes recheck membership role and removal at the mutation boundary", async () => {
  const t = convexTest(schema, modules);
  const editor = asWallet(t, EDITOR);
  const projectId = await createProject(t);
  await addMembership(t, projectId, EDITOR, "editor");

  const before = await editor.mutation(api.gas.mutations.updatePolicy, {
    projectId,
    enabled: true,
    dailyCapStroops: "1000",
    walletHourlyLimit: 4,
    allowedContractIds: [],
  });

  await t.run(async (ctx) => {
    const membership = await ctx.db
      .query("projectMemberships")
      .withIndex("by_project_and_wallet_address", (q) =>
        q.eq("projectId", projectId).eq("walletAddress", EDITOR),
      )
      .unique();
    if (!membership) throw new Error("Editor membership was not created");
    await ctx.db.patch(membership._id, { role: "viewer" });
  });

  await expect(
    editor.mutation(api.gas.mutations.updatePolicy, {
      projectId,
      enabled: false,
      dailyCapStroops: "2000",
      walletHourlyLimit: 0,
      allowedContractIds: [],
    }),
  ).rejects.toThrow("Editor access required");
  expect(await editor.query(api.gas.queries.getPolicy, { projectId })).toEqual(before);

  await t.run(async (ctx) => {
    const membership = await ctx.db
      .query("projectMemberships")
      .withIndex("by_project_and_wallet_address", (q) =>
        q.eq("projectId", projectId).eq("walletAddress", EDITOR),
      )
      .unique();
    if (!membership) throw new Error("Viewer membership was not preserved");
    await ctx.db.delete(membership._id);
  });

  await expect(
    editor.mutation(api.gas.mutations.updatePolicy, {
      projectId,
      enabled: false,
      dailyCapStroops: "2000",
      walletHourlyLimit: 0,
      allowedContractIds: [],
    }),
  ).rejects.toThrow("Unauthorized");
  expect(await asWallet(t, OWNER).query(api.gas.queries.getPolicy, { projectId })).toEqual(before);
});

test("policy writes reject invalid decimal, numeric, allowlist, and extra authority fields", async () => {
  const t = convexTest(schema, modules);
  const editor = asWallet(t, EDITOR);
  const projectId = await createProject(t);
  await addMembership(t, projectId, EDITOR, "editor");

  for (const dailyCapStroops of ["-1", "+1", "1.5", "1e3", "01", "9_000"]) {
    await expect(
      editor.mutation(api.gas.mutations.updatePolicy, {
        projectId,
        enabled: true,
        dailyCapStroops,
        walletHourlyLimit: 1,
        allowedContractIds: [],
      }),
    ).rejects.toThrow();
  }
  await expect(
    editor.mutation(api.gas.mutations.updatePolicy, {
      projectId,
      enabled: true,
      dailyCapStroops: (2n ** 63n).toString(),
      walletHourlyLimit: 1,
      allowedContractIds: [],
    }),
  ).rejects.toThrow();

  for (const walletHourlyLimit of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    await expect(
      editor.mutation(api.gas.mutations.updatePolicy, {
        projectId,
        enabled: true,
        dailyCapStroops: "1",
        walletHourlyLimit,
        allowedContractIds: [],
      }),
    ).rejects.toThrow();
  }

  const tooManyContracts = Array.from({ length: 21 }, () => CONTRACT_ID);
  await expect(
    editor.mutation(api.gas.mutations.updatePolicy, {
      projectId,
      enabled: true,
      dailyCapStroops: "1",
      walletHourlyLimit: 1,
      allowedContractIds: tooManyContracts,
    }),
  ).rejects.toThrow();

  const extraAuthority = {
    projectId,
    enabled: true,
    dailyCapStroops: "1",
    walletHourlyLimit: 1,
    allowedContractIds: [],
    network: "mainnet",
    dailyReservedStroops: "999",
    balanceStroops: "999",
    secretKey: "must-not-be-accepted",
  };
  await expect(editor.mutation(api.gas.mutations.updatePolicy, extraAuthority)).rejects.toThrow();
});

test("relayer upsert is owner-only, Testnet-bound, collision-safe, and balance-preserving", async () => {
  const t = convexTest(schema, modules);
  const owner = asWallet(t, OWNER);
  const editor = asWallet(t, EDITOR);
  const viewer = asWallet(t, VIEWER);
  const projectId = await createProject(t);
  await addMembership(t, projectId, EDITOR, "editor");
  await addMembership(t, projectId, VIEWER, "viewer");

  for (const caller of [editor, viewer]) {
    await expect(
      caller.mutation(api.gas.mutations.updateRelayerAccount, {
        projectId,
        publicKey: RELAYER_PUBLIC_KEY,
        status: GAS_RELAYER_STATUSES.active,
      }),
    ).rejects.toThrow("Owner access required");
  }
  await expect(
    t.mutation(api.gas.mutations.updateRelayerAccount, {
      projectId,
      publicKey: RELAYER_PUBLIC_KEY,
      status: GAS_RELAYER_STATUSES.active,
    }),
  ).rejects.toThrow("Not authenticated");

  const created = await owner.mutation(api.gas.mutations.updateRelayerAccount, {
    projectId,
    publicKey: RELAYER_PUBLIC_KEY.toLowerCase(),
    status: GAS_RELAYER_STATUSES.active,
  });
  expect(created).toEqual({
    publicKey: RELAYER_PUBLIC_KEY,
    network: GAS_NETWORK,
    status: GAS_RELAYER_STATUSES.active,
    balanceStroops: null,
    balanceUpdatedAt: null,
    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
  });

  await t.run(async (ctx) => {
    const account = await ctx.db
      .query("relayerAccounts")
      .withIndex("by_project_id_and_network", (q) =>
        q.eq("projectId", projectId).eq("network", GAS_NETWORK),
      )
      .unique();
    if (!account) throw new Error("Relayer account was not created");
    await ctx.db.patch(account._id, {
      balanceStroops: 9876n,
      balanceUpdatedAt: 456,
      createdAt: 123,
    });
  });

  const updated = await owner.mutation(api.gas.mutations.updateRelayerAccount, {
    projectId,
    publicKey: RELAYER_PUBLIC_KEY,
    status: GAS_RELAYER_STATUSES.disabled,
  });
  expect(updated).toMatchObject({
    publicKey: RELAYER_PUBLIC_KEY,
    network: GAS_NETWORK,
    status: GAS_RELAYER_STATUSES.disabled,
    balanceStroops: "9876",
    balanceUpdatedAt: 456,
    createdAt: 123,
  });
  expect(await viewer.query(api.gas.queries.getRelayerAccount, { projectId })).toEqual(updated);

  const otherProjectId = await createProject(t, OTHER_OWNER);
  await expect(
    asWallet(t, OTHER_OWNER).mutation(api.gas.mutations.updateRelayerAccount, {
      projectId: otherProjectId,
      publicKey: RELAYER_PUBLIC_KEY,
      status: GAS_RELAYER_STATUSES.active,
    }),
  ).rejects.toThrow("already assigned to another project");

  await expect(
    owner.mutation(api.gas.mutations.updateRelayerAccount, {
      projectId,
      publicKey: "not-a-stellar-public-key",
      status: GAS_RELAYER_STATUSES.active,
    }),
  ).rejects.toThrow("Invalid relayer public key");

  const extraAuthority = {
    projectId,
    publicKey: RELAYER_PUBLIC_KEY,
    status: GAS_RELAYER_STATUSES.active,
    network: "mainnet",
    balanceStroops: "1",
    balanceUpdatedAt: 1,
    secretKey: "must-not-be-accepted",
  };
  await expect(
    owner.mutation(api.gas.mutations.updateRelayerAccount, extraAuthority),
  ).rejects.toThrow();
});

test("ambiguous indexed relayer records fail closed", async () => {
  const t = convexTest(schema, modules);
  const owner = asWallet(t, OWNER);
  const projectId = await createProject(t);

  await t.run(async (ctx) => {
    const record = {
      projectId,
      publicKey: RELAYER_PUBLIC_KEY,
      network: GAS_NETWORK,
      status: GAS_RELAYER_STATUSES.active,
      createdAt: NOW,
      updatedAt: NOW,
    } as const;
    await ctx.db.insert("relayerAccounts", record);
    await ctx.db.insert("relayerAccounts", record);
  });

  await expect(owner.query(api.gas.queries.getRelayerAccount, { projectId })).rejects.toThrow();
  await expect(
    owner.mutation(api.gas.mutations.updateRelayerAccount, {
      projectId,
      publicKey: RELAYER_PUBLIC_KEY,
      status: GAS_RELAYER_STATUSES.disabled,
    }),
  ).rejects.toThrow();
});
