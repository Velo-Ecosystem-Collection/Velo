/** The only network admitted by the initial Gas Station domain boundary. */
export const GAS_NETWORK = "testnet" as const;
export type GasNetwork = typeof GAS_NETWORK;

/** Inclusive stroop bounds supported by Convex's signed int64 values. */
export const GAS_MIN_STROOPS = 0n;
export const GAS_MAX_STROOPS = 2n ** 63n - 1n;

/** D1 reservation overhead added to the inner transaction maximum fee. */
export const GAS_FEE_OVERHEAD_STROOPS = 100n;

/** Maximum number of durable FeeBump sends for one execution identity. */
export const GAS_MAX_SEND_COUNT = 3;

/** Reconciliation workers claim no more than this many attempts per page. */
export const GAS_RECONCILIATION_BATCH_LIMIT = 25;

/** Reconciliation lookup leases are independent from execution leases. */
export const GAS_RECONCILIATION_LEASE_MS = 30 * 1_000;

/** Maximum number of concurrent Testnet reconciliation lookups. */
export const GAS_RECONCILIATION_LOOKUP_CONCURRENCY = 5;

/** Initial and maximum delay between unresolved reconciliation lookups. */
export const GAS_RECONCILIATION_INITIAL_DELAY_MS = 60 * 1_000;
export const GAS_RECONCILIATION_MAX_DELAY_MS = 5 * 60 * 1_000;

/** Maximum number of contract IDs accepted in a Gas Station allowlist. */
export const GAS_MAX_ALLOWED_CONTRACT_IDS = 20;

/** The only operation shape admitted by the initial Gas Station boundary. */
export const GAS_SUPPORTED_OPERATION = "invokeHostFunction" as const;
export type GasSupportedOperation = typeof GAS_SUPPORTED_OPERATION;

/** D1 admission and D2 trusted execution lifecycle vocabulary. */
export const GAS_LIFECYCLE_STATES = {
  reserved: "reserved",
  rejected: "rejected",
  expired: "expired",
  claimed: "claimed",
  submissionUnknown: "submission_unknown",
  submitted: "submitted",
  succeeded: "succeeded",
  failed: "failed",
  cancelled: "cancelled",
} as const;

export type GasLifecycleState = (typeof GAS_LIFECYCLE_STATES)[keyof typeof GAS_LIFECYCLE_STATES];

/** Execution states safe to return from the authenticated submit boundary. */
export const GAS_EXECUTION_STATUSES = {
  claimed: GAS_LIFECYCLE_STATES.claimed,
  submissionUnknown: GAS_LIFECYCLE_STATES.submissionUnknown,
  submitted: GAS_LIFECYCLE_STATES.submitted,
  succeeded: GAS_LIFECYCLE_STATES.succeeded,
  failed: GAS_LIFECYCLE_STATES.failed,
  cancelled: GAS_LIFECYCLE_STATES.cancelled,
} as const;

export type GasExecutionStatus =
  (typeof GAS_EXECUTION_STATUSES)[keyof typeof GAS_EXECUTION_STATUSES];

/** Internal one-shot diagnosis states for an observed inner bad sequence. */
export const GAS_SEQUENCE_DIAGNOSIS_DISPOSITIONS = {
  unresolved: "unresolved",
  ledgerObserved: "ledger_observed",
  clientRebuildRequired: "client_rebuild_required",
} as const;

export type GasSequenceDiagnosisDisposition =
  (typeof GAS_SEQUENCE_DIAGNOSIS_DISPOSITIONS)[keyof typeof GAS_SEQUENCE_DIAGNOSIS_DISPOSITIONS];

/** Sanitized outcomes of the bounded Testnet lookup used by sequence diagnosis. */
export const GAS_SEQUENCE_LOOKUP_CLASSIFICATIONS = {
  found: "found",
  notFound: "not_found",
  unavailable: "unavailable",
  malformedResponse: "malformed_response",
  wrongNetwork: "wrong_network",
} as const;

export type GasSequenceLookupClassification =
  (typeof GAS_SEQUENCE_LOOKUP_CLASSIFICATIONS)[keyof typeof GAS_SEQUENCE_LOOKUP_CLASSIFICATIONS];

/** Sanitized outcomes retained by the durable FeeBump reconciliation worker. */
export const GAS_RECONCILIATION_LOOKUP_CLASSIFICATIONS = {
  found: "found",
  notFound: "not_found",
  unavailable: "unavailable",
  malformedResponse: "malformed_response",
  wrongNetwork: "wrong_network",
} as const;

export type GasReconciliationLookupClassification =
  (typeof GAS_RECONCILIATION_LOOKUP_CLASSIFICATIONS)[keyof typeof GAS_RECONCILIATION_LOOKUP_CLASSIFICATIONS];

/** Decisions persisted by the D1 gas admission log. */
export const GAS_DECISION_CODES = {
  reserved: "reserved",
  rejected: "rejected",
} as const;

export type GasDecisionCode = (typeof GAS_DECISION_CODES)[keyof typeof GAS_DECISION_CODES];

/** Rejection reasons that may be recorded for an authenticated D1 decision. */
export const GAS_REJECTION_CODES = {
  policyDisabled: "policy_disabled",
  dailyCapExceeded: "daily_cap_exceeded",
  walletRateLimited: "wallet_rate_limited",
  contractNotWhitelisted: "contract_not_whitelisted",
  unsupportedTransaction: "unsupported_transaction",
  wrongNetwork: "wrong_network",
  invalidSignature: "invalid_signature",
  duplicateTransaction: "duplicate_transaction",
} as const;

export type GasRejectionCode = (typeof GAS_REJECTION_CODES)[keyof typeof GAS_REJECTION_CODES];

/** Relayer metadata status; custody and signing state remain outside D1. */
export const GAS_RELAYER_STATUSES = {
  active: "active",
  disabled: "disabled",
} as const;

export type GasRelayerStatus = (typeof GAS_RELAYER_STATUSES)[keyof typeof GAS_RELAYER_STATUSES];
