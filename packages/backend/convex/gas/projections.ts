import { isCorrelationId } from "@repo/observability";
import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import type {
  GasDecisionCode,
  GasExecutionStatus,
  GasLifecycleState,
  GasNetwork,
  GasRejectionCode,
  GasRelayerStatus,
} from "./types";

import {
  gasDecisionCodeValidator,
  gasExecutionStatusValidator,
  gasLifecycleValidator,
  gasNetworkValidator,
  gasRejectionCodeValidator,
  gasRelayerStatusValidator,
} from "./schema";
import {
  assertValidStroopValue,
  normalizeGasRequestId,
  normalizeTransactionHash,
} from "./validation";

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

/** Fields safe for authenticated submit/replay status responses. */
export type GasSubmitResultProjection = {
  object: "gas_submit_result";
  requestId: string;
  transactionHash: string;
  outerTransactionHash: string | null;
  status: GasExecutionStatus;
  reservedStroops: string;
  actualFeeStroops: string | null;
  expiresAt: string;
  reconciliationRequired: boolean;
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

/** Exact ADR-0003 public execution DTO validator. */
export const gasSubmitResultProjectionValidator = v.object({
  object: v.literal("gas_submit_result"),
  requestId: v.string(),
  transactionHash: v.string(),
  outerTransactionHash: v.union(v.string(), v.null()),
  status: gasExecutionStatusValidator,
  reservedStroops: v.string(),
  actualFeeStroops: v.union(v.string(), v.null()),
  expiresAt: v.string(),
  reconciliationRequired: v.boolean(),
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

/** Project a stored execution attempt without exposing internal claim state. */
export function projectGasExecutionAttempt(
  attempt: Pick<
    Doc<"gasExecutionAttempts">,
    | "requestId"
    | "innerTransactionHash"
    | "outerTransactionHash"
    | "lifecycle"
    | "approvedHoldStroops"
    | "actualFeeStroops"
    | "reservationExpiresAt"
    | "reconciliationRequired"
  >,
): GasSubmitResultProjection {
  try {
    if (
      !isCorrelationId(attempt.requestId) ||
      normalizeGasRequestId(attempt.requestId) !== attempt.requestId ||
      normalizeTransactionHash(attempt.innerTransactionHash) !== attempt.innerTransactionHash ||
      !Number.isSafeInteger(attempt.reservationExpiresAt) ||
      attempt.reservationExpiresAt <= 0 ||
      !Number.isFinite(new Date(attempt.reservationExpiresAt).getTime()) ||
      (attempt.lifecycle !== "claimed" &&
        attempt.lifecycle !== "submission_unknown" &&
        attempt.lifecycle !== "submitted" &&
        attempt.lifecycle !== "succeeded" &&
        attempt.lifecycle !== "failed" &&
        attempt.lifecycle !== "cancelled")
    ) {
      throw new Error("Invalid Gas execution projection");
    }

    const approvedHoldStroops = assertValidStroopValue(attempt.approvedHoldStroops);
    const actualFeeStroops =
      attempt.actualFeeStroops === undefined
        ? null
        : assertValidStroopValue(attempt.actualFeeStroops);
    const outerTransactionHash =
      attempt.outerTransactionHash === undefined
        ? null
        : normalizeTransactionHash(attempt.outerTransactionHash);

    return {
      object: "gas_submit_result",
      requestId: attempt.requestId,
      transactionHash: attempt.innerTransactionHash,
      outerTransactionHash,
      status: attempt.lifecycle,
      reservedStroops: approvedHoldStroops.toString(),
      actualFeeStroops: actualFeeStroops?.toString() ?? null,
      expiresAt: new Date(attempt.reservationExpiresAt).toISOString(),
      reconciliationRequired: attempt.reconciliationRequired,
    };
  } catch {
    throw new Error("Invalid Gas execution projection");
  }
}
