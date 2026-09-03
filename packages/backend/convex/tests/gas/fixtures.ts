import {
  buildGasTestEnvelope,
  GAS_TEST_CONTRACT_ID,
  GAS_TEST_DESTINATION_KEYPAIR,
  GAS_TEST_OTHER_CONTRACT_ID,
  GAS_TEST_RELAYER_KEYPAIR,
  GAS_TEST_SOURCE_KEYPAIR,
} from "@repo/stellar/test-fixtures";

import { GAS_NETWORK, GAS_SUPPORTED_OPERATION } from "../../gas/types.ts";

const TEST_SOURCE_PUBLIC_KEY = GAS_TEST_SOURCE_KEYPAIR.publicKey();
const TEST_CONTRACT_ID = GAS_TEST_CONTRACT_ID;
const TEST_DESTINATION_PUBLIC_KEY = GAS_TEST_DESTINATION_KEYPAIR.publicKey();
const TEST_RELAYER_PUBLIC_KEY = GAS_TEST_RELAYER_KEYPAIR.publicKey();
const OTHER_TEST_CONTRACT_ID = GAS_TEST_OTHER_CONTRACT_ID;

type EnvelopeDecision = "accepted" | "rejected";
type EnvelopeRejectionReason =
  | "unsigned"
  | "wrong_network"
  | "classic_operation"
  | "multiple_operations"
  | "mixed_operations"
  | "fee_bump";
type EnvelopeTransactionCategory =
  | "soroban-invocation"
  | "classic-operation"
  | "multi-operation"
  | "mixed-operation"
  | "fee-bump";
type EnvelopeNetworkOutcome = "testnet" | "mainnet";

type EnvelopeFixture = Readonly<{
  id: string;
  decision: EnvelopeDecision;
  rejectionReason: EnvelopeRejectionReason | null;
  xdr: string;
  metadata: Readonly<{
    expectedSource: string;
    expectedTarget: string;
    expectedTransactionCategory: EnvelopeTransactionCategory;
    expectedOperation: typeof GAS_SUPPORTED_OPERATION | "payment" | "mixed" | "feeBump";
    expectedFeeStroops: string;
    expectedNetworkOutcome: EnvelopeNetworkOutcome;
  }>;
}>;

function envelopeFixture(fixture: EnvelopeFixture): EnvelopeFixture {
  return Object.freeze({
    ...fixture,
    metadata: Object.freeze(fixture.metadata),
  });
}

