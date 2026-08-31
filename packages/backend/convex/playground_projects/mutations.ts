import { v } from "convex/values";

import { internalMutation, mutation } from "../_generated/server";
import {
  assertBoundedJson,
  normalizeContractId,
  normalizeHash,
  normalizeTags,
  normalizeVariable,
  normalizeWalletAddress,
  requireProjectRole,
  parseBoundedJson,
  safeOptionalUrl,
  sha256,
  stripPublicSnapshotArguments,
  verifyPersistenceProof,
} from "./helpers";

const networkValidator = v.union(v.literal("testnet"), v.literal("mainnet"));
const settingsValidator = v.object({ baseFee: v.string(), cpuInstructions: v.number() });
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export const upsertMember = mutation({
  args: {
    projectId: v.id("projects"),
    walletAddress: v.string(),
    role: v.union(v.literal("editor"), v.literal("viewer")),
  },
  handler: async (ctx, args) => {
    const access = await requireProjectRole(ctx, args.projectId, "owner");
    const walletAddress = normalizeWalletAddress(args.walletAddress);
    if (walletAddress === access.project.ownerAddress) {
      throw new Error("Project owner role cannot be changed");
    }
    const existing = await ctx.db
      .query("projectMemberships")
      .withIndex("by_project_and_wallet_address", (q) =>
        q.eq("projectId", args.projectId).eq("walletAddress", walletAddress),
      )
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { role: args.role, updatedAt: now });
      return existing._id;
    }
    return await ctx.db.insert("projectMemberships", {
      projectId: args.projectId,
      walletAddress,
      role: args.role,
      addedBy: access.address,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const removeMember = mutation({
  args: { projectId: v.id("projects"), membershipId: v.id("projectMemberships") },
  handler: async (ctx, args) => {
    await requireProjectRole(ctx, args.projectId, "owner");
    const membership = await ctx.db.get(args.membershipId);
    if (!membership || membership.projectId !== args.projectId) throw new Error("Member not found");
    if (membership.role === "owner") throw new Error("Project owner cannot be removed");
    await ctx.db.delete(membership._id);
  },
});

export const saveContract = mutation({
  args: {
    projectId: v.id("projects"),
    network: networkValidator,
    contractId: v.string(),
    displayName: v.string(),
    description: v.string(),
    tags: v.array(v.string()),
    wasmHash: v.string(),
    specHash: v.string(),
    repositoryUrl: v.optional(v.string()),
    documentationUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await requireProjectRole(ctx, args.projectId, "editor");
    const contractId = normalizeContractId(args.contractId);
    const existing = await ctx.db
      .query("playgroundSavedContracts")
      .withIndex("by_project_and_network_and_contract_id", (q) =>
        q.eq("projectId", args.projectId).eq("network", args.network).eq("contractId", contractId),
      )
      .unique();
    const now = Date.now();
    const value = {
      projectId: args.projectId,
      network: args.network,
      contractId,
      displayName: args.displayName.trim().slice(0, 120) || contractId,
      description: args.description.trim().slice(0, 2000),
      tags: normalizeTags(args.tags),
      wasmHash: normalizeHash(args.wasmHash, "Wasm hash"),
      specHash: normalizeHash(args.specHash, "spec hash"),
      repositoryUrl: safeOptionalUrl(args.repositoryUrl),
      documentationUrl: safeOptionalUrl(args.documentationUrl),
      updatedBy: access.address,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, value);
      return existing._id;
    }
    return await ctx.db.insert("playgroundSavedContracts", {
      ...value,
      createdBy: access.address,
      createdAt: now,
    });
  },
});

export const createRequest = mutation({
  args: {
    projectId: v.id("projects"),
    savedContractId: v.id("playgroundSavedContracts"),
    name: v.string(),
    functionName: v.string(),
    argumentTemplateJson: v.string(),
    sourceStrategy: v.literal("connected_wallet"),
    settings: settingsValidator,
    tags: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await requireProjectRole(ctx, args.projectId, "editor");
    const contract = await ctx.db.get(args.savedContractId);
    if (!contract || contract.projectId !== args.projectId)
      throw new Error("Saved contract not found");
    const now = Date.now();
    const requestId = await ctx.db.insert("playgroundSavedRequests", {
      projectId: args.projectId,
      savedContractId: contract._id,
      name: args.name.trim().slice(0, 120) || args.functionName,
      currentVersion: 1,
      createdBy: access.address,
      updatedBy: access.address,
      createdAt: now,
      updatedAt: now,
    });
    const versionId = await ctx.db.insert("playgroundRequestVersions", {
      projectId: args.projectId,
      requestId,
      savedContractId: contract._id,
      version: 1,
      network: contract.network,
      contractId: contract.contractId,
      wasmHash: contract.wasmHash,
      functionName: args.functionName.trim(),
      argumentTemplateJson: JSON.stringify(
        parseBoundedJson(args.argumentTemplateJson, "Argument template"),
      ),
      sourceStrategy: args.sourceStrategy,
      settings: args.settings,
      tags: normalizeTags(args.tags),
      createdBy: access.address,
      createdAt: now,
    });
    await ctx.db.patch(requestId, { currentVersionId: versionId });
    return { requestId, versionId, version: 1 };
  },
});

export const updateRequest = mutation({
  args: {
    requestId: v.id("playgroundSavedRequests"),
    name: v.optional(v.string()),
    argumentTemplateJson: v.string(),
    sourceStrategy: v.literal("connected_wallet"),
    settings: settingsValidator,
    tags: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error("Saved request not found");
    const access = await requireProjectRole(ctx, request.projectId, "editor");
    const contract = await ctx.db.get(request.savedContractId);
    if (!contract) throw new Error("Saved contract not found");
    const prior = request.currentVersionId ? await ctx.db.get(request.currentVersionId) : null;
    if (!prior) throw new Error("Current request version not found");
    const now = Date.now();
    const version = request.currentVersion + 1;
    const versionId = await ctx.db.insert("playgroundRequestVersions", {
      projectId: request.projectId,
      requestId: request._id,
      savedContractId: contract._id,
      version,
      network: contract.network,
      contractId: contract.contractId,
      wasmHash: contract.wasmHash,
      functionName: prior.functionName,
      argumentTemplateJson: JSON.stringify(
        parseBoundedJson(args.argumentTemplateJson, "Argument template"),
      ),
      sourceStrategy: args.sourceStrategy,
      settings: args.settings,
      tags: normalizeTags(args.tags),
      createdBy: access.address,
      createdAt: now,
    });
    await ctx.db.patch(request._id, {
      ...(args.name === undefined ? {} : { name: args.name.trim().slice(0, 120) }),
      currentVersion: version,
      currentVersionId: versionId,
      updatedBy: access.address,
      updatedAt: now,
    });
    return { requestId: request._id, versionId, version };
  },
});

export const duplicateRequest = mutation({
  args: { requestId: v.id("playgroundSavedRequests"), name: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.requestId);
    if (!source?.currentVersionId) throw new Error("Saved request not found");
    const access = await requireProjectRole(ctx, source.projectId, "editor");
    const version = await ctx.db.get(source.currentVersionId);
    if (!version) throw new Error("Current request version not found");
    const now = Date.now();
    const requestId = await ctx.db.insert("playgroundSavedRequests", {
      projectId: source.projectId,
      savedContractId: source.savedContractId,
      name: args.name?.trim().slice(0, 120) || `${source.name} copy`,
      currentVersion: 1,
      createdBy: access.address,
      updatedBy: access.address,
      createdAt: now,
      updatedAt: now,
    });
    const versionId = await ctx.db.insert("playgroundRequestVersions", {
      projectId: version.projectId,
      requestId,
      savedContractId: version.savedContractId,
      version: 1,
      network: version.network,
      contractId: version.contractId,
      wasmHash: version.wasmHash,
      functionName: version.functionName,
      argumentTemplateJson: version.argumentTemplateJson,
      sourceStrategy: version.sourceStrategy,
      settings: version.settings,
      tags: version.tags,
      createdBy: access.address,
      createdAt: now,
    });
    await ctx.db.patch(requestId, { currentVersionId: versionId });
    return { requestId, versionId, version: 1 };
  },
});

export const upsertVariable = mutation({
  args: {
    projectId: v.id("projects"),
    network: networkValidator,
    name: v.string(),
    kind: v.union(v.literal("string"), v.literal("address"), v.literal("contract")),
    value: v.string(),
  },
  handler: async (ctx, args) => {
    const access = await requireProjectRole(ctx, args.projectId, "editor");
    const variable = normalizeVariable(args.name, args.value);
    if (args.kind === "address") normalizeWalletAddress(variable.value);
    if (args.kind === "contract") normalizeContractId(variable.value);
    const existing = await ctx.db
      .query("playgroundEnvironmentVariables")
      .withIndex("by_project_and_network_and_name", (q) =>
        q.eq("projectId", args.projectId).eq("network", args.network).eq("name", variable.name),
      )
      .unique();
    const now = Date.now();
    const value = {
      projectId: args.projectId,
      network: args.network,
      ...variable,
      kind: args.kind,
      updatedBy: access.address,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, value);
      return existing._id;
    }
    return await ctx.db.insert("playgroundEnvironmentVariables", {
      ...value,
      createdBy: access.address,
      createdAt: now,
    });
  },
});

