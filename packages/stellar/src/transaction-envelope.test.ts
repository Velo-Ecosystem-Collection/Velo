import assert from "node:assert/strict";
import test from "node:test";

import {
  Address,
  Account,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
  TimeoutInfinite,
  xdr,
} from "@stellar/stellar-sdk";

import {
  buildGasTestEnvelope,
  GAS_TEST_CONTRACT_ID,
  GAS_TEST_SOURCE_KEYPAIR,
  keypairForLabel,
} from "./test-fixtures.ts";
import {
  parseTestnetSorobanTransactionEnvelope,
  TESTNET_TRANSACTION_ENVELOPE_MAX_XDR_BYTES,
  TestnetTransactionEnvelopeError,
  type TestnetTransactionEnvelopeErrorCode,
} from "./transaction-envelope.ts";

const VALID_TESTNET_XDR = buildGasTestEnvelope({ kind: "valid", maxTime: "1788362232" });
const UNSIGNED_TESTNET_XDR = buildGasTestEnvelope({ kind: "unsigned" });
const PUBLIC_NETWORK_XDR = buildGasTestEnvelope({ kind: "wrong_network" });
const SOURCE_PUBLIC_KEY = GAS_TEST_SOURCE_KEYPAIR.publicKey();
const CONTRACT_ID = GAS_TEST_CONTRACT_ID;
const CONSTRUCTED_SOURCE = GAS_TEST_SOURCE_KEYPAIR;
const VALID_TRANSACTION_HASH = new Transaction(VALID_TESTNET_XDR, Networks.TESTNET)
  .hash()
  .toString("hex");

function expectError(transactionXdr: string, code: TestnetTransactionEnvelopeErrorCode) {
  assert.throws(
    () => parseTestnetSorobanTransactionEnvelope(transactionXdr),
    (error: unknown) => error instanceof TestnetTransactionEnvelopeError && error.code === code,
  );
}

function tamperedSignatureXdr(transactionXdr: string): string {
  const envelope = xdr.TransactionEnvelope.fromXDR(transactionXdr, "base64");
  const transactionEnvelope = envelope.v1();
  const [originalSignature] = transactionEnvelope.signatures();
  if (!originalSignature) {
    throw new Error("Test fixture must contain a signature");
  }

  const signature = Buffer.from(originalSignature.signature());
  signature[0] = (signature[0] ?? 0) ^ 1;

  return xdr.TransactionEnvelope.envelopeTypeTx(
    new xdr.TransactionV1Envelope({
      tx: transactionEnvelope.tx(),
      signatures: [
        new xdr.DecoratedSignature({
          hint: originalSignature.hint(),
          signature,
        }),
      ],
    }),
  ).toXDR("base64");
}

function signedTransactionXdr(operation: xdr.Operation, maxTime: number = 300): string {
  const transaction = new TransactionBuilder(new Account(CONSTRUCTED_SOURCE.publicKey(), "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(operation)
    .setTimebounds(0, maxTime)
    .build();

  transaction.sign(CONSTRUCTED_SOURCE);
  return transaction.toXDR();
}

function signedTransactionWithRawMaxTime(maxTime: string): string {
  return buildGasTestEnvelope({ maxTime });
}

function signedTransactionWithoutTimeBounds(): string {
  return buildGasTestEnvelope({ maxTime: null });
}

function invokeContractOperation(address: Address): xdr.Operation {
  return Operation.invokeHostFunction({
    func: xdr.HostFunction.hostFunctionTypeInvokeContract(
      new xdr.InvokeContractArgs({
        contractAddress: address.toScAddress(),
        functionName: "hello",
        args: [],
      }),
    ),
  });
}

test("derives authoritative facts from a signed Testnet contract invocation", () => {
  assert.deepEqual(parseTestnetSorobanTransactionEnvelope(VALID_TESTNET_XDR), {
    sourceWallet: SOURCE_PUBLIC_KEY,
    transactionHash: VALID_TRANSACTION_HASH,
    innerMaxFeeStroops: 100n,
    targetContractIds: [CONTRACT_ID],
    innerMaxTime: 1788362232,
  });
});

test("derives maxTime, treats zero as unbounded, and preserves already-expired bounds", () => {
  const operation = invokeContractOperation(new Address(CONTRACT_ID));

  const unbounded = parseTestnetSorobanTransactionEnvelope(
    signedTransactionXdr(operation, TimeoutInfinite),
  );
  assert.equal("innerMaxTime" in unbounded, false);

  const absent = parseTestnetSorobanTransactionEnvelope(signedTransactionWithoutTimeBounds());
  assert.equal("innerMaxTime" in absent, false);

  const alreadyExpired = parseTestnetSorobanTransactionEnvelope(signedTransactionXdr(operation, 1));
  assert.equal(alreadyExpired.innerMaxTime, 1);

  const later = parseTestnetSorobanTransactionEnvelope(signedTransactionXdr(operation, 4102444800));
  assert.equal(later.innerMaxTime, 4102444800);
});

test("rejects a maxTime that cannot safely cross the Convex millisecond boundary", () => {
  expectError(signedTransactionWithRawMaxTime("9007199254741"), "invalid_request");
});

test("rejects unsigned and tampered envelopes as invalid signatures", () => {
  expectError(UNSIGNED_TESTNET_XDR, "invalid_signature");
  expectError(tamperedSignatureXdr(VALID_TESTNET_XDR), "invalid_signature");
});

test("rejects a Public-network signature as wrong_network", () => {
  expectError(PUBLIC_NETWORK_XDR, "wrong_network");
});

test("rejects oversized XDR before decoding", () => {
  expectError("A".repeat(TESTNET_TRANSACTION_ENVELOPE_MAX_XDR_BYTES + 1), "invalid_request");
});

test("requires one source signature with the correct hint", () => {
  expectError(buildGasTestEnvelope({ signatureHint: Buffer.alloc(4, 0xff) }), "invalid_signature");
  expectError(
    buildGasTestEnvelope({ extraSignature: keypairForLabel("gas-extra-signer") }),
    "invalid_signature",
  );
});

test("rejects an alternate operation source", () => {
  expectError(
    buildGasTestEnvelope({ operationSource: keypairForLabel("gas-alternate-source").publicKey() }),
    "unsupported_transaction",
  );
});

test("rejects malformed XDR as invalid_request without exposing parser details", () => {
  for (const transactionXdr of [
    "AAAA",
    "not-a-stellar-transaction-envelope",
    `${VALID_TESTNET_XDR}=`,
  ]) {
    try {
      parseTestnetSorobanTransactionEnvelope(transactionXdr);
      assert.fail("Expected malformed XDR to be rejected");
    } catch (error) {
      assert(error instanceof TestnetTransactionEnvelopeError);
      assert.equal(error.code, "invalid_request");
      assert.equal(error.message.includes(transactionXdr), false);
    }
  }
});

test("rejects a non-contract host function as unsupported_transaction", () => {
  const uploadWasm = Operation.uploadContractWasm({ wasm: Buffer.alloc(32, 1) });
  expectError(signedTransactionXdr(uploadWasm), "unsupported_transaction");
});

test("rejects an invokeContract target that is not a contract address", () => {
  const accountTarget = invokeContractOperation(new Address(CONSTRUCTED_SOURCE.publicKey()));
  expectError(signedTransactionXdr(accountTarget), "unsupported_transaction");
});
