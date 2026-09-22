/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { expect, test } from "vitest";

import type { DataModel, Id } from "../../_generated/dataModel";
import type { GasConsoleCapability } from "../../gas/authorization.ts";
import type { TestConvexForDataModelAndIdentity } from "convex-test";

import { requireGasConsoleAccess, verifyApiKeyForGas } from "../../gas/authorization.ts";
import schema from "../../schema";

const modules = import.meta.glob("../../**/*.ts");
type TestContext = TestConvexForDataModelAndIdentity<DataModel>;

const OWNER = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
const EDITOR = "GBNHK3TLWWXBCEGNFHB45Z66R4AI5YUALKUFBP4WF7YK5JLZIAAG2DLI";
const VIEWER = "GDFWQCS3C72IWT5QV6CJYCMCQZ4WQ2QELSE6ABWI5Q3XRZ6BPGRS6LZV";
const OTHER_OWNER = "GCZCSOTTJVGJNVXKUUEPGZRWWEB4HOFCQLMZJX6VIP4C4ZURI4HVOIMA";
const NOW = 1_757_000_000_000;

function asWallet(t: TestContext, address: string) {
  return t.withIdentity({
    subject: address,
    issuer: "http://localhost:3000",
    tokenIdentifier: `http://localhost:3000|${address}`,
  });
}

async function createProject(
  t: TestContext,
  ownerAddress: string,
  options: { paymentAccessActive?: boolean } = {},
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("projects", {
      name: `Gas Authorization ${ownerAddress.slice(1, 7)}`,
      slug: `gas-authorization-${ownerAddress.slice(1, 7).toLowerCase()}`,
      description: "Gas authorization tests",
      metadataJson: "{}",
      metadataHash: "0".repeat(64),
      ownerAddress,
      ownerTokenIdentifier: `http://localhost:3000|${ownerAddress}`,
      status: "draft",
      ...(options.paymentAccessActive === undefined
        ? {}
        : { paymentAccessActive: options.paymentAccessActive }),
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

async function addApiKey(
  t: TestContext,
  projectId: Id<"projects">,
  keyHash: string,
  revoked = false,
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("apiKeys", {
      projectId,
      keyHash,
      prefix: "tk_live_test...hash",
      label: "Gas authorization test key",
      createdAt: NOW,
      requestCount: 0,
      revoked,
    });
  });
}

test("Gas console capabilities enforce owner/editor/viewer roles", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t, OWNER);
  await addMembership(t, projectId, EDITOR, "editor");
  await addMembership(t, projectId, VIEWER, "viewer");

  const matrix = [
    {
      address: OWNER,
      role: "owner" as const,
      capabilities: ["read", "updatePolicy", "updateRelayer"],
    },
    { address: EDITOR, role: "editor" as const, capabilities: ["read", "updatePolicy"] },
    { address: VIEWER, role: "viewer" as const, capabilities: ["read"] },
  ] as const;

  for (const entry of matrix) {
    const wallet = asWallet(t, entry.address);
    for (const capability of entry.capabilities) {
      const role = await wallet.query(async (ctx) => {
        const access = await requireGasConsoleAccess(
          ctx,
          projectId,
          capability as GasConsoleCapability,
        );
        return access.role;
      });
      expect(role).toBe(entry.role);
    }
  }

  const ownerMutationRole = await asWallet(t, OWNER).mutation(async (ctx) => {
    const access = await requireGasConsoleAccess(ctx, projectId, "updateRelayer");
    return access.role;
  });
  expect(ownerMutationRole).toBe("owner");

  await expect(
    asWallet(t, EDITOR).query(async (ctx) =>
      requireGasConsoleAccess(ctx, projectId, "updateRelayer"),
    ),
  ).rejects.toThrow("Owner access required");
  await expect(
    asWallet(t, VIEWER).query(async (ctx) =>
      requireGasConsoleAccess(ctx, projectId, "updatePolicy"),
    ),
  ).rejects.toThrow("Editor access required");
  await expect(
    asWallet(t, VIEWER).query(async (ctx) =>
      requireGasConsoleAccess(ctx, projectId, "updateRelayer"),
    ),
  ).rejects.toThrow("Owner access required");
});

