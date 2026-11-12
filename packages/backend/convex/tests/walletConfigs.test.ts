import { DEFAULT_WALLET_APPEARANCE_STYLE } from "@carts1024/velo-wallets/config";
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";

import { api } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

function asWallet(t: ReturnType<typeof convexTest>, ownerAddress: string) {
  return t.withIdentity({
    subject: ownerAddress,
    issuer: "http://localhost:3000",
    tokenIdentifier: `http://localhost:3000|${ownerAddress}`,
  });
}

async function createProject(
  owner: ReturnType<typeof asWallet>,
  ownerAddress: string,
  slug: string,
) {
  return await owner.mutation(api.projects.mutation.createDraft, {
    name: "Wallets Project",
    slug,
    description: "Wallet configuration test project",
    metadataJson: JSON.stringify({ name: "Wallets Project", slug }),
    metadataHash: "0".repeat(64),
    ownerAddress,
  });
}

test("owner creates and updates a Testnet wallet draft", async () => {
  const t = convexTest(schema, modules);
  const address = "GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR";
  const owner = asWallet(t, address);
  const projectId = await createProject(owner, address, "wallet-draft");

  const created = await owner.mutation(api.wallet_configs.mutation.saveDraft, {
    projectId,
    network: "testnet",
    walletIds: ["freighter", "albedo"],
    theme: "system",
    buttonLabel: "Connect wallet",
    showInstallLabel: true,
    hideUnsupportedWallets: false,
    persistSession: true,
    allowedOrigins: ["http://localhost:3000"],
  });

  expect(created.publicKey).toMatch(/^vw_pk_[A-Za-z0-9_-]{32}$/);
  const draft = await owner.query(api.wallet_configs.query.getDraft, { projectId });
  expect(draft).toMatchObject({
    network: "testnet",
    walletIds: ["freighter", "albedo"],
    publishedRevision: 0,
    enabled: false,
  });
});

test("another wallet cannot read or mutate a wallet draft", async () => {
  const t = convexTest(schema, modules);
  const address = "GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR";
  const owner = asWallet(t, address);
  const attacker = asWallet(t, "GCATS5YOVB6ROX2WUNKGNQ2MP3GMXDMKSG2O4N5CLX3A6W4PZGZZI55U");
  const projectId = await createProject(owner, address, "wallet-private-draft");

  await owner.mutation(api.wallet_configs.mutation.saveDraft, {
    projectId,
    network: "testnet",
    walletIds: ["freighter"],
    theme: "system",
    buttonLabel: "Connect wallet",
    showInstallLabel: true,
    hideUnsupportedWallets: false,
    persistSession: true,
    allowedOrigins: ["http://localhost:3000"],
  });

  await expect(attacker.query(api.wallet_configs.query.getDraft, { projectId })).rejects.toThrow(
    "Unauthorized",
  );
  await expect(
    attacker.mutation(api.wallet_configs.mutation.setEnabled, { projectId, enabled: false }),
  ).rejects.toThrow("Unauthorized");
});

test("publishing creates immutable revisions and a browser-safe projection", async () => {
  const t = convexTest(schema, modules);
  const address = "GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR";
  const owner = asWallet(t, address);
  const projectId = await createProject(owner, address, "wallet-publication");

  const saved = await owner.mutation(api.wallet_configs.mutation.saveDraft, {
    projectId,
    network: "testnet",
    walletIds: ["freighter"],
    theme: "dark",
    buttonLabel: "Launch wallet",
    appearance: {
      ...DEFAULT_WALLET_APPEARANCE_STYLE,
      palettes: {
        ...DEFAULT_WALLET_APPEARANCE_STYLE.palettes,
        light: {
          ...DEFAULT_WALLET_APPEARANCE_STYLE.palettes.light,
          accent: "#6D28D9",
          accentText: "#FFFFFF",
        },
      },
    },
    showInstallLabel: true,
    hideUnsupportedWallets: false,
    persistSession: true,
    allowedOrigins: ["https://merchant.example"],
  });
  await owner.mutation(api.wallet_configs.mutation.publish, { projectId });

  const first = await t.query(api.wallet_configs.query.getPublishedByKey, {
    publicKey: saved.publicKey,
    origin: "https://merchant.example",
  });
  expect(first).toMatchObject({
    status: "ok",
    config: {
      schemaVersion: 1,
      revision: 1,
      runtimeMajor: 1,
      projectKey: saved.publicKey,
      selectorLogo: "velo",
      appearance: { theme: "dark", buttonLabel: "Launch wallet" },
    },
  });
  expect(first).toMatchObject({
    status: "ok",
    config: {
      appearance: {
        palettes: { light: { accent: "#6D28D9", accentText: "#FFFFFF" } },
        button: { variant: "solid", size: "md", radius: "rounded" },
      },
    },
  });
  expect(first).not.toHaveProperty("allowedOrigins");

  await owner.mutation(api.wallet_configs.mutation.saveDraft, {
    projectId,
    network: "testnet",
    walletIds: ["freighter"],
    theme: "light",
    buttonLabel: "Connect again",
    showInstallLabel: false,
    hideUnsupportedWallets: true,
    persistSession: false,
    allowedOrigins: ["https://merchant.example"],
  });
  await owner.mutation(api.wallet_configs.mutation.publish, { projectId });

  const publications = await owner.query(api.wallet_configs.query.listPublications, { projectId });
  expect(publications.map((publication) => publication.revision)).toEqual([2, 1]);
  expect(publications[1]?.buttonLabel).toBe("Launch wallet");
});

