import {
  Address,
  FeeBumpTransaction,
  Keypair,
  Networks,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

import {
  assertValidContractId,
  assertValidPublicKey,
  assertValidTransactionHash,
} from "./validation.ts";

export const TESTNET_TRANSACTION_ENVELOPE_ERROR_CODES = {
  invalidRequest: "invalid_request",
  invalidSignature: "invalid_signature",
  wrongNetwork: "wrong_network",
  unsupportedTransaction: "unsupported_transaction",
} as const;

export type TestnetTransactionEnvelopeErrorCode =
  (typeof TESTNET_TRANSACTION_ENVELOPE_ERROR_CODES)[keyof typeof TESTNET_TRANSACTION_ENVELOPE_ERROR_CODES];

const TESTNET_TRANSACTION_ENVELOPE_ERROR_MESSAGES: Record<
  TestnetTransactionEnvelopeErrorCode,
  string
> = {
  invalid_request: "Invalid transaction envelope request",
  invalid_signature: "Invalid transaction envelope signature",
  wrong_network: "Transaction envelope is signed for the wrong network",
  unsupported_transaction: "Unsupported transaction envelope",
};

export class TestnetTransactionEnvelopeError extends Error {
  readonly code: TestnetTransactionEnvelopeErrorCode;

  constructor(code: TestnetTransactionEnvelopeErrorCode) {
    super(TESTNET_TRANSACTION_ENVELOPE_ERROR_MESSAGES[code]);
    this.name = "TestnetTransactionEnvelopeError";
    this.code = code;
  }
}

export type TestnetSorobanTransactionFacts = Readonly<{
  sourceWallet: string;
  transactionHash: string;
  innerMaxFeeStroops: bigint;
  targetContractIds: readonly [string];
  innerMaxTime?: number;
}>;

const MAX_SIGNED_INT64 = 2n ** 63n - 1n;
const MAX_CONVEX_TIMESTAMP_SECONDS = BigInt(Math.floor(Number.MAX_SAFE_INTEGER / 1_000));
export const TESTNET_TRANSACTION_ENVELOPE_MAX_XDR_BYTES = 64 * 1_024;

function reject(code: TestnetTransactionEnvelopeErrorCode): never {
  throw new TestnetTransactionEnvelopeError(code);
}

function isCanonicalBase64(value: string): boolean {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return false;
  }

  return Buffer.from(value, "base64").toString("base64") === value;
}

function parseEnvelope(transactionXdr: string): Transaction | FeeBumpTransaction {
  if (typeof transactionXdr !== "string" || transactionXdr.trim() === "") {
    return reject("invalid_request");
  }

  const normalizedXdr = transactionXdr.trim();
  if (
    new TextEncoder().encode(normalizedXdr).byteLength > TESTNET_TRANSACTION_ENVELOPE_MAX_XDR_BYTES
  ) {
    return reject("invalid_request");
  }
  if (!isCanonicalBase64(normalizedXdr)) {
    return reject("invalid_request");
  }

  try {
    return TransactionBuilder.fromXDR(normalizedXdr, Networks.TESTNET);
  } catch {
    return reject("invalid_request");
  }
}

function contractTarget(transaction: Transaction): string {
  try {
    if (transaction.operations.length !== 1) {
      return reject("unsupported_transaction");
    }

    const [operation] = transaction.operations;
    if (!operation || operation.type !== "invokeHostFunction") {
      return reject("unsupported_transaction");
    }

    if (operation.source !== undefined && operation.source !== transaction.source) {
      return reject("unsupported_transaction");
    }

    if (operation.func.switch().name !== "hostFunctionTypeInvokeContract") {
      return reject("unsupported_transaction");
    }

    const contractAddress = operation.func.invokeContract().contractAddress();
    if (contractAddress.switch().name !== "scAddressTypeContract") {
      return reject("unsupported_transaction");
    }

    try {
      return assertValidContractId(Address.fromScAddress(contractAddress).toString());
    } catch {
      return reject("invalid_request");
    }
  } catch (error) {
    if (error instanceof TestnetTransactionEnvelopeError) {
      throw error;
    }

    return reject("invalid_request");
  }
}

