/// <reference types="vite/client" />

import { GAS_TEST_RELAYER_KEYPAIR, keypairForLabel } from "@repo/stellar/test-fixtures";
import { Keypair } from "@stellar/stellar-sdk";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";

import type { DataModel, Id } from "../../_generated/dataModel";
import type { ActionCtx } from "../../_generated/server";
import type { GasRelayerCustodyLookup } from "../../gas/custody_internal";
import type { GasRelayerMetadataLookup } from "../../gas/public_api_internal";
import type { TestConvexForDataModelAndIdentity } from "convex-test";

import { internal } from "../../_generated/api";
import { encryptGasRelayerSecret, parseGasCustodyKeyring } from "../../gas/custody_crypto";
import {
  GAS_MAX_RELAYER_SIGNERS_JSON_BYTES,
  GAS_RELAYER_SIGNERS_ENV,
  RelayerCustodyError,
  withTestnetRelayerSigner,
} from "../../gas/relayer";
import { GAS_NETWORK, GAS_RELAYER_STATUSES } from "../../gas/types";
import schema from "../../schema";

const modules = import.meta.glob("../../**/*.ts");
const OWNER = "GD7O2C226SF2677PFFUVD6O2ICFOBNCWPI5Z46N43ZSFQGLM65U3I2SP";
const NOW = Date.parse("2026-09-05T04:00:00.000Z");
const OTHER_RELAYER_KEYPAIR = keypairForLabel("gas-other-relayer");
type TestContext = TestConvexForDataModelAndIdentity<DataModel>;

