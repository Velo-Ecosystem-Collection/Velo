import {
  GAS_DECISION_CODES,
  GAS_FEE_OVERHEAD_STROOPS,
  GAS_NETWORK,
  GAS_REJECTION_CODES,
  GAS_SUPPORTED_OPERATION,
  type GasRejectionCode,
} from "./types";
import {
  addStroopValues,
  assertNonNegativeSafeInteger,
  assertValidStroopValue,
} from "./validation";

/** The policy fields needed by the side-effect-free evaluator. */
export type GasPolicySnapshot = Readonly<{
  enabled: boolean;
  network: string;
  dailyCapStroops: bigint;
  dailyReservedStroops: bigint;
  walletHourlyLimit: number;
  allowedContractIds: readonly string[];
}>;

/** Server-derived facts and the current quota snapshot used for one decision. */
export type GasPolicyEvaluationInput = Readonly<{
  policy: GasPolicySnapshot | null;
  network: string;
  operation: string;
  targetContractIds: readonly string[];
  innerMaxFeeStroops: bigint;
  walletHourlyUsage: number;
  requestedQuotaUnits: number;
}>;

export type GasPolicyRejectionReason =
  | null
  | Readonly<{
      expectedNetwork: typeof GAS_NETWORK;
    }>
  | Readonly<{
      expectedOperation: typeof GAS_SUPPORTED_OPERATION;
      observedTargetCount: number;
    }>
  | Readonly<{
      targetContractId: string;
    }>
  | Readonly<{
      dailyCapStroops: bigint;
      dailyReservedStroops: bigint;
    }>
  | Readonly<{
      walletHourlyLimit: number;
      walletHourlyUsage: number;
    }>;

type GasPolicyApprovalReason = Readonly<{
  nextDailyReservedStroops: bigint;
  remainingWalletUnits: number;
}>;

export type GasPolicyEvaluationResult =
  | Readonly<{
      decisionCode: typeof GAS_DECISION_CODES.reserved;
      rejectionCode: null;
      requiredReservationStroops: bigint;
      reason: GasPolicyApprovalReason;
    }>
  | Readonly<{
      decisionCode: typeof GAS_DECISION_CODES.rejected;
      rejectionCode: GasRejectionCode;
      requiredReservationStroops: bigint;
      reason: GasPolicyRejectionReason;
    }>;

const INVALID_REQUESTED_QUOTA_UNITS = "Invalid requested gas quota units";

function assertPositiveSafeInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(INVALID_REQUESTED_QUOTA_UNITS);
  }

  return value;
}

function rejected(
  rejectionCode: GasRejectionCode,
  requiredReservationStroops: bigint,
  reason: GasPolicyRejectionReason,
): GasPolicyEvaluationResult {
  return {
    decisionCode: GAS_DECISION_CODES.rejected,
    rejectionCode,
    requiredReservationStroops,
    reason,
  };
}

/**
 * Evaluate one already-validated Gas policy snapshot without I/O or mutation.
 *
 * Numeric invariant failures throw. Policy denials return a stable, typed
 * result so admission code can persist or map them without interpreting text.
 */
export function evaluateGasPolicy(input: GasPolicyEvaluationInput): GasPolicyEvaluationResult {
  const innerMaxFeeStroops = assertValidStroopValue(input.innerMaxFeeStroops);
  const requiredReservationStroops = addStroopValues(innerMaxFeeStroops, GAS_FEE_OVERHEAD_STROOPS);

  const walletHourlyUsage = assertNonNegativeSafeInteger(
    input.walletHourlyUsage,
    "walletHourlyUsage",
  );
  const requestedQuotaUnits = assertPositiveSafeInteger(input.requestedQuotaUnits);

  const policy = input.policy;
  if (policy !== null) {
    assertValidStroopValue(policy.dailyCapStroops);
    assertValidStroopValue(policy.dailyReservedStroops);
    assertNonNegativeSafeInteger(policy.walletHourlyLimit, "walletHourlyLimit");
  }

  if (policy === null || !policy.enabled) {
    return rejected(GAS_REJECTION_CODES.policyDisabled, requiredReservationStroops, null);
  }

  if (policy.network !== GAS_NETWORK || input.network !== GAS_NETWORK) {
    return rejected(GAS_REJECTION_CODES.wrongNetwork, requiredReservationStroops, {
      expectedNetwork: GAS_NETWORK,
    });
  }

  if (input.operation !== GAS_SUPPORTED_OPERATION || input.targetContractIds.length !== 1) {
    return rejected(GAS_REJECTION_CODES.unsupportedTransaction, requiredReservationStroops, {
      expectedOperation: GAS_SUPPORTED_OPERATION,
      observedTargetCount: input.targetContractIds.length,
    });
  }

  const targetContractId = input.targetContractIds[0];
  if (targetContractId === undefined) {
    return rejected(GAS_REJECTION_CODES.unsupportedTransaction, requiredReservationStroops, {
      expectedOperation: GAS_SUPPORTED_OPERATION,
      observedTargetCount: input.targetContractIds.length,
    });
  }

  if (!policy.allowedContractIds.includes(targetContractId)) {
    return rejected(GAS_REJECTION_CODES.contractNotWhitelisted, requiredReservationStroops, {
      targetContractId,
    });
  }

  const dailyCapAllowsReservation =
    requiredReservationStroops <= policy.dailyCapStroops &&
    policy.dailyReservedStroops <= policy.dailyCapStroops - requiredReservationStroops;
  if (!dailyCapAllowsReservation) {
    return rejected(GAS_REJECTION_CODES.dailyCapExceeded, requiredReservationStroops, {
      dailyCapStroops: policy.dailyCapStroops,
      dailyReservedStroops: policy.dailyReservedStroops,
    });
  }

  const walletQuotaAllowsReservation =
    walletHourlyUsage <= policy.walletHourlyLimit - requestedQuotaUnits;
  if (!walletQuotaAllowsReservation) {
    return rejected(GAS_REJECTION_CODES.walletRateLimited, requiredReservationStroops, {
      walletHourlyLimit: policy.walletHourlyLimit,
      walletHourlyUsage,
    });
  }

  return {
    decisionCode: GAS_DECISION_CODES.reserved,
    rejectionCode: null,
    requiredReservationStroops,
    reason: {
      nextDailyReservedStroops: addStroopValues(
        policy.dailyReservedStroops,
        requiredReservationStroops,
      ),
      remainingWalletUnits: policy.walletHourlyLimit - walletHourlyUsage - requestedQuotaUnits,
    },
  };
}
