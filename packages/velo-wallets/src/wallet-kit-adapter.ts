import type { PublishedWalletConfig } from "./config.js";

import { walletKitTheme } from "./appearance.js";
import { VeloWalletError } from "./errors.js";
import { NoirModule, NOIR_ID } from "./noir-module.js";
import { isValidStellarAccountId, isWalletSigningPayload } from "./wallet-validation.js";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readEventPayload(value: unknown) {
  if (!isRecord(value) || !isRecord(value.payload)) return null;
  return value.payload;
}

function requireWalletAddress(value: unknown) {
  if (!isValidStellarAccountId(value)) {
    throw new VeloWalletError(
      "WALLET_UNAVAILABLE",
      "Wallet returned an invalid Stellar account ID.",
    );
  }
  return value;
}

function requireSignedValue(value: unknown, label: string) {
  if (!isWalletSigningPayload(value)) {
    throw new VeloWalletError("SIGNING_FAILED", `Wallet returned an invalid ${label}.`);
  }
  return value;
}

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
        const payload = readEventPayload(event);
        if (!payload) {
          this.emit({ type: "disconnected" });
          return;
        }
        const address = payload.address;
        const networkPassphrase = payload.networkPassphrase;
        if (
          (address !== undefined && address !== null && !isValidStellarAccountId(address)) ||
          (networkPassphrase !== undefined &&
            networkPassphrase !== null &&
            typeof networkPassphrase !== "string")
        ) {
          this.emit({ type: "disconnected" });
          return;
        }
        this.emit({
          type: "changed",
          address: typeof address === "string" ? address : null,
          walletId: null,
          ...(typeof networkPassphrase === "string" ? { networkPassphrase } : {}),
        });
      }),
      StellarWalletsKit.on(KitEventType.WALLET_SELECTED, (event) => {
        const payload = readEventPayload(event);
        const id = payload?.id;
        if (!payload || (id !== undefined && id !== null && typeof id !== "string")) {
          this.emit({ type: "disconnected" });
          return;
        }
        this.emit({
          type: "changed",
          address: null,
          walletId: typeof id === "string" ? id : null,
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
    if (!Array.isArray(wallets)) return [];
    return wallets.flatMap((wallet) => {
      if (
        !isRecord(wallet) ||
        typeof wallet.id !== "string" ||
        typeof wallet.name !== "string" ||
        typeof wallet.isAvailable !== "boolean"
      ) {
        return [];
      }
      return [
        {
          id: wallet.id,
          name: wallet.name,
          isAvailable: wallet.isAvailable,
          url: typeof wallet.url === "string" ? wallet.url : "",
        },
      ];
    });
  }

  async connect(selectedWalletId?: string) {
    const { StellarWalletsKit } = await import("@creit-tech/stellar-wallets-kit");
    let result: { address: string };
    if (selectedWalletId) {
      const wallets = await StellarWalletsKit.refreshSupportedWallets();
      if (!Array.isArray(wallets)) {
        throw new VeloWalletError(
          "WALLET_UNAVAILABLE",
          "Wallet discovery returned an invalid response.",
        );
      }
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
    const selectedModule = StellarWalletsKit.selectedModule;
    const walletId =
      typeof selectedModule?.productId === "string" ? selectedModule.productId : null;
    if (walletId !== null && !this.config?.walletIds.includes(walletId)) {
      throw new VeloWalletError("WALLET_UNAVAILABLE", "This wallet is not enabled for this app.");
    }
    const address = requireWalletAddress(isRecord(result) ? result.address : null);
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
      address,
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
      return isRecord(result) &&
        isValidStellarAccountId(result.address) &&
        result.address === session.address
        ? session
        : null;
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
    return requireSignedValue(isRecord(result) ? result.signedTxXdr : null, "signed transaction");
  }

  async signAuthEntry(authEntry: string, address: string) {
    const { StellarWalletsKit } = await import("@creit-tech/stellar-wallets-kit");
    const result = await StellarWalletsKit.signAuthEntry(authEntry, {
      networkPassphrase: this.requirePassphrase(),
      address,
    });
    return requireSignedValue(
      isRecord(result) ? result.signedAuthEntry : null,
      "signed authorization entry",
    );
  }

  async signMessage(message: string, address: string) {
    const { StellarWalletsKit } = await import("@creit-tech/stellar-wallets-kit");
    const result = await StellarWalletsKit.signMessage(message, {
      networkPassphrase: this.requirePassphrase(),
      address,
    });
    return requireSignedValue(isRecord(result) ? result.signedMessage : null, "signed message");
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
