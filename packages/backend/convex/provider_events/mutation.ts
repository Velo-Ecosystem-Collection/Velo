import { v } from "convex/values";

import { internalQuery } from "../_generated/server";

/** Read-only compatibility queries for historical provider event records. */
export const getByEventId = internalQuery({
  args: { eventId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("providerEvents")
      .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
      .unique();
  },
});

export const getById = internalQuery({
  args: { id: v.id("providerEvents") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});
