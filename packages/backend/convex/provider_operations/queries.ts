import { ConvexError, v } from "convex/values";

import { internalQuery, query } from "../_generated/server";

export const getInternal = internalQuery({
  args: { operationId: v.id("providerOperations") },
  handler: async (ctx, args) => await ctx.db.get(args.operationId),
});

export const getByLogicalKey = internalQuery({
  args: {
    projectId: v.id("projects"),
    provider: v.literal("pdax"),
    operation: v.union(v.literal("trade"), v.literal("fiat_withdrawal")),
    clientKey: v.string(),
  },
  handler: async (ctx, args) =>
    await ctx.db
      .query("providerOperations")
      .withIndex("by_project_provider_operation_and_client_key", (q) =>
        q
          .eq("projectId", args.projectId)
          .eq("provider", args.provider)
          .eq("operation", args.operation)
          .eq("clientKey", args.clientKey),
      )
      .unique(),
});

export const get = query({
  args: { operationId: v.id("providerOperations") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Authentication required");
    const operation = await ctx.db.get(args.operationId);
    if (!operation) return null;
    const project = await ctx.db.get(operation.projectId);
    if (
      !project ||
      project.retiredAt !== undefined ||
      (project.ownerTokenIdentifier !== identity.tokenIdentifier &&
        project.ownerAddress !== identity.subject)
    ) {
      throw new ConvexError("Not authorized");
    }
    return operation;
  },
});

export const listRecovery = query({
  args: { projectId: v.id("projects"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Authentication required");
    const project = await ctx.db.get(args.projectId);
    if (
      !project ||
      project.retiredAt !== undefined ||
      (project.ownerTokenIdentifier !== identity.tokenIdentifier &&
        project.ownerAddress !== identity.subject)
    )
      throw new ConvexError("Not authorized");
    return await ctx.db
      .query("providerOperations")
      .withIndex("by_project_and_created_at", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(Math.min(args.limit ?? 100, 100));
  },
});
