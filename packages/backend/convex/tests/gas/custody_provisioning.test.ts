/// <reference types="vite/client" />

import { Keypair } from "@stellar/stellar-sdk";
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";

import type { DataModel, Id } from "../../_generated/dataModel";
import type { TestConvexForDataModelAndIdentity } from "convex-test";

import { api, internal } from "../../_generated/api";
import { decryptGasRelayerSecret, parseGasCustodyKeyring } from "../../gas/custody_crypto";
import { GAS_NETWORK } from "../../gas/types";
import schema from "../../schema";

const modules = import.meta.glob("../../**/*.ts");
const OWNER = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
const TOKEN_IDENTIFIER = `http://localhost:3000|${OWNER}`;
const DEPLOYMENT_ID = "dev:gas-custody-provisioning";
const KEYRING = JSON.stringify({
  activeVersion: "v1",
  keys: { v1: btoa(String.fromCharCode(...new Uint8Array(32).fill(11))) },
});
const ROTATED_KEYRING = JSON.stringify({
  activeVersion: "v2",
  keys: {
    v1: btoa(String.fromCharCode(...new Uint8Array(32).fill(11))),
    v2: btoa(String.fromCharCode(...new Uint8Array(32).fill(12))),
  },
});
type TestContext = TestConvexForDataModelAndIdentity<DataModel>;

function asOwner(t: TestContext) {
  return t.withIdentity({
    subject: OWNER,
    issuer: "http://localhost:3000",
    tokenIdentifier: TOKEN_IDENTIFIER,
  });
}

async function withProvisioningEnvironment<T>(
  callback: () => Promise<T>,
  keyring = KEYRING,
): Promise<T> {
  const names = [
    "VELO_GAS_CUSTODY_KEYRING_JSON",
    "VELO_GAS_CUSTODY_DEPLOYMENT_ID",
    "VELO_GAS_MANAGED_RELAYER_PROVISIONING_ENABLED",
  ] as const;
  const previous = names.map((name) => process.env[name]);
  process.env.VELO_GAS_CUSTODY_KEYRING_JSON = keyring;
  process.env.VELO_GAS_CUSTODY_DEPLOYMENT_ID = DEPLOYMENT_ID;
  process.env.VELO_GAS_MANAGED_RELAYER_PROVISIONING_ENABLED = "true";
  try {
    return await callback();
  } finally {
    names.forEach((name, index) => {
      const value = previous[index];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    });
  }
}

