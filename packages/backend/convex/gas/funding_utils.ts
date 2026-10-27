import {
  Asset,
  FeeBumpTransaction,
  Keypair,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
  type Account,
} from "@stellar/stellar-sdk";

export const GAS_FUNDING_FEE_STROOPS = 100n;
export const GAS_FUNDING_MIN_CREATE_ACCOUNT_STROOPS = 10_000_000n;
export const GAS_FUNDING_INTENT_TTL_MS = 10 * 60 * 1_000;
export const GAS_FUNDING_MAX_XDR_BYTES = 64 * 1024;
export const GAS_WITHDRAWAL_CONSENT_TTL_MS = 5 * 60 * 1_000;
export const GAS_WITHDRAWAL_FEE_STROOPS = 100n;
const STROOPS_PER_XLM = 10_000_000n;
const WITHDRAWAL_CONSENT_OPERATION_NAME = "velo-gas-withdrawal-v1";

export function calculateGasSpendableBalance(options: {
  ledgerBalanceStroops: bigint;
  minimumReserveStroops: bigint;
  nativeSellingLiabilitiesStroops: bigint;
  outstandingGasCommitmentsStroops: bigint;
  withdrawalFeeStroops?: bigint;
}): bigint {
  const values = [
    options.ledgerBalanceStroops,
    options.minimumReserveStroops,
    options.nativeSellingLiabilitiesStroops,
    options.outstandingGasCommitmentsStroops,
    options.withdrawalFeeStroops ?? GAS_WITHDRAWAL_FEE_STROOPS,
  ];
  if (values.some((value) => value < 0n)) throw new GasFundingTransactionError("invalid_request");
  const spendable =
    options.ledgerBalanceStroops -
    options.minimumReserveStroops -
    options.nativeSellingLiabilitiesStroops -
    options.outstandingGasCommitmentsStroops -
    (options.withdrawalFeeStroops ?? GAS_WITHDRAWAL_FEE_STROOPS);
  return spendable > 0n ? spendable : 0n;
}

export type GasFundingOperation = "create_account" | "payment";

export type GasFundingExpectedIntent = Readonly<{
  operation: GasFundingOperation;
  sourceWallet: string;
  destinationPublicKey: string;
  amountStroops: string;
  feeStroops: string;
  preparedTransactionHash: string;
}>;

export type GasWithdrawalConsentFacts = Readonly<{
  deploymentId: string;
  projectId: string;
  relayerPublicKey: string;
  ownerWallet: string;
  amountStroops: string;
  nonce: string;
  expiresAt: number;
}>;

export class GasFundingTransactionError extends Error {
  constructor(readonly code: "invalid_request" | "intent_mismatch" | "invalid_signature") {
    super(`Gas funding transaction rejected: ${code}`);
    this.name = "GasFundingTransactionError";
  }
}

