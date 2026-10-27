/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { expect, test } from "vitest";

import type { DataModel, Id } from "../../_generated/dataModel";
import type { TestConvexForDataModelAndIdentity } from "convex-test";

import { internal } from "../../_generated/api";
import { GAS_NETWORK } from "../../gas/types";
import schema from "../../schema";

const modules = import.meta.glob("../../**/*.ts");
type TestContext = TestConvexForDataModelAndIdentity<DataModel>;

async function createProject(t: TestContext, index: number): Promise<Id<"projects">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("projects", {
      name: `Custody inventory ${index}`,
      slug: `custody-inventory-${index}`,
      description: "Internal custody summary test",
      metadataJson: "{}",
      metadataHash: "0".repeat(64),
      ownerAddress: "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP",
      status: "draft",
      createdAt: 1,
      updatedAt: 1,
    });
  });
}

test("managed custody inventory groups only counts by deployment and status", async () => {
  const t = convexTest(schema, modules);
  const [developmentProjectId, productionProjectId, unboundProjectId] = await Promise.all([
    createProject(t, 1),
    createProject(t, 2),
    createProject(t, 3),
  ]);

  await t.run(async (ctx) => {
    const common = {
      network: GAS_NETWORK,
      attemptToken: "private-attempt-token",
      attemptCount: 1,
      publicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      keyVersion: "v1",
      nonce: "private-nonce",
      ciphertext: "private-ciphertext",
      authTag: "private-auth-tag",
      createdAt: 1,
      updatedAt: 1,
    } as const;

    await ctx.db.insert("gasRelayerCustody", {
      ...common,
      projectId: developmentProjectId,
      status: "ready",
      deploymentId: "dev:custody-inventory",
    });
    await ctx.db.insert("gasRelayerCustody", {
      ...common,
      projectId: productionProjectId,
      status: "failed",
      deploymentId: "prod:custody-inventory",
    });
    await ctx.db.insert("gasRelayerCustody", {
      ...common,
      projectId: unboundProjectId,
      status: "pending",
    });
  });

  const summary = await t.query(
    internal.gas.custody_internal.getManagedCustodyInventorySummary,
    {},
  );

  expect(summary).toEqual({
    totalRecords: 3,
    byDeploymentId: [
      { deploymentId: null, totalRecords: 1, pending: 1, ready: 0, failed: 0 },
      {
        deploymentId: "dev:custody-inventory",
        totalRecords: 1,
        pending: 0,
        ready: 1,
        failed: 0,
      },
      {
        deploymentId: "prod:custody-inventory",
        totalRecords: 1,
        pending: 0,
        ready: 0,
        failed: 1,
      },
    ],
  });
  const serialized = JSON.stringify(summary);
  for (const secret of [
    "private-attempt-token",
    "private-nonce",
    "private-ciphertext",
    "private-auth-tag",
    "v1",
  ]) {
    expect(serialized).not.toContain(secret);
  }
  expect(serialized).not.toContain("GAAAAAAAA");
  expect(serialized).not.toContain(String(developmentProjectId));
  expect(serialized).not.toContain(String(productionProjectId));
});

test("managed custody inventory reports an empty table without sensitive fields", async () => {
  const t = convexTest(schema, modules);
  await expect(
    t.query(internal.gas.custody_internal.getManagedCustodyInventorySummary, {}),
  ).resolves.toEqual({ totalRecords: 0, byDeploymentId: [] });
});
