import type { PublishedWalletConfig, WalletAppearanceOverrides, WalletNetwork } from "./config.js";

import {
  mergeWalletAppearance,
  parsePublishedWalletConfig,
  validateWalletAppearance,
  WALLET_CATALOG,
} from "./config.js";
import { normalizeWalletError, VeloWalletError, type VeloWalletErrorCode } from "./errors.js";
import {
  networkPassphrase,
  StellarWalletsKitAdapter,
  type WalletKitAdapter,
} from "./wallet-kit-adapter.js";
import { WALLET_LOGOS } from "./wallet-logos.js";

export type VeloWalletStatus =
  | "idle"
  | "loading"
  | "ready"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export type VeloWalletState = {
  status: VeloWalletStatus;
  address: string | null;
  walletId: string | null;
  walletName: string | null;
  network: WalletNetwork;
  error: VeloWalletError | null;
};

export type VeloWalletOption = {
  id: string;
  name: string;
  logo: string;
  isAvailable: boolean;
  installUrl: string | null;
};

export type VeloWalletClientOptions = {
  projectKey: string;
  apiBaseUrl?: string;
  adapter?: WalletKitAdapter;
  fetchConfig?: () => Promise<unknown>;
  appearance?: WalletAppearanceOverrides;
};

export const DEFAULT_VELO_WALLETS_BASE_URL = "https://wallets.velo.dev";

function walletName(walletId: string | null) {
  return WALLET_CATALOG.find((wallet) => wallet.id === walletId)?.name ?? walletId;
}

export class VeloWalletClient {
  readonly adapter: WalletKitAdapter;
  readonly projectKey: string;
  private config: PublishedWalletConfig | null = null;
  private state: VeloWalletState = {
    status: "idle",
    address: null,
    walletId: null,
    walletName: null,
    network: "testnet",
    error: null,
  };
  private listeners = new Set<() => void>();
  private fetchConfig: () => Promise<unknown>;
  private unsubscribeAdapter: (() => void) | null = null;
  private initializePromise: Promise<void> | null = null;
  private appearanceOverrides?: WalletAppearanceOverrides;

  constructor(options: VeloWalletClientOptions) {
    this.projectKey = options.projectKey;
    this.appearanceOverrides = options.appearance;
    this.adapter = options.adapter ?? new StellarWalletsKitAdapter();
    const apiBaseUrl = (options.apiBaseUrl ?? DEFAULT_VELO_WALLETS_BASE_URL).replace(/\/$/, "");
    this.fetchConfig =
      options.fetchConfig ??
      (async () => {
        const response = await fetch(
          `${apiBaseUrl}/api/v1/wallet-config/${encodeURIComponent(this.projectKey)}`,
        );
        if (!response.ok) {
          const codes: Record<number, VeloWalletErrorCode> = {
            403: "ORIGIN_NOT_ALLOWED",
            404: "CONFIG_NOT_FOUND",
            409: "CONFIG_INCOMPATIBLE",
            410: "CONFIG_DISABLED",
          };
          throw new VeloWalletError(
            codes[response.status] ?? "RUNTIME_INIT_FAILED",
            `Wallet configuration request failed (${response.status}).`,
          );
        }
        return await response.json();
      });
  }

  initialize() {
    if (!this.initializePromise) this.initializePromise = this.initializeOnce();
    return this.initializePromise;
  }

  private async initializeOnce() {
    this.patchState({ status: "loading", error: null });
    try {
      const config = parsePublishedWalletConfig(await this.fetchConfig());
      this.config = {
        ...config,
        appearance: mergeWalletAppearance(config.appearance, this.appearanceOverrides),
      };
      const appearanceErrors = validateWalletAppearance(this.config.appearance);
      if (appearanceErrors.length > 0) {
        throw new VeloWalletError(
          "CONFIG_INCOMPATIBLE",
          `Invalid appearance override: ${appearanceErrors.join(" ")}`,
        );
      }
      this.patchState({ network: this.config.network });
      await this.adapter.initialize(this.config);
      this.unsubscribeAdapter = this.adapter.subscribe((event) => {
        if (event.type === "disconnected") {
          this.clearSession();
          this.patchState({
            status: "disconnected",
            address: null,
            walletId: null,
            walletName: null,
            error: null,
          });
          return;
        }

        if (
          event.networkPassphrase &&
          event.networkPassphrase !== networkPassphrase(this.requireConfig())
        ) {
          this.patchState({
            status: "error",
            error: new VeloWalletError(
              "NETWORK_MISMATCH",
              `Switch the wallet to ${this.config?.network === "public" ? "Mainnet" : "Testnet"}.`,
            ),
          });
          return;
        }

        this.patchState({
          ...(event.address !== null
            ? { address: event.address, status: "connected" as const }
            : {}),
          ...(event.walletId !== null
            ? { walletId: event.walletId, walletName: walletName(event.walletId) }
            : {}),
        });
      });

      const storedSession = this.readSession();
      if (storedSession && this.adapter.restoreSession) {
        const restored = await this.adapter.restoreSession(storedSession);
        if (restored) {
          this.patchState({
            status: "connected",
            address: restored.address,
            walletId: restored.walletId,
            walletName: walletName(restored.walletId),
          });
          return;
        }
        this.clearSession();
        this.patchState({
          status: "ready",
          error: new VeloWalletError(
            "SESSION_STALE",
            "The saved wallet session expired. Connect again to continue.",
          ),
        });
        return;
      }
      this.patchState({ status: "ready", error: null });
    } catch (error) {
      this.patchState({
        status: "error",
        error: normalizeWalletError(error, "RUNTIME_INIT_FAILED"),
      });
      throw this.state.error;
    }
  }