/** Deterministic envelopes are built in memory from public test labels. */
export const gasEnvelopeFixtures = Object.freeze([
  envelopeFixture({
    id: "gas-envelope-valid-testnet-soroban",
    decision: "accepted",
    rejectionReason: null,
    xdr: buildGasTestEnvelope({ kind: "valid", maxTime: "1788362232" }),
    metadata: {
      expectedSource: TEST_SOURCE_PUBLIC_KEY,
      expectedTarget: TEST_CONTRACT_ID,
      expectedTransactionCategory: "soroban-invocation",
      expectedOperation: GAS_SUPPORTED_OPERATION,
      expectedFeeStroops: "100",
      expectedNetworkOutcome: GAS_NETWORK,
    },
  }),
  envelopeFixture({
    id: "gas-envelope-unsigned-soroban",
    decision: "rejected",
    rejectionReason: "unsigned",
    xdr: buildGasTestEnvelope({ kind: "unsigned" }),
    metadata: {
      expectedSource: TEST_SOURCE_PUBLIC_KEY,
      expectedTarget: TEST_CONTRACT_ID,
      expectedTransactionCategory: "soroban-invocation",
      expectedOperation: GAS_SUPPORTED_OPERATION,
      expectedFeeStroops: "100",
      expectedNetworkOutcome: GAS_NETWORK,
    },
  }),
  envelopeFixture({
    id: "gas-envelope-mainnet-signed-soroban",
    decision: "rejected",
    rejectionReason: "wrong_network",
    xdr: buildGasTestEnvelope({ kind: "wrong_network" }),
    metadata: {
      expectedSource: TEST_SOURCE_PUBLIC_KEY,
      expectedTarget: TEST_CONTRACT_ID,
      expectedTransactionCategory: "soroban-invocation",
      expectedOperation: GAS_SUPPORTED_OPERATION,
      expectedFeeStroops: "100",
      expectedNetworkOutcome: "mainnet",
    },
  }),
  envelopeFixture({
    id: "gas-envelope-classic-payment",
    decision: "rejected",
    rejectionReason: "classic_operation",
    xdr: buildGasTestEnvelope({ kind: "classic" }),
    metadata: {
      expectedSource: TEST_SOURCE_PUBLIC_KEY,
      expectedTarget: TEST_DESTINATION_PUBLIC_KEY,
      expectedTransactionCategory: "classic-operation",
      expectedOperation: "payment",
      expectedFeeStroops: "100",
      expectedNetworkOutcome: GAS_NETWORK,
    },
  }),
  envelopeFixture({
    id: "gas-envelope-multi-soroban",
    decision: "rejected",
    rejectionReason: "multiple_operations",
    xdr: buildGasTestEnvelope({ kind: "multi" }),
    metadata: {
      expectedSource: TEST_SOURCE_PUBLIC_KEY,
      expectedTarget: TEST_CONTRACT_ID,
      expectedTransactionCategory: "multi-operation",
      expectedOperation: GAS_SUPPORTED_OPERATION,
      expectedFeeStroops: "200",
      expectedNetworkOutcome: GAS_NETWORK,
    },
  }),
  envelopeFixture({
    id: "gas-envelope-mixed-soroban-payment",
    decision: "rejected",
    rejectionReason: "mixed_operations",
    xdr: buildGasTestEnvelope({ kind: "mixed" }),
    metadata: {
      expectedSource: TEST_SOURCE_PUBLIC_KEY,
      expectedTarget: TEST_CONTRACT_ID,
      expectedTransactionCategory: "mixed-operation",
      expectedOperation: "mixed",
      expectedFeeStroops: "200",
      expectedNetworkOutcome: GAS_NETWORK,
    },
  }),
  envelopeFixture({
    id: "gas-envelope-fee-bump-soroban",
    decision: "rejected",
    rejectionReason: "fee_bump",
    xdr: buildGasTestEnvelope({ kind: "fee_bump" }),
    metadata: {
      expectedSource: TEST_SOURCE_PUBLIC_KEY,
      expectedTarget: TEST_CONTRACT_ID,
      expectedTransactionCategory: "fee-bump",
      expectedOperation: "feeBump",
      expectedFeeStroops: "200",
      expectedNetworkOutcome: GAS_NETWORK,
    },
  }),
] satisfies readonly EnvelopeFixture[]);

type MalformedInputCategory = "xdr" | "wallet" | "contract" | "transaction-hash";

type MalformedInputFixture = Readonly<{
  id: string;
  category: MalformedInputCategory;
  value: string;
}>;

/** Deliberately malformed values for future parser and normalization tests. */
export const gasMalformedInputFixtures = Object.freeze([
  Object.freeze({
    id: "gas-input-malformed-xdr-truncated",
    category: "xdr",
    value: "AAAA",
  }),
  Object.freeze({
    id: "gas-input-malformed-xdr-text",
    category: "xdr",
    value: "not-a-stellar-transaction-envelope",
  }),
  Object.freeze({
    id: "gas-input-malformed-wallet-prefix",
    category: "wallet",
    value: "GNOTASTELLARWALLET",
  }),
  Object.freeze({
    id: "gas-input-malformed-wallet-checksum",
    category: "wallet",
    value: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  }),
  Object.freeze({
    id: "gas-input-malformed-contract-prefix",
    category: "contract",
    value: "CNOTASTELLARCONTRACT",
  }),
  Object.freeze({
    id: "gas-input-malformed-transaction-hash-text",
    category: "transaction-hash",
    value: "not-a-transaction-hash",
  }),
  Object.freeze({
    id: "gas-input-malformed-transaction-hash-short-hex",
    category: "transaction-hash",
    value: "deadbeef",
  }),
] satisfies readonly MalformedInputFixture[]);

