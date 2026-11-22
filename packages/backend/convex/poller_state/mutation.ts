import { v } from "convex/values";

import { internalMutation } from "../_generated/server";
import { projectScope, setProjectPolling } from "./helpers";

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
      const poller = await ctx.db
        .query("pollerState")
        .withIndex("by_scope", (q) => q.eq("scope", projectScope(projectId)))
        .unique();
      // Target selection creates the row. A newer poll or project retirement may have changed it.
      if (poller && poller.updatedAt <= failedAt) {
        await ctx.db.patch(poller._id, pollErrorState(failedAt));
      }
    }
  },
});
