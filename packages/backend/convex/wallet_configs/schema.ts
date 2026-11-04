import { defineTable } from "convex/server";
import { v } from "convex/values";

import { walletAppearanceStyle } from "./validators";

const network = v.union(v.literal("testnet"), v.literal("public"));
const theme = v.union(v.literal("light"), v.literal("dark"), v.literal("system"));

export const walletConfigs = defineTable({
  projectId: v.id("projects"),
  publicKey: v.string(),
  enabled: v.boolean(),
  network,
  walletIds: v.array(v.string()),
  theme,
  buttonLabel: v.string(),
  selectorLogo: v.optional(v.union(v.literal("velo"), v.literal("project"), v.literal("none"))),
  appearance: v.optional(walletAppearanceStyle),
  showInstallLabel: v.boolean(),
  hideUnsupportedWallets: v.boolean(),
  persistSession: v.boolean(),
  allowedOrigins: v.array(v.string()),
  draftRevision: v.number(),
  publishedRevision: v.number(),
  activePublicationId: v.optional(v.id("walletConfigPublications")),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_project_id", ["projectId"])
  .index("by_public_key", ["publicKey"]);

export const walletConfigPublications = defineTable({
  projectId: v.id("projects"),
  publicKey: v.string(),
  revision: v.number(),
  schemaVersion: v.literal(1),
  runtimeMajor: v.literal(1),
  network,
  walletIds: v.array(v.string()),
  selectorLogo: v.optional(v.union(v.literal("velo"), v.literal("project"), v.literal("none"))),
  theme,
  buttonLabel: v.string(),
  appearance: v.optional(walletAppearanceStyle),
  showInstallLabel: v.boolean(),
  hideUnsupportedWallets: v.boolean(),
  persistSession: v.boolean(),
  allowedOrigins: v.array(v.string()),
  publishedAt: v.number(),
}).index("by_project_id_and_revision", ["projectId", "revision"]);
