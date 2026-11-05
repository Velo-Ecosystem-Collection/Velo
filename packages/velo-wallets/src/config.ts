import { VeloWalletError } from "./errors.js";

export type WalletNetwork = "testnet" | "public";
export type WalletTheme = "light" | "dark" | "system";
export type WalletFontFamily = "system" | "serif" | "mono";
export type WalletButtonVariant = "solid" | "outline" | "soft";
export type WalletButtonSize = "sm" | "md" | "lg";
export type WalletButtonRadius = "square" | "rounded" | "pill";
export type WalletModalRadius = "sm" | "md" | "lg";
export type WalletModalShadow = "none" | "sm" | "md";

export type WalletPalette = {
  background: string;
  surface: string;
  surfaceMuted: string;
  text: string;
  mutedText: string;
  accent: string;
  accentText: string;
  border: string;
  danger: string;
  focusRing: string;
};

export type WalletAppearanceStyle = {
  palettes: { light: WalletPalette; dark: WalletPalette };
  fontFamily: WalletFontFamily;
  button: {
    variant: WalletButtonVariant;
    size: WalletButtonSize;
    radius: WalletButtonRadius;
  };
  modal: { radius: WalletModalRadius; shadow: WalletModalShadow };
};

export type WalletAppearanceConfig = WalletAppearanceStyle & {
  theme: WalletTheme;
  buttonLabel: string;
};

export type WalletAppearanceOverrides = {
  theme?: WalletTheme;
  buttonLabel?: string;
  palettes?: {
    light?: Partial<WalletPalette>;
    dark?: Partial<WalletPalette>;
  };
  fontFamily?: WalletFontFamily;
  button?: Partial<WalletAppearanceStyle["button"]>;
  modal?: Partial<WalletAppearanceStyle["modal"]>;
};

export type WalletCatalogEntry = {
  id: string;
  name: string;
  transactionSigning: true;
  authEntrySigning: "supported" | "wallet-dependent";
  messageSigning: "supported" | "wallet-dependent";
};

export const WALLET_CATALOG = [
  { id: "albedo", name: "Albedo" },
  { id: "freighter", name: "Freighter" },
  { id: "fordefi", name: "Fordefi" },
  { id: "rabet", name: "Rabet" },
  { id: "xbull", name: "xBull" },
  { id: "lobstr", name: "LOBSTR" },
  { id: "hana", name: "Hana Wallet" },
  { id: "klever", name: "Klever Wallet" },
  { id: "onekey", name: "OneKey Wallet" },
  { id: "BitgetWallet", name: "Bitget Wallet" },
  { id: "cactuslink", name: "Cactus Link" },
  { id: "noir", name: "Noir" },
].map(
  (wallet): WalletCatalogEntry => ({
    ...wallet,
    transactionSigning: true,
    authEntrySigning: "wallet-dependent",
    messageSigning: "wallet-dependent",
  }),
);

export const WALLET_IDS = WALLET_CATALOG.map((wallet) => wallet.id);

export const DEFAULT_WALLET_APPEARANCE_STYLE: WalletAppearanceStyle = {
  palettes: {
    light: {
      background: "#FFFFFF",
      surface: "#F4F4F5",
      surfaceMuted: "#E4E4E7",
      text: "#18181B",
      mutedText: "#52525B",
      accent: "#18181B",
      accentText: "#FFFFFF",
      border: "#71717A",
      danger: "#B91C1C",
      focusRing: "#2563EB",
    },
    dark: {
      background: "#09090B",
      surface: "#18181B",
      surfaceMuted: "#27272A",
      text: "#FAFAFA",
      mutedText: "#D4D4D8",
      accent: "#FAFAFA",
      accentText: "#18181B",
      border: "#A1A1AA",
      danger: "#F87171",
      focusRing: "#60A5FA",
    },
  },
  fontFamily: "system",
  button: { variant: "solid", size: "md", radius: "rounded" },
  modal: { radius: "md", shadow: "md" },
};

