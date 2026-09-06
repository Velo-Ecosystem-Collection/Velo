import { defineTable } from "convex/server";
import { v } from "convex/values";

import {
  GAS_DECISION_CODES,
  GAS_EXECUTION_STATUSES,
  GAS_LIFECYCLE_STATES,
  GAS_NETWORK,
  GAS_REJECTION_CODES,
  GAS_RELAYER_STATUSES,
  GAS_SEQUENCE_DIAGNOSIS_DISPOSITIONS,
  GAS_SEQUENCE_LOOKUP_CLASSIFICATIONS,
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
  v.literal(GAS_LIFECYCLE_STATES.claimed),
  v.literal(GAS_LIFECYCLE_STATES.submissionUnknown),
  v.literal(GAS_LIFECYCLE_STATES.submitted),
  v.literal(GAS_LIFECYCLE_STATES.succeeded),
  v.literal(GAS_LIFECYCLE_STATES.failed),
  v.literal(GAS_LIFECYCLE_STATES.cancelled),
);

export const gasExecutionStatusValidator = v.union(
  v.literal(GAS_EXECUTION_STATUSES.claimed),
  v.literal(GAS_EXECUTION_STATUSES.submissionUnknown),
  v.literal(GAS_EXECUTION_STATUSES.submitted),
  v.literal(GAS_EXECUTION_STATUSES.succeeded),
  v.literal(GAS_EXECUTION_STATUSES.failed),
  v.literal(GAS_EXECUTION_STATUSES.cancelled),
);

export const gasRelayerStatusValidator = v.union(
  v.literal(GAS_RELAYER_STATUSES.active),
  v.literal(GAS_RELAYER_STATUSES.disabled),
);

const gasSendUnknownReasonValidator = v.union(
  v.literal("timeout"),
  v.literal("transport_failure"),
  v.literal("malformed_response"),
  v.literal("hash_mismatch"),
);

const gasSequenceLookupClassificationValidator = v.union(
  v.literal(GAS_SEQUENCE_LOOKUP_CLASSIFICATIONS.found),
  v.literal(GAS_SEQUENCE_LOOKUP_CLASSIFICATIONS.notFound),
  v.literal(GAS_SEQUENCE_LOOKUP_CLASSIFICATIONS.unavailable),
  v.literal(GAS_SEQUENCE_LOOKUP_CLASSIFICATIONS.malformedResponse),
  v.literal(GAS_SEQUENCE_LOOKUP_CLASSIFICATIONS.wrongNetwork),
);

const gasSequenceDiagnosisDispositionValidator = v.union(
  v.literal(GAS_SEQUENCE_DIAGNOSIS_DISPOSITIONS.unresolved),
  v.literal(GAS_SEQUENCE_DIAGNOSIS_DISPOSITIONS.ledgerObserved),
  v.literal(GAS_SEQUENCE_DIAGNOSIS_DISPOSITIONS.clientRebuildRequired),
);

const gasSequenceDiagnosisEvidenceValidator = v.object({
  outerTransactionHash: v.string(),
  innerTransactionHash: v.string(),
  feeSource: v.string(),
  feeStroops: v.int64(),
  ledger: v.number(),
  resultCode: v.string(),
  innerResultCode: v.optional(v.string()),
});

export const gasSequenceDiagnosisInputValidator = v.object({
  lookupClassification: gasSequenceLookupClassificationValidator,
  evidence: v.optional(gasSequenceDiagnosisEvidenceValidator),
});

export const gasSequenceDiagnosisValidator = v.object({
  disposition: gasSequenceDiagnosisDispositionValidator,
  lookupClassification: gasSequenceLookupClassificationValidator,
  recordedAt: v.number(),
  evidence: v.optional(gasSequenceDiagnosisEvidenceValidator),
});

/** Sanitized post-authorization adapter evidence retained for recovery. */
export const gasSendClassificationValidator = v.union(
  v.object({
    status: v.literal("pending"),
    outerTransactionHash: v.string(),
    sendCount: v.number(),
    recordedAt: v.number(),
  }),
  v.object({
    status: v.literal("duplicate"),
    outerTransactionHash: v.string(),
    sendCount: v.number(),
    recordedAt: v.number(),
  }),
  v.object({
    status: v.literal("retry_later"),
    outerTransactionHash: v.string(),
    sendCount: v.number(),
    recordedAt: v.number(),
  }),
  v.object({
    status: v.literal("rejected"),
    outerTransactionHash: v.string(),
    sendCount: v.number(),
    recordedAt: v.number(),
    resultCode: v.optional(v.string()),
    innerResultCode: v.optional(v.string()),
  }),
  v.object({
    status: v.literal("unknown"),
    outerTransactionHash: v.string(),
    sendCount: v.number(),
    recordedAt: v.number(),
    reason: gasSendUnknownReasonValidator,
  }),
);

