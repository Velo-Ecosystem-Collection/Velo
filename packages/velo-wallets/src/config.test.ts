import { describe, expect, test } from "vitest";

import {
  DEFAULT_WALLET_APPEARANCE_STYLE,
  DEFAULT_WALLET_CONFIG,
  WALLET_CATALOG,
  mergeWalletAppearance,
  normalizeAllowedOrigin,
  normalizeWalletAppearance,
  parsePublishedWalletConfig,
  validateWalletDraft,
} from "./config.js";

describe("wallet configuration", () => {
  test("ships the pinned credential-free Wallets Kit catalog", () => {
    expect(WALLET_CATALOG.map((wallet) => wallet.name)).toEqual([
      "Albedo",
      "Freighter",
      "Fordefi",
      "Rabet",
      "xBull",
      "LOBSTR",
      "Hana Wallet",
      "Klever Wallet",
      "OneKey Wallet",
      "Bitget Wallet",
      "Cactus Link",
      "Noir",
    ]);
  });

  test("uses a beginner-safe Testnet preset", () => {
    expect(DEFAULT_WALLET_CONFIG).toMatchObject({
      network: "testnet",
      walletIds: ["freighter"],
      theme: "system",
      persistSession: true,
      allowedOrigins: ["http://localhost:3000"],
      appearance: DEFAULT_WALLET_APPEARANCE_STYLE,
    });
  });

  test("normalizes legacy and locally overridden appearance", () => {
    const legacy = normalizeWalletAppearance({ theme: "dark", buttonLabel: "Launch wallet" });
    expect(legacy).toMatchObject({
      theme: "dark",
      buttonLabel: "Launch wallet",
      palettes: { light: { accent: "#18181B" }, dark: { accent: "#FAFAFA" } },
    });

    expect(
      mergeWalletAppearance(legacy, {
        palettes: { light: { accent: "#6D28D9", accentText: "#FFFFFF" } },
        button: { size: "lg" },
      }),
    ).toMatchObject({
      palettes: { light: { accent: "#6D28D9", accentText: "#FFFFFF" } },
      button: { size: "lg", variant: "solid" },
    });
  });

  test("rejects malformed colors and inaccessible contrast", () => {
    expect(
      validateWalletDraft({
        ...DEFAULT_WALLET_CONFIG,
        appearance: {
          ...DEFAULT_WALLET_APPEARANCE_STYLE,
          palettes: {
            ...DEFAULT_WALLET_APPEARANCE_STYLE.palettes,
            light: {
              ...DEFAULT_WALLET_APPEARANCE_STYLE.palettes.light,
              accent: "red",
              text: "#FFFFFF",
            },
          },
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Light accent must use/i),
        expect.stringMatching(/Light text and background/i),
      ]),
    );
  });

  test("normalizes exact origins and rejects paths", () => {
    expect(normalizeAllowedOrigin("https://Example.com/")).toBe("https://example.com");
    expect(() => normalizeAllowedOrigin("https://example.com/app")).toThrow(/origin/i);
  });

  test("requires HTTPS non-local origins for Mainnet", () => {
    expect(
      validateWalletDraft({
        ...DEFAULT_WALLET_CONFIG,
        network: "public",
      }),
    ).toContain("Mainnet requires at least one non-local HTTPS origin.");
  });

  test("parses only compatible public configurations", () => {
    const parsed = parsePublishedWalletConfig({
      schemaVersion: 1,
      revision: 2,
      runtimeMajor: 1,
      projectKey: "vw_pk_example",
      network: "testnet",
      walletIds: ["freighter"],
      appearance: { theme: "system", buttonLabel: "Connect wallet" },
      modal: { showInstallLabel: true, hideUnsupportedWallets: false },
      session: { persist: true },
    });
    expect(parsed.revision).toBe(2);
    expect(parsed.selectorLogo).toBe("velo");
    expect(parsed.appearance.palettes.light.accent).toBe("#18181B");

    const projectLogoConfig = parsePublishedWalletConfig({
      ...parsed,
      selectorLogo: "project",
      projectLogoUrl: "https://storage.example/project-logo.png",
    });
    expect(projectLogoConfig).toMatchObject({
      selectorLogo: "project",
      projectLogoUrl: "https://storage.example/project-logo.png",
    });

    expect(() =>
      parsePublishedWalletConfig({
        ...parsed,
        selectorLogo: "project",
        projectLogoUrl: "data:image/png;base64,AA==",
      }),
    ).toThrow(/CONFIG_INCOMPATIBLE/);

    expect(() =>
      parsePublishedWalletConfig({
        ...parsed,
        appearance: {
          ...parsed.appearance,
          palettes: { light: { accent: "#000000" }, dark: parsed.appearance.palettes.dark },
        },
      }),
    ).toThrow(/CONFIG_INCOMPATIBLE/);

    for (const invalid of [
      { revision: 1.5 },
      { walletIds: [] },
      { walletIds: ["freighter", "freighter"] },
      { appearance: { ...parsed.appearance, buttonLabel: " " } },
    ]) {
      expect(() => parsePublishedWalletConfig({ ...parsed, ...invalid })).toThrow(
        /CONFIG_INCOMPATIBLE/,
      );
    }

    expect(() => parsePublishedWalletConfig({ schemaVersion: 2 })).toThrow(/CONFIG_INCOMPATIBLE/);
  });

  test("accepts Noir in draft and published wallet configurations", () => {
    const draft = { ...DEFAULT_WALLET_CONFIG, walletIds: ["noir"] };
    expect(validateWalletDraft(draft)).toEqual([]);

    const published = parsePublishedWalletConfig({
      schemaVersion: 1,
      revision: 1,
      runtimeMajor: 1,
      projectKey: "vw_pk_example",
      network: "testnet",
      walletIds: ["noir"],
      appearance: { theme: "system", buttonLabel: "Connect wallet" },
      modal: { showInstallLabel: true, hideUnsupportedWallets: false },
      session: { persist: true },
    });
    expect(published.walletIds).toEqual(["noir"]);
  });

  test("supports selector logo choices and defaults legacy drafts to Velo", () => {
    expect(DEFAULT_WALLET_CONFIG.selectorLogo).toBe("velo");
    expect(
      validateWalletDraft({
        ...DEFAULT_WALLET_CONFIG,
        selectorLogo: "none",
      }),
    ).toEqual([]);
    expect(() =>
      parsePublishedWalletConfig({
        schemaVersion: 1,
        revision: 1,
        runtimeMajor: 1,
        projectKey: "vw_pk_example",
        network: "testnet",
        walletIds: ["freighter"],
        selectorLogo: "other",
        appearance: { theme: "system", buttonLabel: "Connect wallet" },
        modal: { showInstallLabel: true, hideUnsupportedWallets: false },
        session: { persist: true },
      }),
    ).toThrow(/CONFIG_INCOMPATIBLE/);
  });
});
