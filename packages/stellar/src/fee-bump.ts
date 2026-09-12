import {
  FeeBumpTransaction,
  Keypair,
  Networks,
  Transaction,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";

import {
  parseTestnetSorobanTransactionEnvelope,
  TESTNET_TRANSACTION_ENVELOPE_MAX_XDR_BYTES,
  TestnetTransactionEnvelopeError,
  type TestnetSorobanTransactionFacts,
} from "./transaction-envelope.ts";
import { assertValidPublicKey, assertValidTransactionHash } from "./validation.ts";

export const TESTNET_FEE_BUMP_MIN_BASE_FEE_STROOPS = 100n;
export const TESTNET_FEE_BUMP_MAX_XDR_BYTES = TESTNET_TRANSACTION_ENVELOPE_MAX_XDR_BYTES;

const MAX_SIGNED_INT64 = 2n ** 63n - 1n;
const SINGLE_OPERATION_COUNT = 1n;

export const TESTNET_FEE_BUMP_ERROR_CODES = {
  invalidRequest: "invalid_request",
  invalidSignature: "invalid_signature",
  wrongNetwork: "wrong_network",
  unsupportedTransaction: "unsupported_transaction",
  invalidFee: "invalid_fee",
  feeOverflow: "fee_overflow",
  insufficientBaseFee: "insufficient_base_fee",
  feeCeilingExceeded: "fee_ceiling_exceeded",
  invalidSigner: "invalid_signer",
  signerFailure: "signer_failure",
} as const;

export type TestnetFeeBumpErrorCode =
  (typeof TESTNET_FEE_BUMP_ERROR_CODES)[keyof typeof TESTNET_FEE_BUMP_ERROR_CODES];

const TESTNET_FEE_BUMP_ERROR_MESSAGES: Record<TestnetFeeBumpErrorCode, string> = {
  invalid_request: "Invalid FeeBump request",
  invalid_signature: "Invalid inner transaction signature",
  wrong_network: "Inner transaction is signed for the wrong network",
  unsupported_transaction: "Unsupported inner transaction",
  invalid_fee: "Invalid FeeBump fee",
  fee_overflow: "FeeBump fee exceeds signed-int64 range",
  insufficient_base_fee: "FeeBump base fee is insufficient",
  fee_ceiling_exceeded: "FeeBump fee exceeds the approved ceiling",
  invalid_signer: "Invalid FeeBump signer response",
  signer_failure: "FeeBump signer unavailable",
};

export class TestnetFeeBumpError extends Error {
  readonly code: TestnetFeeBumpErrorCode;

  constructor(code: TestnetFeeBumpErrorCode) {
    super(TESTNET_FEE_BUMP_ERROR_MESSAGES[code]);
    this.name = "TestnetFeeBumpError";
    this.code = code;
  }
}

export type TestnetFeeBumpSigner = Readonly<{
  publicKey: string;
  sign(payload: Uint8Array): Uint8Array;
}>;

export type TestnetFeeBumpQuote = Readonly<{
  innerTransactionHash: string;
  innerMaxFeeStroops: bigint;
  innerInclusionFeeStroops: bigint;
  resourceFeeStroops: bigint;
  baseFeeStroops: bigint;
  outerMaxFeeStroops: bigint;
}>;

export type TestnetFeeBumpResult = Readonly<
  TestnetFeeBumpQuote & {
    signedOuterXdr: string;
    outerTransactionHash: string;
    feeSource: string;
  }
>;

type ParsedInnerTransaction = Readonly<{
  transaction: Transaction;
  facts: TestnetSorobanTransactionFacts;
  innerMaxFeeStroops: bigint;
  innerInclusionFeeStroops: bigint;
  resourceFeeStroops: bigint;
}>;

function reject(code: TestnetFeeBumpErrorCode): never {
  throw new TestnetFeeBumpError(code);
}

function parseNonnegativeInt64(value: unknown): bigint {
  if (typeof value !== "bigint" && typeof value !== "string") {
    return reject("invalid_fee");
  }

  const text = typeof value === "bigint" ? value.toString() : value;
  if (!/^(?:0|[1-9][0-9]*)$/.test(text)) {
    return reject("invalid_fee");
  }

  let parsed: bigint;
  try {
    parsed = BigInt(text);
  } catch {
    return reject("invalid_fee");
  }

  if (parsed > MAX_SIGNED_INT64) return reject("fee_overflow");
  return parsed;
}

function parseSignedInt64(value: unknown): bigint {
  if (typeof value !== "string" && typeof value !== "bigint") {
    return reject("invalid_fee");
  }

  const text = typeof value === "bigint" ? value.toString() : value;
  if (!/^-?(?:0|[1-9][0-9]*)$/.test(text)) {
    return reject("invalid_fee");
  }

  let parsed: bigint;
  try {
    parsed = BigInt(text);
  } catch {
    return reject("invalid_fee");
  }

  if (parsed < -MAX_SIGNED_INT64 - 1n || parsed > MAX_SIGNED_INT64) {
    return reject("fee_overflow");
  }

  return parsed;
}

function checkedAdd(left: bigint, right: bigint): bigint {
  if (left < 0n || right < 0n || left > MAX_SIGNED_INT64 - right) {
    return reject("fee_overflow");
  }

  return left + right;
}

function checkedMultiply(left: bigint, right: bigint): bigint {
  if (left < 0n || right < 0n || (right !== 0n && left > MAX_SIGNED_INT64 / right)) {
    return reject("fee_overflow");
  }

  return left * right;
}

function mapEnvelopeError(error: unknown): never {
  if (error instanceof TestnetTransactionEnvelopeError) {
    return reject(error.code);
  }

  return reject("invalid_request");
}

function resourceFeeStroops(transaction: Transaction): bigint {
  try {
    const sorobanData = transaction.toEnvelope().v1().tx().ext().value();
    if (sorobanData === undefined) return 0n;

    return parseSignedInt64(sorobanData.resourceFee().toString());
  } catch (error) {
    if (error instanceof TestnetFeeBumpError) throw error;
    return reject("invalid_request");
  }
}

function parseInnerTransaction(transactionXdr: string): ParsedInnerTransaction {
  let facts: TestnetSorobanTransactionFacts;
  try {
    facts = parseTestnetSorobanTransactionEnvelope(transactionXdr);
  } catch (error) {
    return mapEnvelopeError(error);
  }

  if (typeof transactionXdr !== "string") return reject("invalid_request");
  const normalizedXdr = transactionXdr.trim();

  let parsed: Transaction | FeeBumpTransaction;
  try {
    parsed = TransactionBuilder.fromXDR(normalizedXdr, Networks.TESTNET);
  } catch {
    return reject("invalid_request");
  }

  if (!(parsed instanceof Transaction)) return reject("unsupported_transaction");

  const envelope = parsed.toEnvelope();
  if (envelope.switch() !== xdr.EnvelopeType.envelopeTypeTx()) {
    return reject("unsupported_transaction");
  }

  const innerMaxFeeStroops = parseNonnegativeInt64(parsed.fee);
  const resourceFee = resourceFeeStroops(parsed);
  if (resourceFee < 0n || resourceFee > innerMaxFeeStroops) {
    return reject("invalid_fee");
  }

  const innerInclusionFeeTotal = innerMaxFeeStroops - resourceFee;
  if (BigInt(parsed.operations.length) !== SINGLE_OPERATION_COUNT) {
    return reject("unsupported_transaction");
  }

  if (innerInclusionFeeTotal % SINGLE_OPERATION_COUNT !== 0n) {
    return reject("invalid_fee");
  }

  if (parsed.toXDR() !== normalizedXdr) return reject("invalid_request");

  return Object.freeze({
    transaction: parsed,
    facts,
    innerMaxFeeStroops,
    innerInclusionFeeStroops: innerInclusionFeeTotal / SINGLE_OPERATION_COUNT,
    resourceFeeStroops: resourceFee,
  });
}

function quoteParsedInner(
  parsed: ParsedInnerTransaction,
  requestedBaseFeeStroops?: bigint,
): TestnetFeeBumpQuote {
  let baseFeeStroops = parsed.innerInclusionFeeStroops;
  if (baseFeeStroops < TESTNET_FEE_BUMP_MIN_BASE_FEE_STROOPS) {
    baseFeeStroops = TESTNET_FEE_BUMP_MIN_BASE_FEE_STROOPS;
  }

  if (requestedBaseFeeStroops !== undefined) {
    const requested = parseNonnegativeInt64(requestedBaseFeeStroops);
    if (
      requested < TESTNET_FEE_BUMP_MIN_BASE_FEE_STROOPS ||
      requested < parsed.innerInclusionFeeStroops
    ) {
      return reject("insufficient_base_fee");
    }
    baseFeeStroops = requested;
  }

  const outerMaxFeeStroops = checkedAdd(
    checkedMultiply(baseFeeStroops, 2n),
    parsed.resourceFeeStroops,
  );

  return Object.freeze({
    innerTransactionHash: parsed.facts.transactionHash,
    innerMaxFeeStroops: parsed.innerMaxFeeStroops,
    innerInclusionFeeStroops: parsed.innerInclusionFeeStroops,
    resourceFeeStroops: parsed.resourceFeeStroops,
    baseFeeStroops,
    outerMaxFeeStroops,
  });
}

function feeSourcePublicKey(signer: TestnetFeeBumpSigner): string {
  try {
    if (
      typeof signer !== "object" ||
      signer === null ||
      typeof signer.publicKey !== "string" ||
      typeof signer.sign !== "function"
    ) {
      return reject("invalid_signer");
    }

    return assertValidPublicKey(signer.publicKey);
  } catch (error) {
    if (error instanceof TestnetFeeBumpError) throw error;
    return reject("invalid_signer");
  }
}

function validateApprovedCeiling(approvedCeilingStroops: bigint): bigint {
  return parseNonnegativeInt64(approvedCeilingStroops);
}

function sameXdrBytes(left: string, right: string): boolean {
  try {
    return Buffer.from(left, "base64").equals(Buffer.from(right, "base64"));
  } catch {
    return false;
  }
}

/**
 * Quote a Testnet FeeBump for a signed, single-operation Soroban envelope.
 * The returned fee values are exact stroops and are safe for signed-int64 XDR.
 */
export function quoteTestnetFeeBump(
  transactionXdr: string,
  inclusionBaseFeeStroops?: bigint,
): TestnetFeeBumpQuote {
  return quoteParsedInner(parseInnerTransaction(transactionXdr), inclusionBaseFeeStroops);
}

/**
 * Build and sign a transient Testnet FeeBump without changing the signed inner
 * envelope. Authorization of the approved ceiling belongs to the caller's
 * trusted execution boundary.
 */
export function buildTestnetFeeBumpTransaction(
  transactionXdr: string,
  baseFeeStroops: bigint,
  approvedTotalCeilingStroops: bigint,
  signer: TestnetFeeBumpSigner,
): TestnetFeeBumpResult {
  const parsed = parseInnerTransaction(transactionXdr);
  const quote = quoteParsedInner(parsed, baseFeeStroops);
  const approvedCeiling = validateApprovedCeiling(approvedTotalCeilingStroops);
  if (quote.outerMaxFeeStroops > approvedCeiling) {
    return reject("fee_ceiling_exceeded");
  }

  const feeSource = feeSourcePublicKey(signer);
  const feeSourceKeypair = Keypair.fromPublicKey(feeSource);

  let feeBump: FeeBumpTransaction;
  try {
    feeBump = TransactionBuilder.buildFeeBumpTransaction(
      feeSource,
      quote.baseFeeStroops.toString(),
      parsed.transaction,
      Networks.TESTNET,
    );
  } catch {
    return reject("invalid_fee");
  }

  const actualOuterFeeStroops = parseNonnegativeInt64(feeBump.fee);
  if (
    actualOuterFeeStroops !== quote.outerMaxFeeStroops ||
    actualOuterFeeStroops > approvedCeiling ||
    feeBump.feeSource !== feeSource ||
    !sameXdrBytes(feeBump.innerTransaction.toXDR(), transactionXdr.trim())
  ) {
    return reject("invalid_request");
  }

  const unsignedOuterXdr = feeBump.toXDR();
  if (new TextEncoder().encode(unsignedOuterXdr).byteLength > TESTNET_FEE_BUMP_MAX_XDR_BYTES) {
    return reject("invalid_request");
  }

  const outerHash = feeBump.hash();
  let signature: Uint8Array;
  try {
    const candidate = signer.sign(new Uint8Array(outerHash));
    if (!(candidate instanceof Uint8Array)) return reject("invalid_signer");
    signature = new Uint8Array(candidate);
  } catch (error) {
    if (error instanceof TestnetFeeBumpError) throw error;
    return reject("signer_failure");
  }

  if (signature.byteLength !== 64) return reject("invalid_signer");

  let validSignature = false;
  try {
    validSignature = feeSourceKeypair.verify(outerHash, Buffer.from(signature));
  } catch {
    return reject("invalid_signer");
  }
  if (!validSignature) return reject("invalid_signer");

  try {
    feeBump.addDecoratedSignature(
      new xdr.DecoratedSignature({
        hint: feeSourceKeypair.signatureHint(),
        signature: Buffer.from(signature),
      }),
    );
  } catch {
    return reject("invalid_signer");
  }

  const signedOuterXdr = feeBump.toXDR();
  if (new TextEncoder().encode(signedOuterXdr).byteLength > TESTNET_FEE_BUMP_MAX_XDR_BYTES) {
    return reject("invalid_request");
  }

  let reparsed: Transaction | FeeBumpTransaction;
  try {
    reparsed = TransactionBuilder.fromXDR(signedOuterXdr, Networks.TESTNET);
  } catch {
    return reject("invalid_signer");
  }

  if (!(reparsed instanceof FeeBumpTransaction)) return reject("invalid_signer");

  const reparsedOuterHash = assertValidTransactionHash(reparsed.hash().toString("hex"));
  const reparsedInnerHash = assertValidTransactionHash(
    reparsed.innerTransaction.hash().toString("hex"),
  );
  if (
    reparsedOuterHash !== assertValidTransactionHash(outerHash.toString("hex")) ||
    reparsedInnerHash !== quote.innerTransactionHash ||
    reparsed.fee !== quote.outerMaxFeeStroops.toString() ||
    reparsed.feeSource !== feeSource ||
    reparsed.signatures.length !== 1 ||
    !sameXdrBytes(reparsed.innerTransaction.toXDR(), transactionXdr.trim())
  ) {
    return reject("invalid_signer");
  }

  const [decoratedSignature] = reparsed.signatures;
  if (!decoratedSignature) return reject("invalid_signer");
  if (!Buffer.from(decoratedSignature.hint()).equals(feeSourceKeypair.signatureHint())) {
    return reject("invalid_signer");
  }

  let reparsedSignatureValid = false;
  try {
    reparsedSignatureValid = feeSourceKeypair.verify(
      reparsed.hash(),
      Buffer.from(decoratedSignature.signature()),
    );
  } catch {
    return reject("invalid_signer");
  }
  if (!reparsedSignatureValid) return reject("invalid_signer");

  return Object.freeze({
    ...quote,
    signedOuterXdr,
    outerTransactionHash: reparsedOuterHash,
    feeSource,
  });
}