test("published selector can use the project logo uploaded in Project Settings", async () => {
  const t = convexTest(schema, modules);
  const address = "GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR";
  const owner = asWallet(t, address);
  const projectId = await createProject(owner, address, "wallet-project-logo");
  const logoStorageId = await t.run(
    async (ctx) => await ctx.storage.store(new Blob(["project logo"], { type: "image/png" })),
  );
  await owner.mutation(api.projects.mutation.setLogo, { id: projectId, logoStorageId });

  const saved = await owner.mutation(api.wallet_configs.mutation.saveDraft, {
    projectId,
    network: "testnet",
    walletIds: ["freighter"],
    theme: "system",
    buttonLabel: "Connect wallet",
    selectorLogo: "project",
    showInstallLabel: true,
    hideUnsupportedWallets: false,
    persistSession: true,
    allowedOrigins: ["https://merchant.example"],
  });
  await owner.mutation(api.wallet_configs.mutation.publish, { projectId });

  const projectLogo = await t.query(api.wallet_configs.query.getPublishedByKey, {
    publicKey: saved.publicKey,
    origin: "https://merchant.example",
  });
  expect(projectLogo).toMatchObject({
    status: "ok",
    config: {
      selectorLogo: "project",
      projectLogoUrl: expect.any(String),
    },
  });

  await owner.mutation(api.wallet_configs.mutation.saveDraft, {
    projectId,
    network: "testnet",
    walletIds: ["freighter"],
    theme: "system",
    buttonLabel: "Connect wallet",
    selectorLogo: "none",
    showInstallLabel: true,
    hideUnsupportedWallets: false,
    persistSession: true,
    allowedOrigins: ["https://merchant.example"],
  });
  await owner.mutation(api.wallet_configs.mutation.publish, { projectId });

  const noLogo = await t.query(api.wallet_configs.query.getPublishedByKey, {
    publicKey: saved.publicKey,
    origin: "https://merchant.example",
  });
  expect(noLogo).toMatchObject({ status: "ok", config: { selectorLogo: "none" } });
  expect(noLogo).not.toHaveProperty("config.projectLogoUrl");
});

test("public lookup enforces origins and disabled state", async () => {
  const t = convexTest(schema, modules);
  const address = "GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR";
  const owner = asWallet(t, address);
  const projectId = await createProject(owner, address, "wallet-origin");
  const saved = await owner.mutation(api.wallet_configs.mutation.saveDraft, {
    projectId,
    network: "testnet",
    walletIds: ["freighter"],
    theme: "system",
    buttonLabel: "Connect wallet",
    showInstallLabel: true,
    hideUnsupportedWallets: false,
    persistSession: true,
    allowedOrigins: ["https://merchant.example"],
  });
  await owner.mutation(api.wallet_configs.mutation.publish, { projectId });

  await expect(
    t.query(api.wallet_configs.query.getPublishedByKey, {
      publicKey: saved.publicKey,
      origin: "https://attacker.example",
    }),
  ).resolves.toEqual({ status: "origin_rejected" });

  await owner.mutation(api.wallet_configs.mutation.setEnabled, { projectId, enabled: false });
  await expect(
    t.query(api.wallet_configs.query.getPublishedByKey, { publicKey: saved.publicKey }),
  ).resolves.toEqual({ status: "disabled" });
});

test("saving a draft does not change the active publication origin policy", async () => {
  const t = convexTest(schema, modules);
  const address = "GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR";
  const owner = asWallet(t, address);
  const projectId = await createProject(owner, address, "wallet-origin-revision");
  const input = {
    projectId,
    network: "testnet" as const,
    walletIds: ["freighter"],
    theme: "system" as const,
    buttonLabel: "Connect wallet",
    showInstallLabel: true,
    hideUnsupportedWallets: false,
    persistSession: true,
  };
  const saved = await owner.mutation(api.wallet_configs.mutation.saveDraft, {
    ...input,
    allowedOrigins: ["https://one.example"],
  });
  await owner.mutation(api.wallet_configs.mutation.publish, { projectId });
  await owner.mutation(api.wallet_configs.mutation.saveDraft, {
    ...input,
    allowedOrigins: ["https://two.example"],
  });

  await expect(
    t.query(api.wallet_configs.query.getPublishedByKey, {
      publicKey: saved.publicKey,
      origin: "https://one.example",
    }),
  ).resolves.toMatchObject({ status: "ok" });
  await expect(
    t.query(api.wallet_configs.query.getPublishedByKey, {
      publicKey: saved.publicKey,
      origin: "https://two.example",
    }),
  ).resolves.toEqual({ status: "origin_rejected" });
});

test("Mainnet publication requires a non-local HTTPS origin", async () => {
  const t = convexTest(schema, modules);
  const address = "GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR";
  const owner = asWallet(t, address);
  const projectId = await createProject(owner, address, "wallet-mainnet-validation");

  await expect(
    owner.mutation(api.wallet_configs.mutation.saveDraft, {
      projectId,
      network: "public",
      walletIds: ["freighter"],
      theme: "system",
      buttonLabel: "Connect wallet",
      showInstallLabel: true,
      hideUnsupportedWallets: false,
      persistSession: true,
      allowedOrigins: ["http://localhost:3000"],
    }),
  ).rejects.toThrow("Mainnet requires at least one non-local HTTPS origin");
});
