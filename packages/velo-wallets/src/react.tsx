"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";

import {
  WALLET_BUTTON_PADDING,
  WALLET_BUTTON_RADII,
  WALLET_FONT_STACKS,
  walletPalette,
} from "./appearance.js";
import {
  getSharedVeloWalletClient,
  releaseSharedVeloWalletClient,
  VeloWalletClient,
  type VeloWalletClientOptions,
} from "./browser.js";
import {
  DEFAULT_WALLET_CONFIG,
  normalizeWalletAppearance,
  type WalletAppearanceConfig,
  type WalletAppearanceOverrides,
} from "./config.js";
import { openWalletSelector } from "./wallet-selector.js";

const WalletContext = createContext<VeloWalletClient | null>(null);
const defaultAppearance = normalizeWalletAppearance(DEFAULT_WALLET_CONFIG);

export function VeloWalletProvider({
  projectKey,
  apiBaseUrl,
  appearance,
  children,
}: {
  projectKey: string;
  apiBaseUrl?: string;
  appearance?: WalletAppearanceOverrides;
  children: ReactNode;
}) {
  const appearanceKey = JSON.stringify(appearance ?? {});
  const client = useMemo(
    () =>
      typeof window === "undefined"
        ? new VeloWalletClient({ projectKey, apiBaseUrl, appearance })
        : getSharedVeloWalletClient({ projectKey, apiBaseUrl, appearance }),
    [apiBaseUrl, appearanceKey, projectKey],
  );
  const lifecycle = useRef<{ client: VeloWalletClient | null; generation: number }>({
    client: null,
    generation: 0,
  });

  useEffect(() => {
    const generation = lifecycle.current.generation + 1;
    lifecycle.current = { client, generation };
    client.initialize().catch(() => undefined);
    return () => {
      queueMicrotask(() => {
        const current = lifecycle.current;
        if (current.client !== client || current.generation === generation) {
          releaseSharedVeloWalletClient(client);
        }
      });
    };
  }, [client]);

  return <WalletContext.Provider value={client}>{children}</WalletContext.Provider>;
}

export function useVeloWallet() {
  const client = useContext(WalletContext);
  if (!client) throw new Error("useVeloWallet must be used inside VeloWalletProvider.");
  const state = useSyncExternalStore(client.subscribe, client.getState, client.getState);

  return {
    ...state,
    appearance: client.getConfig()?.appearance ?? defaultAppearance,
    connect: (walletId?: string) => client.connect(walletId),
    disconnect: () => client.disconnect(),
    getAddress: () => Promise.resolve(client.getAddress()),
    signTransaction: (xdr: string) => client.signTransaction(xdr),
    signAuthEntry: (authEntry: string) => client.signAuthEntry(authEntry),
    signMessage: (message: string) => client.signMessage(message),
    client,
  };
}

