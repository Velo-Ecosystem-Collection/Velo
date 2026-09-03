import assert from "node:assert/strict";
import test from "node:test";

import {
  Address,
  Account,
  Keypair,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
  TimeoutInfinite,
  xdr,
} from "@stellar/stellar-sdk";

import {
  parseTestnetSorobanTransactionEnvelope,
  TestnetTransactionEnvelopeError,
  type TestnetTransactionEnvelopeErrorCode,
} from "./transaction-envelope.ts";

const VALID_TESTNET_XDR =
  "AAAAAgAAAABadW5rta4REM0pw87n3o8AjuKAWqhQv5Yv8K6leUAAbQAAAGQAAAAAAAAAAgAAAAEAAAAAAAAAAAAAAABqmD34AAAAAAAAAAEAAAAAAAAAGAAAAAAAAAABvxI1TzXMXzGEYZPMWoFwTQw4Rjb29snNgXvqMYCGtTsAAAAFaGVsbG8AAAAAAAABAAAADwAAAARWZWxvAAAAAAAAAAAAAAABeUAAbQAAAEDTxNKaUtm2l4Soz5yILVJi6G7p88kCKjxUEgZEp5nMOaM8VUZXVC5dCTa9K/dYcuJGLsiQnI7kl+ANwfsthUkJ";
const UNSIGNED_TESTNET_XDR =
  "AAAAAgAAAABadW5rta4REM0pw87n3o8AjuKAWqhQv5Yv8K6leUAAbQAAAGQAAAAAAAAAAgAAAAEAAAAAAAAAAAAAAABqmD34AAAAAAAAAAEAAAAAAAAAGAAAAAAAAAABvxI1TzXMXzGEYZPMWoFwTQw4Rjb29snNgXvqMYCGtTsAAAAFaGVsbG8AAAAAAAABAAAADwAAAARWZWxvAAAAAAAAAAAAAAAA";
const PUBLIC_NETWORK_XDR =
  "AAAAAgAAAABadW5rta4REM0pw87n3o8AjuKAWqhQv5Yv8K6leUAAbQAAAGQAAAAAAAAAAgAAAAEAAAAAAAAAAAAAAABqmD34AAAAAAAAAAEAAAAAAAAAGAAAAAAAAAABvxI1TzXMXzGEYZPMWoFwTQw4Rjb29snNgXvqMYCGtTsAAAAFaGVsbG8AAAAAAAABAAAADwAAAARWZWxvAAAAAAAAAAAAAAABeUAAbQAAAEAfsC8s9qUgayPoUWzTGY4LjtRSzTianGeYOnoDSCs0ycw+zqcPXNFI8hSwPPF2M1xmqf1zLij2SEtP+uoAK8gN";

const SOURCE_PUBLIC_KEY = "GBNHK3TLWWXBCEGNFHB45Z66R4AI5YUALKUFBP4WF7YK5JLZIAAG2DLI";
const CONTRACT_ID = "CC7RENKPGXGF6MMEMGJ4YWUBOBGQYOCGG33PNSONQF56UMMAQ22TWH6R";
const CONSTRUCTED_SOURCE = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7));

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
  const base = xdr.TransactionEnvelope.fromXDR(
    signedTransactionXdr(invokeContractOperation(new Address(CONTRACT_ID))),
    "base64",
  );
  const transaction = base.v1().tx();
  const alteredTransaction = new xdr.Transaction({
    sourceAccount: transaction.sourceAccount(),
    fee: transaction.fee(),
    seqNum: transaction.seqNum(),
    cond: xdr.Preconditions.precondTime(
      new xdr.TimeBounds({
        minTime: xdr.Uint64.fromString("0"),
        maxTime: xdr.Uint64.fromString(maxTime),
      }),
    ),
    memo: transaction.memo(),
    operations: transaction.operations(),
    ext: transaction.ext(),
  });
  const unsigned = xdr.TransactionEnvelope.envelopeTypeTx(
    new xdr.TransactionV1Envelope({ tx: alteredTransaction, signatures: [] }),
  ).toXDR("base64");
  const signed = new Transaction(unsigned, Networks.TESTNET);
  signed.sign(CONSTRUCTED_SOURCE);
  return signed.toXDR();
}

function signedTransactionWithoutTimeBounds(): string {
  const base = xdr.TransactionEnvelope.fromXDR(
    signedTransactionXdr(invokeContractOperation(new Address(CONTRACT_ID))),
    "base64",
  );
  const transaction = base.v1().tx();
  const alteredTransaction = new xdr.Transaction({
    sourceAccount: transaction.sourceAccount(),
    fee: transaction.fee(),
    seqNum: transaction.seqNum(),
    cond: xdr.Preconditions.precondNone(),
    memo: transaction.memo(),
    operations: transaction.operations(),
    ext: transaction.ext(),
  });
  const unsigned = xdr.TransactionEnvelope.envelopeTypeTx(
    new xdr.TransactionV1Envelope({ tx: alteredTransaction, signatures: [] }),
  ).toXDR("base64");
  const signed = new Transaction(unsigned, Networks.TESTNET);
  signed.sign(CONSTRUCTED_SOURCE);
  return signed.toXDR();
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
    transactionHash: "a4d98992d858b947bc3e76e42f8ff2aae3d5734ddcb0cd2ace094055eb93f1ed",
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