export async function digestGasWithdrawalConsent(
  facts: GasWithdrawalConsentFacts,
): Promise<string> {
  const canonical = JSON.stringify([
    "velo-gas-withdrawal-v1",
    facts.deploymentId,
    facts.projectId,
    "testnet",
    facts.relayerPublicKey,
    facts.ownerWallet,
    facts.amountStroops,
    facts.nonce,
    facts.expiresAt,
  ]);
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function buildOwnerWithdrawalConsent(options: {
  sourceAccount: Account;
  sourceWallet: string;
  digest: string;
}): { transactionHash: string; transactionXdr: string } {
  if (!/^[a-f0-9]{64}$/.test(options.digest)) {
    throw new GasFundingTransactionError("invalid_request");
  }
  const builder = new TransactionBuilder(options.sourceAccount, {
    fee: GAS_WITHDRAWAL_FEE_STROOPS.toString(),
    networkPassphrase: Networks.TESTNET,
  });
  builder.addOperation(
    Operation.manageData({
      name: WITHDRAWAL_CONSENT_OPERATION_NAME,
      value: Buffer.from(options.digest, "hex"),
    }),
  );
  const transaction = builder.setTimeout(300).build();
  if (transaction.source !== options.sourceWallet) {
    throw new GasFundingTransactionError("invalid_request");
  }
  return {
    transactionHash: transaction.hash().toString("hex"),
    transactionXdr: transaction.toXDR(),
  };
}

export function validateOwnerWithdrawalConsent(
  transactionXdr: string,
  expected: {
    sourceWallet: string;
    digest: string;
    preparedTransactionHash: string;
  },
): string {
  if (
    transactionXdr.trim() === "" ||
    new TextEncoder().encode(transactionXdr).byteLength > GAS_FUNDING_MAX_XDR_BYTES ||
    !/^[a-f0-9]{64}$/.test(expected.digest)
  ) {
    throw new GasFundingTransactionError("invalid_request");
  }
  let transaction: Transaction | FeeBumpTransaction;
  try {
    transaction = TransactionBuilder.fromXDR(transactionXdr.trim(), Networks.TESTNET);
  } catch {
    throw new GasFundingTransactionError("invalid_request");
  }
  if (
    transaction instanceof FeeBumpTransaction ||
    !(transaction instanceof Transaction) ||
    transaction.operations.length !== 1 ||
    transaction.signatures.length !== 1
  ) {
    throw new GasFundingTransactionError("intent_mismatch");
  }
  const operation = transaction.operations[0];
  const transactionHash = transaction.hash().toString("hex");
  const signature = transaction.signatures[0];
  let owner: Keypair;
  try {
    owner = Keypair.fromPublicKey(expected.sourceWallet);
  } catch {
    throw new GasFundingTransactionError("intent_mismatch");
  }
  if (
    !signature ||
    signature.hint().toString("hex") !== owner.signatureHint().toString("hex") ||
    !owner.verify(Buffer.from(transaction.hash()), Buffer.from(signature.signature()))
  ) {
    throw new GasFundingTransactionError("invalid_signature");
  }
  if (
    transaction.source !== expected.sourceWallet ||
    transaction.fee !== GAS_WITHDRAWAL_FEE_STROOPS.toString() ||
    transactionHash !== expected.preparedTransactionHash ||
    operation?.source !== undefined ||
    operation?.type !== "manageData" ||
    operation.name !== WITHDRAWAL_CONSENT_OPERATION_NAME ||
    !Buffer.isBuffer(operation.value) ||
    operation.value.toString("hex") !== expected.digest
  ) {
    throw new GasFundingTransactionError("intent_mismatch");
  }
  return transactionHash;
}

export function validateManagedWithdrawalTransaction(
  transactionXdr: string,
  expected: { relayerPublicKey: string; ownerWallet: string; amountStroops: string },
): { transactionHash: string; transaction: Transaction } {
  let transaction: Transaction | FeeBumpTransaction;
  try {
    transaction = TransactionBuilder.fromXDR(transactionXdr, Networks.TESTNET);
  } catch {
    throw new GasFundingTransactionError("invalid_request");
  }
  if (
    transaction instanceof FeeBumpTransaction ||
    !(transaction instanceof Transaction) ||
    transaction.operations.length !== 1 ||
    transaction.signatures.length !== 1
  ) {
    throw new GasFundingTransactionError("intent_mismatch");
  }
  const relayer = Keypair.fromPublicKey(expected.relayerPublicKey);
  const signature = transaction.signatures[0];
  const operation = transaction.operations[0];
  const transactionHash = transaction.hash().toString("hex");
  if (
    !signature ||
    signature.hint().toString("hex") !== relayer.signatureHint().toString("hex") ||
    !relayer.verify(Buffer.from(transaction.hash()), Buffer.from(signature.signature()))
  ) {
    throw new GasFundingTransactionError("invalid_signature");
  }
  if (
    transaction.source !== expected.relayerPublicKey ||
    transaction.fee !== GAS_WITHDRAWAL_FEE_STROOPS.toString() ||
    operation?.source !== undefined ||
    operation?.type !== "payment" ||
    operation.destination !== expected.ownerWallet ||
    !operation.asset.isNative() ||
    stroopsToAmount(operation.amount) !== expected.amountStroops
  ) {
    throw new GasFundingTransactionError("intent_mismatch");
  }
  return { transactionHash, transaction };
}

export function stroopsToXlm(stroops: bigint): string {
  const whole = stroops / STROOPS_PER_XLM;
  const remainder = stroops % STROOPS_PER_XLM;
  if (remainder === 0n) return whole.toString();
  return `${whole}.${remainder.toString().padStart(7, "0").replace(/0+$/, "")}`;
}

export function buildOwnerFundingTransaction(options: {
  sourceAccount: Account;
  sourceWallet: string;
  destinationPublicKey: string;
  amountStroops: bigint;
  destinationExists: boolean;
}): {
  operation: GasFundingOperation;
  feeStroops: string;
  transactionHash: string;
  transactionXdr: string;
} {
  if (
    options.amountStroops <= 0n ||
    (!options.destinationExists && options.amountStroops < GAS_FUNDING_MIN_CREATE_ACCOUNT_STROOPS)
  ) {
    throw new GasFundingTransactionError("invalid_request");
  }
  const operation: GasFundingOperation = options.destinationExists ? "payment" : "create_account";
  const builder = new TransactionBuilder(options.sourceAccount, {
    fee: GAS_FUNDING_FEE_STROOPS.toString(),
    networkPassphrase: Networks.TESTNET,
  });
  if (operation === "create_account") {
    builder.addOperation(
      Operation.createAccount({
        destination: options.destinationPublicKey,
        startingBalance: stroopsToXlm(options.amountStroops),
      }),
    );
  } else {
    builder.addOperation(
      Operation.payment({
        destination: options.destinationPublicKey,
        asset: Asset.native(),
        amount: stroopsToXlm(options.amountStroops),
      }),
    );
  }
  const transaction = builder.setTimeout(300).build();
  return {
    operation,
    feeStroops: transaction.fee,
    transactionHash: transaction.hash().toString("hex"),
    transactionXdr: transaction.toXDR(),
  };
}

/** Validate owner-signed funding XDR against the exact prepared Testnet intent. */
export function validateOwnerFundingTransaction(
  transactionXdr: string,
  expected: GasFundingExpectedIntent,
): { transactionHash: string; transaction: Transaction } {
  if (
    transactionXdr.trim() === "" ||
    new TextEncoder().encode(transactionXdr).byteLength > GAS_FUNDING_MAX_XDR_BYTES
  ) {
    throw new GasFundingTransactionError("invalid_request");
  }

  let transaction: Transaction | FeeBumpTransaction;
  try {
    transaction = TransactionBuilder.fromXDR(transactionXdr.trim(), Networks.TESTNET);
  } catch {
    throw new GasFundingTransactionError("invalid_request");
  }
  if (
    transaction instanceof FeeBumpTransaction ||
    !(transaction instanceof Transaction) ||
    transaction.operations.length !== 1 ||
    transaction.signatures.length !== 1
  ) {
    throw new GasFundingTransactionError("intent_mismatch");
  }

  let owner: Keypair;
  try {
    owner = Keypair.fromPublicKey(expected.sourceWallet);
  } catch {
    throw new GasFundingTransactionError("intent_mismatch");
  }
  const transactionHash = transaction.hash().toString("hex");
  const signature = transaction.signatures[0];
  if (
    !signature ||
    signature.hint().toString("hex") !== owner.signatureHint().toString("hex") ||
    !owner.verify(Buffer.from(transaction.hash()), Buffer.from(signature.signature()))
  ) {
    throw new GasFundingTransactionError("invalid_signature");
  }

  if (
    transaction.source !== expected.sourceWallet ||
    transaction.fee !== expected.feeStroops ||
    transactionHash !== expected.preparedTransactionHash
  ) {
    throw new GasFundingTransactionError("intent_mismatch");
  }

  const operation = transaction.operations[0];
  if (!operation || operation.source !== undefined) {
    throw new GasFundingTransactionError("intent_mismatch");
  }
  if (expected.operation === "create_account") {
    if (
      operation.type !== "createAccount" ||
      operation.destination !== expected.destinationPublicKey ||
      stroopsToAmount(operation.startingBalance) !== expected.amountStroops
    ) {
      throw new GasFundingTransactionError("intent_mismatch");
    }
  } else {
    if (
      operation.type !== "payment" ||
      operation.destination !== expected.destinationPublicKey ||
      !operation.asset.isNative() ||
      stroopsToAmount(operation.amount) !== expected.amountStroops
    ) {
      throw new GasFundingTransactionError("intent_mismatch");
    }
  }
  return { transactionHash, transaction };
}

function stroopsToAmount(amount: string): string {
  const [whole, fraction = ""] = amount.split(".");
  if (!/^\d+$/.test(whole ?? "") || !/^\d{1,7}$/.test(fraction)) {
    throw new GasFundingTransactionError("intent_mismatch");
  }
  return (BigInt(whole ?? "0") * STROOPS_PER_XLM + BigInt(fraction.padEnd(7, "0"))).toString();
}