function sourceWallet(transaction: Transaction): string {
  try {
    return assertValidPublicKey(transaction.source);
  } catch {
    return reject("invalid_request");
  }
}

function innerMaximumFee(transaction: Transaction): bigint {
  const fee = transaction.fee;
  if (!/^(?:0|[1-9][0-9]*)$/.test(fee)) {
    return reject("invalid_request");
  }

  try {
    const parsedFee = BigInt(fee);
    if (parsedFee < 0n || parsedFee > MAX_SIGNED_INT64) {
      return reject("invalid_request");
    }

    return parsedFee;
  } catch {
    return reject("invalid_request");
  }
}

function innerMaximumTime(transaction: Transaction): number | undefined {
  const maxTime = transaction.timeBounds?.maxTime;
  if (maxTime === undefined || maxTime === "0") return undefined;
  if (!/^(?:0|[1-9][0-9]*)$/.test(maxTime)) {
    return reject("invalid_request");
  }

  try {
    const parsedMaxTime = BigInt(maxTime);
    if (parsedMaxTime === 0n) return undefined;
    if (parsedMaxTime > MAX_CONVEX_TIMESTAMP_SECONDS) {
      return reject("invalid_request");
    }

    return Number(parsedMaxTime);
  } catch {
    return reject("invalid_request");
  }
}

function transactionHash(transaction: Transaction): string {
  try {
    return assertValidTransactionHash(transaction.hash().toString("hex"));
  } catch {
    return reject("invalid_request");
  }
}

function hasValidSourceSignature(transaction: Transaction, source: string): boolean {
  if (transaction.signatures.length !== 1) {
    return false;
  }

  try {
    const keypair = Keypair.fromPublicKey(source);
    const expectedHint = Buffer.from(keypair.rawPublicKey()).subarray(-4);
    const [decoratedSignature] = transaction.signatures;
    if (!decoratedSignature || !Buffer.from(decoratedSignature.hint()).equals(expectedHint)) {
      return false;
    }

    const signatureBaseHash = transaction.hash();
    const signature = Buffer.from(decoratedSignature.signature());
    return signature.length === 64 && keypair.verify(signatureBaseHash, signature);
  } catch {
    return false;
  }
}

function hasValidPublicNetworkSignature(transaction: Transaction, source: string): boolean {
  try {
    const publicNetworkTransaction = TransactionBuilder.fromXDR(
      transaction.toXDR(),
      Networks.PUBLIC,
    );

    return (
      publicNetworkTransaction instanceof Transaction &&
      publicNetworkTransaction.source === source &&
      hasValidSourceSignature(publicNetworkTransaction, source)
    );
  } catch {
    return false;
  }
}

/**
 * Validates a signed Testnet Soroban invocation and derives facts from its XDR.
 * Only the returned facts are safe for downstream policy decisions.
 */
export function parseTestnetSorobanTransactionEnvelope(
  transactionXdr: string,
): TestnetSorobanTransactionFacts {
  const parsedEnvelope = parseEnvelope(transactionXdr);
  if (parsedEnvelope instanceof FeeBumpTransaction || "innerTransaction" in parsedEnvelope) {
    return reject("unsupported_transaction");
  }

  if (!(parsedEnvelope instanceof Transaction)) {
    return reject("invalid_request");
  }

  const targetContractId = contractTarget(parsedEnvelope);
  const source = sourceWallet(parsedEnvelope);
  const fee = innerMaximumFee(parsedEnvelope);
  const maxTime = innerMaximumTime(parsedEnvelope);
  const hash = transactionHash(parsedEnvelope);

  if (!hasValidSourceSignature(parsedEnvelope, source)) {
    if (hasValidPublicNetworkSignature(parsedEnvelope, source)) {
      return reject("wrong_network");
    }

    return reject("invalid_signature");
  }

  return Object.freeze({
    sourceWallet: source,
    transactionHash: hash,
    innerMaxFeeStroops: fee,
    targetContractIds: Object.freeze([targetContractId] as const),
    ...(maxTime === undefined ? {} : { innerMaxTime: maxTime }),
  });
}