type PolicyBoundary =
  | "enabled"
  | "disabled"
  | "daily-cap-under"
  | "daily-cap-at"
  | "daily-cap-over"
  | "wallet-quota-under"
  | "wallet-quota-at"
  | "wallet-quota-over"
  | "allowlist-empty"
  | "allowlist-allowed"
  | "allowlist-disallowed"
  | "payment-access-independent";

type PolicyFixture = Readonly<{
  id: string;
  boundary: PolicyBoundary;
  network: typeof GAS_NETWORK;
  enabled: boolean;
  paymentAccessActive: boolean;
  dailyCapStroops: string;
  dailyReservedStroops: string;
  requestedReservationStroops: string;
  walletHourlyLimit: number;
  walletHourlyUsed: number;
  requestedWalletUnits: number;
  allowedContractIds: readonly string[];
}>;

function policyFixture(fixture: PolicyFixture): PolicyFixture {
  return Object.freeze({
    ...fixture,
    allowedContractIds: Object.freeze([...fixture.allowedContractIds]),
  });
}

/** Policy-state inputs only; no evaluator or production decision is asserted here. */
export const gasPolicyFixtures = Object.freeze([
  policyFixture({
    id: "gas-policy-enabled-testnet",
    boundary: "enabled",
    network: GAS_NETWORK,
    enabled: true,
    paymentAccessActive: true,
    dailyCapStroops: "1000",
    dailyReservedStroops: "0",
    requestedReservationStroops: "100",
    walletHourlyLimit: 3,
    walletHourlyUsed: 0,
    requestedWalletUnits: 1,
    allowedContractIds: [TEST_CONTRACT_ID],
  }),
  policyFixture({
    id: "gas-policy-disabled-testnet",
    boundary: "disabled",
    network: GAS_NETWORK,
    enabled: false,
    paymentAccessActive: true,
    dailyCapStroops: "1000",
    dailyReservedStroops: "0",
    requestedReservationStroops: "100",
    walletHourlyLimit: 3,
    walletHourlyUsed: 0,
    requestedWalletUnits: 1,
    allowedContractIds: [TEST_CONTRACT_ID],
  }),
  policyFixture({
    id: "gas-policy-daily-cap-under",
    boundary: "daily-cap-under",
    network: GAS_NETWORK,
    enabled: true,
    paymentAccessActive: true,
    dailyCapStroops: "1000",
    dailyReservedStroops: "400",
    requestedReservationStroops: "500",
    walletHourlyLimit: 3,
    walletHourlyUsed: 0,
    requestedWalletUnits: 1,
    allowedContractIds: [TEST_CONTRACT_ID],
  }),
  policyFixture({
    id: "gas-policy-daily-cap-at",
    boundary: "daily-cap-at",
    network: GAS_NETWORK,
    enabled: true,
    paymentAccessActive: true,
    dailyCapStroops: "1000",
    dailyReservedStroops: "500",
    requestedReservationStroops: "500",
    walletHourlyLimit: 3,
    walletHourlyUsed: 0,
    requestedWalletUnits: 1,
    allowedContractIds: [TEST_CONTRACT_ID],
  }),
  policyFixture({
    id: "gas-policy-daily-cap-over",
    boundary: "daily-cap-over",
    network: GAS_NETWORK,
    enabled: true,
    paymentAccessActive: true,
    dailyCapStroops: "1000",
    dailyReservedStroops: "501",
    requestedReservationStroops: "500",
    walletHourlyLimit: 3,
    walletHourlyUsed: 0,
    requestedWalletUnits: 1,
    allowedContractIds: [TEST_CONTRACT_ID],
  }),
  policyFixture({
    id: "gas-policy-wallet-quota-under",
    boundary: "wallet-quota-under",
    network: GAS_NETWORK,
    enabled: true,
    paymentAccessActive: true,
    dailyCapStroops: "1000",
    dailyReservedStroops: "0",
    requestedReservationStroops: "100",
    walletHourlyLimit: 3,
    walletHourlyUsed: 1,
    requestedWalletUnits: 1,
    allowedContractIds: [TEST_CONTRACT_ID],
  }),
  policyFixture({
    id: "gas-policy-wallet-quota-at",
    boundary: "wallet-quota-at",
    network: GAS_NETWORK,
    enabled: true,
    paymentAccessActive: true,
    dailyCapStroops: "1000",
    dailyReservedStroops: "0",
    requestedReservationStroops: "100",
    walletHourlyLimit: 3,
    walletHourlyUsed: 2,
    requestedWalletUnits: 1,
    allowedContractIds: [TEST_CONTRACT_ID],
  }),
  policyFixture({
    id: "gas-policy-wallet-quota-over",
    boundary: "wallet-quota-over",
    network: GAS_NETWORK,
    enabled: true,
    paymentAccessActive: true,
    dailyCapStroops: "1000",
    dailyReservedStroops: "0",
    requestedReservationStroops: "100",
    walletHourlyLimit: 3,
    walletHourlyUsed: 3,
    requestedWalletUnits: 1,
    allowedContractIds: [TEST_CONTRACT_ID],
  }),
  policyFixture({
    id: "gas-policy-allowlist-empty",
    boundary: "allowlist-empty",
    network: GAS_NETWORK,
    enabled: true,
    paymentAccessActive: true,
    dailyCapStroops: "1000",
    dailyReservedStroops: "0",
    requestedReservationStroops: "100",
    walletHourlyLimit: 3,
    walletHourlyUsed: 0,
    requestedWalletUnits: 1,
    allowedContractIds: [],
  }),
  policyFixture({
    id: "gas-policy-allowlist-allowed",
    boundary: "allowlist-allowed",
    network: GAS_NETWORK,
    enabled: true,
    paymentAccessActive: true,
    dailyCapStroops: "1000",
    dailyReservedStroops: "0",
    requestedReservationStroops: "100",
    walletHourlyLimit: 3,
    walletHourlyUsed: 0,
    requestedWalletUnits: 1,
    allowedContractIds: [TEST_CONTRACT_ID],
  }),
  policyFixture({
    id: "gas-policy-allowlist-disallowed",
    boundary: "allowlist-disallowed",
    network: GAS_NETWORK,
    enabled: true,
    paymentAccessActive: true,
    dailyCapStroops: "1000",
    dailyReservedStroops: "0",
    requestedReservationStroops: "100",
    walletHourlyLimit: 3,
    walletHourlyUsed: 0,
    requestedWalletUnits: 1,
    allowedContractIds: [OTHER_TEST_CONTRACT_ID],
  }),
  policyFixture({
    id: "gas-policy-payment-access-independent",
    boundary: "payment-access-independent",
    network: GAS_NETWORK,
    enabled: true,
    paymentAccessActive: false,
    dailyCapStroops: "1000",
    dailyReservedStroops: "0",
    requestedReservationStroops: "100",
    walletHourlyLimit: 3,
    walletHourlyUsed: 0,
    requestedWalletUnits: 1,
    allowedContractIds: [TEST_CONTRACT_ID],
  }),
] satisfies readonly PolicyFixture[]);

export const gasFixtureLifecycleStates = Object.freeze(["reserved", "rejected", "expired"]);

export const gasFixtureRelayerPublicKey = TEST_RELAYER_PUBLIC_KEY;
export const gasFixtureSourceWallet = TEST_SOURCE_PUBLIC_KEY;
export const gasFixtureContractId = TEST_CONTRACT_ID;
export const gasFixtureOtherContractId = OTHER_TEST_CONTRACT_ID;

/** Signed Testnet contract envelopes used to exercise the Convex-safe maxTime boundary. */
export const gasMaxTimeEnvelopeFixtures = Object.freeze({
  unbounded: buildGasTestEnvelope({ maxTime: undefined }),
  alreadyExpired: buildGasTestEnvelope({ maxTime: 1 }),
  earlier: buildGasTestEnvelope({ maxTime: "4102444800" }),
  later: buildGasTestEnvelope({ maxTime: "4102444801" }),
  unsafe: buildGasTestEnvelope({ maxTime: "9007199254741" }),
});
