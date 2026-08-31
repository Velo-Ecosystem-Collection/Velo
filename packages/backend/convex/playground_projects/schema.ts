import { defineTable } from "convex/server";
import { v } from "convex/values";

export const projectMemberships = defineTable({
  projectId: v.id("projects"),
  walletAddress: v.string(),
  role: v.union(v.literal("owner"), v.literal("editor"), v.literal("viewer")),
  addedBy: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_project", ["projectId"])
  .index("by_project_and_wallet_address", ["projectId", "walletAddress"])
  .index("by_wallet_address", ["walletAddress"]);

export const playgroundSavedContracts = defineTable({
  projectId: v.id("projects"),
  network: v.union(v.literal("testnet"), v.literal("mainnet")),
  contractId: v.string(),
  displayName: v.string(),
  description: v.string(),
  tags: v.array(v.string()),
  wasmHash: v.string(),
  specHash: v.string(),
  repositoryUrl: v.optional(v.string()),
  documentationUrl: v.optional(v.string()),
  createdBy: v.string(),
  updatedBy: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_project", ["projectId"])
  .index("by_project_and_network_and_contract_id", ["projectId", "network", "contractId"]);

export const playgroundSavedRequests = defineTable({
  projectId: v.id("projects"),
  savedContractId: v.id("playgroundSavedContracts"),
  name: v.string(),
  currentVersion: v.number(),
  currentVersionId: v.optional(v.id("playgroundRequestVersions")),
  createdBy: v.string(),
  updatedBy: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_project", ["projectId"])
  .index("by_saved_contract", ["savedContractId"]);

export const playgroundRequestVersions = defineTable({
  projectId: v.id("projects"),
  requestId: v.id("playgroundSavedRequests"),
  savedContractId: v.id("playgroundSavedContracts"),
  version: v.number(),
  network: v.union(v.literal("testnet"), v.literal("mainnet")),
  contractId: v.string(),
  wasmHash: v.string(),
  functionName: v.string(),
  argumentTemplateJson: v.string(),
  sourceStrategy: v.literal("connected_wallet"),
  settings: v.object({ baseFee: v.string(), cpuInstructions: v.number() }),
  tags: v.array(v.string()),
  createdBy: v.string(),
  createdAt: v.number(),
})
  .index("by_request_and_version", ["requestId", "version"])
  .index("by_project", ["projectId"]);

export const playgroundEnvironmentVariables = defineTable({
  projectId: v.id("projects"),
  network: v.union(v.literal("testnet"), v.literal("mainnet")),
  name: v.string(),
  kind: v.union(v.literal("string"), v.literal("address"), v.literal("contract")),
  value: v.string(),
  createdBy: v.string(),
  updatedBy: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_project", ["projectId"])
  .index("by_project_and_network", ["projectId", "network"])
  .index("by_project_and_network_and_name", ["projectId", "network", "name"]);

export const playgroundExecutions = defineTable({
  projectId: v.id("projects"),
  requestId: v.optional(v.id("playgroundSavedRequests")),
  requestVersionId: v.optional(v.id("playgroundRequestVersions")),
  idempotencyKey: v.string(),
  kind: v.union(v.literal("simulation"), v.literal("invocation")),
  actorAddress: v.string(),
  journeyCorrelationId: v.string(),
  requestCorrelationId: v.string(),
  network: v.union(v.literal("testnet"), v.literal("mainnet")),
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
  searchText: v.string(),
  expiresAt: v.number(),
  createdAt: v.number(),
})
  .index("by_project", ["projectId"])
  .index("by_project_and_created_at", ["projectId", "createdAt"])
  .index("by_project_and_idempotency_key", ["projectId", "idempotencyKey"])
  .index("by_project_and_journey_correlation_id", ["projectId", "journeyCorrelationId"])
  .index("by_project_and_transaction_hash", ["projectId", "transactionHash"])
  .index("by_expires_at", ["expiresAt"])
  .searchIndex("search_text", { searchField: "searchText", filterFields: ["projectId", "status"] });

export const playgroundShares = defineTable({
  projectId: v.id("projects"),
  requestVersionId: v.optional(v.id("playgroundRequestVersions")),
  tokenHash: v.string(),
  visibility: v.union(v.literal("private_project"), v.literal("public_unlisted")),
  includeArguments: v.boolean(),
  snapshotJson: v.string(),
  createdBy: v.string(),
  createdAt: v.number(),
  expiresAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
})
  .index("by_project", ["projectId"])
  .index("by_token_hash", ["tokenHash"])
  .index("by_expires_at", ["expiresAt"]);

export const playgroundWebhookFilters = defineTable({
  projectId: v.id("projects"),
  endpointId: v.id("webhookEndpoints"),
  network: v.union(v.literal("testnet"), v.literal("mainnet")),
  contractId: v.string(),
  topics: v.array(v.any()),
  data: v.optional(v.any()),
  sourceExecutionId: v.optional(v.id("playgroundExecutions")),
  enabled: v.boolean(),
  createdBy: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_project", ["projectId"])
  .index("by_project_and_contract_id", ["projectId", "contractId"])
  .index("by_endpoint", ["endpointId"]);
