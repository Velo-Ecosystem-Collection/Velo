/// <reference types="vite/client" />
import { createHash } from "node:crypto";

import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";

import { api, internal } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");
const OWNER = "GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR";
const TOKEN_IDENTIFIER = `http://localhost:3000|${OWNER}`;

function asOwner(t: ReturnType<typeof convexTest>) {
  return t.withIdentity({
    subject: OWNER,
    issuer: "http://localhost:3000",
    tokenIdentifier: TOKEN_IDENTIFIER,
  });
}

async function seedRegisteredProject(t: ReturnType<typeof convexTest>, slug: string) {
  return await t.run(
    async (ctx) =>
      await ctx.db.insert("projects", {
        name: `Retirement ${slug}`,
        normalizedName: `retirement ${slug}`,
        slug,
        description: "Retirement lifecycle fixture",
        metadataJson: "{}",
        metadataHash: "0".repeat(64),
        ownerAddress: OWNER,
        ownerTokenIdentifier: TOKEN_IDENTIFIER,
        status: "registered",
        registryProjectId: 47,
        paymentAccessActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
  );
}

test("retirement hides wallet publications and Playground public shares while retaining their records", async () => {
  const t = convexTest(schema, modules);
  const owner = asOwner(t);
  const projectId = await seedRegisteredProject(t, "public-surfaces");
  const token = "existing-public-share-token";
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const { configId, publicationId, shareId } = await t.run(async (ctx) => {
    const publicationId = await ctx.db.insert("walletConfigPublications", {
      projectId,
      publicKey: "wallet-publication-key",
      revision: 1,
      schemaVersion: 1,
      runtimeMajor: 1,
      network: "testnet",
      walletIds: ["freighter"],
      theme: "system",
      buttonLabel: "Connect wallet",
      showInstallLabel: true,
      hideUnsupportedWallets: false,
      persistSession: true,
      allowedOrigins: ["https://merchant.example"],
      publishedAt: Date.now(),
    });
    const configId = await ctx.db.insert("walletConfigs", {
      projectId,
      publicKey: "wallet-publication-key",
      enabled: true,
      network: "testnet",
      walletIds: ["freighter"],
      theme: "system",
      buttonLabel: "Connect wallet",
      showInstallLabel: true,
      hideUnsupportedWallets: false,
      persistSession: true,
      allowedOrigins: ["https://merchant.example"],
      draftRevision: 1,
      publishedRevision: 1,
      activePublicationId: publicationId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const shareId = await ctx.db.insert("playgroundShares", {
      projectId,
      tokenHash,
      visibility: "public_unlisted",
      includeArguments: true,
      snapshotJson: JSON.stringify({ title: "Existing shared request" }),
      createdBy: OWNER,
      createdAt: Date.now(),
    });
    return { configId, publicationId, shareId };
  });

  expect(
    await owner.query(api.wallet_configs.query.getPublishedByKey, {
      publicKey: "wallet-publication-key",
      origin: "https://merchant.example",
    }),
  ).toEqual(expect.objectContaining({ status: "ok" }));
  expect(
    await owner.query(api.playground_projects.queries.getPublicShare, { token }),
  ).not.toBeNull();

  await owner.mutation(api.projects.mutation.retire, {
    id: projectId,
    confirmationName: "Retirement public-surfaces",
  });

  expect(
    await owner.query(api.wallet_configs.query.getPublishedByKey, {
      publicKey: "wallet-publication-key",
      origin: "https://merchant.example",
    }),
  ).toEqual({ status: "not_found" });
  expect(await owner.query(api.playground_projects.queries.getPublicShare, { token })).toBeNull();
  await expect(owner.mutation(api.wallet_configs.mutation.publish, { projectId })).rejects.toThrow(
    "Project is retired",
  );

  const retained = await t.run(async (ctx) => ({
    config: await ctx.db.get(configId),
    publication: await ctx.db.get(publicationId),
    share: await ctx.db.get(shareId),
    project: await ctx.db.get(projectId),
  }));
  expect(retained.project?.retiredAt).toBeTypeOf("number");
  expect(retained.config?.activePublicationId).toBe(publicationId);
  expect(retained.publication).not.toBeNull();
  expect(retained.share?.revokedAt).toBeUndefined();
});

test("scheduled polling skips retired projects and result writes recheck retirement", async () => {
  const t = convexTest(schema, modules);
  const activeProjectId = await seedRegisteredProject(t, "polling-active");
  const retiredProjectId = await seedRegisteredProject(t, "polling-retired");
  const contractId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
  await t.run(async (ctx) => {
    for (let index = 0; index < 105; index += 1) {
      await ctx.db.insert("projectContracts", {
        projectId: retiredProjectId,
        ownerAddress: OWNER,
        registryProjectId: 47,
        contractId: `${contractId}-retired-${index}`,
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    await ctx.db.insert("projectContracts", {
      projectId: activeProjectId,
      ownerAddress: OWNER,
      registryProjectId: 47,
      contractId: `${contractId}-eligible`,
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.patch(retiredProjectId, { retiredAt: Date.now() });
  });

  const targets = await t.mutation(internal.contract_events.mutation.selectScheduledTargets, {});
  expect(targets.map((target) => target.projectId)).toEqual([activeProjectId]);
  expect(
    await t.query(internal.poller_state.query.getByScope, {
      scope: `project:${activeProjectId}`,
    }),
  ).toMatchObject({ status: "polling" });
  await expect(
    t.query(internal.contract_events.query.getPollTargetInternal, {
      projectId: retiredProjectId,
    }),
  ).rejects.toThrow("Only registered projects can poll");

  const result = await t.mutation(internal.contract_events.mutation.storePollResult, {
    projectId: retiredProjectId,
    latestLedger: 100,
    cursor: "retired-cursor",
    events: [
      {
        eventId: "late-retired-event",
        contractId,
        transactionHash: "a".repeat(64),
        ledger: 99,
        topic: "transfer",
        topics: ["transfer"],
        type: "transfer",
        raw: {},
      },
    ],
  });
  expect(result).toBeNull();
  const persisted = await t.run(async (ctx) => ({
    events: await ctx.db.query("contractEvents").collect(),
    pollers: await ctx.db.query("pollerState").collect(),
  }));
  expect(persisted.events).toHaveLength(0);
  expect(persisted.pollers).toHaveLength(1);
  expect(persisted.pollers[0]).toMatchObject({ projectId: activeProjectId, status: "polling" });
});

test("scheduled polling preserves project order and the twenty-project limit", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-10T00:00:00Z"));
  try {
    const t = convexTest(schema, modules);
    const projectIds: Array<Awaited<ReturnType<typeof seedRegisteredProject>>> = [];
    for (let index = 0; index < 25; index += 1) {
      projectIds.push(
        await seedRegisteredProject(t, `polling-limit-${String(index).padStart(2, "0")}`),
      );
      vi.setSystemTime(new Date(Date.now() + 1_000));
    }
    for (const [index, projectId] of projectIds.entries()) {
      await t.run(async (ctx) => {
        await ctx.db.insert("projectContracts", {
          projectId,
          ownerAddress: OWNER,
          registryProjectId: 47,
          contractId: `contract-${index}`,
          status: "active",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      });
      vi.setSystemTime(new Date(Date.now() + 1_000));
    }

    const targets = await t.mutation(internal.contract_events.mutation.selectScheduledTargets, {});
    expect(targets.map((target) => target.projectId)).toEqual(projectIds.slice(0, 20));
  } finally {
    vi.useRealTimers();
  }
});

test("existing webhook delivery retries after retirement", async () => {
  const t = convexTest(schema, modules);
  const owner = asOwner(t);
  const projectId = await owner.mutation(api.projects.mutation.createDraft, {
    name: "Webhook Retirement",
    slug: "webhook-retirement",
    description: "Existing delivery retry",
    metadataJson: "{}",
    metadataHash: "0".repeat(64),
    ownerAddress: OWNER,
  });
  await owner.mutation(api.webhook_endpoints.mutation.saveSettings, {
    projectId,
    url: "https://api.example.com/webhook",
    enabled: true,
    eventTypes: ["payment.succeeded"],
  });

  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error("Connection failed");
  };
  try {
    await t.action(internal.webhookDelivery.trigger, {
      projectId,
      eventType: "payment.succeeded",
    });
    const deliveryId = await t.run(async (ctx) => {
      const delivery = await ctx.db
        .query("webhookDeliveries")
        .withIndex("by_project_created_at", (q) => q.eq("projectId", projectId))
        .first();
      return delivery!._id;
    });
    await owner.mutation(api.projects.mutation.retire, {
      id: projectId,
      confirmationName: "Webhook Retirement",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(deliveryId, { nextAttemptAt: Date.now() });
    });

    await t.action(internal.webhookDelivery.trigger, {
      projectId,
      eventType: "payment.succeeded",
      deliveryId,
      attemptCount: 2,
    });

    const delivery = await t.run(async (ctx) => await ctx.db.get(deliveryId));
    expect(fetchCount).toBe(2);
    expect(delivery?.attemptCount).toBe(2);
    expect(delivery?.status).toBe("pending");
    expect(delivery?.projectId).toBe(projectId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
