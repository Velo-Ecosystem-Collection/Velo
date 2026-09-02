/** The only network admitted by the initial Gas Station domain boundary. */
export const GAS_NETWORK = "testnet" as const;
export type GasNetwork = typeof GAS_NETWORK;

/** The only operation shape admitted by the initial Gas Station boundary. */
export const GAS_SUPPORTED_OPERATION = "invokeHostFunction" as const;
export type GasSupportedOperation = typeof GAS_SUPPORTED_OPERATION;

/** The initial D1 lifecycle vocabulary; D2 may extend it behind a trusted seam. */
export const GAS_LIFECYCLE_STATES = {
  reserved: "reserved",
  rejected: "rejected",
  expired: "expired",
} as const;

export type GasLifecycleState = (typeof GAS_LIFECYCLE_STATES)[keyof typeof GAS_LIFECYCLE_STATES];

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