/** Internal input shape; the mutation supplies the trusted record timestamp. */
export const gasSendClassificationInputValidator = v.union(
  v.object({
    status: v.literal("pending"),
    outerTransactionHash: v.string(),
    sendCount: v.number(),
  }),
  v.object({
    status: v.literal("duplicate"),
    outerTransactionHash: v.string(),
    sendCount: v.number(),
  }),
  v.object({
    status: v.literal("retry_later"),
    outerTransactionHash: v.string(),
    sendCount: v.number(),
  }),
  v.object({
    status: v.literal("rejected"),
    outerTransactionHash: v.string(),
    sendCount: v.number(),
    resultCode: v.optional(v.string()),
    innerResultCode: v.optional(v.string()),
  }),
  v.object({
    status: v.literal("unknown"),
    outerTransactionHash: v.string(),
    sendCount: v.number(),
    reason: gasSendUnknownReasonValidator,
  }),
);

export const gasPolicies = defineTable({
  projectId: v.id("projects"),
  enabled: v.boolean(),
  network: gasNetworkValidator,
  dailyCapStroops: v.int64(),
  dailyReservedStroops: v.int64(),
  dailyWindowKey: v.string(),
  /** D2 accounting fields are optional so pre-D2 policies initialize lazily. */
  outstandingHoldsStroops: v.optional(v.int64()),
  dailyConfirmedSpendStroops: v.optional(v.int64()),
  accountingState: v.optional(v.union(v.literal("initialized"), v.literal("overflow"))),
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

/**
 * Durable D2 execution identity and accounting facts.
 *
 * This table deliberately contains no signed envelope, signature, secret, or
 * raw provider response. It is independent from gasLogs so reconciliation can
 * continue after the D1 audit row is retained or deleted.
 */
export const gasExecutionAttempts = defineTable({
  projectId: v.id("projects"),
  network: gasNetworkValidator,
  requestId: v.string(),
  idempotencyKeyHash: v.string(),
  requestFingerprint: v.string(),
  innerTransactionHash: v.string(),
  sourceWallet: v.string(),
  targetContractIds: v.array(v.string()),
  innerMaxFeeStroops: v.int64(),
  originalReservationStroops: v.int64(),
  reservationCreatedAt: v.number(),
  reservationExpiresAt: v.number(),
  accountingDayKey: v.string(),
  lifecycle: gasLifecycleValidator,
  approvedHoldStroops: v.int64(),
  feeCeilingStroops: v.int64(),
  relayerPublicKey: v.string(),
  outerTransactionHash: v.optional(v.string()),
  /** Exact fee on the pinned outer wrapper, when send authorization exists. */
  outerFeeStroops: v.optional(v.int64()),
  leaseToken: v.optional(v.string()),
  leaseGeneration: v.number(),
  leaseExpiresAt: v.optional(v.number()),
  sendCount: v.number(),
  nextCheckAt: v.number(),
  /** Earliest authenticated resupply/send time for a transient retry. */
  nextSendAt: v.optional(v.number()),
  firstPossibleSendAt: v.optional(v.number()),
  reconciliationDeadlineAt: v.optional(v.number()),
  reconciliationRequired: v.boolean(),
  latestSendClassification: v.optional(gasSendClassificationValidator),
  /** One bounded, internal diagnosis of an inner bad-sequence rejection. */
  sequenceDiagnosis: v.optional(gasSequenceDiagnosisValidator),
  actualFeeStroops: v.optional(v.int64()),
  settledAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_project_id_and_request_id", ["projectId", "requestId"])
  .index("by_project_id_and_idempotency_key_hash", ["projectId", "idempotencyKeyHash"])
  .index("by_project_id_and_inner_transaction_hash", ["projectId", "innerTransactionHash"])
  .index("by_lifecycle_and_next_check_at", ["lifecycle", "nextCheckAt"])
  .index("by_lifecycle_and_lease_expires_at", ["lifecycle", "leaseExpiresAt"]);