export type WalletDraftConfig = {
  network: WalletNetwork;
  walletIds: string[];
  theme: WalletTheme;
  buttonLabel: string;
  appearance?: WalletAppearanceStyle;
  showInstallLabel: boolean;
  hideUnsupportedWallets: boolean;
  persistSession: boolean;
  allowedOrigins: string[];
};

export type PublishedWalletConfig = {
  schemaVersion: 1;
  revision: number;
  runtimeMajor: 1;
  projectKey: string;
  network: WalletNetwork;
  walletIds: string[];
  appearance: WalletAppearanceConfig;
  modal: { showInstallLabel: boolean; hideUnsupportedWallets: boolean };
  session: { persist: boolean };
};

export const DEFAULT_WALLET_CONFIG: WalletDraftConfig = {
  network: "testnet",
  walletIds: ["freighter"],
  theme: "system",
  buttonLabel: "Connect wallet",
  appearance: DEFAULT_WALLET_APPEARANCE_STYLE,
  showInstallLabel: true,
  hideUnsupportedWallets: false,
  persistSession: true,
  allowedOrigins: ["http://localhost:3000"],
};

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const FONT_FAMILIES: WalletFontFamily[] = ["system", "serif", "mono"];
const BUTTON_VARIANTS: WalletButtonVariant[] = ["solid", "outline", "soft"];
const BUTTON_SIZES: WalletButtonSize[] = ["sm", "md", "lg"];
const BUTTON_RADII: WalletButtonRadius[] = ["square", "rounded", "pill"];
const MODAL_RADII: WalletModalRadius[] = ["sm", "md", "lg"];
const MODAL_SHADOWS: WalletModalShadow[] = ["none", "sm", "md"];

function copyDefaultStyle(): WalletAppearanceStyle {
  return {
    ...DEFAULT_WALLET_APPEARANCE_STYLE,
    palettes: {
      light: { ...DEFAULT_WALLET_APPEARANCE_STYLE.palettes.light },
      dark: { ...DEFAULT_WALLET_APPEARANCE_STYLE.palettes.dark },
    },
    button: { ...DEFAULT_WALLET_APPEARANCE_STYLE.button },
    modal: { ...DEFAULT_WALLET_APPEARANCE_STYLE.modal },
  };
}

function normalizePalette(palette: Partial<WalletPalette> | undefined, fallback: WalletPalette) {
  return Object.fromEntries(
    Object.entries({ ...fallback, ...palette }).map(([key, value]) => [
      key,
      typeof value === "string" && HEX_COLOR.test(value) ? value.toUpperCase() : value,
    ]),
  ) as WalletPalette;
}

export function mergeWalletAppearance(
  base: WalletAppearanceConfig,
  override?: WalletAppearanceOverrides,
): WalletAppearanceConfig {
  if (!override) return base;
  return {
    theme: override.theme ?? base.theme,
    buttonLabel: override.buttonLabel?.trim() || base.buttonLabel,
    palettes: {
      light: normalizePalette(override.palettes?.light, base.palettes.light),
      dark: normalizePalette(override.palettes?.dark, base.palettes.dark),
    },
    fontFamily: override.fontFamily ?? base.fontFamily,
    button: { ...base.button, ...override.button },
    modal: { ...base.modal, ...override.modal },
  };
}

export function normalizeWalletAppearance(value: {
  theme: WalletTheme;
  buttonLabel: string;
  appearance?: Partial<WalletAppearanceStyle>;
}): WalletAppearanceConfig {
  const defaults = copyDefaultStyle();
  const style = value.appearance ?? (value as Partial<WalletAppearanceStyle>);
  return {
    theme: value.theme,
    buttonLabel: value.buttonLabel.trim(),
    palettes: {
      light: normalizePalette(style.palettes?.light, defaults.palettes.light),
      dark: normalizePalette(style.palettes?.dark, defaults.palettes.dark),
    },
    fontFamily: style.fontFamily ?? defaults.fontFamily,
    button: { ...defaults.button, ...style.button },
    modal: { ...defaults.modal, ...style.modal },
  };
}

function relativeLuminance(color: string) {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
  return channels
    .map((channel) => channel / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index]!, 0);
}

