import { v } from "convex/values";

import { mutation } from "../_generated/server";
import { requireProjectOwner } from "../projects/helpers";
import { normalizedDraft, uniquePublicKey } from "./helpers";
import { walletDraftArgs } from "./validators";

export const saveDraft = mutation({
  args: walletDraftArgs,
  handler: async (ctx, args) => {
    await requireProjectOwner(ctx, args.projectId);
    const draft = normalizedDraft(args);
    const existing = await ctx.db
      .query("walletConfigs")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .unique();
    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...draft,
        draftRevision: existing.draftRevision + 1,
        updatedAt: now,
      });
      return { id: existing._id, publicKey: existing.publicKey };
    }

    const publicKey = await uniquePublicKey(ctx);
    const id = await ctx.db.insert("walletConfigs", {
      ...draft,
      projectId: args.projectId,
      publicKey,
      enabled: false,
      draftRevision: 1,
      publishedRevision: 0,
      createdAt: now,
      updatedAt: now,
    });
    return { id, publicKey };
  },
});

export const publish = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectOwner(ctx, args.projectId);
    const config = await ctx.db
      .query("walletConfigs")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .unique();
    if (!config) throw new Error("Save wallet settings before publishing");

    const draft = normalizedDraft(config);
    const revision = config.publishedRevision + 1;
    const publishedAt = Date.now();
    const publicationId = await ctx.db.insert("walletConfigPublications", {
      projectId: config.projectId,
      publicKey: config.publicKey,
      revision,
      schemaVersion: 1,
      runtimeMajor: 1,
      network: draft.network,
      walletIds: draft.walletIds,
      selectorLogo: draft.selectorLogo ?? "velo",
      theme: draft.theme,
      buttonLabel: draft.buttonLabel,
      appearance: draft.appearance,
      showInstallLabel: draft.showInstallLabel,
      hideUnsupportedWallets: draft.hideUnsupportedWallets,
      persistSession: draft.persistSession,
      allowedOrigins: draft.allowedOrigins,
      publishedAt,
    });
    await ctx.db.patch(config._id, {
      activePublicationId: publicationId,
      publishedRevision: revision,
      enabled: true,
      updatedAt: publishedAt,
    });
    return { publicationId, revision, publicKey: config.publicKey };
  },
});

export const setEnabled = mutation({
  args: { projectId: v.id("projects"), enabled: v.boolean() },
  handler: async (ctx, args) => {
    await requireProjectOwner(ctx, args.projectId);
    const config = await ctx.db
      .query("walletConfigs")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .unique();
    if (!config) throw new Error("Wallet configuration not found");
    if (args.enabled && !config.activePublicationId) {
      throw new Error("Publish wallet settings before enabling the integration");
    }
    await ctx.db.patch(config._id, { enabled: args.enabled, updatedAt: Date.now() });
    return null;
  },
});
