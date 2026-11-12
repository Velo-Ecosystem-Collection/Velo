import { StrKey } from "@stellar/stellar-sdk";

const TRANSACTION_HASH_PATTERN = /^[0-9a-f]{64}$/i;
const METADATA_HASH_PATTERN = /^[0-9a-f]{64}$/i;

export function normalizePublicKey(publicKey: string) {
  return publicKey.trim().toUpperCase();
}

export function normalizeContractId(contractId: string) {
  return contractId.trim().toUpperCase();
}

export function normalizeTransactionHash(hash: string) {
  return hash.trim().toLowerCase();
}

export function assertValidPublicKey(publicKey: string) {
  const normalized = normalizePublicKey(publicKey);

  if (!StrKey.isValidEd25519PublicKey(normalized)) {
    throw new Error("Invalid Stellar public key");
  }

  return normalized;
}

/** Validate an address used as a Stellar identity (classic account or contract account). */
export function assertValidAccountAddress(address: string) {
  const normalized = address.trim().toUpperCase();

  if (!StrKey.isValidEd25519PublicKey(normalized) && !StrKey.isValidContract(normalized)) {
    throw new Error("Invalid Stellar account address");
  }

  return normalized;
}

export function assertValidContractId(contractId: string) {
  const normalized = normalizeContractId(contractId);

  if (!StrKey.isValidContract(normalized)) {
    throw new Error("Invalid Stellar contract ID");
  }

  return normalized;
}

export function assertValidTransactionHash(hash: string) {
  const normalized = normalizeTransactionHash(hash);

  if (!TRANSACTION_HASH_PATTERN.test(normalized)) {
    throw new Error("Invalid transaction hash");
  }

  return normalized;
}

export function assertValidMetadataHash(hash: string) {
  const normalized = normalizeTransactionHash(hash);

  if (!METADATA_HASH_PATTERN.test(normalized)) {
    throw new Error("Metadata hash must be a 32-byte hex SHA-256 digest");
  }

  return normalized;
}
