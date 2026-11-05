import { beforeEach, describe, expect, test, vi } from "vitest";

import type { WalletKitAdapter } from "./wallet-kit-adapter.js";

import { VeloWalletClient } from "./browser.js";
import { WALLET_CATALOG } from "./config.js";
import { WALLET_LOGOS } from "./wallet-logos.js";

const PROJECT_KEY = "vw_pk_00000000000000000000000000000000";
const ACCOUNT_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const OTHER_ACCOUNT_ADDRESS = "GA54SPC34JL3I57ENALTO2V26XOFFG4VGQLFQXDGF6KJ5TJY7ODY56ST";

const publishedConfig = {
  schemaVersion: 1 as const,
  revision: 1,
  runtimeMajor: 1 as const,
  projectKey: PROJECT_KEY,
  network: "testnet" as const,
  walletIds: ["freighter"],
  appearance: { theme: "system" as const, buttonLabel: "Connect wallet" },
  modal: { showInstallLabel: true, hideUnsupportedWallets: false },
  session: { persist: true },
};

function mockAdapter(): WalletKitAdapter {
  return {
    initialize: vi.fn(async () => undefined),
    connect: vi.fn(async () => ({ address: ACCOUNT_ADDRESS, walletId: "freighter" })),
    listWallets: vi.fn(async () => [
      {
        id: "freighter",
        name: "Freighter",
        isAvailable: true,
        url: "https://www.freighter.app/",
      },
    ]),
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

  test("bundles one logo for every supported wallet", () => {
    expect(Object.keys(WALLET_LOGOS).sort()).toEqual(WALLET_CATALOG.map(({ id }) => id).sort());
    expect(Object.values(WALLET_LOGOS).every(Boolean)).toBe(true);
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

    await expect(client.connect()).resolves.toBe(ACCOUNT_ADDRESS);
    expect(client.getState()).toMatchObject({
      status: "connected",
      address: ACCOUNT_ADDRESS,
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

  test("validates the public project key and API base URL", () => {
    expect(
      () =>
        new VeloWalletClient({
          projectKey: "vw_pk_example",
          adapter: mockAdapter(),
          fetchConfig: async () => publishedConfig,
        }),
    ).toThrow(/valid Velo wallet project key/);
    expect(
      () =>
        new VeloWalletClient({
          projectKey: PROJECT_KEY,
          apiBaseUrl: "http://wallets.example.com",
          adapter: mockAdapter(),
          fetchConfig: async () => publishedConfig,
        }),
    ).toThrow(/must use HTTPS/);
    expect(
      () =>
        new VeloWalletClient({
          projectKey: PROJECT_KEY,
          apiBaseUrl: "https://user:secret@wallets.example.com",
          adapter: mockAdapter(),
          fetchConfig: async () => publishedConfig,
        }),
    ).toThrow(/without credentials/);
  });

  test("rejects a response for a different project and retries failed initialization", async () => {
    const mismatched = new VeloWalletClient({
      projectKey: PROJECT_KEY,
      adapter: mockAdapter(),
      fetchConfig: async () => ({
        ...publishedConfig,
        projectKey: "vw_pk_11111111111111111111111111111111",
      }),
    });
    await expect(mismatched.initialize()).rejects.toMatchObject({ code: "CONFIG_INCOMPATIBLE" });

    let fetchCount = 0;
    const retryable = new VeloWalletClient({
      projectKey: PROJECT_KEY,
      adapter: mockAdapter(),
      fetchConfig: async () => {
        fetchCount += 1;
        if (fetchCount === 1) throw new Error("Temporary configuration failure");
        return publishedConfig;
      },
    });
    await expect(retryable.initialize()).rejects.toMatchObject({ code: "RUNTIME_INIT_FAILED" });
    await expect(retryable.initialize()).resolves.toBeUndefined();
    expect(fetchCount).toBe(2);
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

  test("lists configured wallets with bundled logos and safe install URLs", async () => {
    const adapter = mockAdapter();
    vi.mocked(adapter.listWallets!).mockResolvedValue([
      { id: "freighter", name: "Freighter", isAvailable: true, url: "https://freighter.app/" },
      { id: "noir", name: "Noir", isAvailable: false, url: "javascript:alert(1)" },
      { id: "albedo", name: "Albedo", isAvailable: true, url: "https://albedo.link/" },
    ]);
    const client = new VeloWalletClient({
      projectKey: publishedConfig.projectKey,
      adapter,
      fetchConfig: async () => ({ ...publishedConfig, walletIds: ["noir", "freighter"] }),
    });

    await expect(client.listWallets()).resolves.toEqual([
      expect.objectContaining({
        id: "noir",
        name: "Noir",
        isAvailable: false,
        installUrl: null,
        logo: expect.any(String),
      }),
      expect.objectContaining({
        id: "freighter",
        isAvailable: true,
        installUrl: "https://freighter.app/",
        logo: expect.any(String),
      }),
    ]);
  });

  test("hides unavailable configured wallets when the published setting requests it", async () => {
    const adapter = mockAdapter();
    vi.mocked(adapter.listWallets!).mockResolvedValue([
      { id: "freighter", name: "Freighter", isAvailable: true, url: "" },
      { id: "noir", name: "Noir", isAvailable: false, url: "" },
    ]);
    const client = new VeloWalletClient({
      projectKey: publishedConfig.projectKey,
      adapter,
      fetchConfig: async () => ({
        ...publishedConfig,
        walletIds: ["freighter", "noir"],
        modal: { showInstallLabel: true, hideUnsupportedWallets: true },
      }),
    });

    await expect(client.listWallets()).resolves.toMatchObject([{ id: "freighter" }]);
  });

  test("persists only the address and wallet id", async () => {
    const client = new VeloWalletClient({
      projectKey: publishedConfig.projectKey,
      adapter: mockAdapter(),
      fetchConfig: async () => publishedConfig,
    });

    await client.initialize();
    await client.connect();
    expect(window.localStorage.getItem(`velo-wallets:v1:${PROJECT_KEY}:session`)).toBe(
      JSON.stringify({ address: ACCOUNT_ADDRESS, walletId: "freighter" }),
    );
  });

  test("disconnect clears the persisted Noir widget session", async () => {
    const noirConfig = { ...publishedConfig, walletIds: ["noir"] };
    const adapter = mockAdapter();
    vi.mocked(adapter.connect).mockResolvedValue({ address: ACCOUNT_ADDRESS, walletId: "noir" });
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
    expect(window.localStorage.getItem(`velo-wallets:v1:${PROJECT_KEY}:session`)).toBe(
      JSON.stringify({ address: ACCOUNT_ADDRESS, walletId: "noir" }),
    );

    await client.disconnect();
    expect(adapter.disconnect).toHaveBeenCalledOnce();
    expect(window.localStorage.getItem(`velo-wallets:v1:${PROJECT_KEY}:session`)).toBeNull();
    expect(client.getState()).toMatchObject({ status: "disconnected", address: null });
  });

  test("remains connected when browser storage is unavailable", async () => {
    const client = new VeloWalletClient({
      projectKey: PROJECT_KEY,
      adapter: mockAdapter(),
      fetchConfig: async () => publishedConfig,
    });
    await client.initialize();
    const setItem = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("Storage is disabled");
    });
    await expect(client.connect()).resolves.toBe(ACCOUNT_ADDRESS);
    expect(client.getState()).toMatchObject({ status: "connected", address: ACCOUNT_ADDRESS });
    setItem.mockRestore();

    const removeItem = vi.spyOn(window.localStorage, "removeItem").mockImplementation(() => {
      throw new Error("Storage is disabled");
    });
    await expect(client.disconnect()).resolves.toBeUndefined();
    expect(client.getState()).toMatchObject({ status: "disconnected", address: null });
    removeItem.mockRestore();
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
      `velo-wallets:v1:${PROJECT_KEY}:session`,
      JSON.stringify({ address: ACCOUNT_ADDRESS, walletId: "freighter" }),
    );
    const validAdapter = {
      ...mockAdapter(),
      restoreSession: vi.fn(async () => ({ address: ACCOUNT_ADDRESS, walletId: "freighter" })),
    };
    const restored = new VeloWalletClient({
      projectKey: publishedConfig.projectKey,
      adapter: validAdapter,
      fetchConfig: async () => publishedConfig,
    });
    await restored.initialize();
    expect(restored.getState()).toMatchObject({ status: "connected", address: ACCOUNT_ADDRESS });

    window.localStorage.setItem(
      `velo-wallets:v1:${PROJECT_KEY}:session`,
      JSON.stringify({ address: OTHER_ACCOUNT_ADDRESS, walletId: "freighter" }),
    );
    const stale = new VeloWalletClient({
      projectKey: publishedConfig.projectKey,
      adapter: { ...mockAdapter(), restoreSession: vi.fn(async () => null) },
      fetchConfig: async () => publishedConfig,
    });
    await stale.initialize();
    expect(stale.getState()).toMatchObject({ status: "ready", error: { code: "SESSION_STALE" } });
    expect(window.localStorage.getItem(`velo-wallets:v1:${PROJECT_KEY}:session`)).toBeNull();
  });

  test("does not restore a wallet removed from the published configuration", async () => {
    window.localStorage.setItem(
      `velo-wallets:v1:${PROJECT_KEY}:session`,
      JSON.stringify({ address: ACCOUNT_ADDRESS, walletId: "albedo" }),
    );
    const adapter = {
      ...mockAdapter(),
      restoreSession: vi.fn(async () => ({ address: ACCOUNT_ADDRESS, walletId: "albedo" })),
    };
    const client = new VeloWalletClient({
      projectKey: PROJECT_KEY,
      adapter,
      fetchConfig: async () => publishedConfig,
    });

    await client.initialize();
    expect(adapter.restoreSession).not.toHaveBeenCalled();
    expect(client.getState()).toMatchObject({ status: "ready", error: { code: "SESSION_STALE" } });
    expect(window.localStorage.getItem(`velo-wallets:v1:${PROJECT_KEY}:session`)).toBeNull();
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
      fetchConfig: async () => ({ ...publishedConfig, walletIds: ["freighter", "albedo"] }),
    });
    await client.initialize();
    notify({ type: "changed", address: OTHER_ACCOUNT_ADDRESS, walletId: "albedo" });
    expect(client.getState()).toMatchObject({
      status: "connected",
      address: OTHER_ACCOUNT_ADDRESS,
      walletId: "albedo",
    });
    expect(window.localStorage.getItem(`velo-wallets:v1:${PROJECT_KEY}:session`)).toBe(
      JSON.stringify({ address: OTHER_ACCOUNT_ADDRESS, walletId: "albedo" }),
    );
    notify({
      type: "changed",
      address: OTHER_ACCOUNT_ADDRESS,
      walletId: "albedo",
      networkPassphrase: "Public Global Stellar Network ; September 2015",
    });
    expect(client.getState()).toMatchObject({
      status: "error",
      address: null,
      walletId: null,
      error: { code: "NETWORK_MISMATCH" },
    });
    expect(window.localStorage.getItem(`velo-wallets:v1:${PROJECT_KEY}:session`)).toBeNull();
    await expect(client.signTransaction("xdr")).rejects.toMatchObject({ code: "SESSION_STALE" });
    notify({ type: "disconnected" });
    expect(client.getState()).toMatchObject({ status: "disconnected", address: null });
  });

  test("drops a signing result when the connected account changes in flight", async () => {
    let resolveSigning: (value: string) => void = () => undefined;
    let notify: Parameters<WalletKitAdapter["subscribe"]>[0] = () => undefined;
    const adapter = {
      ...mockAdapter(),
      subscribe: vi.fn((listener: Parameters<WalletKitAdapter["subscribe"]>[0]) => {
        notify = listener;
        return () => undefined;
      }),
    };
    vi.mocked(adapter.signTransaction).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSigning = resolve;
      }),
    );
    const client = new VeloWalletClient({
      projectKey: PROJECT_KEY,
      adapter,
      fetchConfig: async () => publishedConfig,
    });
    await client.initialize();
    await client.connect();

    const signing = client.signTransaction("xdr");
    notify({ type: "changed", address: OTHER_ACCOUNT_ADDRESS, walletId: "freighter" });
    resolveSigning("signed for the previous account");
    await expect(signing).rejects.toMatchObject({ code: "SESSION_STALE" });
  });

  test("rejects malformed connection and signing responses", async () => {
    const adapter = mockAdapter();
    const validConnect = adapter.connect;
    Reflect.set(
      adapter,
      "connect",
      vi.fn(async () => ({ address: "GABC", walletId: "freighter" })),
    );
    const client = new VeloWalletClient({
      projectKey: PROJECT_KEY,
      adapter,
      fetchConfig: async () => publishedConfig,
    });
    await client.initialize();
    await expect(client.connect()).rejects.toMatchObject({ code: "WALLET_UNAVAILABLE" });
    expect(client.getState()).toMatchObject({ status: "error", address: null });

    Reflect.set(adapter, "connect", validConnect);
    await client.connect();
    vi.mocked(adapter.signTransaction).mockResolvedValueOnce(" ");
    await expect(client.signTransaction("xdr")).rejects.toMatchObject({ code: "SIGNING_FAILED" });
    await expect(client.signTransaction(" ")).rejects.toMatchObject({ code: "SIGNING_FAILED" });
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
    vi.mocked(adapter.connect).mockResolvedValueOnce({
      address: ACCOUNT_ADDRESS,
      walletId: "freighter",
    });
    await client.connect();
    await expect(client.signMessage("hello")).rejects.toMatchObject({
      code: "WALLET_METHOD_UNSUPPORTED",
    });
  });
});