async function createProject(t: TestContext, suffix: string): Promise<Id<"projects">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("projects", {
      name: `Gas Relayer Custody ${suffix}`,
      slug: `gas-relayer-custody-${suffix}`,
      description: "Relayer custody test project",
      metadataJson: "{}",
      metadataHash: "0".repeat(64),
      ownerAddress: OWNER,
      status: "draft",
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
}

async function createRelayerMetadata(
  t: TestContext,
  projectId: Id<"projects">,
  options: { publicKey?: string; status?: "active" | "disabled" } = {},
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("relayerAccounts", {
      projectId,
      publicKey: options.publicKey ?? GAS_TEST_RELAYER_KEYPAIR.publicKey(),
      network: GAS_NETWORK,
      status: options.status ?? GAS_RELAYER_STATUSES.active,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
}

function signerConfiguration(
  projectId: string,
  keypair: Keypair = GAS_TEST_RELAYER_KEYPAIR,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify([
    {
      projectId,
      network: GAS_NETWORK,
      secretKey: keypair.secret(),
      ...extra,
    },
  ]);
}

async function withSignerConfiguration<T>(
  configuration: string | undefined,
  callback: () => Promise<T>,
): Promise<T> {
  const previous = process.env[GAS_RELAYER_SIGNERS_ENV];
  if (configuration === undefined) delete process.env[GAS_RELAYER_SIGNERS_ENV];
  else process.env[GAS_RELAYER_SIGNERS_ENV] = configuration;

  try {
    return await callback();
  } finally {
    if (previous === undefined) delete process.env[GAS_RELAYER_SIGNERS_ENV];
    else process.env[GAS_RELAYER_SIGNERS_ENV] = previous;
  }
}

async function withManagedCustodyEnvironment<T>(
  options: { keyring: string | undefined; deploymentId: string | undefined; enabled?: string },
  callback: () => Promise<T>,
): Promise<T> {
  const names = [
    "VELO_GAS_CUSTODY_KEYRING_JSON",
    "VELO_GAS_CUSTODY_DEPLOYMENT_ID",
    "VELO_GAS_MANAGED_RELAYER_PROVISIONING_ENABLED",
  ] as const;
  const previous = names.map((name) => process.env[name]);
  const values = [options.keyring, options.deploymentId, options.enabled];
  names.forEach((name, index) => {
    const value = values[index];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  });
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

function actionContext(
  metadata: GasRelayerMetadataLookup,
  custody: GasRelayerCustodyLookup = null,
): ActionCtx {
  let queryCount = 0;
  return {
    runQuery: async () => (queryCount++ === 0 ? metadata : custody),
  } as unknown as ActionCtx;
}

async function expectSigningBlocked(
  projectId: Id<"projects">,
  configuration: string | undefined,
  metadata: GasRelayerMetadataLookup,
  expectedStatus: RelayerCustodyError["status"],
): Promise<void> {
  let callbackCalled = false;
  await expect(
    withSignerConfiguration(configuration, async () =>
      withTestnetRelayerSigner(actionContext(metadata), projectId, () => {
        callbackCalled = true;
      }),
    ),
  ).rejects.toMatchObject({ status: expectedStatus });
  expect(callbackCalled).toBe(false);
}

test("resolves active Testnet custody and verifies an in-memory signature", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t, "ready");
  await createRelayerMetadata(t, projectId);
  const configuration = signerConfiguration(projectId);

  await withSignerConfiguration(configuration, async () => {
    const readiness = await t.action(internal.gas.relayer.readiness, { projectId });
    expect(readiness).toEqual({
      status: "ready",
      network: GAS_NETWORK,
      publicKey: GAS_TEST_RELAYER_KEYPAIR.publicKey(),
    });

    const message = new TextEncoder().encode("custody-boundary-test");
    const signature = await withTestnetRelayerSigner(
      actionContext({
        status: "active",
        network: GAS_NETWORK,
        publicKey: GAS_TEST_RELAYER_KEYPAIR.publicKey(),
      }),
      projectId,
      (signer) => {
        expect(signer.publicKey).toBe(GAS_TEST_RELAYER_KEYPAIR.publicKey());
        expect(JSON.stringify(signer)).not.toContain(GAS_TEST_RELAYER_KEYPAIR.secret());
        return signer.sign(message);
      },
    );

    expect(
      Keypair.fromPublicKey(GAS_TEST_RELAYER_KEYPAIR.publicKey()).verify(
        Buffer.from(message),
        Buffer.from(signature),
      ),
    ).toBe(true);
  });
});

test("internal custody configuration status returns version metadata but never key material", async () => {
  const t = convexTest(schema, modules);
  const key = String.fromCharCode(...new Uint8Array(32).fill(11));
  const keyring = JSON.stringify({ activeVersion: "v1", keys: { v1: btoa(key) } });

  await withManagedCustodyEnvironment(
    {
      keyring,
      deploymentId: " dev:gas-custody-status ",
      enabled: "true",
    },
    async () => {
      const status = await t.action(internal.gas.relayer.custodyConfigurationStatus, {});
      expect(status).toEqual({
        deploymentId: "dev:gas-custody-status",
        network: GAS_NETWORK,
        provisioningEnabled: true,
        keyringStatus: "valid",
        activeKeyVersion: "v1",
        keyVersionCount: 1,
      });
      expect(JSON.stringify(status)).not.toContain(key);
      expect(JSON.stringify(status)).not.toContain(btoa(key));
      expect(status).not.toHaveProperty("keys");
    },
  );
});

test("custody configuration status reads the current environment object", async () => {
  const t = convexTest(schema, modules);
  const key = String.fromCharCode(...new Uint8Array(32).fill(13));
  const previousEnvironment = process.env;
  process.env = {
    ...previousEnvironment,
    VELO_GAS_CUSTODY_KEYRING_JSON: JSON.stringify({ activeVersion: "v1", keys: { v1: btoa(key) } }),
    VELO_GAS_CUSTODY_DEPLOYMENT_ID: "prod:runtime-environment-check",
    VELO_GAS_MANAGED_RELAYER_PROVISIONING_ENABLED: "true",
  };

  try {
    const status = await t.action(internal.gas.relayer.custodyConfigurationStatus, {});
    expect(status).toEqual({
      deploymentId: "prod:runtime-environment-check",
      network: GAS_NETWORK,
      provisioningEnabled: true,
      keyringStatus: "valid",
      activeKeyVersion: "v1",
      keyVersionCount: 1,
    });
    expect(JSON.stringify(status)).not.toContain(key);
  } finally {
    process.env = previousEnvironment;
  }
});

test("internal custody configuration status distinguishes absent and invalid keyrings safely", async () => {
  const t = convexTest(schema, modules);

  await withManagedCustodyEnvironment(
    { keyring: undefined, deploymentId: undefined, enabled: undefined },
    async () => {
      const status = await t.action(internal.gas.relayer.custodyConfigurationStatus, {});
      expect(status).toEqual({
        deploymentId: null,
        network: GAS_NETWORK,
        provisioningEnabled: false,
        keyringStatus: "missing",
        activeKeyVersion: null,
        keyVersionCount: 0,
      });
    },
  );

  await withManagedCustodyEnvironment(
    { keyring: "not-a-keyring", deploymentId: "dev:gas-custody-status", enabled: "false" },
    async () => {
      const status = await t.action(internal.gas.relayer.custodyConfigurationStatus, {});
      expect(status).toEqual({
        deploymentId: "dev:gas-custody-status",
        network: GAS_NETWORK,
        provisioningEnabled: false,
        keyringStatus: "invalid",
        activeKeyVersion: null,
        keyVersionCount: 0,
      });
      expect(JSON.stringify(status)).not.toContain("not-a-keyring");
    },
  );
});

test("rollback disables provisioning without blocking signing for existing managed custody", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t, "encrypted-ready");
  const deploymentId = "dev:gas-custody-tests";
  const keyringJson = JSON.stringify({
    activeVersion: "v1",
    keys: { v1: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))) },
  });
  const encrypted = await encryptGasRelayerSecret(
    GAS_TEST_RELAYER_KEYPAIR.secret(),
    parseGasCustodyKeyring(keyringJson),
    {
      deploymentId,
      projectId,
      network: GAS_NETWORK,
      publicKey: GAS_TEST_RELAYER_KEYPAIR.publicKey(),
    },
  );
  await t.run(async (ctx) => {
    await ctx.db.insert("relayerAccounts", {
      projectId,
      publicKey: GAS_TEST_RELAYER_KEYPAIR.publicKey(),
      network: GAS_NETWORK,
      status: "active",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await ctx.db.insert("gasRelayerCustody", {
      projectId,
      network: GAS_NETWORK,
      status: "ready",
      attemptToken: "ready-token",
      attemptCount: 1,
      publicKey: GAS_TEST_RELAYER_KEYPAIR.publicKey(),
      deploymentId,
      ...encrypted,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  await withManagedCustodyEnvironment(
    { keyring: keyringJson, deploymentId, enabled: "false" },
    async () => {
      expect(await t.action(internal.gas.relayer.readiness, { projectId })).toEqual({
        status: "ready",
        network: GAS_NETWORK,
        publicKey: GAS_TEST_RELAYER_KEYPAIR.publicKey(),
      });
      expect(
        (await t.action(internal.gas.relayer.custodyConfigurationStatus, {})).provisioningEnabled,
      ).toBe(false);
      const signature = await withTestnetRelayerSigner(
        actionContext(
          {
            status: "active",
            network: GAS_NETWORK,
            publicKey: GAS_TEST_RELAYER_KEYPAIR.publicKey(),
          },
          {
            projectId,
            network: GAS_NETWORK,
            status: "ready",
            attemptToken: "ready-token",
            attemptCount: 1,
            publicKey: GAS_TEST_RELAYER_KEYPAIR.publicKey(),
            deploymentId,
            ...encrypted,
            createdAt: NOW,
            updatedAt: NOW,
          },
        ),
        projectId,
        (signer) => signer.sign(new TextEncoder().encode("managed-key")),
      );
      expect(
        GAS_TEST_RELAYER_KEYPAIR.verify(Buffer.from("managed-key"), Buffer.from(signature)),
      ).toBe(true);
    },
  );
});

test("managed decryption failure does not fall back to legacy plaintext configuration", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t, "no-fallback");
  const metadata: GasRelayerMetadataLookup = {
    status: "active",
    network: GAS_NETWORK,
    publicKey: GAS_TEST_RELAYER_KEYPAIR.publicKey(),
  };
  const custody: Exclude<GasRelayerCustodyLookup, null | { status: "ambiguous" }> = {
    projectId,
    network: GAS_NETWORK,
    status: "ready",
    attemptToken: "ready-token",
    attemptCount: 1,
    publicKey: GAS_TEST_RELAYER_KEYPAIR.publicKey(),
    deploymentId: "dev:gas-custody-tests",
    keyVersion: "v1",
    nonce: "AA==",
    ciphertext: "AA==",
    authTag: "AA==",
    createdAt: NOW,
    updatedAt: NOW,
  };

  await withSignerConfiguration(signerConfiguration(projectId), async () => {
    await withManagedCustodyEnvironment(
      { keyring: "invalid-keyring", deploymentId: "dev:gas-custody-tests" },
      async () => {
        await expect(
          withTestnetRelayerSigner(actionContext(metadata, custody), projectId, () => {
            throw new Error("must not reach signer callback");
          }),
        ).rejects.toMatchObject({ status: "configuration_mismatch" });
      },
    );
  });
});

test("managed custody preserves trusted signer callback failures", async () => {
  const projectId = "projects:managed-callback-error" as Id<"projects">;
  const keyringJson = JSON.stringify({
    activeVersion: "v1",
    keys: { v1: btoa(String.fromCharCode(...new Uint8Array(32).fill(17))) },
  });
  const keyring = parseGasCustodyKeyring(keyringJson);
  const metadata: GasRelayerMetadataLookup = {
    status: "active",
    network: GAS_NETWORK,
    publicKey: GAS_TEST_RELAYER_KEYPAIR.publicKey(),
  };
  const encrypted = await encryptGasRelayerSecret(GAS_TEST_RELAYER_KEYPAIR.secret(), keyring, {
    deploymentId: "dev:gas-custody-tests",
    projectId,
    network: GAS_NETWORK,
    publicKey: GAS_TEST_RELAYER_KEYPAIR.publicKey(),
  });
  const custody: Exclude<GasRelayerCustodyLookup, null | { status: "ambiguous" }> = {
    projectId,
    network: GAS_NETWORK,
    status: "ready",
    attemptToken: "callback-error-token",
    attemptCount: 1,
    publicKey: GAS_TEST_RELAYER_KEYPAIR.publicKey(),
    deploymentId: "dev:gas-custody-tests",
    ...encrypted,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const callbackFailure = new Error("trusted callback failed");

  await withManagedCustodyEnvironment(
    { keyring: keyringJson, deploymentId: "dev:gas-custody-tests" },
    async () => {
      await expect(
        withTestnetRelayerSigner(actionContext(metadata, custody), projectId, () => {
          throw callbackFailure;
        }),
      ).rejects.toBe(callbackFailure);
    },
  );
});

test("missing and malformed configuration fail before the callback", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t, "configuration");
  const metadata: GasRelayerMetadataLookup = {
    status: "active",
    network: GAS_NETWORK,
    publicKey: GAS_TEST_RELAYER_KEYPAIR.publicKey(),
  };

  await expectSigningBlocked(projectId, undefined, metadata, "configuration_unavailable");
  await expectSigningBlocked(projectId, "not-json", metadata, "configuration_mismatch");
  await expectSigningBlocked(projectId, JSON.stringify({}), metadata, "configuration_mismatch");
  await expectSigningBlocked(
    projectId,
    signerConfiguration(projectId, GAS_TEST_RELAYER_KEYPAIR, { unexpected: "field" }),
    metadata,
    "configuration_mismatch",
  );
});

test("invalid, wrong-network, and oversized configuration are redacted failures", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t, "invalid-config");
  const metadata: GasRelayerMetadataLookup = {
    status: "active",
    network: GAS_NETWORK,
    publicKey: GAS_TEST_RELAYER_KEYPAIR.publicKey(),
  };

  await expectSigningBlocked(
    projectId,
    JSON.stringify([{ projectId, network: GAS_NETWORK, secretKey: "not-a-seed" }]),
    metadata,
    "configuration_mismatch",
  );
  await expectSigningBlocked(
    projectId,
    JSON.stringify([
      { projectId, network: "public", secretKey: GAS_TEST_RELAYER_KEYPAIR.secret() },
    ]),
    metadata,
    "configuration_mismatch",
  );

  const oversized = JSON.stringify([
    { projectId, network: GAS_NETWORK, secretKey: "x".repeat(GAS_MAX_RELAYER_SIGNERS_JSON_BYTES) },
  ]);
  await expectSigningBlocked(projectId, oversized, metadata, "configuration_mismatch");
});

