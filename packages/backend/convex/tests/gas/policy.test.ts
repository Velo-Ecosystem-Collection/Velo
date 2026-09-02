/// <reference types="vite/client" />

import { expect, test } from "vitest";

import {
  evaluateGasPolicy,
  type GasPolicyEvaluationInput,
  type GasPolicySnapshot,
} from "../../gas/policy.ts";
import {
  GAS_DECISION_CODES,
  GAS_FEE_OVERHEAD_STROOPS,
  GAS_MAX_STROOPS,
  GAS_NETWORK,
  GAS_REJECTION_CODES,
  GAS_SUPPORTED_OPERATION,
} from "../../gas/types.ts";
import { gasEnvelopeFixtures } from "./fixtures.ts";

const targetContractId = gasEnvelopeFixtures[0].metadata.expectedTarget;
const otherContractId = "CA7QYNF7SOWQ3LLQ6ZMPD6PTQVVBYV3R6DR2ICR6UBZMWRXZPPTD3FVO";

const basePolicy: GasPolicySnapshot = Object.freeze({
  enabled: true,
  network: GAS_NETWORK,
  dailyCapStroops: 1_000n,
  dailyReservedStroops: 0n,
  walletHourlyLimit: 3,
  allowedContractIds: Object.freeze([targetContractId]),
});

function input(overrides: Partial<GasPolicyEvaluationInput> = {}): GasPolicyEvaluationInput {
  return {
    policy: basePolicy,
    network: GAS_NETWORK,
    operation: GAS_SUPPORTED_OPERATION,
    targetContractIds: [targetContractId],
    innerMaxFeeStroops: 100n,
    walletHourlyUsage: 0,
    requestedQuotaUnits: 1,
    ...overrides,
  };
}

test("reserves the exact inner maximum fee plus the named D1 overhead", () => {
  const result = evaluateGasPolicy(
    input({
      innerMaxFeeStroops: 900n,
      walletHourlyUsage: 2,
    }),
  );

  expect(GAS_FEE_OVERHEAD_STROOPS).toBe(100n);
  expect(result).toEqual({
    decisionCode: GAS_DECISION_CODES.reserved,
    rejectionCode: null,
    requiredReservationStroops: 1_000n,
    reason: {
      nextDailyReservedStroops: 1_000n,
      remainingWalletUnits: 0,
    },
  });
});

test("allows reservations exactly at the daily cap and wallet quota", () => {
  const result = evaluateGasPolicy(
    input({
      innerMaxFeeStroops: 400n,
      walletHourlyUsage: 2,
      requestedQuotaUnits: 1,
      policy: Object.freeze({
        ...basePolicy,
        dailyReservedStroops: 500n,
      }),
    }),
  );

  expect(result.decisionCode).toBe(GAS_DECISION_CODES.reserved);
  expect(result.rejectionCode).toBeNull();
  expect(result.reason).toEqual({
    nextDailyReservedStroops: 1_000n,
    remainingWalletUnits: 0,
  });
});

test.each([
  ["missing policy", input({ policy: null }), GAS_REJECTION_CODES.policyDisabled, null],
  [
    "disabled policy",
    input({ policy: Object.freeze({ ...basePolicy, enabled: false }) }),
    GAS_REJECTION_CODES.policyDisabled,
    null,
  ],
  [
    "wrong network",
    input({ network: "mainnet" }),
    GAS_REJECTION_CODES.wrongNetwork,
    { expectedNetwork: GAS_NETWORK },
  ],
  [
    "unsupported operation",
    input({ operation: "payment" }),
    GAS_REJECTION_CODES.unsupportedTransaction,
    { expectedOperation: GAS_SUPPORTED_OPERATION, observedTargetCount: 1 },
  ],
  [
    "wrong target cardinality",
    input({ targetContractIds: [] }),
    GAS_REJECTION_CODES.unsupportedTransaction,
    { expectedOperation: GAS_SUPPORTED_OPERATION, observedTargetCount: 0 },
  ],
  [
    "non-whitelisted contract",
    input({ targetContractIds: [otherContractId] }),
    GAS_REJECTION_CODES.contractNotWhitelisted,
    { targetContractId: otherContractId },
  ],
  [
    "daily cap",
    input({
      policy: Object.freeze({ ...basePolicy, dailyReservedStroops: 901n }),
    }),
    GAS_REJECTION_CODES.dailyCapExceeded,
    { dailyCapStroops: 1_000n, dailyReservedStroops: 901n },
  ],
  [
    "wallet quota",
    input({ walletHourlyUsage: 3 }),
    GAS_REJECTION_CODES.walletRateLimited,
    { walletHourlyLimit: 3, walletHourlyUsage: 3 },
  ],
] as const)("returns bounded data for %s", (_name, request, rejectionCode, reason) => {
  const result = evaluateGasPolicy(request);

  expect(result).toEqual({
    decisionCode: GAS_DECISION_CODES.rejected,
    rejectionCode,
    requiredReservationStroops: 200n,
    reason,
  });
});