function useSystemDark(theme: WalletAppearanceConfig["theme"]) {
  const [systemDark, setSystemDark] = useState(false);
  useEffect(() => {
    if (theme !== "system" || !window.matchMedia) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [theme]);
  return systemDark;
}

function buttonStyle(appearance: WalletAppearanceConfig, systemDark: boolean): CSSProperties {
  const palette = walletPalette(appearance, systemDark);
  const solid = appearance.button.variant === "solid";
  const outline = appearance.button.variant === "outline";
  return {
    appearance: "none",
    background: solid ? palette.accent : outline ? "transparent" : palette.surfaceMuted,
    border: `1px solid ${outline ? palette.accent : palette.border}`,
    borderRadius: WALLET_BUTTON_RADII[appearance.button.radius],
    color: solid ? palette.accentText : palette.accent,
    cursor: "pointer",
    fontFamily: WALLET_FONT_STACKS[appearance.fontFamily],
    fontSize:
      appearance.button.size === "sm"
        ? ".8125rem"
        : appearance.button.size === "lg"
          ? "1rem"
          : ".875rem",
    fontWeight: 600,
    lineHeight: 1.25,
    outlineColor: palette.focusRing,
    padding: WALLET_BUTTON_PADDING[appearance.button.size],
  };
}

function secondaryButtonStyle(
  appearance: WalletAppearanceConfig,
  systemDark: boolean,
): CSSProperties {
  const palette = walletPalette(appearance, systemDark);
  return {
    ...buttonStyle(appearance, systemDark),
    background: palette.surface,
    borderColor: palette.border,
    color: palette.text,
    padding: ".45rem .7rem",
  };
}

export function ConnectButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  const wallet = useVeloWallet();
  const systemDark = useSystemDark(wallet.appearance.theme);
  const connected = wallet.status === "connected";
  const statusId = useId();
  const label = connected
    ? `${wallet.walletName ?? "Wallet"} · ${wallet.address?.slice(0, 7) ?? ""}…`
    : wallet.status === "connecting"
      ? "Connecting…"
      : wallet.appearance.buttonLabel;

  return (
    <button
      type="button"
      {...props}
      data-velo-wallet-trigger=""
      data-status={wallet.status}
      disabled={props.disabled || wallet.status === "connecting" || wallet.status === "loading"}
      style={{ ...buttonStyle(wallet.appearance, systemDark), ...props.style }}
      onClick={(event) => {
        props.onClick?.(event);
        if (!event.defaultPrevented) {
          const action = connected ? wallet.disconnect() : openWalletSelector(wallet.client);
          action.catch(() => undefined);
        }
      }}
      aria-describedby={props["aria-describedby"] ?? statusId}
    >
      {label}
      <span id={statusId} role="status" aria-live="polite" hidden>
        {wallet.error?.message ?? wallet.status}
      </span>
    </button>
  );
}

export function WalletWidget({ style, ...props }: HTMLAttributes<HTMLDivElement>) {
  const wallet = useVeloWallet();
  const systemDark = useSystemDark(wallet.appearance.theme);
  const palette = walletPalette(wallet.appearance, systemDark);
  const [announcement, setAnnouncement] = useState("");
  const connected = wallet.status === "connected";

  async function copyAddress() {
    if (!wallet.address || !navigator.clipboard) return;
    await navigator.clipboard.writeText(wallet.address);
    setAnnouncement("Address copied.");
  }

  return (
    <div
      {...props}
      data-velo-wallet-widget=""
      data-status={wallet.status}
      style={{
        color: palette.text,
        display: "grid",
        fontFamily: WALLET_FONT_STACKS[wallet.appearance.fontFamily],
        gap: ".4rem",
        ...style,
      }}
    >
      {connected ? (
        <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: ".4rem" }}>
          <span style={buttonStyle(wallet.appearance, systemDark)}>
            {wallet.walletName ?? "Wallet"} · {shortenAddress(wallet.address)}
          </span>
          <button
            type="button"
            style={secondaryButtonStyle(wallet.appearance, systemDark)}
            onClick={() => void copyAddress()}
          >
            Copy address
          </button>
          <button
            type="button"
            style={{
              ...secondaryButtonStyle(wallet.appearance, systemDark),
              color: palette.danger,
            }}
            onClick={() => void wallet.disconnect()}
          >
            Disconnect
          </button>
        </div>
      ) : (
        <ConnectButton />
      )}
      <span
        role="status"
        aria-live="polite"
        style={{ color: wallet.error ? palette.danger : palette.mutedText, fontSize: ".75rem" }}
      >
        {announcement || wallet.error?.message || statusMessage(wallet.status)}
      </span>
    </div>
  );
}

function shortenAddress(address: string | null) {
  return address && address.length > 14
    ? `${address.slice(0, 7)}…${address.slice(-5)}`
    : (address ?? "");
}

function statusMessage(status: string) {
  if (status === "loading") return "Loading wallet configuration.";
  if (status === "connecting") return "Opening wallet selector.";
  if (status === "ready") return "Wallet connection is ready.";
  if (status === "disconnected") return "Wallet disconnected.";
  if (status === "connected") return "Wallet connected.";
  return "";
}

export type { VeloWalletClientOptions };
