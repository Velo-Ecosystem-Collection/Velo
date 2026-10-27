import { v } from "convex/values";

import { internalMutation, mutation } from "../_generated/server";
import { requireProjectOwner } from "../projects/helpers";

// Internal mutation to store or update a provider connection (including tokens)
export const upsertInternal = internalMutation({
  args: {
    projectId: v.id("projects"),
    provider: v.literal("pdax"),
    status: v.union(v.literal("connected"), v.literal("disconnected")),
    username: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    idToken: v.optional(v.string()),
    refreshToken: v.optional(v.string()),
    tokenExpiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project || project.retiredAt !== undefined) {
      throw new Error("Project is retired or unavailable");
    }
    const existing = await ctx.db
      .query("providerConnections")
      .withIndex("by_project_provider", (q) =>
        q.eq("projectId", args.projectId).eq("provider", args.provider),
      )
      .unique();

    const now = Date.now();

    if (existing) {
      const updatePayload: Record<string, unknown> = {
        status: args.status,
        updatedAt: now,
      };
      if (args.username !== undefined) updatePayload.username = args.username;
      if (args.accessToken !== undefined) updatePayload.accessToken = args.accessToken;
      if (args.idToken !== undefined) updatePayload.idToken = args.idToken;
      if (args.refreshToken !== undefined) updatePayload.refreshToken = args.refreshToken;
      if (args.tokenExpiresAt !== undefined) updatePayload.tokenExpiresAt = args.tokenExpiresAt;

      await ctx.db.patch(existing._id, updatePayload);
      return existing._id;
    } else {
      return await ctx.db.insert("providerConnections", {
        projectId: args.projectId,
        provider: args.provider,
        status: args.status,
        username: args.username,
        accessToken: args.accessToken,
        idToken: args.idToken,
        refreshToken: args.refreshToken,
        tokenExpiresAt: args.tokenExpiresAt,
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});

// Public mutation to disconnect the provider connection (nullifies tokens)
export const disconnect = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectOwner(ctx, args.projectId);

    const existing = await ctx.db
      .query("providerConnections")
      .withIndex("by_project_provider", (q) =>
        q.eq("projectId", args.projectId).eq("provider", "pdax"),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "disconnected",
        accessToken: undefined,
        idToken: undefined,
        refreshToken: undefined,
        tokenExpiresAt: undefined,
        updatedAt: Date.now(),
      });
      return true;
    }
    return false;
  },
});