  async listWallets(): Promise<VeloWalletOption[]> {
    await this.initialize();
    const config = this.requireConfig();
    const discovered = this.adapter.listWallets
      ? await this.adapter.listWallets()
      : config.walletIds.map((id) => ({
          id,
          name: walletName(id) ?? id,
          isAvailable: true,
          url: "",
        }));
    const byId = new Map(discovered.map((wallet) => [wallet.id, wallet]));
    return config.walletIds
      .map((id) => {
        const wallet = byId.get(id);
        const entry = WALLET_CATALOG.find((item) => item.id === id);
        const installUrl = safeInstallUrl(wallet?.url);
        return {
          id,
          name: entry?.name ?? wallet?.name ?? id,
          logo: WALLET_LOGOS[id] ?? "",
          isAvailable: wallet?.isAvailable ?? false,
          installUrl,
        };
      })
      .filter((wallet) => !config.modal.hideUnsupportedWallets || wallet.isAvailable);
  }

  async connect(walletId?: string) {
    await this.initialize();
    this.patchState({ status: "connecting", error: null });
    try {
      const session = await this.adapter.connect(walletId);
      this.patchState({
        status: "connected",
        address: session.address,
        walletId: session.walletId,
        walletName: walletName(session.walletId),
      });
      this.writeSession(session);
      return session.address;
    } catch (error) {
      const normalized = normalizeWalletError(error, "WALLET_UNAVAILABLE");
      this.patchState({ status: "error", error: normalized });
      throw normalized;
    }
  }

  async disconnect() {
    await this.adapter.disconnect();
    this.clearSession();
    this.patchState({
      status: "disconnected",
      address: null,
      walletId: null,
      walletName: null,
      error: null,
    });
  }

  getAddress() {
    return this.state.address;
  }

  getConfig() {
    return this.config;
  }

  signTransaction(xdr: string) {
    return this.sign((address) => this.adapter.signTransaction(xdr, address));
  }

  signAuthEntry(authEntry: string) {
    return this.sign((address) => this.adapter.signAuthEntry(authEntry, address));
  }

  signMessage(message: string) {
    return this.sign((address) => this.adapter.signMessage(message, address));
  }

  getState = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  destroy() {
    this.unsubscribeAdapter?.();
    this.unsubscribeAdapter = null;
    this.adapter.destroy?.();
    this.listeners.clear();
  }

  private async sign(operation: (address: string) => Promise<string>) {
    const address = this.state.address;
    if (!address) throw new VeloWalletError("SESSION_STALE", "Connect a wallet before signing.");
    try {
      return await operation(address);
    } catch (error) {
      throw normalizeWalletError(error, "SIGNING_FAILED");
    }
  }

  private requireConfig() {
    if (!this.config)
      throw new VeloWalletError("RUNTIME_INIT_FAILED", "Runtime is not initialized.");
    return this.config;
  }

  private patchState(patch: Partial<VeloWalletState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  private storageKey() {
    return `velo-wallets:v1:${this.projectKey}:session`;
  }

  private readSession() {
    if (typeof window === "undefined" || !this.config?.session.persist) return null;
    try {
      const value = window.localStorage.getItem(this.storageKey());
      if (!value) return null;
      const parsed = JSON.parse(value) as { address?: unknown; walletId?: unknown };
      return typeof parsed.address === "string"
        ? {
            address: parsed.address,
            walletId: typeof parsed.walletId === "string" ? parsed.walletId : null,
          }
        : null;
    } catch {
      return null;
    }
  }

  private writeSession(session: { address: string; walletId: string | null }) {
    if (typeof window === "undefined" || !this.config?.session.persist) return;
    window.localStorage.setItem(this.storageKey(), JSON.stringify(session));
  }

  private clearSession() {
    if (typeof window !== "undefined") window.localStorage.removeItem(this.storageKey());
  }
}

function safeInstallUrl(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

let sharedClient: VeloWalletClient | null = null;
let sharedAppearanceKey = "";
let sharedClientUsers = 0;

export function getSharedVeloWalletClient(options: VeloWalletClientOptions) {
  if (sharedClient && sharedClient.projectKey !== options.projectKey) {
    throw new VeloWalletError(
      "RUNTIME_INIT_FAILED",
      "Only one Velo Wallets project key can be active in a document.",
    );
  }
  const appearanceKey = JSON.stringify(options.appearance ?? {});
  if (sharedClient && sharedAppearanceKey !== appearanceKey) {
    throw new VeloWalletError(
      "RUNTIME_INIT_FAILED",
      "Only one Velo Wallets appearance override can be active in a document.",
    );
  }
  if (!sharedClient) {
    sharedAppearanceKey = appearanceKey;
    sharedClient = new VeloWalletClient(options);
  }
  sharedClientUsers += 1;
  return sharedClient;
}

export function releaseSharedVeloWalletClient(client: VeloWalletClient) {
  if (sharedClient !== client) return;
  sharedClientUsers = Math.max(0, sharedClientUsers - 1);
  if (sharedClientUsers === 0) {
    sharedClient.destroy();
    sharedClient = null;
    sharedAppearanceKey = "";
  }
}
