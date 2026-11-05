import { serializeCssVariables, walletCssVariables, walletPalette } from "./appearance.js";
import {
  getSharedVeloWalletClient,
  releaseSharedVeloWalletClient,
  type VeloWalletClient,
  type VeloWalletState,
} from "./browser.js";
import {
  DEFAULT_WALLET_CONFIG,
  normalizeWalletAppearance,
  type WalletAppearanceOverrides,
  type WalletPalette,
} from "./config.js";
import { openWalletSelector } from "./wallet-selector.js";

const EVENT_VERSION = 1;
const BaseElement: typeof HTMLElement =
  typeof HTMLElement === "undefined" ? (class {} as typeof HTMLElement) : HTMLElement;

export class VeloWalletElement extends BaseElement {
  private client: VeloWalletClient | null = null;
  private unsubscribe: (() => void) | null = null;
  private root: ShadowRoot | null = null;
  private lastStatus: VeloWalletState["status"] = "idle";
  private localAppearance?: WalletAppearanceOverrides;
  private themeMedia: MediaQueryList | null = null;
  private readonly handleThemeChange = () => this.render();

  set appearance(value: WalletAppearanceOverrides | undefined) {
    this.localAppearance = value;
  }

  get appearance() {
    return this.localAppearance;
  }

  connectedCallback() {
    if (!this.root) this.root = this.attachShadow({ mode: "open" });
    const projectKey = this.getAttribute("project-key");
    if (!projectKey) {
      this.renderError("Add a project-key attribute to initialize Velo Wallets.");
      return;
    }

    const cssAppearance = readCssAppearanceOverrides(this);
    this.client = getSharedVeloWalletClient({
      projectKey,
      apiBaseUrl: this.getAttribute("api-base") ?? undefined,
      appearance: mergeAppearanceOverrides(cssAppearance, this.localAppearance),
    });
    if (window.matchMedia) {
      this.themeMedia = window.matchMedia("(prefers-color-scheme: dark)");
      this.themeMedia.addEventListener("change", this.handleThemeChange);
    }
    this.unsubscribe = this.client.subscribe(() => this.render());
    this.render();
    this.client
      .initialize()
      .then(() => this.dispatch("velo:wallet-ready"))
      .catch((error) => this.dispatch("velo:wallet-error", { error }));
  }