export const deleteVariable = mutation({
  args: { variableId: v.id("playgroundEnvironmentVariables") },
  handler: async (ctx, args) => {
    const variable = await ctx.db.get(args.variableId);
    if (!variable) throw new Error("Variable not found");
    await requireProjectRole(ctx, variable.projectId, "editor");
    await ctx.db.delete(variable._id);
  },
});

export const recordExecution = mutation({
  args: {
    projectId: v.id("projects"),
    requestId: v.optional(v.id("playgroundSavedRequests")),
    requestVersionId: v.optional(v.id("playgroundRequestVersions")),
    idempotencyKey: v.string(),
    kind: v.union(v.literal("simulation"), v.literal("invocation")),
    journeyCorrelationId: v.string(),
    requestCorrelationId: v.string(),
    network: networkValidator,
    contractId: v.string(),
    functionName: v.string(),
    sourceAccount: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("success"),
      v.literal("failed"),
      v.literal("unknown"),
    ),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    transactionHash: v.optional(v.string()),
    fee: v.optional(v.string()),
    wasmHash: v.string(),
    errorCode: v.optional(v.string()),
    eventSummaries: v.optional(v.array(v.any())),
    persistenceProof: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { persistenceProof = "development", ...record } = args;
    await verifyPersistenceProof(record, persistenceProof);
    const access = await requireProjectRole(ctx, args.projectId, "viewer");
    const existing = await ctx.db
      .query("playgroundExecutions")
      .withIndex("by_project_and_idempotency_key", (q) =>
        q.eq("projectId", args.projectId).eq("idempotencyKey", args.idempotencyKey),
      )
      .unique();
    if (existing) return existing._id;
    const now = Date.now();
    const contractId = normalizeContractId(args.contractId);
    const sourceAccount = normalizeWalletAddress(args.sourceAccount);
    const searchText = [
      contractId,
      args.functionName,
      sourceAccount,
      args.transactionHash ?? "",
      args.status,
    ]
      .join(" ")
      .toLowerCase();
    return await ctx.db.insert("playgroundExecutions", {
      ...record,
      contractId,
      sourceAccount,
      actorAddress: access.address,
      wasmHash: normalizeHash(args.wasmHash, "Wasm hash"),
      eventSummaries: args.eventSummaries
        ? (assertBoundedJson(args.eventSummaries, "Event summaries", 64 * 1024) as unknown[])
        : undefined,
      searchText,
      expiresAt: now + THIRTY_DAYS_MS,
      createdAt: now,
    });
  },
});

