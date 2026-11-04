import { v } from "convex/values";

const walletPalette = v.object({
  background: v.string(),
  surface: v.string(),
  surfaceMuted: v.string(),
  text: v.string(),
  mutedText: v.string(),
  accent: v.string(),
  accentText: v.string(),
  border: v.string(),
  danger: v.string(),
  focusRing: v.string(),
});

export const walletAppearanceStyle = v.object({
  palettes: v.object({ light: walletPalette, dark: walletPalette }),
  fontFamily: v.union(v.literal("system"), v.literal("serif"), v.literal("mono")),
  button: v.object({
    variant: v.union(v.literal("solid"), v.literal("outline"), v.literal("soft")),
    size: v.union(v.literal("sm"), v.literal("md"), v.literal("lg")),
    radius: v.union(v.literal("square"), v.literal("rounded"), v.literal("pill")),
  }),
  modal: v.object({
    radius: v.union(v.literal("sm"), v.literal("md"), v.literal("lg")),
    shadow: v.union(v.literal("none"), v.literal("sm"), v.literal("md")),
  }),
});

export const walletDraftArgs = {
  projectId: v.id("projects"),
  network: v.union(v.literal("testnet"), v.literal("public")),
  walletIds: v.array(v.string()),
  theme: v.union(v.literal("light"), v.literal("dark"), v.literal("system")),
  buttonLabel: v.string(),
  selectorLogo: v.optional(v.union(v.literal("velo"), v.literal("project"), v.literal("none"))),
  appearance: v.optional(walletAppearanceStyle),
  showInstallLabel: v.boolean(),
  hideUnsupportedWallets: v.boolean(),
  persistSession: v.boolean(),
  allowedOrigins: v.array(v.string()),
};
