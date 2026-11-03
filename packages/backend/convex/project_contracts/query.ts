import { v } from "convex/values";

import { query } from "../_generated/server";
import { requireProjectRole } from "../playground_projects/helpers";

export const listByProject = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    try {
      await requireProjectRole(ctx, args.projectId, "viewer");
    } catch {
      return null;
    }

    return await ctx.db
      .query("projectContracts")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(100);
  },
});