  disconnectedCallback() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.client) releaseSharedVeloWalletClient(this.client);
    this.client = null;
    this.themeMedia?.removeEventListener("change", this.handleThemeChange);
    this.themeMedia = null;
  }

  async connect() {
    if (!this.client) throw new Error("Velo Wallets element is not connected.");
    try {
      return await this.client.connect();
    } finally {
      this.root?.querySelector<HTMLElement>(".primary")?.focus();
    }
  }

  async disconnect() {
    if (!this.client) return;
    await this.client.disconnect();
    this.root?.querySelector<HTMLElement>(".primary")?.focus();
  }

  getAddress() {
    return Promise.resolve(this.client?.getAddress() ?? null);
  }

  signTransaction(xdr: string) {
    if (!this.client) throw new Error("Velo Wallets element is not connected.");
    return this.announceSigning("transaction", () => this.client!.signTransaction(xdr));
  }

  signAuthEntry(authEntry: string) {
    if (!this.client) throw new Error("Velo Wallets element is not connected.");
    return this.announceSigning("authorization entry", () => this.client!.signAuthEntry(authEntry));
  }

  signMessage(message: string) {
    if (!this.client) throw new Error("Velo Wallets element is not connected.");
    return this.announceSigning("message", () => this.client!.signMessage(message));
  }

  private render() {
    if (!this.root || !this.client) return;
    const state = this.client.getState();
    const connected = state.status === "connected";
    const appearance =
      this.client.getConfig()?.appearance ?? normalizeWalletAppearance(DEFAULT_WALLET_CONFIG);
    const theme = appearance.theme;
    const systemDark = theme === "system" && Boolean(this.themeMedia?.matches);
    const palette = walletPalette(appearance, systemDark);
    const configVariables = Object.fromEntries(
      Object.entries(walletCssVariables(appearance, palette)).map(([key, value]) => [
        key.replace("--velo-wallet-", "--velo-config-"),
        value,
      ]),
    );
    const label = connected
      ? `${state.walletName ?? "Wallet"} · ${shortenAddress(state.address)}`
      : state.status === "connecting"
        ? "Connecting…"
        : state.status === "loading"
          ? "Loading…"
          : appearance.buttonLabel;
    this.root.innerHTML = `
      <style>${styles}</style>
      <div class="wallet theme-${theme}" part="container" data-status="${state.status}" style="${escapeAttribute(serializeCssVariables(configVariables))}">
        <button class="primary" part="trigger" type="button" ${state.status === "connecting" || state.status === "loading" ? "disabled" : ""}>${escapeHtml(label)}</button>
        ${connected ? `<div class="actions" part="actions"><button class="copy" part="copy-button" type="button">Copy address</button><button class="disconnect" part="disconnect-button" type="button">Disconnect</button></div>` : ""}
        <span class="status" part="status" role="status" aria-live="polite">${escapeHtml(statusMessage(state))}</span>
      </div>
    `;
    this.root.querySelector(".primary")?.addEventListener("click", () => {
      const action = connected
        ? Promise.resolve()
        : openWalletSelector(this.client!).then(() => {
            this.root?.querySelector<HTMLElement>(".primary")?.focus();
          });
      action.catch((error) => this.dispatch("velo:wallet-error", { error }));
    });
    this.root.querySelector(".disconnect")?.addEventListener("click", () => {
      this.disconnect().catch((error) => this.dispatch("velo:wallet-error", { error }));
    });
    this.root.querySelector(".copy")?.addEventListener("click", () => {
      const address = state.address;
      if (address && navigator.clipboard) {
        navigator.clipboard.writeText(address).then(() => this.setAnnouncement("Address copied."));
      }
    });
    this.dispatch("velo:wallet-changed", { state });
    if (state.status === "connected" && this.lastStatus !== "connected") {
      this.dispatch("velo:wallet-connected", { address: state.address });
    }
    if (state.status === "disconnected" && this.lastStatus === "connected") {
      this.dispatch("velo:wallet-disconnected");
    }
    this.lastStatus = state.status;
  }

  private renderError(message: string) {
    if (!this.root) return;
    this.root.innerHTML = `<span role="alert">${escapeHtml(message)}</span>`;
  }

  private async announceSigning(label: string, operation: () => Promise<string>) {
    this.setAnnouncement(`Requesting ${label} signature.`);
    try {
      const result = await operation();
      this.setAnnouncement(`${label[0]?.toUpperCase()}${label.slice(1)} signed.`);
      return result;
    } catch (error) {
      this.setAnnouncement(`${label[0]?.toUpperCase()}${label.slice(1)} signing failed.`);
      this.dispatch("velo:wallet-error", { error });
      throw error;
    }
  }

  private setAnnouncement(message: string) {
    const status = this.root?.querySelector<HTMLElement>(".status");
    if (status) status.textContent = message;
  }

  private dispatch(name: string, detail: Record<string, unknown> = {}) {
    this.dispatchEvent(
      new CustomEvent(name, {
        bubbles: true,
        composed: true,
        detail: { version: EVENT_VERSION, ...detail },
      }),
    );
  }
}

function statusMessage(state: VeloWalletState) {
  if (state.error) return state.error.message;
  if (state.status === "connected") return `Connected to ${state.walletName ?? "wallet"}.`;
  if (state.status === "connecting") return "Opening wallet selector.";
  if (state.status === "loading") return "Loading wallet configuration.";
  if (state.status === "ready") return "Wallet connection is ready.";
  if (state.status === "disconnected") return "Wallet disconnected.";
  return "";
}

