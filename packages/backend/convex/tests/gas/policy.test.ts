/// <reference types="vite/client" />

import { expect, test } from "vitest";

import {
  evaluateGasPolicy,
  type GasPolicyEvaluationInput,
  type GasPolicyEvaluationResult,
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
import { gasEnvelopeFixtures, gasPolicyFixtures } from "./fixtures.ts";

type GasPolicyFixture = (typeof gasPolicyFixtures)[number];
type GasPolicyBoundary = GasPolicyFixture["boundary"];
type ExpectedPolicyOutcome = {
  decisionCode: (typeof GAS_DECISION_CODES)[keyof typeof GAS_DECISION_CODES];
  rejectionCode: (typeof GAS_REJECTION_CODES)[keyof typeof GAS_REJECTION_CODES] | null;
};

function envelopeFixtureById(id: string) {
  const fixture = gasEnvelopeFixtures.find((candidate) => candidate.id === id);
  if (!fixture) {
    throw new Error(`Missing gas envelope fixture: ${id}`);
  }

  return fixture;
}

function policyFixtureByBoundary(boundary: GasPolicyBoundary): GasPolicyFixture {
  const fixture = gasPolicyFixtures.find((candidate) => candidate.boundary === boundary);
  if (!fixture) {
    throw new Error(`Missing gas policy fixture: ${boundary}`);
  }

  return fixture;
}

function onlyContractId(fixture: GasPolicyFixture): string {
  const [contractId] = fixture.allowedContractIds;
  if (contractId === undefined) {
    throw new Error(`Gas policy fixture has no contract ID: ${fixture.id}`);
  }

  return contractId;
}

const validEnvelopeFixture = envelopeFixtureById("gas-envelope-valid-testnet-soroban");
const targetContractId = validEnvelopeFixture.metadata.expectedTarget;
const otherContractId = onlyContractId(policyFixtureByBoundary("allowlist-disallowed"));

const basePolicyFixture = policyFixtureByBoundary("enabled");

function policySnapshot(fixture: GasPolicyFixture): GasPolicySnapshot {
  return Object.freeze({
    enabled: fixture.enabled,
    network: fixture.network,
    dailyCapStroops: BigInt(fixture.dailyCapStroops),
    dailyReservedStroops: BigInt(fixture.dailyReservedStroops),
    walletHourlyLimit: fixture.walletHourlyLimit,
    allowedContractIds: fixture.allowedContractIds,
  });
}

const basePolicy = policySnapshot(basePolicyFixture);

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

/**
 * Policy fixtures store the complete requested reservation. Convert that
 * boundary value back to the evaluator's inner maximum fee input so the
 * under/at/over cases remain exact after the D1 overhead is applied.
 */
function inputForPolicyFixture(
  fixture: GasPolicyFixture,
  overrides: Partial<GasPolicyEvaluationInput> = {},
): GasPolicyEvaluationInput {
  return input({
    policy: policySnapshot(fixture),
    network: fixture.network,
    innerMaxFeeStroops: BigInt(fixture.requestedReservationStroops) - GAS_FEE_OVERHEAD_STROOPS,
    walletHourlyUsage: fixture.walletHourlyUsed,
    requestedQuotaUnits: fixture.requestedWalletUnits,
    ...overrides,
  });
}

const expectedPolicyOutcomes = {
  enabled: {
    decisionCode: GAS_DECISION_CODES.reserved,
    rejectionCode: null,
  },
  disabled: {
    decisionCode: GAS_DECISION_CODES.rejected,
    rejectionCode: GAS_REJECTION_CODES.policyDisabled,
  },
  "daily-cap-under": {
    decisionCode: GAS_DECISION_CODES.reserved,
    rejectionCode: null,
  },
  "daily-cap-at": {
    decisionCode: GAS_DECISION_CODES.reserved,
    rejectionCode: null,
  },
  "daily-cap-over": {
    decisionCode: GAS_DECISION_CODES.rejected,
    rejectionCode: GAS_REJECTION_CODES.dailyCapExceeded,
  },
  "wallet-quota-under": {
    decisionCode: GAS_DECISION_CODES.reserved,
    rejectionCode: null,
  },
  "wallet-quota-at": {
    decisionCode: GAS_DECISION_CODES.reserved,
    rejectionCode: null,
  },
  "wallet-quota-over": {
    decisionCode: GAS_DECISION_CODES.rejected,
    rejectionCode: GAS_REJECTION_CODES.walletRateLimited,
  },
  "allowlist-empty": {
    decisionCode: GAS_DECISION_CODES.rejected,
    rejectionCode: GAS_REJECTION_CODES.contractNotWhitelisted,
  },
  "allowlist-allowed": {
    decisionCode: GAS_DECISION_CODES.reserved,
    rejectionCode: null,
  },
  "allowlist-disallowed": {
    decisionCode: GAS_DECISION_CODES.rejected,
    rejectionCode: GAS_REJECTION_CODES.contractNotWhitelisted,
  },
  "payment-access-independent": {
    decisionCode: GAS_DECISION_CODES.reserved,
    rejectionCode: null,
  },
} satisfies Record<GasPolicyBoundary, ExpectedPolicyOutcome>;

function expectedPolicyReason(
  fixture: GasPolicyFixture,
  rejectionCode: ExpectedPolicyOutcome["rejectionCode"],
): GasPolicyEvaluationResult["reason"] {
  switch (rejectionCode) {
    case null:
      return {
        nextDailyReservedStroops:
          BigInt(fixture.dailyReservedStroops) + BigInt(fixture.requestedReservationStroops),
        remainingWalletUnits:
          fixture.walletHourlyLimit - fixture.walletHourlyUsed - fixture.requestedWalletUnits,
      };
    case GAS_REJECTION_CODES.policyDisabled:
      return null;
    case GAS_REJECTION_CODES.contractNotWhitelisted:
      return { targetContractId };
    case GAS_REJECTION_CODES.dailyCapExceeded:
      return {
        dailyCapStroops: BigInt(fixture.dailyCapStroops),
        dailyReservedStroops: BigInt(fixture.dailyReservedStroops),
      };
    case GAS_REJECTION_CODES.walletRateLimited:
      return {
        walletHourlyLimit: fixture.walletHourlyLimit,
        walletHourlyUsage: fixture.walletHourlyUsed,
      };
    default:
      throw new Error(`Unexpected policy fixture rejection: ${rejectionCode}`);
  }
}

test.each(gasPolicyFixtures.map((fixture) => [fixture.id, fixture] as const))(
  "returns the complete typed result for %s",
  (_id, fixture) => {
    const innerMaxFeeStroops =
      BigInt(fixture.requestedReservationStroops) - GAS_FEE_OVERHEAD_STROOPS;
    const expectedOutcome = expectedPolicyOutcomes[fixture.boundary];
    const result = evaluateGasPolicy(inputForPolicyFixture(fixture));

    expect(result).toEqual({
      ...expectedOutcome,
      requiredReservationStroops: innerMaxFeeStroops + GAS_FEE_OVERHEAD_STROOPS,
      reason: expectedPolicyReason(fixture, expectedOutcome.rejectionCode),
    });
  },
);

test("reserves the exact inner maximum fee plus the named D1 overhead", () => {
  const innerMaxFeeStroops = BigInt(validEnvelopeFixture.metadata.expectedFeeStroops);
  const result = evaluateGasPolicy(
    input({
      innerMaxFeeStroops,
      walletHourlyUsage: 2,
    }),
  );

  expect(GAS_FEE_OVERHEAD_STROOPS).toBe(100n);
  expect(result).toEqual({
    decisionCode: GAS_DECISION_CODES.reserved,
    rejectionCode: null,
    requiredReservationStroops: innerMaxFeeStroops + GAS_FEE_OVERHEAD_STROOPS,
    reason: {
      nextDailyReservedStroops: innerMaxFeeStroops + GAS_FEE_OVERHEAD_STROOPS,
      remainingWalletUnits: 0,
    },
  });
});

const classicPaymentEnvelope = envelopeFixtureById("gas-envelope-classic-payment");
const mixedOperationEnvelope = envelopeFixtureById("gas-envelope-mixed-soroban-payment");
const multiOperationEnvelope = envelopeFixtureById("gas-envelope-multi-soroban");
const feeBumpEnvelope = envelopeFixtureById("gas-envelope-fee-bump-soroban");

const unsupportedOperationCases = [
  {
    label: "classic payment operation",
    fixture: classicPaymentEnvelope,
    operation: classicPaymentEnvelope.metadata.expectedOperation,
    targetContractIds: [classicPaymentEnvelope.metadata.expectedTarget],
    observedTargetCount: 1,
  },
  {
    label: "mixed operation",
    fixture: mixedOperationEnvelope,
    operation: mixedOperationEnvelope.metadata.expectedOperation,
    targetContractIds: [mixedOperationEnvelope.metadata.expectedTarget],
    observedTargetCount: 1,
  },
  {
    label: "FeeBump operation",
    fixture: feeBumpEnvelope,
    operation: feeBumpEnvelope.metadata.expectedOperation,
    targetContractIds: [feeBumpEnvelope.metadata.expectedTarget],
    observedTargetCount: 1,
  },
  {
    label: "missing target",
    fixture: validEnvelopeFixture,
    operation: validEnvelopeFixture.metadata.expectedOperation,
    targetContractIds: [],
    observedTargetCount: 0,
  },
  {
    label: "multiple targets",
    fixture: multiOperationEnvelope,
    operation: multiOperationEnvelope.metadata.expectedOperation,
    targetContractIds: [targetContractId, targetContractId],
    observedTargetCount: 2,
  },
] as const;

test.each(unsupportedOperationCases.map((scenario) => [scenario.label, scenario] as const))(
  "rejects %s with the unsupported-transaction result",
  (_label, scenario) => {
    const innerMaxFeeStroops = BigInt(scenario.fixture.metadata.expectedFeeStroops);
    const result = evaluateGasPolicy(
      input({
        innerMaxFeeStroops,
        operation: scenario.operation,
        targetContractIds: scenario.targetContractIds,
      }),
    );

    expect(result).toEqual({
      decisionCode: GAS_DECISION_CODES.rejected,
      rejectionCode: GAS_REJECTION_CODES.unsupportedTransaction,
      requiredReservationStroops: innerMaxFeeStroops + GAS_FEE_OVERHEAD_STROOPS,
      reason: {
        expectedOperation: GAS_SUPPORTED_OPERATION,
        observedTargetCount: scenario.observedTargetCount,
      },
    });
  },
);

test("rejects a missing policy with a stable, bounded result", () => {
  const result = evaluateGasPolicy(input({ policy: null }));

  expect(result).toEqual({
    decisionCode: GAS_DECISION_CODES.rejected,
    rejectionCode: GAS_REJECTION_CODES.policyDisabled,
    requiredReservationStroops: 200n,
    reason: null,
  });
});

test("rejects a non-Testnet policy or request before policy target checks", () => {
  const mainnetEnvelope = envelopeFixtureById("gas-envelope-mainnet-signed-soroban");
  const innerMaxFeeStroops = BigInt(mainnetEnvelope.metadata.expectedFeeStroops);
  const result = evaluateGasPolicy(
    input({
      network: mainnetEnvelope.metadata.expectedNetworkOutcome,
      innerMaxFeeStroops,
    }),
  );

  expect(result).toEqual({
    decisionCode: GAS_DECISION_CODES.rejected,
    rejectionCode: GAS_REJECTION_CODES.wrongNetwork,
    requiredReservationStroops: innerMaxFeeStroops + GAS_FEE_OVERHEAD_STROOPS,
    reason: { expectedNetwork: GAS_NETWORK },
  });
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
