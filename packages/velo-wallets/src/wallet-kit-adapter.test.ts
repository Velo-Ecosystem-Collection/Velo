import { beforeEach, describe, expect, test, vi } from "vitest";

const kit = vi.hoisted(() => {
  const callbacks = new Map<string, (event: unknown) => void>();
  let selectedWalletId = "freighter";
  return {
    callbacks,
    init: vi.fn(),
    setTheme: vi.fn(),
    setNetwork: vi.fn(),
    setWallet: vi.fn((walletId: string) => {
      selectedWalletId = walletId;
    }),
    authModal: vi.fn(async () => ({ address: "GABC" })),
    fetchAddress: vi.fn(async () => ({ address: "GABC" })),
    refreshSupportedWallets: vi.fn(async () => [
      {
        id: "freighter",
        name: "Freighter",
        type: "HOT_WALLET",
        isPlatformWrapper: false,
        isAvailable: true,
        url: "https://www.freighter.app/",
        icon: "https://example.test/freighter.png",
      },
      {
        id: "noir",
        name: "Noir",
        type: "HOT_WALLET",
        isPlatformWrapper: false,
        isAvailable: true,
        url: "https://chromewebstore.google.com/detail/noir/example",
        icon: "data:image/png;base64,AA==",
      },
    ]),
    getAddress: vi.fn(async () => ({ address: "GABC" })),
    getNetwork: vi.fn(async () => ({
      network: "TESTNET",
      networkPassphrase: "Test SDF Network ; September 2015",
    })),
    disconnect: vi.fn(async () => undefined),
    on: vi.fn((type: string, callback: (event: unknown) => void) => {
      callbacks.set(type, callback);
      if (type === "state-updated") {
        callback({
          payload: {
            address: undefined,
            networkPassphrase: "Test SDF Network ; September 2015",
          },
        });
      }
      return vi.fn();
    }),
    get selectedModule() {
      return { productId: selectedWalletId };
    },
  };
});

vi.mock("@creit-tech/stellar-wallets-kit", () => ({
  KitEventType: {
    STATE_UPDATED: "state-updated",
    WALLET_SELECTED: "wallet-selected",
    DISCONNECT: "disconnect",
  },
  Networks: { PUBLIC: "public", TESTNET: "testnet" },
  StellarWalletsKit: kit,
}));

vi.mock("@creit-tech/stellar-wallets-kit/modules/utils", () => ({
  defaultModules: vi.fn(() => [{ productId: "freighter" }]),
}));

import { parsePublishedWalletConfig } from "./config.js";
import { StellarWalletsKitAdapter, type WalletKitEvent } from "./wallet-kit-adapter.js";

const config = parsePublishedWalletConfig({
  schemaVersion: 1 as const,
  revision: 1,
  runtimeMajor: 1 as const,
  projectKey: "vw_pk_example",
  network: "testnet" as const,
  walletIds: ["freighter"],
  appearance: { theme: "system" as const, buttonLabel: "Connect wallet" },
  modal: { showInstallLabel: true, hideUnsupportedWallets: false },
  session: { persist: true },
});
const noirConfig = parsePublishedWalletConfig({
  schemaVersion: 1,
  revision: 2,
  runtimeMajor: 1,
  projectKey: "vw_pk_example",
  network: "testnet",
  walletIds: ["noir"],
  appearance: { theme: "system", buttonLabel: "Connect wallet" },
  modal: { showInstallLabel: true, hideUnsupportedWallets: false },
  session: { persist: true },
});

const mediaListeners = new Set<(event: MediaQueryListEvent) => void>();

