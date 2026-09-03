/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { expect, test } from "vitest";

import type { DataModel, Id } from "../../_generated/dataModel";
import type { TestConvexForDataModelAndIdentity } from "convex-test";

import { api } from "../../_generated/api";
import { GAS_NETWORK, GAS_RELAYER_STATUSES } from "../../gas/types";
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
    dailyReservedStroops: "250",
    dailyWindowKey: "2026-01-01",
    walletHourlyLimit: 0,
    allowedContractIds: [],
    createdAt: 123,
  });
  expect(updated.updatedAt).toBeGreaterThanOrEqual(NOW);
  expect(await viewer.query(api.gas.queries.getPolicy, { projectId })).toEqual(updated);
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