export function colorContrast(first: string, second: string) {
  if (!HEX_COLOR.test(first) || !HEX_COLOR.test(second)) return 0;
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort(
    (a, b) => b - a,
  );
  return (lighter! + 0.05) / (darker! + 0.05);
}

export function validateWalletAppearance(appearance: WalletAppearanceConfig) {
  const errors: string[] = [];
  const palettes = [
    ["Light", appearance.palettes.light],
    ["Dark", appearance.palettes.dark],
  ] as const;
  for (const [label, palette] of palettes) {
    for (const [token, color] of Object.entries(palette)) {
      if (!HEX_COLOR.test(color)) errors.push(`${label} ${token} must use #RRGGBB format.`);
    }
    const contrastPairs = [
      ["text and background", palette.text, palette.background, 4.5],
      ["text and surface", palette.text, palette.surface, 4.5],
      ["muted text and background", palette.mutedText, palette.background, 4.5],
      ["accent text and accent", palette.accentText, palette.accent, 4.5],
      ["focus ring and background", palette.focusRing, palette.background, 3],
      ["border and background", palette.border, palette.background, 3],
    ] as const;
    for (const [name, foreground, background, minimum] of contrastPairs) {
      if (
        HEX_COLOR.test(foreground) &&
        HEX_COLOR.test(background) &&
        colorContrast(foreground, background) < minimum
      ) {
        errors.push(`${label} ${name} contrast must be at least ${minimum}:1.`);
      }
    }
  }
  if (!FONT_FAMILIES.includes(appearance.fontFamily))
    errors.push("Choose a supported font family.");
  if (!BUTTON_VARIANTS.includes(appearance.button.variant))
    errors.push("Choose a supported button variant.");
  if (!BUTTON_SIZES.includes(appearance.button.size))
    errors.push("Choose a supported button size.");
  if (!BUTTON_RADII.includes(appearance.button.radius))
    errors.push("Choose a supported button radius.");
  if (!MODAL_RADII.includes(appearance.modal.radius))
    errors.push("Choose a supported modal radius.");
  if (!MODAL_SHADOWS.includes(appearance.modal.shadow))
    errors.push("Choose a supported modal shadow.");
  return errors;
}

function isLocalHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function normalizeAllowedOrigin(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Allowed origin must be a valid HTTP or HTTPS origin.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Allowed origin must use HTTP or HTTPS without credentials.");
  }
  if ((url.pathname && url.pathname !== "/") || url.search || url.hash) {
    throw new Error("Allowed origin cannot include a path, query, or fragment.");
  }
  return url.origin;
}

