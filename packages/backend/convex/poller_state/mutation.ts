import { v } from "convex/values";

import { internalMutation } from "../_generated/server";
import { projectScope, setProjectPolling } from "./helpers";
import { pollerForProject } from "./query";

function pollErrorState(failedAt: number) {
  return {
    status: "error" as const,
    lastRunAt: failedAt,
    errorMessage: "poller_error",
    updatedAt: failedAt,
  };
}

export const markPolling = internalMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await setProjectPolling(ctx, args.projectId);
  },
});

export const markError = internalMutation({
  args: {
    projectId: v.id("projects"),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const scope = projectScope(args.projectId);
    const existing = await ctx.db
      .query("pollerState")
      .withIndex("by_scope", (q) => q.eq("scope", scope))
      .unique();
    const value = pollErrorState(Date.now());
    if (existing) {
      await ctx.db.patch(existing._id, value);
    } else {
      await ctx.db.insert("pollerState", { scope, projectId: args.projectId, ...value });
    }
  },
});

export const markScheduledErrors = internalMutation({
  args: {
    failures: v.array(v.object({ projectId: v.id("projects"), failedAt: v.number() })),
  },
  handler: async (ctx, { failures }) => {
    for (const { projectId, failedAt } of failures) {
      const poller = await pollerForProject(ctx, projectId);
      if (poller && poller.updatedAt > failedAt) continue;

      const project = await ctx.db.get(projectId);
      if (!project || project.retiredAt !== undefined || project.status !== "registered") continue;

      const value = pollErrorState(failedAt);
      if (poller) {
        await ctx.db.patch(poller._id, value);
      } else {
        await ctx.db.insert("pollerState", { scope: projectScope(projectId), projectId, ...value });
      }
    }
  },
});
