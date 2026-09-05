import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import type {
  GasDecisionCode,
  GasLifecycleState,
  GasNetwork,
  GasRejectionCode,
  GasRelayerStatus,
} from "./types";

import {
  gasDecisionCodeValidator,
  gasLifecycleValidator,
  gasNetworkValidator,
  gasRejectionCodeValidator,
  gasRelayerStatusValidator,
} from "./schema";

/** Fields safe for project-scoped policy views and API responses. */
export type GasPolicyProjection = {
  enabled: boolean;
  network: GasNetwork;
  dailyCapStroops: string;
  dailyReservedStroops: string;
  dailyWindowKey: string;
  walletHourlyLimit: number;
  allowedContractIds: string[];
  createdAt: number;
  updatedAt: number;
};

/** Fields safe for project-scoped decision and lifecycle views. */
export type GasLogProjection = {
  requestId: string;
  transactionHash: string | null;
  sourceWallet: string | null;
  targetContractIds: string[] | null;
  innerMaxFeeStroops: string | null;
  reservedStroops: string | null;
  actualFeeStroops: string | null;
  decisionCode: GasDecisionCode;
  rejectionCode: GasRejectionCode | null;
  lifecycle: GasLifecycleState;
  expiresAt: number | null;
  createdAt: number;
  updatedAt: number;
};

/** Fields safe for project-scoped relayer metadata views. */
export type RelayerAccountProjection = {
  publicKey: string;
  network: GasNetwork;
  status: GasRelayerStatus;
  balanceStroops: string | null;
  balanceUpdatedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

/** Explicit public return validator for safe Gas policy projections. */
export const gasPolicyProjectionValidator = v.object({
  enabled: v.boolean(),
  network: gasNetworkValidator,
  dailyCapStroops: v.string(),
  dailyReservedStroops: v.string(),
  dailyWindowKey: v.string(),
  walletHourlyLimit: v.number(),
  allowedContractIds: v.array(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

/** Explicit public return validator for safe Gas log projections. */
export const gasLogProjectionValidator = v.object({
  requestId: v.string(),
  transactionHash: v.union(v.string(), v.null()),
  sourceWallet: v.union(v.string(), v.null()),
  targetContractIds: v.union(v.array(v.string()), v.null()),
  innerMaxFeeStroops: v.union(v.string(), v.null()),
  reservedStroops: v.union(v.string(), v.null()),
  actualFeeStroops: v.union(v.string(), v.null()),
  decisionCode: gasDecisionCodeValidator,
  rejectionCode: v.union(gasRejectionCodeValidator, v.null()),
  lifecycle: gasLifecycleValidator,
  expiresAt: v.union(v.number(), v.null()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

/** Explicit public return validator for safe relayer projections. */
export const relayerAccountProjectionValidator = v.object({
  publicKey: v.string(),
  network: gasNetworkValidator,
  status: gasRelayerStatusValidator,
  balanceStroops: v.union(v.string(), v.null()),
  balanceUpdatedAt: v.union(v.number(), v.null()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

function decimalStroops(value: bigint | undefined): string | null {
  return value === undefined ? null : value.toString();
}

/** Project a stored Gas policy without exposing Convex or project internals. */
export function projectGasPolicy(policy: Doc<"gasPolicies">): GasPolicyProjection {
  return {
    enabled: policy.enabled,
    network: policy.network,
    dailyCapStroops: policy.dailyCapStroops.toString(),
    dailyReservedStroops: policy.dailyReservedStroops.toString(),
    dailyWindowKey: policy.dailyWindowKey,
    walletHourlyLimit: policy.walletHourlyLimit,
    allowedContractIds: [...policy.allowedContractIds],
    createdAt: policy.createdAt,
    updatedAt: policy.updatedAt,
  };
}

/** Project a stored Gas decision without exposing correlation hashes or raw input. */
export function projectGasLog(log: Doc<"gasLogs">): GasLogProjection {
  return {
    requestId: log.requestId,
    transactionHash: log.transactionHash ?? null,
    sourceWallet: log.sourceWallet ?? null,
    targetContractIds: log.targetContractIds === undefined ? null : [...log.targetContractIds],
    innerMaxFeeStroops: decimalStroops(log.innerMaxFeeStroops),
    reservedStroops: decimalStroops(log.reservedStroops),
    actualFeeStroops: decimalStroops(log.actualFeeStroops),
    decisionCode: log.decisionCode,
    rejectionCode: log.rejectionCode ?? null,
    lifecycle: log.lifecycle,
    expiresAt: log.expiresAt ?? null,
    createdAt: log.createdAt,
    updatedAt: log.updatedAt,
  };
}

/** Project relayer metadata without exposing custody, credentials, or Convex internals. */
export function projectRelayerAccount(account: Doc<"relayerAccounts">): RelayerAccountProjection {
  return {
    publicKey: account.publicKey,
    network: account.network,
    status: account.status,
    balanceStroops: decimalStroops(account.balanceStroops),
    balanceUpdatedAt: account.balanceUpdatedAt ?? null,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}
