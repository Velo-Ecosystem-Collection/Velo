import { v } from "convex/values";

import { query } from "../_generated/server";
import { requireProjectRole, sha256, stableStringify } from "./helpers";

const networkValidator = v.union(v.literal("testnet"), v.literal("mainnet"));

function variableName(value: unknown): string | null {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof (value as Record<string, unknown>).$variable === "string"
  ) {
    return String((value as Record<string, unknown>).$variable)
      .trim()
      .toUpperCase();
  }
  return null;
}

function resolveTemplate(
  value: unknown,
  variables: Map<string, string>,
  path = "$",
): { value: unknown; issues: Array<{ path: string; message: string }> } {
  const reference = variableName(value);
  if (reference) {
    const resolved = variables.get(reference);
    return resolved === undefined
      ? { value: null, issues: [{ path, message: `Variable ${reference} is not defined` }] }
      : { value: resolved, issues: [] };
  }
  if (Array.isArray(value)) {
    const values: unknown[] = [];
    const issues: Array<{ path: string; message: string }> = [];
    value.forEach((child, index) => {
      const result = resolveTemplate(child, variables, `${path}[${index}]`);
      values.push(result.value);
      issues.push(...result.issues);
    });
    return { value: values, issues };
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    const issues: Array<{ path: string; message: string }> = [];
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const resolved = resolveTemplate(child, variables, `${path}.${key}`);
      result[key] = resolved.value;
      issues.push(...resolved.issues);
    }
    return { value: result, issues };
  }
  return { value, issues: [] };
}

export const getMyAccess = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    try {
      const access = await requireProjectRole(ctx, args.projectId, "viewer");
      return { role: access.role, walletAddress: access.address };
    } catch {
      return null;
    }
  },
});

export const listMembers = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const access = await requireProjectRole(ctx, args.projectId, "viewer");
    const rows = await ctx.db
      .query("projectMemberships")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    return [
      {
        _id: null,
        walletAddress: access.project.ownerAddress,
        role: "owner" as const,
        createdAt: access.project.createdAt,
      },
      ...rows.filter((row) => row.walletAddress !== access.project.ownerAddress),
    ];
  },
});

export const listContracts = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectRole(ctx, args.projectId, "viewer");
    return await ctx.db
      .query("playgroundSavedContracts")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(100);
  },
});

export const listRequests = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectRole(ctx, args.projectId, "viewer");
    const requests = await ctx.db
      .query("playgroundSavedRequests")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(100);
    return await Promise.all(
      requests.map(async (request) => ({
        ...request,
        version: request.currentVersionId ? await ctx.db.get(request.currentVersionId) : null,
      })),
    );
  },
});

export const getRequestVersion = query({
  args: { versionId: v.id("playgroundRequestVersions") },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (!version) return null;
    await requireProjectRole(ctx, version.projectId, "viewer");
    return version;
  },
});

export const listVariables = query({
  args: { projectId: v.id("projects"), network: networkValidator },
  handler: async (ctx, args) => {
    await requireProjectRole(ctx, args.projectId, "viewer");
    return await ctx.db
      .query("playgroundEnvironmentVariables")
      .withIndex("by_project_and_network", (q) =>
        q.eq("projectId", args.projectId).eq("network", args.network),
      )
      .collect();
  },
});

export const previewVariables = query({
  args: {
    projectId: v.id("projects"),
    network: networkValidator,
    argumentTemplateJson: v.string(),
    wasmHash: v.optional(v.string()),
    requestVersionId: v.optional(v.id("playgroundRequestVersions")),
  },
  handler: async (ctx, args) => {
    await requireProjectRole(ctx, args.projectId, "viewer");
    const requestVersion = args.requestVersionId ? await ctx.db.get(args.requestVersionId) : null;
    if (
      requestVersion &&
      (requestVersion.projectId !== args.projectId ||
        requestVersion.network !== args.network ||
        (args.wasmHash !== undefined && requestVersion.wasmHash !== args.wasmHash))
    ) {
      throw new Error("Request version no longer matches the selected contract context");
    }
    const rows = await ctx.db
      .query("playgroundEnvironmentVariables")
      .withIndex("by_project_and_network", (q) =>
        q.eq("projectId", args.projectId).eq("network", args.network),
      )
      .collect();
    const result = resolveTemplate(
      JSON.parse(args.argumentTemplateJson) as unknown,
      new Map(rows.map((row) => [row.name, row.value])),
    );
    return {
      resolvedArguments: result.value,
      issues: result.issues,
      resolutionHash: await sha256(
        stableStringify({
          network: args.network,
          wasmHash: args.wasmHash ?? null,
          requestVersionId: args.requestVersionId ?? null,
          variableRevision: rows
            .map((row) => ({
              name: row.name,
              kind: row.kind,
              value: row.value,
              updatedAt: row.updatedAt,
            }))
            .sort((left, right) => left.name.localeCompare(right.name)),
          resolvedArguments: result.value,
        }),
      ),
    };
  },
});