test("fails closed for an empty allowlist", () => {
  const result = evaluateGasPolicy(
    input({ policy: Object.freeze({ ...basePolicy, allowedContractIds: [] }) }),
  );

  expect(result.decisionCode).toBe(GAS_DECISION_CODES.rejected);
  expect(result.rejectionCode).toBe(GAS_REJECTION_CODES.contractNotWhitelisted);
  expect(result.reason).toEqual({ targetContractId });
});

test("applies the security-first rejection precedence", () => {
  const policy = Object.freeze({
    ...basePolicy,
    dailyReservedStroops: 901n,
    allowedContractIds: Object.freeze([otherContractId]),
  });

  expect(
    evaluateGasPolicy(
      input({
        policy,
        network: "mainnet",
        operation: "payment",
        targetContractIds: [],
        walletHourlyUsage: 3,
      }),
    ).rejectionCode,
  ).toBe(GAS_REJECTION_CODES.wrongNetwork);

  expect(
    evaluateGasPolicy(
      input({
        policy,
        operation: "payment",
        targetContractIds: [],
        walletHourlyUsage: 3,
      }),
    ).rejectionCode,
  ).toBe(GAS_REJECTION_CODES.unsupportedTransaction);

  expect(evaluateGasPolicy(input({ policy, walletHourlyUsage: 3 })).rejectionCode).toBe(
    GAS_REJECTION_CODES.contractNotWhitelisted,
  );

  expect(
    evaluateGasPolicy(
      input({
        policy: Object.freeze({ ...basePolicy, dailyReservedStroops: 901n }),
        walletHourlyUsage: 3,
      }),
    ).rejectionCode,
  ).toBe(GAS_REJECTION_CODES.dailyCapExceeded);
});

test("is deterministic and does not mutate frozen policy or transaction facts", () => {
  const allowedContractIds = Object.freeze([targetContractId]);
  const targetContractIds = Object.freeze([targetContractId]);
  const policy = Object.freeze({ ...basePolicy, allowedContractIds });
  const request = Object.freeze({
    ...input({ policy, targetContractIds }),
  });

  const first = evaluateGasPolicy(request);
  const second = evaluateGasPolicy(request);

  expect(second).toEqual(first);
  expect(request).toEqual({
    policy,
    network: GAS_NETWORK,
    operation: GAS_SUPPORTED_OPERATION,
    targetContractIds,
    innerMaxFeeStroops: 100n,
    walletHourlyUsage: 0,
    requestedQuotaUnits: 1,
  });
  expect(policy.allowedContractIds).toEqual([targetContractId]);
});

test("throws for invalid numeric invariants instead of returning policy denials", () => {
  const invalidRequests: GasPolicyEvaluationInput[] = [
    input({ innerMaxFeeStroops: -1n }),
    input({ innerMaxFeeStroops: GAS_MAX_STROOPS }),
    input({ walletHourlyUsage: -1 }),
    input({ walletHourlyUsage: Number.NaN }),
    input({ walletHourlyUsage: Number.MAX_SAFE_INTEGER + 1 }),
    input({ requestedQuotaUnits: 0 }),
    input({ requestedQuotaUnits: -1 }),
    input({ requestedQuotaUnits: 1.5 }),
    input({ policy: Object.freeze({ ...basePolicy, dailyCapStroops: -1n }) }),
    input({ policy: Object.freeze({ ...basePolicy, dailyReservedStroops: GAS_MAX_STROOPS + 1n }) }),
    input({
      policy: Object.freeze({ ...basePolicy, walletHourlyLimit: Number.POSITIVE_INFINITY }),
    }),
  ];

  for (const request of invalidRequests) {
    expect(() => evaluateGasPolicy(request)).toThrow();
  }
});