test("duplicate projects and shared seeds are rejected globally", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t, "duplicates");
  const otherProjectId = await createProject(t, "other-duplicates");
  const metadata: GasRelayerMetadataLookup = {
    status: "active",
    network: GAS_NETWORK,
    publicKey: GAS_TEST_RELAYER_KEYPAIR.publicKey(),
  };

  await expectSigningBlocked(
    projectId,
    JSON.stringify([
      { projectId, network: GAS_NETWORK, secretKey: GAS_TEST_RELAYER_KEYPAIR.secret() },
      { projectId, network: GAS_NETWORK, secretKey: OTHER_RELAYER_KEYPAIR.secret() },
    ]),
    metadata,
    "configuration_mismatch",
  );
  await expectSigningBlocked(
    projectId,
    JSON.stringify([
      { projectId, network: GAS_NETWORK, secretKey: GAS_TEST_RELAYER_KEYPAIR.secret() },
      {
        projectId: otherProjectId,
        network: GAS_NETWORK,
        secretKey: GAS_TEST_RELAYER_KEYPAIR.secret(),
      },
    ]),
    metadata,
    "configuration_mismatch",
  );
});

test("metadata is required, active, unique, canonical, and project-bound", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t, "metadata");
  const configuration = signerConfiguration(projectId);

  await withSignerConfiguration(configuration, async () => {
    await expectSigningBlocked(projectId, configuration, null, "metadata_unavailable");

    await createRelayerMetadata(t, projectId, { status: "disabled" });
    expect(await t.action(internal.gas.relayer.readiness, { projectId })).toEqual({
      status: "metadata_disabled",
      network: GAS_NETWORK,
      publicKey: null,
    });
    await expectSigningBlocked(
      projectId,
      configuration,
      { status: "disabled", network: GAS_NETWORK, publicKey: GAS_TEST_RELAYER_KEYPAIR.publicKey() },
      "metadata_disabled",
    );
  });

  const mismatchedProjectId = await createProject(t, "metadata-mismatch");
  await createRelayerMetadata(t, mismatchedProjectId, {
    publicKey: OTHER_RELAYER_KEYPAIR.publicKey(),
  });
  await expectSigningBlocked(
    mismatchedProjectId,
    signerConfiguration(mismatchedProjectId),
    {
      status: "active",
      network: GAS_NETWORK,
      publicKey: OTHER_RELAYER_KEYPAIR.publicKey(),
    },
    "configuration_mismatch",
  );
});

