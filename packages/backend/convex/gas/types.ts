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
