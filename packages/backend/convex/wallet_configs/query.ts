import { normalizeAllowedOrigin, normalizeWalletAppearance } from "@carts1024/velo-wallets/config";
import { v } from "convex/values";

import { query } from "../_generated/server";
import { requireProjectOwner } from "../projects/helpers";

export const getDraft = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectOwner(ctx, args.projectId);
    return await ctx.db
      .query("walletConfigs")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .unique();
  },
});

export const listPublications = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectOwner(ctx, args.projectId);
    return await ctx.db
      .query("walletConfigPublications")
      .withIndex("by_project_id_and_revision", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(25);
  },
});

export const getPublishedByKey = query({
  args: { publicKey: v.string(), origin: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const config = await ctx.db
      .query("walletConfigs")
      .withIndex("by_public_key", (q) => q.eq("publicKey", args.publicKey))
      .unique();
    if (!config) return { status: "not_found" as const };
    const project = await ctx.db.get(config.projectId);
    if (!project || project.retiredAt !== undefined) return { status: "not_found" as const };
    if (!config.activePublicationId) {
      return { status: config.enabled ? ("unpublished" as const) : ("disabled" as const) };
    }

    const publication = await ctx.db.get(config.activePublicationId);
    if (!publication) return { status: "unpublished" as const };

    if (args.origin) {
      let normalizedOrigin: string;
      try {
        normalizedOrigin = normalizeAllowedOrigin(args.origin);
      } catch {
        return { status: "origin_rejected" as const };
      }
      if (!publication.allowedOrigins.includes(normalizedOrigin)) {
        return { status: "origin_rejected" as const };
      }
    }

    if (!config.enabled) {
      return {
        status: "disabled" as const,
        ...(args.origin ? { corsAllowed: true as const } : {}),
      };
    }

    const appearance = normalizeWalletAppearance({
      theme: publication.theme,
      buttonLabel: publication.buttonLabel,
      appearance: publication.appearance,
    });

    return {
      status: "ok" as const,
      config: {
        schemaVersion: publication.schemaVersion,
        revision: publication.revision,
        runtimeMajor: publication.runtimeMajor,
        projectKey: publication.publicKey,
        network: publication.network,
        walletIds: publication.walletIds,
        appearance,
        modal: {
          showInstallLabel: publication.showInstallLabel,
          hideUnsupportedWallets: publication.hideUnsupportedWallets,
        },
        session: { persist: publication.persistSession },
      },
    };
  },
});
