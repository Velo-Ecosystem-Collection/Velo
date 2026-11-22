import { v } from "convex/values";

import type { QueryCtx } from "../_generated/server";
import type { ProjectId } from "../projects/types";

import { internalQuery } from "../_generated/server";
import { projectScope } from "./helpers";

export async function pollerForProject(ctx: QueryCtx, projectId: ProjectId) {
  return await ctx.db
    .query("pollerState")
    .withIndex("by_scope", (q) => q.eq("scope", projectScope(projectId)))
    .unique();
}

export const getScheduledCheckpoints = internalQuery({
  args: { projectIds: v.array(v.id("projects")) },
  handler: async (ctx, { projectIds }) =>
    await Promise.all(projectIds.map((projectId) => pollerForProject(ctx, projectId))),
});

export const getByScope = internalQuery({
  args: { scope: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("pollerState")
      .withIndex("by_scope", (q) => q.eq("scope", args.scope))
      .unique();
  },
});
