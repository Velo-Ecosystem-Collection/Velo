import { GAS_TEST_SOURCE_KEYPAIR, keypairForLabel } from "@repo/stellar/test-fixtures";
import {
  Account,
  Asset,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { expect, test } from "vitest";

import {
  buildOwnerWithdrawalConsent,
  buildOwnerFundingTransaction,
  calculateGasSpendableBalance,
  digestGasWithdrawalConsent,
  GAS_FUNDING_MIN_CREATE_ACCOUNT_STROOPS,
  GasFundingTransactionError,
  validateManagedWithdrawalTransaction,
  validateOwnerFundingTransaction,
  validateOwnerWithdrawalConsent,
} from "../../gas/funding_utils";

const DESTINATION = keypairForLabel("gas-funding-destination").publicKey();
const OTHER_DESTINATION = keypairForLabel("gas-funding-other-destination").publicKey();

function signXdr(xdr: string, signer = GAS_TEST_SOURCE_KEYPAIR): string {
  const transaction = TransactionBuilder.fromXDR(xdr, Networks.TESTNET) as Transaction;
  transaction.sign(signer);
  return transaction.toXDR();
}

test("withdrawal consent binds owner, deployment, project, relayer, amount, nonce, network, and expiry", async () => {
  const relayer = keypairForLabel("gas-withdrawal-relayer");
  const facts = {
    deploymentId: "dev:gas-custody",
    projectId: "project-test-id",
    relayerPublicKey: relayer.publicKey(),
    ownerWallet: GAS_TEST_SOURCE_KEYPAIR.publicKey(),
    amountStroops: "12345678",
    nonce: "11e1d7e8-9d8d-49ed-8c75-c0e413a265cc",
    expiresAt: 1_800_000_000_000,
  };
  const digest = await digestGasWithdrawalConsent(facts);
  const prepared = buildOwnerWithdrawalConsent({
    sourceAccount: new Account(facts.ownerWallet, "100"),
    sourceWallet: facts.ownerWallet,
    digest,
  });
  const signed = signXdr(prepared.transactionXdr);
  expect(
    validateOwnerWithdrawalConsent(signed, {
      sourceWallet: facts.ownerWallet,
      digest,
      preparedTransactionHash: prepared.transactionHash,
    }),
  ).toBe(prepared.transactionHash);

  expect(() =>
    validateOwnerWithdrawalConsent(signed, {
      sourceWallet: facts.ownerWallet,
      digest: "f".repeat(64),
      preparedTransactionHash: prepared.transactionHash,
    }),
  ).toThrowError("intent_mismatch");
  expect(() =>
    validateOwnerWithdrawalConsent(signed, {
      sourceWallet: facts.ownerWallet,
      digest,
      preparedTransactionHash: "e".repeat(64),
    }),
  ).toThrowError("intent_mismatch");
  expect(() =>
    validateOwnerWithdrawalConsent(
      signXdr(prepared.transactionXdr, keypairForLabel("wrong-owner")),
      {
        sourceWallet: facts.ownerWallet,
        digest,
        preparedTransactionHash: prepared.transactionHash,
      },
    ),
  ).toThrowError(GasFundingTransactionError);

  const changedDeployment = await digestGasWithdrawalConsent({
    ...facts,
    deploymentId: "prod:gas-custody",
  });
  expect(changedDeployment).not.toBe(digest);
});

test("managed withdrawal payment is validated against the owner destination and exact amount", () => {
  const relayer = keypairForLabel("gas-withdrawal-source");
  const owner = GAS_TEST_SOURCE_KEYPAIR.publicKey();
  const builder = new TransactionBuilder(new Account(relayer.publicKey(), "100"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  });
  builder.addOperation(
    Operation.payment({
      destination: owner,
      asset: Asset.native(),
      amount: "1.2345678",
    }),
  );
  const tx = builder.setTimeout(300).build();
  tx.sign(relayer);
  const validated = validateManagedWithdrawalTransaction(tx.toXDR(), {
    relayerPublicKey: relayer.publicKey(),
    ownerWallet: owner,
    amountStroops: "12345678",
  });
  expect(validated.transactionHash).toBe(tx.hash().toString("hex"));
  expect(() =>
    validateManagedWithdrawalTransaction(tx.toXDR(), {
      relayerPublicKey: relayer.publicKey(),
      ownerWallet: OTHER_DESTINATION,
      amountStroops: "12345678",
    }),
  ).toThrowError("intent_mismatch");
});

test("spendable withdrawal balance preserves ledger reserve, liabilities, commitments, and fee", () => {
  expect(
    calculateGasSpendableBalance({
      ledgerBalanceStroops: 100_000_000n,
      minimumReserveStroops: 10_000_000n,
      nativeSellingLiabilitiesStroops: 5_000_000n,
      outstandingGasCommitmentsStroops: 20_000_000n,
      withdrawalFeeStroops: 100n,
    }),
  ).toBe(64_999_900n);
  expect(
    calculateGasSpendableBalance({
      ledgerBalanceStroops: 15_000_000n,
      minimumReserveStroops: 10_000_000n,
      nativeSellingLiabilitiesStroops: 4_000_000n,
      outstandingGasCommitmentsStroops: 1_000_000n,
    }),
  ).toBe(0n);
});

function expectedIntent(
  prepared: ReturnType<typeof buildOwnerFundingTransaction>,
  operation: "create_account" | "payment",
  amountStroops: string,
  destination = DESTINATION,
) {
  return {
    operation,
    sourceWallet: GAS_TEST_SOURCE_KEYPAIR.publicKey(),
    destinationPublicKey: destination,
    amountStroops,
    feeStroops: prepared.feeStroops,
    preparedTransactionHash: prepared.transactionHash,
  };
}

test("prepares and verifies a signed CreateAccount transaction for an absent relayer", () => {
  const prepared = buildOwnerFundingTransaction({
    sourceAccount: new Account(GAS_TEST_SOURCE_KEYPAIR.publicKey(), "100"),
    sourceWallet: GAS_TEST_SOURCE_KEYPAIR.publicKey(),
    destinationPublicKey: DESTINATION,
    amountStroops: GAS_FUNDING_MIN_CREATE_ACCOUNT_STROOPS,
    destinationExists: false,
  });
  expect(prepared.operation).toBe("create_account");

  const signedXdr = signXdr(prepared.transactionXdr);
  expect(
    validateOwnerFundingTransaction(
      signedXdr,
      expectedIntent(prepared, "create_account", "10000000"),
    ),
  ).toMatchObject({
    transactionHash: prepared.transactionHash,
  });
});

test("prepares a native XLM Payment for an existing relayer account", () => {
  const prepared = buildOwnerFundingTransaction({
    sourceAccount: new Account(GAS_TEST_SOURCE_KEYPAIR.publicKey(), "101"),
    sourceWallet: GAS_TEST_SOURCE_KEYPAIR.publicKey(),
    destinationPublicKey: DESTINATION,
    amountStroops: 12_345_678n,
    destinationExists: true,
  });
  expect(prepared.operation).toBe("payment");

  const signedXdr = signXdr(prepared.transactionXdr);
  expect(
    validateOwnerFundingTransaction(signedXdr, expectedIntent(prepared, "payment", "12345678")),
  ).toMatchObject({
    transactionHash: prepared.transactionHash,
  });
});

test("rejects a signature from another wallet and any prepared-intent substitution", () => {
  const prepared = buildOwnerFundingTransaction({
    sourceAccount: new Account(GAS_TEST_SOURCE_KEYPAIR.publicKey(), "102"),
    sourceWallet: GAS_TEST_SOURCE_KEYPAIR.publicKey(),
    destinationPublicKey: DESTINATION,
    amountStroops: 20_000_000n,
    destinationExists: true,
  });
  const wrongSignature = signXdr(
    prepared.transactionXdr,
    keypairForLabel("gas-funding-wrong-owner"),
  );
  expect(() =>
    validateOwnerFundingTransaction(
      wrongSignature,
      expectedIntent(prepared, "payment", "20000000"),
    ),
  ).toThrowError(GasFundingTransactionError);

  const signed = signXdr(prepared.transactionXdr);
  expect(() =>
    validateOwnerFundingTransaction(signed, {
      ...expectedIntent(prepared, "payment", "20000000"),
      destinationPublicKey: OTHER_DESTINATION,
    }),
  ).toThrowError("intent_mismatch");
  expect(() =>
    validateOwnerFundingTransaction(signed, expectedIntent(prepared, "payment", "20000001")),
  ).toThrowError("intent_mismatch");
});

test("rejects malformed, unsigned, and underfunded account-creation transactions", () => {
  const prepared = buildOwnerFundingTransaction({
    sourceAccount: new Account(GAS_TEST_SOURCE_KEYPAIR.publicKey(), "103"),
    sourceWallet: GAS_TEST_SOURCE_KEYPAIR.publicKey(),
    destinationPublicKey: DESTINATION,
    amountStroops: 10_000_000n,
    destinationExists: false,
  });
  expect(() =>
    validateOwnerFundingTransaction(
      prepared.transactionXdr,
      expectedIntent(prepared, "create_account", "10000000"),
    ),
  ).toThrowError("intent_mismatch");
  expect(() =>
    validateOwnerFundingTransaction(
      "not-xdr",
      expectedIntent(prepared, "create_account", "10000000"),
    ),
  ).toThrowError("invalid_request");
  expect(() =>
    buildOwnerFundingTransaction({
      sourceAccount: new Account(GAS_TEST_SOURCE_KEYPAIR.publicKey(), "104"),
      sourceWallet: GAS_TEST_SOURCE_KEYPAIR.publicKey(),
      destinationPublicKey: DESTINATION,
      amountStroops: GAS_FUNDING_MIN_CREATE_ACCOUNT_STROOPS - 1n,
      destinationExists: false,
    }),
  ).toThrowError("invalid_request");
});
