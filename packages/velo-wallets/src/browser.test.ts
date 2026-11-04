import { beforeEach, describe, expect, test, vi } from "vitest";

import type { WalletKitAdapter } from "./wallet-kit-adapter.js";

import { VeloWalletClient } from "./browser.js";

const publishedConfig = {
  schemaVersion: 1 as const,
  revision: 1,
  runtimeMajor: 1 as const,
  projectKey: "vw_pk_example",
  network: "testnet" as const,
  walletIds: ["freighter"],
  appearance: { theme: "system" as const, buttonLabel: "Connect wallet" },
  modal: { showInstallLabel: true, hideUnsupportedWallets: false },
  session: { persist: true },
};

function mockAdapter(): WalletKitAdapter {
  return {
    initialize: vi.fn(async () => undefined),
    connect: vi.fn(async () => ({ address: "GABC", walletId: "freighter" })),
    disconnect: vi.fn(async () => undefined),
    signTransaction: vi.fn(async () => "signed-xdr"),
    signAuthEntry: vi.fn(async () => "signed-auth"),
    signMessage: vi.fn(async () => "signed-message"),
    subscribe: vi.fn(() => () => undefined),
  };
}

describe("VeloWalletClient", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test("loads configuration and connects through the injected adapter", async () => {
    const adapter = mockAdapter();
    const client = new VeloWalletClient({
      projectKey: publishedConfig.projectKey,
      adapter,
      fetchConfig: async () => publishedConfig,
    });

    await client.initialize();
    expect(client.getState().status).toBe("ready");

    await expect(client.connect()).resolves.toBe("GABC");
    expect(client.getState()).toMatchObject({
      status: "connected",
      address: "GABC",
      walletId: "freighter",
    });
    expect(adapter.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        appearance: expect.objectContaining({
          buttonLabel: "Connect wallet",
          palettes: expect.any(Object),
        }),
      }),
    );
  });

  test("merges validated local appearance overrides", async () => {
    const adapter = mockAdapter();
    const client = new VeloWalletClient({
      projectKey: publishedConfig.projectKey,
      adapter,
      appearance: {
        palettes: {
          light: { accent: "#6D28D9", accentText: "#FFFFFF" },
        },
      },
      fetchConfig: async () => publishedConfig,
    });

    await client.initialize();
    expect(client.getConfig()?.appearance.palettes.light.accent).toBe("#6D28D9");
  });

  test("persists only the address and wallet id", async () => {
    const client = new VeloWalletClient({
      projectKey: publishedConfig.projectKey,
      adapter: mockAdapter(),
      fetchConfig: async () => publishedConfig,
    });

    await client.initialize();
    await client.connect();
    expect(window.localStorage.getItem("velo-wallets:v1:vw_pk_example:session")).toBe(
      JSON.stringify({ address: "GABC", walletId: "freighter" }),
    );
  });

  test("disconnect clears the persisted Noir widget session", async () => {
    const noirConfig = { ...publishedConfig, walletIds: ["noir"] };
    const adapter = mockAdapter();
    vi.mocked(adapter.connect).mockResolvedValue({ address: "GABC", walletId: "noir" });
    Object.defineProperty(window, "noir", {
      configurable: true,
      value: { stellar: { isNoir: true } },
    });
    const client = new VeloWalletClient({
      projectKey: publishedConfig.projectKey,
      adapter,
      fetchConfig: async () => noirConfig,
    });

    await client.connect();
    expect(window.localStorage.getItem("velo-wallets:v1:vw_pk_example:session")).toBe(
      JSON.stringify({ address: "GABC", walletId: "noir" }),
    );

    await client.disconnect();
    expect(adapter.disconnect).toHaveBeenCalledOnce();
    expect(window.localStorage.getItem("velo-wallets:v1:vw_pk_example:session")).toBeNull();
    expect(client.getState()).toMatchObject({ status: "disconnected", address: null });
  });

  test("delegates signing without calling configuration fetch again", async () => {
    const adapter = mockAdapter();
    const fetchConfig = vi.fn(async () => publishedConfig);
    const client = new VeloWalletClient({
      projectKey: publishedConfig.projectKey,
      adapter,
      fetchConfig,
    });

    await client.initialize();
    await client.connect();
    await expect(client.signTransaction("xdr")).resolves.toBe("signed-xdr");
    await expect(client.signAuthEntry("auth")).resolves.toBe("signed-auth");
    await expect(client.signMessage("message")).resolves.toBe("signed-message");
    expect(fetchConfig).toHaveBeenCalledTimes(1);
  });

  test("restores a valid session and reports a stale session", async () => {
    window.localStorage.setItem(
      "velo-wallets:v1:vw_pk_example:session",
      JSON.stringify({ address: "GABC", walletId: "freighter" }),
    );
    const validAdapter = {
      ...mockAdapter(),
      restoreSession: vi.fn(async () => ({ address: "GABC", walletId: "freighter" })),
    };
    const restored = new VeloWalletClient({
      projectKey: publishedConfig.projectKey,
      adapter: validAdapter,
      fetchConfig: async () => publishedConfig,
    });
    await restored.initialize();
    expect(restored.getState()).toMatchObject({ status: "connected", address: "GABC" });

    window.localStorage.setItem(
      "velo-wallets:v1:vw_pk_example:session",
      JSON.stringify({ address: "GOLD", walletId: "freighter" }),
    );
    const stale = new VeloWalletClient({
      projectKey: publishedConfig.projectKey,
      adapter: { ...mockAdapter(), restoreSession: vi.fn(async () => null) },
      fetchConfig: async () => publishedConfig,
    });
    await stale.initialize();
    expect(stale.getState()).toMatchObject({ status: "ready", error: { code: "SESSION_STALE" } });
    expect(window.localStorage.getItem("velo-wallets:v1:vw_pk_example:session")).toBeNull();
  });

  test("detects account, network, and disconnect adapter events", async () => {
    let notify: Parameters<WalletKitAdapter["subscribe"]>[0] = () => undefined;
    const adapter = {
      ...mockAdapter(),
      subscribe: vi.fn((listener: typeof notify) => {
        notify = listener;
        return () => undefined;
      }),
    };
    const client = new VeloWalletClient({
      projectKey: publishedConfig.projectKey,
      adapter,
      fetchConfig: async () => publishedConfig,
    });
    await client.initialize();
    notify({ type: "changed", address: "GNEW", walletId: "albedo" });
    expect(client.getState()).toMatchObject({
      status: "connected",
      address: "GNEW",
      walletId: "albedo",
    });
    notify({
      type: "changed",
      address: "GNEW",
      walletId: "albedo",
      networkPassphrase: "Public Global Stellar Network ; September 2015",
    });
    expect(client.getState().error?.code).toBe("NETWORK_MISMATCH");
    notify({ type: "disconnected" });
    expect(client.getState()).toMatchObject({ status: "disconnected", address: null });
  });

  test("normalizes unsupported methods and user rejections", async () => {
    const adapter = mockAdapter();
    vi.mocked(adapter.connect).mockRejectedValueOnce(new Error("User rejected connection"));
    vi.mocked(adapter.signMessage).mockRejectedValueOnce(new Error("Method not supported"));
    const client = new VeloWalletClient({
      projectKey: publishedConfig.projectKey,
      adapter,
      fetchConfig: async () => publishedConfig,
    });
    await client.initialize();
    await expect(client.connect()).rejects.toMatchObject({ code: "CONNECTION_REJECTED" });
    vi.mocked(adapter.connect).mockResolvedValueOnce({ address: "GABC", walletId: "freighter" });
    await client.connect();
    await expect(client.signMessage("hello")).rejects.toMatchObject({
      code: "WALLET_METHOD_UNSUPPORTED",
    });
  });
});
