import { v } from "convex/values";

import { query } from "../_generated/server";
import { getAuthenticatedIdentity, normalizeAddress } from "../projects/helpers";

export const getByWallet = query({
  args: {},
  handler: async (ctx) => {
    const identity = await getAuthenticatedIdentity(ctx);
    if (!identity) {
      return null;
    }

    const tokenUser = await ctx.db
      .query("users")
      .withIndex("by_token_identifier", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();

    const user =
      tokenUser ??
      (await ctx.db
        .query("users")
        .withIndex("by_wallet", (q) => q.eq("walletAddress", normalizeAddress(identity.subject)))
        .unique());

    if (!user) {
      return null;
    }

    const avatarUrl = user.avatarStorageId
      ? ((await ctx.storage.getUrl(user.avatarStorageId)) ?? undefined)
      : undefined;

    return {
      ...user,
      avatarUrl,
    };
  },
});

export const listAll = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(100, Math.max(1, args.limit ?? 50));

    return await ctx.db.query("users").order("desc").take(limit);
  },
});
