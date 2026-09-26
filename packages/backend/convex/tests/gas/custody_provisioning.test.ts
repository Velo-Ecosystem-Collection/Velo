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
  enabled = "true",
  deploymentId = DEPLOYMENT_ID,
): Promise<T> {
  const names = [
    "VELO_GAS_CUSTODY_KEYRING_JSON",
    "VELO_GAS_CUSTODY_DEPLOYMENT_ID",
    "VELO_GAS_MANAGED_RELAYER_PROVISIONING_ENABLED",
  ] as const;
  const previous = names.map((name) => process.env[name]);
  process.env.VELO_GAS_CUSTODY_KEYRING_JSON = keyring;
  process.env.VELO_GAS_CUSTODY_DEPLOYMENT_ID = deploymentId;
  process.env.VELO_GAS_MANAGED_RELAYER_PROVISIONING_ENABLED = enabled;
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

async function createExistingProjectWithoutRelayer(t: TestContext): Promise<Id<"projects">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("projects", {
      name: "Existing project without relayer",
      slug: `existing-without-relayer-${Math.random().toString(36).slice(2)}`,
      description: "Legacy project awaiting owner-initiated Testnet wallet setup",
      metadataJson: "{}",
      metadataHash: "0".repeat(64),
      ownerAddress: OWNER,
      ownerTokenIdentifier: TOKEN_IDENTIFIER,
      status: "registered",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
}

test("new project queues provisioning atomically and publishes only the committed address", async () => {
  vi.useFakeTimers();
  try {
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
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());

      const status = await owner.query(api.gas.queries.getProvisioningStatus, { projectId });
      expect(status.state).toBe("ready");
      expect(status.managed).toBe(true);
      expect(status.deploymentContextMatches).toBe(true);
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
        "deploymentContextMatches",
        "errorCode",
        "managed",
        "publicKey",
        "relayerStatus",
        "state",
      ]);
    });
  } finally {
    vi.useRealTimers();
  }
});