export function validateWalletDraft(config: WalletDraftConfig) {
  const errors: string[] = [];
  const uniqueWalletIds = new Set(config.walletIds);
  if (uniqueWalletIds.size === 0) errors.push("Select at least one wallet.");
  if (uniqueWalletIds.size !== config.walletIds.length) errors.push("Wallets must be unique.");
  if (config.walletIds.some((walletId) => !WALLET_IDS.includes(walletId))) {
    errors.push("One or more selected wallets are unsupported.");
  }
  const labelLength = config.buttonLabel.trim().length;
  if (labelLength < 1 || labelLength > 40)
    errors.push("Button label must be between 1 and 40 characters.");
  errors.push(...validateWalletAppearance(normalizeWalletAppearance(config)));
  if (config.allowedOrigins.length > 20) errors.push("A maximum of 20 origins is allowed.");

  const normalizedOrigins: string[] = [];
  for (const origin of config.allowedOrigins) {
    try {
      normalizedOrigins.push(normalizeAllowedOrigin(origin));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Invalid allowed origin.");
    }
  }
  if (new Set(normalizedOrigins).size !== normalizedOrigins.length)
    errors.push("Allowed origins must be unique.");
  if (
    config.network === "public" &&
    !normalizedOrigins.some((origin) => {
      const url = new URL(origin);
      return url.protocol === "https:" && !isLocalHostname(url.hostname);
    })
  ) {
    errors.push("Mainnet requires at least one non-local HTTPS origin.");
  }
  return [...new Set(errors)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasValidPublishedStyle(appearance: Record<string, unknown>) {
  if (!("palettes" in appearance)) return true;
  const palettes = appearance.palettes;
  const button = appearance.button;
  const modalStyle = appearance.modal;
  if (!isRecord(palettes) || !isRecord(palettes.light) || !isRecord(palettes.dark)) return false;
  const light = palettes.light;
  const dark = palettes.dark;
  const paletteKeys = Object.keys(DEFAULT_WALLET_APPEARANCE_STYLE.palettes.light);
  if (
    !paletteKeys.every((key) => typeof light[key] === "string" && typeof dark[key] === "string") ||
    !FONT_FAMILIES.includes(appearance.fontFamily as WalletFontFamily) ||
    !isRecord(button) ||
    !BUTTON_VARIANTS.includes(button.variant as WalletButtonVariant) ||
    !BUTTON_SIZES.includes(button.size as WalletButtonSize) ||
    !BUTTON_RADII.includes(button.radius as WalletButtonRadius) ||
    !isRecord(modalStyle) ||
    !MODAL_RADII.includes(modalStyle.radius as WalletModalRadius) ||
    !MODAL_SHADOWS.includes(modalStyle.shadow as WalletModalShadow)
  ) {
    return false;
  }
  return true;
}

export function parsePublishedWalletConfig(value: unknown): PublishedWalletConfig {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.runtimeMajor !== 1) {
    throw new VeloWalletError(
      "CONFIG_INCOMPATIBLE",
      "CONFIG_INCOMPATIBLE: Velo Wallets configuration is not compatible with runtime v1.",
    );
  }
  const appearance = value.appearance;
  const modal = value.modal;
  const session = value.session;
  if (
    typeof value.revision !== "number" ||
    typeof value.projectKey !== "string" ||
    (value.network !== "testnet" && value.network !== "public") ||
    !Array.isArray(value.walletIds) ||
    value.walletIds.some((id) => typeof id !== "string" || !WALLET_IDS.includes(id)) ||
    !isRecord(appearance) ||
    !["light", "dark", "system"].includes(String(appearance.theme)) ||
    typeof appearance.buttonLabel !== "string" ||
    !hasValidPublishedStyle(appearance) ||
    !isRecord(modal) ||
    typeof modal.showInstallLabel !== "boolean" ||
    typeof modal.hideUnsupportedWallets !== "boolean" ||
    !isRecord(session) ||
    typeof session.persist !== "boolean"
  ) {
    throw new VeloWalletError(
      "CONFIG_INCOMPATIBLE",
      "CONFIG_INCOMPATIBLE: Published wallet configuration is malformed.",
    );
  }
  const normalizedAppearance = normalizeWalletAppearance(
    appearance as unknown as WalletAppearanceConfig,
  );
  if (validateWalletAppearance(normalizedAppearance).length > 0) {
    throw new VeloWalletError(
      "CONFIG_INCOMPATIBLE",
      "CONFIG_INCOMPATIBLE: Published wallet appearance is malformed or inaccessible.",
    );
  }
  return {
    schemaVersion: 1,
    revision: value.revision,
    runtimeMajor: 1,
    projectKey: value.projectKey,
    network: value.network,
    walletIds: value.walletIds as string[],
    appearance: normalizedAppearance,
    modal: modal as PublishedWalletConfig["modal"],
    session: session as PublishedWalletConfig["session"],
  };
}

export function draftToPublishedConfig(
  draft: WalletDraftConfig,
  projectKey: string,
  revision: number,
): PublishedWalletConfig {
  return {
    schemaVersion: 1,
    revision,
    runtimeMajor: 1,
    projectKey,
    network: draft.network,
    walletIds: [...draft.walletIds],
    appearance: normalizeWalletAppearance(draft),
    modal: {
      showInstallLabel: draft.showInstallLabel,
      hideUnsupportedWallets: draft.hideUnsupportedWallets,
    },
    session: { persist: draft.persistSession },
  };
}