function shortenAddress(address: string | null) {
  return address && address.length > 14
    ? `${address.slice(0, 7)}…${address.slice(-5)}`
    : (address ?? "");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    };
    return entities[character] ?? character;
  });
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

const paletteTokens: Array<[keyof WalletPalette, string]> = [
  ["background", "background"],
  ["surface", "surface"],
  ["surfaceMuted", "surface-muted"],
  ["text", "text"],
  ["mutedText", "muted-text"],
  ["accent", "accent"],
  ["accentText", "accent-text"],
  ["border", "border"],
  ["danger", "danger"],
  ["focusRing", "focus-ring"],
];

function readCssAppearanceOverrides(element: HTMLElement): WalletAppearanceOverrides | undefined {
  const computed = getComputedStyle(element);
  const light: Partial<WalletPalette> = {};
  const dark: Partial<WalletPalette> = {};
  for (const [token, cssToken] of paletteTokens) {
    const shared = computed.getPropertyValue(`--velo-wallet-${cssToken}`).trim();
    const lightValue =
      computed.getPropertyValue(`--velo-wallet-light-${cssToken}`).trim() || shared;
    const darkValue = computed.getPropertyValue(`--velo-wallet-dark-${cssToken}`).trim() || shared;
    if (lightValue) light[token] = lightValue;
    if (darkValue) dark[token] = darkValue;
  }
  return Object.keys(light).length || Object.keys(dark).length
    ? { palettes: { light, dark } }
    : undefined;
}

function mergeAppearanceOverrides(
  base?: WalletAppearanceOverrides,
  override?: WalletAppearanceOverrides,
): WalletAppearanceOverrides | undefined {
  if (!base) return override;
  if (!override) return base;
  return {
    ...base,
    ...override,
    palettes: {
      light: { ...base.palettes?.light, ...override.palettes?.light },
      dark: { ...base.palettes?.dark, ...override.palettes?.dark },
    },
    button: { ...base.button, ...override.button },
    modal: { ...base.modal, ...override.modal },
  };
}

const styles = `
  :host { display: inline-block; }
  .wallet { display: grid; gap: .35rem; }
  button { border: 1px solid var(--velo-wallet-border, var(--velo-config-border)); border-radius: var(--velo-wallet-button-radius, var(--velo-config-button-radius)); background: var(--velo-wallet-surface, var(--velo-config-surface)); color: var(--velo-wallet-text, var(--velo-config-text)); cursor: pointer; font-family: var(--velo-wallet-font-family, var(--velo-config-font-family)); font-size: .875rem; font-weight: 600; padding: .45rem .7rem; }
  button.primary { background: var(--velo-wallet-button-background, var(--velo-config-button-background)); border-color: var(--velo-wallet-button-border, var(--velo-config-button-border)); color: var(--velo-wallet-button-text, var(--velo-config-button-text)); padding: var(--velo-wallet-button-padding, var(--velo-config-button-padding)); }
  .actions { display: flex; gap: .4rem; }
  button.disconnect { color: var(--velo-wallet-danger, var(--velo-config-danger)); }
  button:focus-visible { outline: 3px solid var(--velo-wallet-focus-ring, var(--velo-config-focus-ring)); outline-offset: 2px; }
  button:disabled { cursor: wait; opacity: .65; }
  .status { color: var(--velo-wallet-muted-text, var(--velo-config-muted-text)); font-family: var(--velo-wallet-font-family, var(--velo-config-font-family)); font-size: .75rem; max-width: 24rem; }
  [data-status="error"] .status { color: var(--velo-wallet-danger, var(--velo-config-danger)); }
`;

if (typeof customElements !== "undefined" && !customElements.get("velo-wallet")) {
  customElements.define("velo-wallet", VeloWalletElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "velo-wallet": VeloWalletElement;
  }
}