describe("StellarWalletsKitAdapter", () => {
  beforeEach(() => {
    kit.callbacks.clear();
    vi.clearAllMocks();
    kit.setWallet("freighter");
    mediaListeners.clear();
    vi.mocked(kit.getNetwork).mockResolvedValue({
      network: "TESTNET",
      networkPassphrase: "Test SDF Network ; September 2015",
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
          mediaListeners.add(listener),
        removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
          mediaListeners.delete(listener),
      })),
    });
  });

  test("initializes before a wallet is selected", async () => {
    const adapter = new StellarWalletsKitAdapter();
    const events: WalletKitEvent[] = [];
    adapter.subscribe((event) => events.push(event));

    await expect(adapter.initialize(config)).resolves.toBeUndefined();
    expect(events).toContainEqual({
      type: "changed",
      address: null,
      walletId: null,
      networkPassphrase: "Test SDF Network ; September 2015",
    });
    expect(kit.init).toHaveBeenCalledWith(
      expect.objectContaining({ theme: expect.objectContaining({ primary: "#18181B" }) }),
    );
  });

  test("updates a system theme and removes the listener on cleanup", async () => {
    const adapter = new StellarWalletsKitAdapter();
    await adapter.initialize(config);

    expect(mediaListeners).toHaveLength(1);
    mediaListeners.forEach((listener) => listener({ matches: true } as MediaQueryListEvent));
    expect(kit.setTheme).toHaveBeenCalledWith(expect.objectContaining({ primary: "#FAFAFA" }));

    adapter.destroy();
    expect(mediaListeners).toHaveLength(0);
  });

  test("adds Noir only when selected in the published configuration", async () => {
    const adapter = new StellarWalletsKitAdapter();
    await adapter.initialize(noirConfig);
    expect(kit.init).toHaveBeenCalledWith(
      expect.objectContaining({
        modules: expect.arrayContaining([expect.objectContaining({ productId: "noir" })]),
      }),
    );
  });

  test("checks Noir's selected network when connecting", async () => {
    const adapter = new StellarWalletsKitAdapter();
    await adapter.initialize(noirConfig);
    kit.setWallet("noir");
    await expect(adapter.connect()).resolves.toEqual({ address: "GABC", walletId: "noir" });

    vi.mocked(kit.getNetwork).mockResolvedValueOnce({
      network: "PUBLIC",
      networkPassphrase: "Public Global Stellar Network ; September 2015",
    });
    await expect(adapter.connect()).rejects.toMatchObject({ code: "NETWORK_MISMATCH" });
  });

  test("lists Kit availability and connects directly to a configured wallet", async () => {
    const adapter = new StellarWalletsKitAdapter();
    await adapter.initialize(config);

    await expect(adapter.listWallets()).resolves.toContainEqual({
      id: "freighter",
      name: "Freighter",
      isAvailable: true,
      url: "https://www.freighter.app/",
    });
    await expect(adapter.connect("freighter")).resolves.toEqual({
      address: "GABC",
      walletId: "freighter",
    });
    expect(kit.setWallet).toHaveBeenCalledWith("freighter");
    expect(kit.fetchAddress).toHaveBeenCalledOnce();
    expect(kit.authModal).not.toHaveBeenCalled();
  });

  test("refuses a wallet that is configured but currently unavailable", async () => {
    vi.mocked(kit.refreshSupportedWallets).mockResolvedValueOnce([
      {
        id: "freighter",
        name: "Freighter",
        isAvailable: false,
        isPlatformWrapper: false,
        type: "HOT_WALLET",
        url: "https://www.freighter.app/",
        icon: "",
      },
    ]);
    const adapter = new StellarWalletsKitAdapter();
    await adapter.initialize(config);

    await expect(adapter.connect("freighter")).rejects.toMatchObject({
      code: "WALLET_UNAVAILABLE",
    });
    expect(kit.fetchAddress).not.toHaveBeenCalled();
  });

  test("restores an allowed Noir session without requesting access", async () => {
    const provider = {
      isNoir: true as const,
      isConnected: vi.fn(async () => ({ isConnected: true })),
      isAllowed: vi.fn(async () => ({ isAllowed: true })),
      requestAccess: vi.fn(async () => ({ address: "GABC" })),
      getAddress: vi.fn(async () => ({ address: "GABC" })),
      getNetwork: vi.fn(async () => ({
        network: "TESTNET",
        networkPassphrase: "Test SDF Network ; September 2015",
      })),
      signTransaction: vi.fn(),
      signAuthEntry: vi.fn(),
      signMessage: vi.fn(),
    };
    Object.defineProperty(window, "noir", { configurable: true, value: { stellar: provider } });
    const adapter = new StellarWalletsKitAdapter();
    await adapter.initialize(noirConfig);

    await expect(adapter.restoreSession?.({ address: "GABC", walletId: "noir" })).resolves.toEqual({
      address: "GABC",
      walletId: "noir",
    });
    expect(provider.requestAccess).not.toHaveBeenCalled();
  });

  test("disconnect clears the local Noir session without revoking extension authorization", async () => {
    const provider = { isNoir: true as const };
    Object.defineProperty(window, "noir", { configurable: true, value: { stellar: provider } });
    const adapter = new StellarWalletsKitAdapter();
    await adapter.initialize(noirConfig);

    await adapter.disconnect();
    expect(kit.disconnect).toHaveBeenCalledOnce();
    expect(provider).not.toHaveProperty("disconnect");
  });
});
