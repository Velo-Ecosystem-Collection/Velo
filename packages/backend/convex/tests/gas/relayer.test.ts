/// <reference types="vite/client" />

import { GAS_TEST_RELAYER_KEYPAIR, keypairForLabel } from "@repo/stellar/test-fixtures";
import { Keypair } from "@stellar/stellar-sdk";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";

import type { DataModel, Id } from "../../_generated/dataModel";
import type { ActionCtx } from "../../_generated/server";
import type { GasRelayerMetadataLookup } from "../../gas/public_api_internal";
import type { TestConvexForDataModelAndIdentity } from "convex-test";

import { internal } from "../../_generated/api";
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

function actionContext(metadata: GasRelayerMetadataLookup): ActionCtx {
  return {
    runQuery: async () => metadata,
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
