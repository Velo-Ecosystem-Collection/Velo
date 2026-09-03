import {
  assertValidContractId,
  assertValidPublicKey,
  assertValidTransactionHash,
} from "@repo/stellar/validation";

import type { GasNetwork } from "./types";

import {
  GAS_MAX_ALLOWED_CONTRACT_IDS,
  GAS_MAX_STROOPS,
  GAS_MIN_STROOPS,
  GAS_NETWORK,
} from "./types";

const CANONICAL_UNSIGNED_DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const MAX_STROOP_DIGITS = GAS_MAX_STROOPS.toString().length;
export const GAS_MAX_TIME_SECONDS = Math.floor(Number.MAX_SAFE_INTEGER / 1_000);
export const GAS_MAX_REQUEST_ID_BYTES = 128;

const INVALID_STROOP_AMOUNT = "Invalid stroop amount";
const INVALID_STROOP_VALUE = "Invalid stroop value";
const STROOP_VALUE_OUT_OF_RANGE = "Stroop value is outside the supported range";
const STROOP_SUM_OUT_OF_RANGE = "Stroop sum exceeds the supported range";
const INVALID_WALLET_ADDRESS = "Invalid Stellar wallet address";
const INVALID_CONTRACT_ID = "Invalid Stellar contract ID";
const INVALID_TRANSACTION_HASH = "Invalid transaction hash";
const INVALID_NETWORK = "Gas Station network must be testnet";
const INVALID_CONTRACT_ALLOWLIST = "Invalid contract allowlist";
const CONTRACT_ALLOWLIST_TOO_LARGE = "Contract allowlist is too large";
const INVALID_RELAYER_PUBLIC_KEY = "Invalid relayer public key";
const INVALID_NON_NEGATIVE_SAFE_INTEGER = "Invalid non-negative safe integer";

/** Validate a non-negative JavaScript safe integer at a numeric boundary. */
export function assertNonNegativeSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${INVALID_NON_NEGATIVE_SAFE_INTEGER}: ${label}`);
  }

  return value;
}

/** Normalize and bound the opaque server-issued reservation/request identifier. */
export function normalizeGasRequestId(value: string): string {
  if (typeof value !== "string") {
    throw new Error("Invalid Gas request ID");
  }

  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    new TextEncoder().encode(normalized).byteLength > GAS_MAX_REQUEST_ID_BYTES
  ) {
    throw new Error("Invalid Gas request ID");
  }

  return normalized;
}

/** Validate a transaction maxTime that will later cross Convex as milliseconds. */
export function assertValidInnerMaxTime(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > GAS_MAX_TIME_SECONDS) {
    throw new Error("Invalid inner max time");
  }

  return value;
}

/** Parse a trimmed canonical unsigned decimal stroop amount. */
export function parseStroopAmount(value: string): bigint {
  if (typeof value !== "string") {
    throw new Error(INVALID_STROOP_AMOUNT);
  }

  const normalized = value.trim();
  if (!CANONICAL_UNSIGNED_DECIMAL.test(normalized)) {
    throw new Error(INVALID_STROOP_AMOUNT);
  }

  if (normalized.length > MAX_STROOP_DIGITS) {
    throw new Error(STROOP_VALUE_OUT_OF_RANGE);
  }

  const amount = BigInt(normalized);
  if (amount < GAS_MIN_STROOPS || amount > GAS_MAX_STROOPS) {
    throw new Error(STROOP_VALUE_OUT_OF_RANGE);
  }

  return amount;
}

/** Validate an existing bigint stroop value within Convex's signed int64 range. */
export function assertValidStroopValue(value: bigint): bigint {
  if (typeof value !== "bigint") {
    throw new Error(INVALID_STROOP_VALUE);
  }

  if (value < GAS_MIN_STROOPS || value > GAS_MAX_STROOPS) {
    throw new Error(STROOP_VALUE_OUT_OF_RANGE);
  }

  return value;
}

/** Add two valid stroop values without exceeding Convex's signed int64 maximum. */
export function addStroopValues(left: bigint, right: bigint): bigint {
  const validLeft = assertValidStroopValue(left);
  const validRight = assertValidStroopValue(right);

  if (validLeft > GAS_MAX_STROOPS - validRight) {
    throw new Error(STROOP_SUM_OUT_OF_RANGE);
  }

  return validLeft + validRight;
}

/** Normalize and checksum-validate a Stellar wallet public address. */
export function normalizeWalletAddress(address: string): string {
  if (typeof address !== "string") {
    throw new Error(INVALID_WALLET_ADDRESS);
  }

  try {
    return assertValidPublicKey(address);
  } catch {
    throw new Error(INVALID_WALLET_ADDRESS);
  }
}

/** Normalize and checksum-validate the public key of a managed relayer. */
export function normalizeRelayerPublicKey(publicKey: string): string {
  if (typeof publicKey !== "string") {
    throw new Error(INVALID_RELAYER_PUBLIC_KEY);
  }

  try {
    return assertValidPublicKey(publicKey);
  } catch {
    throw new Error(INVALID_RELAYER_PUBLIC_KEY);
  }
}

/** Normalize and checksum-validate a Stellar contract ID. */
export function normalizeContractId(contractId: string): string {
  if (typeof contractId !== "string") {
    throw new Error(INVALID_CONTRACT_ID);
  }

  try {
    return assertValidContractId(contractId);
  } catch {
    throw new Error(INVALID_CONTRACT_ID);
  }
}

/** Normalize and validate a Stellar transaction hash. */
export function normalizeTransactionHash(hash: string): string {
  if (typeof hash !== "string") {
    throw new Error(INVALID_TRANSACTION_HASH);
  }

  try {
    return assertValidTransactionHash(hash);
  } catch {
    throw new Error(INVALID_TRANSACTION_HASH);
  }
}

/** Accept only the canonical Testnet network literal. */
export function normalizeGasNetwork(network: string): GasNetwork {
  if (network !== GAS_NETWORK) {
    throw new Error(INVALID_NETWORK);
  }

  return network;
}

/** Normalize, validate, and deduplicate a bounded contract allowlist. */
export function normalizeContractAllowlist(contractIds: readonly string[]): string[] {
  if (!Array.isArray(contractIds)) {
    throw new Error(INVALID_CONTRACT_ALLOWLIST);
  }

  if (contractIds.length > GAS_MAX_ALLOWED_CONTRACT_IDS) {
    throw new Error(CONTRACT_ALLOWLIST_TOO_LARGE);
  }

  const normalizedContractIds = contractIds.map((contractId) => normalizeContractId(contractId));
  return Array.from(new Set(normalizedContractIds));
}
