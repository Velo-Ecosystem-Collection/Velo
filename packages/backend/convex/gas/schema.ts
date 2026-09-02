import { defineTable } from "convex/server";
import { v } from "convex/values";

import {
  GAS_DECISION_CODES,
  GAS_LIFECYCLE_STATES,
  GAS_NETWORK,
  GAS_REJECTION_CODES,
  GAS_RELAYER_STATUSES,
} from "./types";

export const gasNetworkValidator = v.literal(GAS_NETWORK);

export const gasDecisionCodeValidator = v.union(
  v.literal(GAS_DECISION_CODES.reserved),
  v.literal(GAS_DECISION_CODES.rejected),
);

export const gasRejectionCodeValidator = v.union(
  v.literal(GAS_REJECTION_CODES.policyDisabled),
  v.literal(GAS_REJECTION_CODES.dailyCapExceeded),
  v.literal(GAS_REJECTION_CODES.walletRateLimited),
  v.literal(GAS_REJECTION_CODES.contractNotWhitelisted),
  v.literal(GAS_REJECTION_CODES.unsupportedTransaction),
  v.literal(GAS_REJECTION_CODES.wrongNetwork),
  v.literal(GAS_REJECTION_CODES.invalidSignature),
  v.literal(GAS_REJECTION_CODES.duplicateTransaction),
);

export const gasLifecycleValidator = v.union(
  v.literal(GAS_LIFECYCLE_STATES.reserved),
  v.literal(GAS_LIFECYCLE_STATES.rejected),
  v.literal(GAS_LIFECYCLE_STATES.expired),
);

export const gasRelayerStatusValidator = v.union(
  v.literal(GAS_RELAYER_STATUSES.active),
  v.literal(GAS_RELAYER_STATUSES.disabled),
);

export const gasPolicies = defineTable({
  projectId: v.id("projects"),
  enabled: v.boolean(),
  network: gasNetworkValidator,
  dailyCapStroops: v.int64(),
  dailyReservedStroops: v.int64(),
  dailyWindowKey: v.string(),
  walletHourlyLimit: v.number(),
  allowedContractIds: v.array(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_project_id", ["projectId"]);

export const gasLogs = defineTable({
  projectId: v.id("projects"),
  requestId: v.string(),
  idempotencyKeyHash: v.string(),
  requestFingerprint: v.string(),
  transactionHash: v.optional(v.string()),
  sourceWallet: v.optional(v.string()),
  targetContractIds: v.optional(v.array(v.string())),
  innerMaxFeeStroops: v.optional(v.int64()),
  reservedStroops: v.optional(v.int64()),
  actualFeeStroops: v.optional(v.int64()),
  decisionCode: gasDecisionCodeValidator,
  rejectionCode: v.optional(gasRejectionCodeValidator),
  lifecycle: gasLifecycleValidator,
  expiresAt: v.optional(v.number()),
  retentionExpiresAt: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_project_id_and_created_at", ["projectId", "createdAt"])
  .index("by_project_id_and_source_wallet_and_created_at", [
    "projectId",
    "sourceWallet",
    "createdAt",
  ])
  .index("by_project_id_and_transaction_hash", ["projectId", "transactionHash"])
  .index("by_project_id_and_idempotency_key_hash", ["projectId", "idempotencyKeyHash"])
  .index("by_project_id_and_request_id", ["projectId", "requestId"])
  .index("by_lifecycle_and_expires_at", ["lifecycle", "expiresAt"])
  .index("by_retention_expires_at", ["retentionExpiresAt"]);

export const relayerAccounts = defineTable({
  projectId: v.id("projects"),
  publicKey: v.string(),
  network: gasNetworkValidator,
  status: gasRelayerStatusValidator,
  balanceStroops: v.optional(v.int64()),
  balanceUpdatedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_project_id_and_network", ["projectId", "network"])
  .index("by_public_key", ["publicKey"]);
