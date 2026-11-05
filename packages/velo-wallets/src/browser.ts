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
  type WalletKitSession,
} from "./wallet-kit-adapter.js";
import { WALLET_LOGOS } from "./wallet-logos.js";
import { isValidStellarAccountId, isWalletSigningPayload } from "./wallet-validation.js";

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
const PUBLIC_PROJECT_KEY = /^vw_pk_[A-Za-z0-9_-]{32}$/;
const MAX_SIGNING_RESPONSE_LENGTH = 1_048_576;

function walletName(walletId: string | null) {
  return WALLET_CATALOG.find((wallet) => wallet.id === walletId)?.name ?? walletId;
}

function normalizeApiBaseUrl(value: string | undefined) {
  let url: URL;
  try {
    url = new URL(value ?? DEFAULT_VELO_WALLETS_BASE_URL);
  } catch {
    throw new VeloWalletError(
      "CONFIG_INCOMPATIBLE",
      "Wallet API base URL must be an absolute URL.",
    );
  }
  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol === "http:" && !localHosts.has(url.hostname))
  ) {
    throw new VeloWalletError(
      "CONFIG_INCOMPATIBLE",
      "Wallet API base URL must use HTTPS, or HTTP on a local development host, without credentials, query, or fragment.",
    );
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

function isWalletSession(
  value: unknown,
  allowedWalletIds?: readonly string[],
): value is WalletKitSession {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  if (!("address" in value) || !isValidStellarAccountId(value.address)) return false;
  if (!("walletId" in value)) return false;
  return (
    value.walletId === null ||
    (typeof value.walletId === "string" &&
      (allowedWalletIds === undefined || allowedWalletIds.includes(value.walletId)))
  );
}

function validSessionError(code: "SESSION_STALE" | "WALLET_UNAVAILABLE") {
  return new VeloWalletError(
    code,
    code === "SESSION_STALE"
      ? "The saved wallet session is invalid or no longer enabled. Connect again to continue."
      : "The wallet returned an invalid account or selected wallet.",
  );
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
  private connectionAttempt = 0;
  private sessionRevision = 0;
  private lifecycleRevision = 0;
  private destroyed = false;

  constructor(options: VeloWalletClientOptions) {
    if (!PUBLIC_PROJECT_KEY.test(options.projectKey)) {
      throw new VeloWalletError("CONFIG_INCOMPATIBLE", "Provide a valid Velo wallet project key.");
    }
    this.projectKey = options.projectKey;
    this.appearanceOverrides = options.appearance;
    this.adapter = options.adapter ?? new StellarWalletsKitAdapter();
    const apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl);
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

  initialize(): Promise<void> {
    if (this.destroyed) {
      return Promise.reject(
        new VeloWalletError("SESSION_STALE", "Wallet client has been destroyed."),
      );
    }
    if (!this.initializePromise) {
      const promise = this.initializeOnce(this.lifecycleRevision);
      this.initializePromise = promise;
      void promise.catch(() => {
        if (this.initializePromise === promise) this.initializePromise = null;
      });
    }
    return this.initializePromise;
  }

  private async initializeOnce(lifecycleRevision: number) {
    this.patchState({ status: "loading", error: null });
    try {
      const config = parsePublishedWalletConfig(await this.fetchConfig());
      if (config.projectKey !== this.projectKey) {
        throw new VeloWalletError(
          "CONFIG_INCOMPATIBLE",
          "Wallet configuration does not match the requested project key.",
        );
      }
      if (this.lifecycleRevision !== lifecycleRevision || this.destroyed) {
        throw new VeloWalletError("SESSION_STALE", "Wallet client has been destroyed.");
      }
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
      if (this.lifecycleRevision !== lifecycleRevision || this.destroyed) {
        this.adapter.destroy?.();
        throw new VeloWalletError("SESSION_STALE", "Wallet client has been destroyed.");
      }
      this.unsubscribeAdapter = this.adapter.subscribe((event) => {
        if (event.type === "disconnected") {
          this.connectionAttempt += 1;
          this.sessionRevision += 1;
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

        const currentConfig = this.config;
        if (!currentConfig) return;
        if (
          event.networkPassphrase &&
          event.networkPassphrase !== networkPassphrase(currentConfig)
        ) {
          this.invalidateSession(
            new VeloWalletError(
              "NETWORK_MISMATCH",
              `Switch the wallet to ${currentConfig.network === "public" ? "Mainnet" : "Testnet"}.`,
            ),
          );
          return;
        }

        if (event.address !== null && !isValidStellarAccountId(event.address)) {
          this.invalidateSession(validSessionError("WALLET_UNAVAILABLE"));
          return;
        }
        if (event.walletId !== null && !currentConfig.walletIds.includes(event.walletId)) {
          this.invalidateSession(validSessionError("WALLET_UNAVAILABLE"));
          return;
        }

        const currentState = this.state;
        const walletChanged = event.walletId !== null && event.walletId !== currentState.walletId;
        const accountChanged =
          event.address !== null &&
          currentState.address !== null &&
          event.address !== currentState.address;
        if (walletChanged && event.address === null) {
          this.sessionRevision += 1;
          this.clearSession();
          this.patchState({
            status: currentState.status === "connecting" ? "connecting" : "ready",
            address: null,
            walletId: event.walletId,
            walletName: walletName(event.walletId),
            error: null,
          });
          return;
        }

        const walletId = event.walletId ?? currentState.walletId;
        if (accountChanged || walletChanged) this.sessionRevision += 1;
        this.patchState({
          ...(event.address !== null
            ? { address: event.address, status: "connected" as const }
            : {}),
          ...(event.walletId !== null
            ? { walletId: event.walletId, walletName: walletName(event.walletId) }
            : {}),
        });
        if (event.address !== null) {
          if (walletId !== null) this.writeSession({ address: event.address, walletId });
          else this.clearSession();
        }
      });

      if (!this.config.session.persist) this.clearSession();
      const storedSession = this.readSession();
      if (storedSession && this.state.address === null) {
        const walletIsEnabled =
          storedSession.walletId === null || this.config.walletIds.includes(storedSession.walletId);
        const restoredValue =
          walletIsEnabled && this.adapter.restoreSession
            ? await this.adapter.restoreSession(storedSession)
            : null;
        if (
          restoredValue &&
          isWalletSession(restoredValue, this.config.walletIds) &&
          restoredValue.address === storedSession.address &&
          restoredValue.walletId === storedSession.walletId
        ) {
          this.patchState({
            status: "connected",
            address: restoredValue.address,
            walletId: restoredValue.walletId,
            walletName: walletName(restoredValue.walletId),
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
      this.unsubscribeAdapter?.();
      this.unsubscribeAdapter = null;
      this.adapter.destroy?.();
      const normalized = normalizeWalletError(error, "RUNTIME_INIT_FAILED");
      if (normalized.code === "NETWORK_MISMATCH") this.clearSession();
      if (this.lifecycleRevision === lifecycleRevision && !this.destroyed) {
        this.patchState({ status: "error", error: normalized });
      }
      throw normalized;
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
    const config = this.requireConfig();
    if (walletId !== undefined && !config.walletIds.includes(walletId)) {
      throw new VeloWalletError("WALLET_UNAVAILABLE", "This wallet is not enabled for this app.");
    }
    const attempt = ++this.connectionAttempt;
    this.sessionRevision += 1;
    this.clearSession();
    this.patchState({
      status: "connecting",
      address: null,
      walletId: null,
      walletName: null,
      error: null,
    });
    try {
      const session = await this.adapter.connect(walletId);
      if (!isWalletSession(session, config.walletIds)) {
        throw validSessionError("WALLET_UNAVAILABLE");
      }
      if (attempt !== this.connectionAttempt || this.destroyed) {
        throw new VeloWalletError(
          "SESSION_STALE",
          "The wallet connection changed before it completed.",
        );
      }
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
      if (attempt === this.connectionAttempt && !this.destroyed) {
        this.patchState({ status: "error", error: normalized });
      }
      throw normalized;
    }
  }

  async disconnect() {
    this.connectionAttempt += 1;
    this.sessionRevision += 1;
    this.clearSession();
    this.patchState({
      status: "disconnected",
      address: null,
      walletId: null,
      walletName: null,
      error: null,
    });
    try {
      await this.adapter.disconnect();
    } catch (error) {
      const normalized = normalizeWalletError(error, "WALLET_UNAVAILABLE");
      this.patchState({ status: "error", error: normalized });
      throw normalized;
    }
  }

  getAddress() {
    return this.state.address;
  }

  getConfig() {
    return this.config;
  }

  signTransaction(xdr: string) {
    return this.sign(xdr, (address) => this.adapter.signTransaction(xdr, address));
  }

  signAuthEntry(authEntry: string) {
    return this.sign(authEntry, (address) => this.adapter.signAuthEntry(authEntry, address));
  }

  signMessage(message: string) {
    return this.sign(message, (address) => this.adapter.signMessage(message, address));
  }

  getState = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  destroy() {
    this.destroyed = true;
    this.lifecycleRevision += 1;
    this.connectionAttempt += 1;
    this.sessionRevision += 1;
    this.unsubscribeAdapter?.();
    this.unsubscribeAdapter = null;
    this.adapter.destroy?.();
    this.listeners.clear();
  }

  private async sign(input: string, operation: (address: string) => Promise<unknown>) {
    if (!isWalletSigningPayload(input)) {
      throw new VeloWalletError(
        "SIGNING_FAILED",
        "Signing input must be a non-empty string no larger than 1 MiB.",
      );
    }
    const session = this.state;
    if (
      session.status !== "connected" ||
      !isValidStellarAccountId(session.address) ||
      this.destroyed
    ) {
      throw new VeloWalletError("SESSION_STALE", "Connect a wallet before signing.");
    }
    const sessionRevision = this.sessionRevision;
    try {
      const result = await operation(session.address);
      if (
        this.sessionRevision !== sessionRevision ||
        this.state.status !== "connected" ||
        this.state.address !== session.address ||
        this.state.walletId !== session.walletId
      ) {
        throw new VeloWalletError("SESSION_STALE", "The wallet session changed while signing.");
      }
      if (
        typeof result !== "string" ||
        result.trim().length === 0 ||
        result.length > MAX_SIGNING_RESPONSE_LENGTH
      ) {
        throw new VeloWalletError(
          "SIGNING_FAILED",
          "The wallet returned an invalid signing response.",
        );
      }
      return result;
    } catch (error) {
      const normalized = normalizeWalletError(error, "SIGNING_FAILED");
      if (normalized.code === "NETWORK_MISMATCH") this.invalidateSession(normalized);
      throw normalized;
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
      const parsed: unknown = JSON.parse(value);
      if (isWalletSession(parsed)) return parsed;
      this.clearSession();
      return null;
    } catch {
      return null;
    }
  }

  private writeSession(session: { address: string; walletId: string | null }) {
    if (typeof window === "undefined" || !this.config?.session.persist) return;
    try {
      window.localStorage.setItem(this.storageKey(), JSON.stringify(session));
    } catch {
      // Wallet access remains usable when browser storage is disabled or full.
    }
  }

  private clearSession() {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(this.storageKey());
    } catch {
      // Disconnecting and invalidating a session must not depend on browser storage.
    }
  }

  private invalidateSession(error: VeloWalletError) {
    this.connectionAttempt += 1;
    this.sessionRevision += 1;
    this.clearSession();
    this.patchState({
      status: "error",
      address: null,
      walletId: null,
      walletName: null,
      error,
    });
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