test("ambiguous, malformed, cross-project, and serialized custody failures never sign or leak", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t, "ambiguous");
  const configuration = signerConfiguration(projectId);
  const rawConfiguration = JSON.stringify([
    { projectId, network: GAS_NETWORK, secretKey: GAS_TEST_RELAYER_KEYPAIR.secret() },
  ]);

  await createRelayerMetadata(t, projectId);
  await createRelayerMetadata(t, projectId, { publicKey: OTHER_RELAYER_KEYPAIR.publicKey() });
  const ambiguous = await withSignerConfiguration(rawConfiguration, async () =>
    t.action(internal.gas.relayer.readiness, { projectId }),
  );
  expect(ambiguous).toEqual({
    status: "metadata_unavailable",
    network: GAS_NETWORK,
    publicKey: null,
  });

  await expectSigningBlocked(
    projectId,
    configuration,
    { status: "active", network: GAS_NETWORK, publicKey: "not-a-public-key" },
    "metadata_unavailable",
  );

  const otherProjectId = await createProject(t, "cross-project");
  await expectSigningBlocked(
    otherProjectId,
    rawConfiguration,
    { status: "active", network: GAS_NETWORK, publicKey: GAS_TEST_RELAYER_KEYPAIR.publicKey() },
    "configuration_mismatch",
  );

  let errorText = "";
  try {
    await withSignerConfiguration(rawConfiguration, async () =>
      withTestnetRelayerSigner(
        actionContext({ status: "active", network: GAS_NETWORK, publicKey: "not-a-public-key" }),
        projectId,
        () => {
          throw new Error("callback must not run");
        },
      ),
    );
  } catch (error) {
    errorText = String(error);
  }
  expect(errorText).not.toContain(GAS_TEST_RELAYER_KEYPAIR.secret());
  expect(errorText).not.toContain(rawConfiguration);
});

test("private metadata lookup fails closed on duplicate rows", async () => {
  const t = convexTest(schema, modules);
  const projectId = await createProject(t, "lookup-duplicate");
  await createRelayerMetadata(t, projectId);
  await createRelayerMetadata(t, projectId);

  expect(await t.query(internal.gas.public_api_internal.getRelayerMetadata, { projectId })).toEqual(
    {
      status: "ambiguous",
    },
  );
});
