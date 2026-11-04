import type { PublishedWalletConfig } from "./config.js";

import { walletKitTheme } from "./appearance.js";
import { VeloWalletError } from "./errors.js";
import { NoirModule, NOIR_ID } from "./noir-module.js";

export type WalletKitSession = { address: string; walletId: string | null };
export type WalletKitOption = {
  id: string;
  name: string;
  isAvailable: boolean;
  url: string;
};
export type WalletKitEvent =
  | { type: "changed"; address: string | null; walletId: string | null; networkPassphrase?: string }
  | { type: "disconnected" };

export interface WalletKitAdapter {
  initialize(config: PublishedWalletConfig): Promise<void>;
  connect(walletId?: string): Promise<WalletKitSession>;
  listWallets?(): Promise<WalletKitOption[]>;
  disconnect(): Promise<void>;
  signTransaction(xdr: string, address: string): Promise<string>;
  signAuthEntry(authEntry: string, address: string): Promise<string>;
  signMessage(message: string, address: string): Promise<string>;
  subscribe(listener: (event: WalletKitEvent) => void): () => void;
  restoreSession?(session: WalletKitSession): Promise<WalletKitSession | null>;
  destroy?(): void;
}

const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
const PUBLIC_PASSPHRASE = "Public Global Stellar Network ; September 2015";

export function networkPassphrase(config: PublishedWalletConfig) {
  return config.network === "public" ? PUBLIC_PASSPHRASE : TESTNET_PASSPHRASE;
}

export class StellarWalletsKitAdapter implements WalletKitAdapter {
  private config: PublishedWalletConfig | null = null;
  private listeners = new Set<(event: WalletKitEvent) => void>();
  private unsubscribers: Array<() => void> = [];
  private themeMedia: MediaQueryList | null = null;
  private themeListener: ((event: MediaQueryListEvent) => void) | null = null;
  private noirModule: NoirModule | null = null;

  async initialize(config: PublishedWalletConfig) {
    if (typeof window === "undefined") throw new Error("Wallet runtime requires a browser.");
    this.config = config;
    const [{ StellarWalletsKit, KitEventType, Networks }, { defaultModules }] = await Promise.all([
      import("@creit-tech/stellar-wallets-kit"),
      import("@creit-tech/stellar-wallets-kit/modules/utils"),
    ]);
    const modules = defaultModules({
      filterBy: (module) => config.walletIds.includes(module.productId),
    });
    this.noirModule = config.walletIds.includes(NOIR_ID) ? new NoirModule() : null;
    if (this.noirModule) modules.push(this.noirModule);
    const systemDark =
      config.appearance.theme === "system" &&
      window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    StellarWalletsKit.init({
      modules,
      network: config.network === "public" ? Networks.PUBLIC : Networks.TESTNET,
      authModal: config.modal,
      theme: walletKitTheme(config.appearance, systemDark),
    });
    StellarWalletsKit.setNetwork(config.network === "public" ? Networks.PUBLIC : Networks.TESTNET);

    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [
      StellarWalletsKit.on(KitEventType.STATE_UPDATED, (event) => {
        this.emit({
          type: "changed",
          address: event.payload.address ?? null,
          walletId: null,
          networkPassphrase: event.payload.networkPassphrase,
        });
      }),
      StellarWalletsKit.on(KitEventType.WALLET_SELECTED, (event) => {
        this.emit({
          type: "changed",
          address: null,
          walletId: event.payload.id ?? null,
        });
      }),
      StellarWalletsKit.on(KitEventType.DISCONNECT, () => this.emit({ type: "disconnected" })),
    ];

    this.removeThemeListener();
    if (config.appearance.theme === "system" && window.matchMedia) {
      this.themeMedia = window.matchMedia("(prefers-color-scheme: dark)");
      this.themeListener = (event) =>
        StellarWalletsKit.setTheme(walletKitTheme(config.appearance, event.matches));
      this.themeMedia.addEventListener("change", this.themeListener);
    }
  }