export const listExecutions = query({
  args: {
    projectId: v.id("projects"),
    search: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("success"),
        v.literal("failed"),
        v.literal("unknown"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    await requireProjectRole(ctx, args.projectId, "viewer");
    if (args.search?.trim()) {
      return await ctx.db
        .query("playgroundExecutions")
        .withSearchIndex("search_text", (q) => {
          const base = q
            .search("searchText", args.search!.trim().toLowerCase())
            .eq("projectId", args.projectId);
          return args.status ? base.eq("status", args.status) : base;
        })
        .take(100);
    }
    return (
      await ctx.db
        .query("playgroundExecutions")
        .withIndex("by_project_and_created_at", (q) => q.eq("projectId", args.projectId))
        .order("desc")
        .take(100)
    ).filter((row) => !args.status || row.status === args.status);
  },
});

export const getLog = query({
  args: { projectId: v.id("projects"), journeyCorrelationId: v.string() },
  handler: async (ctx, args) => {
    await requireProjectRole(ctx, args.projectId, "viewer");
    const executions = await ctx.db
      .query("playgroundExecutions")
      .withIndex("by_project_and_journey_correlation_id", (q) =>
        q.eq("projectId", args.projectId).eq("journeyCorrelationId", args.journeyCorrelationId),
      )
      .collect();
    if (!executions.length) return null;
    const deliveries = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_project_and_correlation_id_created_at", (q) =>
        q.eq("projectId", args.projectId).eq("correlationId", args.journeyCorrelationId),
      )
      .collect();
    const stages = await ctx.db
      .query("journeyStages")
      .withIndex("by_journey_correlation_id_and_at", (q) =>
        q.eq("journeyCorrelationId", args.journeyCorrelationId),
      )
      .collect();
    const transactionHashes = new Set(
      executions
        .map((execution) => execution.transactionHash)
        .filter((hash): hash is string => Boolean(hash)),
    );
    const events = (
      await Promise.all(
        [...transactionHashes].map((transactionHash) =>
          ctx.db
            .query("contractEvents")
            .withIndex("by_transaction_hash", (q) => q.eq("transactionHash", transactionHash))
            .collect(),
        ),
      )
    )
      .flat()
      .filter((event) => event.projectId === args.projectId);
    return { executions, deliveries, events, stages };
  },
});

export const getExecution = query({
  args: { executionId: v.id("playgroundExecutions") },
  handler: async (ctx, args) => {
    const execution = await ctx.db.get(args.executionId);
    if (!execution) return null;
    await requireProjectRole(ctx, execution.projectId, "viewer");
    return execution;
  },
});

export const listShares = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectRole(ctx, args.projectId, "viewer");
    return await ctx.db
      .query("playgroundShares")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(100);
  },
});

export const getPublicShare = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const tokenHash = await sha256(args.token);
    const share = await ctx.db
      .query("playgroundShares")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (
      !share ||
      share.visibility !== "public_unlisted" ||
      share.revokedAt !== undefined ||
      (share.expiresAt !== undefined && share.expiresAt <= Date.now())
    ) {
      return null;
    }
    return {
      _id: share._id,
      snapshot: JSON.parse(share.snapshotJson) as unknown,
      includeArguments: share.includeArguments,
      expiresAt: share.expiresAt,
    };
  },
});

export const getPrivateShare = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const tokenHash = await sha256(args.token);
    const share = await ctx.db
      .query("playgroundShares")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (
      !share ||
      share.visibility !== "private_project" ||
      share.revokedAt !== undefined ||
      (share.expiresAt !== undefined && share.expiresAt <= Date.now())
    ) {
      return null;
    }
    await requireProjectRole(ctx, share.projectId, "viewer");
    return share;
  },
});

export const listWebhookFilters = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectRole(ctx, args.projectId, "viewer");
    return await ctx.db
      .query("playgroundWebhookFilters")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});