test("Gas console access rejects unauthenticated, non-member, and cross-project callers", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t, OWNER);
  const otherProjectId = await createProject(t, OTHER_OWNER);
  await addMembership(t, projectId, EDITOR, "editor");

  await expect(
    t.query(async (ctx) => requireGasConsoleAccess(ctx, projectId, "read")),
  ).rejects.toThrow("Not authenticated");
  await expect(
    asWallet(t, VIEWER).query(async (ctx) => requireGasConsoleAccess(ctx, projectId, "read")),
  ).rejects.toThrow("Unauthorized");
  await expect(
    asWallet(t, EDITOR).query(async (ctx) => requireGasConsoleAccess(ctx, otherProjectId, "read")),
  ).rejects.toThrow("Unauthorized");
});

test("valid Gas API keys return only their stored project scope regardless of payment access", async () => {
  const t = convexTest(schema, modules);
  const inactiveProjectId = await createProject(t, OWNER, { paymentAccessActive: false });
  const absentPaymentGateProjectId = await createProject(t, OTHER_OWNER);
  const inactiveKeyHash = "a".repeat(64);
  const absentPaymentGateKeyHash = "b".repeat(64);
  const inactiveKeyId = await addApiKey(t, inactiveProjectId, inactiveKeyHash);
  const absentPaymentGateKeyId = await addApiKey(
    t,
    absentPaymentGateProjectId,
    absentPaymentGateKeyHash,
  );

  const inactiveResult = await t.mutation(async (ctx) => verifyApiKeyForGas(ctx, inactiveKeyHash));
  expect(inactiveResult).toEqual({
    authorized: true,
    apiKeyId: inactiveKeyId,
    projectId: inactiveProjectId,
  });
  expect(Object.keys(inactiveResult).sort()).toEqual(["apiKeyId", "authorized", "projectId"]);

  const absentPaymentGateResult = await t.query(async (ctx) =>
    verifyApiKeyForGas(ctx, absentPaymentGateKeyHash),
  );
  expect(absentPaymentGateResult).toEqual({
    authorized: true,
    apiKeyId: absentPaymentGateKeyId,
    projectId: absentPaymentGateProjectId,
  });
});

test("invalid Gas API keys fail uniformly for missing, malformed, unknown, revoked, orphaned, and duplicate hashes", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t, OWNER);
  const revokedHash = "c".repeat(64);
  const orphanedHash = "d".repeat(64);
  const duplicateHash = "e".repeat(64);
  await addApiKey(t, projectId, revokedHash, true);
  const orphanedProjectId = await createProject(t, OTHER_OWNER);
  await addApiKey(t, orphanedProjectId, orphanedHash);
  await t.run(async (ctx) => {
    await ctx.db.delete(orphanedProjectId);
    await ctx.db.insert("apiKeys", {
      projectId,
      keyHash: duplicateHash,
      prefix: "tk_live_test...hash",
      label: "Duplicate key 1",
      createdAt: NOW,
      requestCount: 0,
      revoked: false,
    });
    await ctx.db.insert("apiKeys", {
      projectId,
      keyHash: duplicateHash,
      prefix: "tk_live_test...hash",
      label: "Duplicate key 2",
      createdAt: NOW,
      requestCount: 0,
      revoked: false,
    });
  });

  const invalidInputs: unknown[] = [
    undefined,
    null,
    "not-a-sha256-hash",
    "a".repeat(63),
    "a".repeat(65),
    "A".repeat(64),
    "f".repeat(64),
    revokedHash,
    orphanedHash,
    duplicateHash,
  ];

  for (const invalidInput of invalidInputs) {
    const result = await t.query(async (ctx) => verifyApiKeyForGas(ctx, invalidInput));
    expect(result).toEqual({ authorized: false });
    expect(Object.keys(result)).toEqual(["authorized"]);
  }
});