async function createPendingProject(t: TestContext): Promise<Id<"projects">> {
  return await t.run(async (ctx) => {
    const projectId = await ctx.db.insert("projects", {
      name: "Concurrent custody project",
      slug: `concurrent-custody-${Math.random().toString(36).slice(2)}`,
      description: "Provisioning race test",
      metadataJson: "{}",
      metadataHash: "0".repeat(64),
      ownerAddress: OWNER,
      ownerTokenIdentifier: TOKEN_IDENTIFIER,
      status: "draft",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("gasRelayerCustody", {
      projectId,
      network: GAS_NETWORK,
      status: "pending",
      attemptToken: "shared-attempt-token",
      attemptCount: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return projectId;
  });
}

test("new project queues provisioning atomically and publishes only the committed address", async () => {
  const t = convexTest(schema, modules);
  const owner = asOwner(t);

  await withProvisioningEnvironment(async () => {
    const projectId = await owner.mutation(api.projects.mutation.createDraft, {
      name: "Managed Gas project",
      slug: "managed-gas-project",
      description: "A new project with managed Testnet custody",
      metadataJson: "{}",
      metadataHash: "0".repeat(64),
      ownerAddress: OWNER,
    });

    const status = await owner.query(api.gas.queries.getProvisioningStatus, { projectId });
    expect(status.state).toBe("ready");
    expect(status.managed).toBe(true);
    expect(status.publicKey).toMatch(/^G[A-Z2-7]{55}$/);

    const custodyRows = await t.run(async (ctx) =>
      ctx.db
        .query("gasRelayerCustody")
        .withIndex("by_project_id", (q) => q.eq("projectId", projectId))
        .take(2),
    );
    expect(custodyRows).toHaveLength(1);
    const custody = custodyRows[0];
    expect(custody?.status).toBe("ready");
    expect(custody?.ciphertext).toBeTruthy();
    expect(custody?.authTag).toBeTruthy();
    expect(custody?.nonce).toBeTruthy();

    const secret = await decryptGasRelayerSecret(
      {
        keyVersion: custody!.keyVersion!,
        nonce: custody!.nonce!,
        ciphertext: custody!.ciphertext!,
        authTag: custody!.authTag!,
      },
      parseGasCustodyKeyring(KEYRING),
      {
        deploymentId: DEPLOYMENT_ID,
        projectId,
        network: GAS_NETWORK,
        publicKey: custody!.publicKey!,
      },
    );
    expect(Keypair.fromSecret(secret).publicKey()).toBe(status.publicKey);
    expect(JSON.stringify(custody)).not.toContain(secret);
    expect(Object.keys(status).sort()).toEqual([
      "errorCode",
      "managed",
      "publicKey",
      "relayerStatus",
      "state",
    ]);
  });
});

test("concurrent provisioning workers commit one encrypted candidate and discard the rest", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createPendingProject(t);

  await withProvisioningEnvironment(async () => {
    await Promise.all([
      t.action(internal.gas.relayer.provisionProject, {
        projectId,
        attemptToken: "shared-attempt-token",
      }),
      t.action(internal.gas.relayer.provisionProject, {
        projectId,
        attemptToken: "shared-attempt-token",
      }),
    ]);
  });

  const custodyRows = await t.run(async (ctx) =>
    ctx.db
      .query("gasRelayerCustody")
      .withIndex("by_project_id", (q) => q.eq("projectId", projectId))
      .take(2),
  );
  const relayerRows = await t.run(async (ctx) =>
    ctx.db
      .query("relayerAccounts")
      .withIndex("by_project_id_and_network", (q) =>
        q.eq("projectId", projectId).eq("network", GAS_NETWORK),
      )
      .take(2),
  );
  expect(custodyRows).toHaveLength(1);
  expect(relayerRows).toHaveLength(1);
  expect(custodyRows[0]?.publicKey).toBe(relayerRows[0]?.publicKey);
  expect(custodyRows[0]?.status).toBe("ready");
});

test("rotates ciphertext metadata without changing the account and rejects stale rotation commits", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema, modules);
    const owner = asOwner(t);

    const { projectId, originalStatus } = await withProvisioningEnvironment(async () => {
      const projectId = await owner.mutation(api.projects.mutation.createDraft, {
        name: "Rotating managed project",
        slug: "rotating-managed-project",
        description: "Encryption key rotation preserves the Testnet account",
        metadataJson: "{}",
        metadataHash: "0".repeat(64),
        ownerAddress: OWNER,
      });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
      const originalStatus = await owner.query(api.gas.queries.getProvisioningStatus, {
        projectId,
      });
      return { projectId, originalStatus };
    });
    expect(originalStatus.state).toBe("ready");

    await withProvisioningEnvironment(
      () => t.action(internal.gas.relayer.rotateCustodyEncryptionKey, { projectId }),
      ROTATED_KEYRING,
    ).then((result) => expect(result).toBe("rotated"));

    const rotated = await t.run(async (ctx) =>
      ctx.db
        .query("gasRelayerCustody")
        .withIndex("by_project_id", (q) => q.eq("projectId", projectId))
        .first(),
    );
    expect(rotated?.keyVersion).toBe("v2");
    expect(rotated?.publicKey).toBe(originalStatus.publicKey);
    const secret = await decryptGasRelayerSecret(
      {
        keyVersion: rotated!.keyVersion!,
        nonce: rotated!.nonce!,
        ciphertext: rotated!.ciphertext!,
        authTag: rotated!.authTag!,
      },
      parseGasCustodyKeyring(ROTATED_KEYRING),
      {
        deploymentId: DEPLOYMENT_ID,
        projectId,
        network: GAS_NETWORK,
        publicKey: rotated!.publicKey!,
      },
    );
    expect(Keypair.fromSecret(secret).publicKey()).toBe(originalStatus.publicKey);

    expect(
      await t.mutation(internal.gas.execution.rotateProvisionedCustodyKey, {
        projectId,
        expectedKeyVersion: "v1",
        deploymentId: DEPLOYMENT_ID,
        keyVersion: "v3",
        nonce: "stale-nonce",
        ciphertext: "stale-ciphertext",
        authTag: "stale-tag",
      }),
    ).toBe("stale");
    await withProvisioningEnvironment(
      () => t.action(internal.gas.relayer.rotateCustodyEncryptionKey, { projectId }),
      ROTATED_KEYRING,
    ).then((result) => expect(result).toBe("already_current"));
  } finally {
    vi.useRealTimers();
  }
});

test("missing encryption configuration leaves the project usable and stores no address", async () => {
  const t = convexTest(schema, modules);
  const owner = asOwner(t);
  const projectId = await owner.mutation(api.projects.mutation.createDraft, {
    name: "Provisioning failure project",
    slug: "provisioning-failure-project",
    description: "Provisioning fails closed without deployment custody configuration",
    metadataJson: "{}",
    metadataHash: "0".repeat(64),
    ownerAddress: OWNER,
  });

  expect(await owner.query(api.projects.query.getById, { id: projectId })).not.toBeNull();
  expect(await owner.query(api.gas.queries.getProvisioningStatus, { projectId })).toMatchObject({
    state: "failed",
    managed: true,
    publicKey: null,
    errorCode: "provisioning_disabled",
  });
  expect(
    await t.run(async (ctx) =>
      ctx.db
        .query("relayerAccounts")
        .withIndex("by_project_id_and_network", (q) =>
          q.eq("projectId", projectId).eq("network", GAS_NETWORK),
        )
        .take(2),
    ),
  ).toHaveLength(0);
});