export const recordInvocationOutcome = mutation({
  args: {
    projectId: v.id("projects"),
    idempotencyKey: v.string(),
    journeyCorrelationId: v.string(),
    requestCorrelationId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("success"),
      v.literal("failed"),
      v.literal("unknown"),
    ),
    transactionHash: v.string(),
    fee: v.optional(v.string()),
    errorCode: v.optional(v.string()),
    eventSummaries: v.optional(v.array(v.any())),
    completedAt: v.optional(v.number()),
    persistenceProof: v.string(),
  },
  handler: async (ctx, args) => {
    const { persistenceProof, ...outcome } = args;
    await verifyPersistenceProof(outcome, persistenceProof);
    await requireProjectRole(ctx, args.projectId, "viewer");
    const existing = await ctx.db
      .query("playgroundExecutions")
      .withIndex("by_project_and_idempotency_key", (q) =>
        q.eq("projectId", args.projectId).eq("idempotencyKey", args.idempotencyKey),
      )
      .unique();
    if (existing) return existing._id;
    const executions = await ctx.db
      .query("playgroundExecutions")
      .withIndex("by_project_and_journey_correlation_id", (q) =>
        q.eq("projectId", args.projectId).eq("journeyCorrelationId", args.journeyCorrelationId),
      )
      .collect();
    const simulation = executions.find((execution) => execution.kind === "simulation");
    if (!simulation) throw new Error("Trusted simulation record not found");
    const now = Date.now();
    return await ctx.db.insert("playgroundExecutions", {
      projectId: args.projectId,
      requestId: simulation.requestId,
      requestVersionId: simulation.requestVersionId,
      idempotencyKey: args.idempotencyKey,
      kind: "invocation",
      actorAddress: simulation.actorAddress,
      journeyCorrelationId: args.journeyCorrelationId,
      requestCorrelationId: args.requestCorrelationId,
      network: simulation.network,
      contractId: simulation.contractId,
      functionName: simulation.functionName,
      sourceAccount: simulation.sourceAccount,
      status: args.status,
      startedAt: simulation.completedAt ?? simulation.startedAt,
      completedAt: args.completedAt,
      transactionHash: args.transactionHash,
      fee: args.fee,
      wasmHash: simulation.wasmHash,
      errorCode: args.errorCode,
      eventSummaries: args.eventSummaries
        ? (assertBoundedJson(args.eventSummaries, "Event summaries", 64 * 1024) as unknown[])
        : undefined,
      searchText: [
        simulation.contractId,
        simulation.functionName,
        simulation.sourceAccount,
        args.transactionHash,
        args.status,
      ]
        .join(" ")
        .toLowerCase(),
      expiresAt: now + THIRTY_DAYS_MS,
      createdAt: now,
    });
  },
});