test("managed custody status flags a deployment identity mismatch without exposing custody data", async () => {
  const t = convexTest(schema, modules);
  const owner = asOwner(t);
  const projectId = await createExistingProjectWithoutRelayer(t);
  const publicKey = Keypair.random().publicKey();

  await t.run(async (ctx) => {
    await ctx.db.insert("relayerAccounts", {
      projectId,
      publicKey,
      network: GAS_NETWORK,
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("gasRelayerCustody", {
      projectId,
      network: GAS_NETWORK,
      status: "ready",
      attemptToken: "private-attempt-token",
      attemptCount: 1,
      publicKey,
      deploymentId: DEPLOYMENT_ID,
      keyVersion: "v1",
      nonce: "private-nonce",
      ciphertext: "private-ciphertext",
      authTag: "private-auth-tag",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  const previousDeploymentId = process.env.VELO_GAS_CUSTODY_DEPLOYMENT_ID;
  process.env.VELO_GAS_CUSTODY_DEPLOYMENT_ID = "prod:gas-custody-provisioning";
  try {
    const status = await owner.query(api.gas.queries.getProvisioningStatus, { projectId });
    expect(status).toMatchObject({
      state: "ready",
      managed: true,
      publicKey,
      relayerStatus: "active",
      deploymentContextMatches: false,
    });
    expect(JSON.stringify(status)).not.toMatch(
      /ciphertext|nonce|authTag|deploymentId|keyVersion|private-attempt-token/,
    );
  } finally {
    if (previousDeploymentId === undefined) delete process.env.VELO_GAS_CUSTODY_DEPLOYMENT_ID;
    else process.env.VELO_GAS_CUSTODY_DEPLOYMENT_ID = previousDeploymentId;
  }
});

test("an owner can provision an existing project with no custody or relayer and publish only committed custody", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema, modules);
    const owner = asOwner(t);
    const projectId = await createExistingProjectWithoutRelayer(t);

    expect(await owner.query(api.gas.queries.getProvisioningStatus, { projectId })).toEqual({
      state: "not_configured",
      managed: false,
      publicKey: null,
      relayerStatus: null,
      deploymentContextMatches: null,
      errorCode: null,
    });
    expect(await owner.query(api.gas.queries.getRelayerAccount, { projectId })).toBeNull();
    expect(
      await t.run(async (ctx) =>
        ctx.db
          .query("gasRelayerCustody")
          .withIndex("by_project_id", (q) => q.eq("projectId", projectId))
          .take(2),
      ),
    ).toHaveLength(0);

    await withProvisioningEnvironment(async () => {
      expect(await owner.mutation(api.gas.mutations.retryProvisioning, { projectId })).toBe(
        "queued",
      );
      const queuedStatus = await owner.query(api.gas.queries.getProvisioningStatus, {
        projectId,
      });
      if (queuedStatus.state === "pending") {
        expect(queuedStatus.publicKey).toBeNull();
        expect(await owner.query(api.gas.queries.getRelayerAccount, { projectId })).toBeNull();
      }

      const firstAttempt = await t.run(async (ctx) =>
        ctx.db
          .query("gasRelayerCustody")
          .withIndex("by_project_id", (q) => q.eq("projectId", projectId))
          .unique(),
      );
      expect(firstAttempt?.attemptCount).toBe(1);
      expect(["pending", "ready"]).toContain(firstAttempt?.status);

      const duplicateResult = await owner.mutation(api.gas.mutations.retryProvisioning, {
        projectId,
      });
      expect(["already_pending", "already_ready"]).toContain(duplicateResult);

      await t.finishAllScheduledFunctions(() => vi.runAllTimers());

      const status = await owner.query(api.gas.queries.getProvisioningStatus, { projectId });
      expect(status).toMatchObject({ state: "ready", managed: true, errorCode: null });
      expect(status.publicKey).toMatch(/^G[A-Z2-7]{55}$/);
      const custody = await t.run(async (ctx) =>
        ctx.db
          .query("gasRelayerCustody")
          .withIndex("by_project_id", (q) => q.eq("projectId", projectId))
          .unique(),
      );
      const relayer = await owner.query(api.gas.queries.getRelayerAccount, { projectId });
      expect(custody?.status).toBe("ready");
      expect(custody?.ciphertext).toBeTruthy();
      expect(custody?.nonce).toBeTruthy();
      expect(custody?.authTag).toBeTruthy();
      expect(relayer?.publicKey).toBe(status.publicKey);
      expect(relayer?.status).toBe("active");
      expect(await owner.query(api.gas.queries.getPolicy, { projectId })).toBeNull();
      expect(Object.keys(status).sort()).toEqual([
        "deploymentContextMatches",
        "errorCode",
        "managed",
        "publicKey",
        "relayerStatus",
        "state",
      ]);
      expect(JSON.stringify(status)).not.toMatch(
        /ciphertext|nonce|authTag|deploymentId|keyVersion/,
      );
      expect(custody?.attemptCount).toBe(1);
      expect(await owner.mutation(api.gas.mutations.retryProvisioning, { projectId })).toBe(
        "already_ready",
      );
    });
  } finally {
    vi.useRealTimers();
  }
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

test("verifies and migrates a mismatched deployment context without changing the relayer address", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema, modules);
    const owner = asOwner(t);
    const targetDeploymentId = "prod:custody-migration-test";
    const { projectId, publicKey } = await withProvisioningEnvironment(async () => {
      const projectId = await owner.mutation(api.projects.mutation.createDraft, {
        name: "Context migration project",
        slug: "context-migration-project",
        description: "Rebind authenticated custody context without replacing the account",
        metadataJson: "{}",
        metadataHash: "0".repeat(64),
        ownerAddress: OWNER,
      });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
      const status = await owner.query(api.gas.queries.getProvisioningStatus, { projectId });
      expect(status.state).toBe("ready");
      return { projectId, publicKey: status.publicKey! };
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("gasPolicies", {
        projectId,
        enabled: false,
        network: GAS_NETWORK,
        dailyCapStroops: 10_000_000n,
        dailyReservedStroops: 0n,
        dailyWindowKey: new Date().toISOString().slice(0, 10),
        walletHourlyLimit: 100,
        allowedContractIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const before = await t.run(async (ctx) =>
      ctx.db
        .query("gasRelayerCustody")
        .withIndex("by_project_id", (q) => q.eq("projectId", projectId))
        .first(),
    );
    expect(before?.deploymentId).toBe(DEPLOYMENT_ID);

    await withProvisioningEnvironment(
      async () => {
        await expect(
          t.action(internal.gas.relayer.recoverCustodyDeploymentContext, {
            projectId,
            expectedStoredDeploymentId: DEPLOYMENT_ID,
            expectedPublicKey: publicKey,
            mode: "verify",
          }),
        ).resolves.toBe("verified");
        const afterVerify = await t.run(async (ctx) =>
          ctx.db
            .query("gasRelayerCustody")
            .withIndex("by_project_id", (q) => q.eq("projectId", projectId))
            .first(),
        );
        expect(afterVerify).toMatchObject({
          deploymentId: DEPLOYMENT_ID,
          keyVersion: before?.keyVersion,
          publicKey,
        });

        await expect(
          t.action(internal.gas.relayer.recoverCustodyDeploymentContext, {
            projectId,
            expectedStoredDeploymentId: DEPLOYMENT_ID,
            expectedPublicKey: publicKey,
            mode: "migrate",
          }),
        ).resolves.toBe("migrated");
      },
      ROTATED_KEYRING,
      "true",
      targetDeploymentId,
    );

    const migrated = await t.run(async (ctx) =>
      ctx.db
        .query("gasRelayerCustody")
        .withIndex("by_project_id", (q) => q.eq("projectId", projectId))
        .first(),
    );
    expect(migrated).toMatchObject({
      deploymentId: targetDeploymentId,
      keyVersion: "v2",
      publicKey,
      status: "ready",
    });
    expect(migrated?.ciphertext).not.toBe(before?.ciphertext);
    const secret = await decryptGasRelayerSecret(
      {
        keyVersion: migrated!.keyVersion!,
        nonce: migrated!.nonce!,
        ciphertext: migrated!.ciphertext!,
        authTag: migrated!.authTag!,
      },
      parseGasCustodyKeyring(ROTATED_KEYRING),
      { deploymentId: targetDeploymentId, projectId, network: GAS_NETWORK, publicKey },
    );
    expect(Keypair.fromSecret(secret).publicKey()).toBe(publicKey);
    expect(JSON.stringify(migrated)).not.toContain(secret);
  } finally {
    vi.useRealTimers();
  }
});

test("custody deployment-context recovery fails closed when paused state or key access is missing", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema, modules);
    const owner = asOwner(t);
    const targetDeploymentId = "prod:custody-migration-blocked";
    const { projectId, publicKey } = await withProvisioningEnvironment(async () => {
      const projectId = await owner.mutation(api.projects.mutation.createDraft, {
        name: "Blocked context migration project",
        slug: "blocked-context-migration-project",
        description: "Recovery refuses a keyring without the recorded version",
        metadataJson: "{}",
        metadataHash: "0".repeat(64),
        ownerAddress: OWNER,
      });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
      const status = await owner.query(api.gas.queries.getProvisioningStatus, { projectId });
      expect(status.state).toBe("ready");
      return { projectId, publicKey: status.publicKey! };
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("gasPolicies", {
        projectId,
        enabled: true,
        network: GAS_NETWORK,
        dailyCapStroops: 10_000_000n,
        dailyReservedStroops: 0n,
        dailyWindowKey: new Date().toISOString().slice(0, 10),
        walletHourlyLimit: 100,
        allowedContractIds: ["C" + "A".repeat(55)],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await withProvisioningEnvironment(
      async () => {
        await expect(
          t.action(internal.gas.relayer.recoverCustodyDeploymentContext, {
            projectId,
            expectedStoredDeploymentId: DEPLOYMENT_ID,
            expectedPublicKey: publicKey,
            mode: "migrate",
          }),
        ).resolves.toBe("sponsorship_enabled");
      },
      ROTATED_KEYRING,
      "true",
      targetDeploymentId,
    );

    await t.run(async (ctx) => {
      const policies = await ctx.db
        .query("gasPolicies")
        .withIndex("by_project_id", (q) => q.eq("projectId", projectId))
        .take(2);
      await ctx.db.patch(policies[0]!._id, { enabled: false, updatedAt: Date.now() });
      const relayer = await ctx.db
        .query("relayerAccounts")
        .withIndex("by_project_id_and_network", (q) =>
          q.eq("projectId", projectId).eq("network", GAS_NETWORK),
        )
        .unique();
      expect(relayer).not.toBeNull();
      await ctx.db.insert("gasProjectMaintenance", {
        projectId,
        withdrawalRequestId: "operator-context-migration-test",
        ownerWallet: OWNER,
        relayerId: relayer!._id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    await withProvisioningEnvironment(
      async () => {
        await expect(
          t.action(internal.gas.relayer.recoverCustodyDeploymentContext, {
            projectId,
            expectedStoredDeploymentId: DEPLOYMENT_ID,
            expectedPublicKey: publicKey,
            mode: "migrate",
          }),
        ).resolves.toBe("maintenance_locked");
      },
      ROTATED_KEYRING,
      "true",
      targetDeploymentId,
    );
    await t.run(async (ctx) => {
      const locks = await ctx.db
        .query("gasProjectMaintenance")
        .withIndex("by_project_id", (q) => q.eq("projectId", projectId))
        .take(2);
      await ctx.db.delete(locks[0]!._id);
    });

    const custodyBeforeMissingKey = await t.run(async (ctx) =>
      ctx.db
        .query("gasRelayerCustody")
        .withIndex("by_project_id", (q) => q.eq("projectId", projectId))
        .first(),
    );
    const keyringMissingV1 = JSON.stringify({
      activeVersion: "v2",
      keys: { v2: btoa(String.fromCharCode(...new Uint8Array(32).fill(12))) },
    });
    await withProvisioningEnvironment(
      async () => {
        await expect(
          t.action(internal.gas.relayer.recoverCustodyDeploymentContext, {
            projectId,
            expectedStoredDeploymentId: DEPLOYMENT_ID,
            expectedPublicKey: publicKey,
            mode: "migrate",
          }),
        ).resolves.toBe("custody_unavailable");
      },
      keyringMissingV1,
      "true",
      targetDeploymentId,
    );
    const custodyAfter = await t.run(async (ctx) =>
      ctx.db
        .query("gasRelayerCustody")
        .withIndex("by_project_id", (q) => q.eq("projectId", projectId))
        .first(),
    );
    expect(custodyAfter).toMatchObject({
      deploymentId: custodyBeforeMissingKey?.deploymentId,
      keyVersion: custodyBeforeMissingKey?.keyVersion,
      nonce: custodyBeforeMissingKey?.nonce,
      ciphertext: custodyBeforeMissingKey?.ciphertext,
      authTag: custodyBeforeMissingKey?.authTag,
    });
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

test("rollback fails closed for new provisioning attempts while retaining the project", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema, modules);
    const owner = asOwner(t);
    const projectId = await createExistingProjectWithoutRelayer(t);

    await withProvisioningEnvironment(
      async () => {
        expect(await owner.mutation(api.gas.mutations.retryProvisioning, { projectId })).toBe(
          "queued",
        );
        await t.finishAllScheduledFunctions(() => vi.runAllTimers());

        expect(await owner.query(api.projects.query.getById, { id: projectId })).not.toBeNull();
        expect(
          await owner.query(api.gas.queries.getProvisioningStatus, { projectId }),
        ).toMatchObject({
          state: "failed",
          managed: true,
          publicKey: null,
          errorCode: "provisioning_disabled",
        });
        expect(await owner.query(api.gas.queries.getRelayerAccount, { projectId })).toBeNull();
        expect(
          await t.run(async (ctx) =>
            ctx.db
              .query("gasRelayerCustody")
              .withIndex("by_project_id", (q) => q.eq("projectId", projectId))
              .take(2),
          ),
        ).toHaveLength(1);
      },
      KEYRING,
      "false",
    );
  } finally {
    vi.useRealTimers();
  }
});