  async listWallets() {
    const { StellarWalletsKit } = await import("@creit-tech/stellar-wallets-kit");
    const wallets = await StellarWalletsKit.refreshSupportedWallets();
    return wallets.map((wallet) => ({
      id: wallet.id,
      name: wallet.name,
      isAvailable: wallet.isAvailable,
      url: wallet.url,
    }));
  }

  async connect(selectedWalletId?: string) {
    const { StellarWalletsKit } = await import("@creit-tech/stellar-wallets-kit");
    let result: { address: string };
    if (selectedWalletId) {
      const wallets = await StellarWalletsKit.refreshSupportedWallets();
      const wallet = wallets.find((item) => item.id === selectedWalletId);
      if (!wallet || !this.config?.walletIds.includes(selectedWalletId)) {
        throw new VeloWalletError("WALLET_UNAVAILABLE", "This wallet is not enabled for this app.");
      }
      if (!wallet.isAvailable) {
        throw new VeloWalletError("WALLET_UNAVAILABLE", `${wallet.name} is not available.`);
      }
      StellarWalletsKit.setWallet(selectedWalletId);
      result = await StellarWalletsKit.fetchAddress();
    } else {
      result = await StellarWalletsKit.authModal();
    }
    const walletId = StellarWalletsKit.selectedModule?.productId ?? null;
    if (walletId === NOIR_ID) {
      const network = await StellarWalletsKit.getNetwork();
      if (network.networkPassphrase !== this.requirePassphrase()) {
        throw new VeloWalletError(
          "NETWORK_MISMATCH",
          `Switch Noir to ${this.config?.network === "public" ? "Mainnet" : "Testnet"}.`,
        );
      }
    }
    return {
      address: result.address,
      walletId,
    };
  }

  async restoreSession(session: WalletKitSession) {
    try {
      const { StellarWalletsKit } = await import("@creit-tech/stellar-wallets-kit");
      if (session.walletId) StellarWalletsKit.setWallet(session.walletId);
      if (session.walletId === NOIR_ID && this.noirModule) {
        return (await this.noirModule.hasMatchingSession(session.address, this.requirePassphrase()))
          ? session
          : null;
      }
      const result = await StellarWalletsKit.getAddress();
      return result.address === session.address ? session : null;
    } catch (error) {
      if (error instanceof VeloWalletError && error.code === "NETWORK_MISMATCH") throw error;
      return null;
    }
  }

  async disconnect() {
    const { StellarWalletsKit } = await import("@creit-tech/stellar-wallets-kit");
    await StellarWalletsKit.disconnect();
  }

  async signTransaction(xdr: string, address: string) {
    const { StellarWalletsKit } = await import("@creit-tech/stellar-wallets-kit");
    const result = await StellarWalletsKit.signTransaction(xdr, {
      networkPassphrase: this.requirePassphrase(),
      address,
    });
    return result.signedTxXdr;
  }

  async signAuthEntry(authEntry: string, address: string) {
    const { StellarWalletsKit } = await import("@creit-tech/stellar-wallets-kit");
    const result = await StellarWalletsKit.signAuthEntry(authEntry, {
      networkPassphrase: this.requirePassphrase(),
      address,
    });
    return result.signedAuthEntry;
  }

  async signMessage(message: string, address: string) {
    const { StellarWalletsKit } = await import("@creit-tech/stellar-wallets-kit");
    const result = await StellarWalletsKit.signMessage(message, {
      networkPassphrase: this.requirePassphrase(),
      address,
    });
    return result.signedMessage;
  }

  subscribe(listener: (event: WalletKitEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy() {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
    this.removeThemeListener();
    this.listeners.clear();
    this.noirModule = null;
  }

  private emit(event: WalletKitEvent) {
    this.listeners.forEach((listener) => listener(event));
  }

  private requirePassphrase() {
    if (!this.config) throw new Error("Wallet adapter is not initialized.");
    return networkPassphrase(this.config);
  }

  private removeThemeListener() {
    if (this.themeMedia && this.themeListener) {
      this.themeMedia.removeEventListener("change", this.themeListener);
    }
    this.themeMedia = null;
    this.themeListener = null;
  }
}