export const createShare = mutation({
  args: {
    projectId: v.id("projects"),
    requestVersionId: v.optional(v.id("playgroundRequestVersions")),
    visibility: v.union(v.literal("private_project"), v.literal("public_unlisted")),
    includeArguments: v.boolean(),
    snapshotJson: v.string(),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const access = await requireProjectRole(ctx, args.projectId, "editor");
    const random = new Uint8Array(32);
    crypto.getRandomValues(random);
    const token = Array.from(random)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const tokenHash = await sha256(token);
    const now = Date.now();
    const isPublic = args.visibility === "public_unlisted";
    const snapshotJson = isPublic
      ? stripPublicSnapshotArguments(args.snapshotJson, args.includeArguments)
      : JSON.stringify(parseBoundedJson(args.snapshotJson, "Share snapshot", 128 * 1024));
    const shareId = await ctx.db.insert("playgroundShares", {
      projectId: args.projectId,
      requestVersionId: args.requestVersionId,
      tokenHash,
      visibility: args.visibility,
      includeArguments: args.includeArguments,
      snapshotJson,
      createdBy: access.address,
      createdAt: now,
      expiresAt: args.expiresAt ?? (isPublic ? now + THIRTY_DAYS_MS : undefined),
    });
    return { shareId, token };
  },
});

export const revokeShare = mutation({
  args: { shareId: v.id("playgroundShares") },
  handler: async (ctx, args) => {
    const share = await ctx.db.get(args.shareId);
    if (!share) throw new Error("Share not found");
    await requireProjectRole(ctx, share.projectId, "editor");
    await ctx.db.patch(share._id, { revokedAt: Date.now() });
  },
});

export const saveWebhookFilter = mutation({
  args: {
    projectId: v.id("projects"),
    endpointId: v.id("webhookEndpoints"),
    network: networkValidator,
    contractId: v.string(),
    topics: v.array(v.any()),
    data: v.optional(v.any()),
    sourceExecutionId: v.optional(v.id("playgroundExecutions")),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const access = await requireProjectRole(ctx, args.projectId, "editor");
    const endpoint = await ctx.db.get(args.endpointId);
    if (!endpoint || endpoint.projectId !== args.projectId) throw new Error("Webhook not found");
    const now = Date.now();
    return await ctx.db.insert("playgroundWebhookFilters", {
      ...args,
      contractId: normalizeContractId(args.contractId),
      topics: assertBoundedJson(args.topics, "Webhook topics", 32 * 1024) as unknown[],
      data:
        args.data === undefined
          ? undefined
          : assertBoundedJson(args.data, "Webhook data", 32 * 1024),
      createdBy: access.address,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const expireExecutions = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("playgroundExecutions")
      .withIndex("by_expires_at", (q) => q.lt("expiresAt", Date.now()))
      .take(Math.min(100, Math.max(1, args.limit ?? 100)));
    for (const row of rows) await ctx.db.delete(row._id);
    return rows.length;
  },
});

export const purgeForProjectDeletion = internalMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const tables = [
      "projectMemberships",
      "playgroundRequestVersions",
      "playgroundSavedRequests",
      "playgroundSavedContracts",
      "playgroundEnvironmentVariables",
      "playgroundShares",
      "playgroundWebhookFilters",
      "playgroundExecutions",
    ] as const;
    let deleted = 0;
    for (const table of tables) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .collect();
      for (const row of rows) {
        await ctx.db.delete(row._id);
        deleted += 1;
      }
    }
    return deleted;
  },
});
