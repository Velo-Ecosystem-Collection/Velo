import assert from "node:assert/strict";
import test from "node:test";

import {
  FeeBumpTransaction,
  Keypair,
  Networks,
  Transaction,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";

import {
  buildTestnetFeeBumpTransaction,
  quoteTestnetFeeBump,
  TESTNET_FEE_BUMP_ERROR_CODES,
  TestnetFeeBumpError,
  type TestnetFeeBumpErrorCode,
  type TestnetFeeBumpSigner,
} from "./fee-bump.ts";
import {
  buildGasTestEnvelope,
  GAS_TEST_RELAYER_KEYPAIR,
  GAS_TEST_SOURCE_KEYPAIR,
  keypairForLabel,
} from "./test-fixtures.ts";
import { TESTNET_TRANSACTION_ENVELOPE_MAX_XDR_BYTES } from "./transaction-envelope.ts";

const VALID_INNER_XDR = buildGasTestEnvelope();
const RESOURCE_INNER_XDR = buildGasTestEnvelope({ resourceFee: 50n });
const MAX_SIGNED_INT64 = 2n ** 63n - 1n;

function expectError(action: () => unknown, code: TestnetFeeBumpErrorCode): void {
  assert.throws(
    action,
    (error: unknown) =>
      error instanceof TestnetFeeBumpError &&
      error.code === code &&
      !error.message.includes(VALID_INNER_XDR),
  );
}

function signerFor(
  keypair: Keypair = GAS_TEST_RELAYER_KEYPAIR,
  sign: (payload: Uint8Array) => Uint8Array = (payload) => keypair.sign(Buffer.from(payload)),
): TestnetFeeBumpSigner {
  return Object.freeze({
    publicKey: keypair.publicKey(),
    sign,
  });
}

function tamperedSignatureXdr(transactionXdr: string): string {
  const envelope = xdr.TransactionEnvelope.fromXDR(transactionXdr, "base64");
  const transactionEnvelope = envelope.v1();
  const [originalSignature] = transactionEnvelope.signatures();
  if (!originalSignature) throw new Error("Test fixture must contain a signature");

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

function rewriteSignedTransaction(
  transactionXdr: string,
  options: Readonly<{ fee?: string; resourceFee?: string }>,
): string {
  const envelope = xdr.TransactionEnvelope.fromXDR(transactionXdr, "base64").v1();
  const base = envelope.tx();
  const existingSorobanData = base.ext().value();
  const alteredSorobanData =
    options.resourceFee === undefined || existingSorobanData === undefined
      ? existingSorobanData
      : new xdr.SorobanTransactionData({
          resources: existingSorobanData.resources(),
          ext: existingSorobanData.ext(),
          resourceFee: new xdr.Int64(options.resourceFee),
        });
  const alteredExt =
    alteredSorobanData === undefined
      ? new xdr.TransactionExt(0)
      : new xdr.TransactionExt(1, alteredSorobanData);
  const alteredTransaction = new xdr.Transaction({
    sourceAccount: base.sourceAccount(),
    fee: options.fee === undefined ? base.fee() : Number(options.fee),
    seqNum: base.seqNum(),
    cond: base.cond(),
    memo: base.memo(),
    operations: base.operations(),
    ext: alteredExt,
  });
  const unsigned = xdr.TransactionEnvelope.envelopeTypeTx(
    new xdr.TransactionV1Envelope({ tx: alteredTransaction, signatures: [] }),
  ).toXDR("base64");
  const signed = new Transaction(unsigned, Networks.TESTNET);
  signed.sign(GAS_TEST_SOURCE_KEYPAIR);
  return signed.toXDR();
}

test("quotes the minimum and explicit FeeBump fees with resource fees counted once", () => {
  assert.deepEqual(quoteTestnetFeeBump(VALID_INNER_XDR), {
    innerTransactionHash: new Transaction(VALID_INNER_XDR, Networks.TESTNET).hash().toString("hex"),
    innerMaxFeeStroops: 100n,
    innerInclusionFeeStroops: 100n,
    resourceFeeStroops: 0n,
    baseFeeStroops: 100n,
    outerMaxFeeStroops: 200n,
  });

  assert.deepEqual(quoteTestnetFeeBump(RESOURCE_INNER_XDR), {
    innerTransactionHash: new Transaction(RESOURCE_INNER_XDR, Networks.TESTNET)
      .hash()
      .toString("hex"),
    innerMaxFeeStroops: 150n,
    innerInclusionFeeStroops: 100n,
    resourceFeeStroops: 50n,
    baseFeeStroops: 100n,
    outerMaxFeeStroops: 250n,
  });
  assert.equal(quoteTestnetFeeBump(RESOURCE_INNER_XDR, 250n).baseFeeStroops, 250n);
  assert.equal(quoteTestnetFeeBump(RESOURCE_INNER_XDR, 250n).outerMaxFeeStroops, 550n);
  assert.equal(quoteTestnetFeeBump(buildGasTestEnvelope({ fee: "50" })).baseFeeStroops, 100n);
  const higherInnerInclusion = quoteTestnetFeeBump(buildGasTestEnvelope({ fee: "200" }));
  assert.equal(higherInnerInclusion.baseFeeStroops, 200n);
  assert.equal(higherInnerInclusion.outerMaxFeeStroops, 400n);
  expectError(
    () => quoteTestnetFeeBump(buildGasTestEnvelope({ fee: "200" }), 199n),
    TESTNET_FEE_BUMP_ERROR_CODES.insufficientBaseFee,
  );
});

test("builds a Testnet FeeBump with the expected source, signature, hashes, and fee", () => {
  const observedPayloads: Uint8Array[] = [];
  const result = buildTestnetFeeBumpTransaction(
    RESOURCE_INNER_XDR,
    100n,
    250n,
    signerFor(GAS_TEST_RELAYER_KEYPAIR, (payload) => {
      observedPayloads.push(new Uint8Array(payload));
      return GAS_TEST_RELAYER_KEYPAIR.sign(Buffer.from(payload));
    }),
  );
  const outer = TransactionBuilder.fromXDR(result.signedOuterXdr, Networks.TESTNET);

  assert(outer instanceof FeeBumpTransaction);
  assert.equal(result.feeSource, GAS_TEST_RELAYER_KEYPAIR.publicKey());
  assert.equal(result.innerMaxFeeStroops, 150n);
  assert.equal(result.resourceFeeStroops, 50n);
  assert.equal(result.outerMaxFeeStroops, 250n);
  assert.equal(result.outerTransactionHash, outer.hash().toString("hex"));
  assert.equal(result.innerTransactionHash, outer.innerTransaction.hash().toString("hex"));
  assert.equal(outer.feeSource, GAS_TEST_RELAYER_KEYPAIR.publicKey());
  assert.equal(outer.fee, "250");
  assert.equal(observedPayloads.length, 1);
  assert.deepEqual(Buffer.from(observedPayloads[0] ?? []), outer.hash());

  const [signature] = outer.signatures;
  assert(signature);
  assert.deepEqual(Buffer.from(signature.hint()), GAS_TEST_RELAYER_KEYPAIR.signatureHint());
  assert.equal(
    GAS_TEST_RELAYER_KEYPAIR.verify(outer.hash(), Buffer.from(signature.signature())),
    true,
  );
  assert(Object.isFrozen(result));
});

test("preserves the byte-identical inner envelope, sequence, signature, and Soroban data", () => {
  const result = buildTestnetFeeBumpTransaction(RESOURCE_INNER_XDR, 100n, 250n, signerFor());
  const outer = TransactionBuilder.fromXDR(result.signedOuterXdr, Networks.TESTNET);
  assert(outer instanceof FeeBumpTransaction);

  assert.equal(outer.innerTransaction.toXDR(), RESOURCE_INNER_XDR);
  assert.equal(outer.innerTransaction.sequence, "2");
  assert.deepEqual(
    outer.innerTransaction.toEnvelope().v1().tx().ext().toXDR(),
    new Transaction(RESOURCE_INNER_XDR, Networks.TESTNET).toEnvelope().v1().tx().ext().toXDR(),
  );
  assert.equal(outer.innerTransaction.signatures.length, 1);
});

test("accepts an exact ceiling and rejects an insufficient ceiling before invoking the signer", () => {
  const result = buildTestnetFeeBumpTransaction(VALID_INNER_XDR, 100n, 200n, signerFor());
  assert.equal(result.outerMaxFeeStroops, 200n);

  let called = false;
  expectError(
    () =>
      buildTestnetFeeBumpTransaction(VALID_INNER_XDR, 100n, 199n, {
        publicKey: GAS_TEST_RELAYER_KEYPAIR.publicKey(),
        sign: () => {
          called = true;
          return GAS_TEST_RELAYER_KEYPAIR.sign(Buffer.alloc(32));
        },
      }),
    TESTNET_FEE_BUMP_ERROR_CODES.feeCeilingExceeded,
  );
  assert.equal(called, false);
});

test("rejects unsigned, tampered, wrong-network, oversized, and unsupported envelopes", () => {
  expectError(
    () => quoteTestnetFeeBump(buildGasTestEnvelope({ kind: "unsigned" })),
    TESTNET_FEE_BUMP_ERROR_CODES.invalidSignature,
  );
  expectError(
    () => quoteTestnetFeeBump(tamperedSignatureXdr(VALID_INNER_XDR)),
    TESTNET_FEE_BUMP_ERROR_CODES.invalidSignature,
  );
  expectError(
    () => quoteTestnetFeeBump(buildGasTestEnvelope({ kind: "wrong_network" })),
    TESTNET_FEE_BUMP_ERROR_CODES.wrongNetwork,
  );
  expectError(
    () => quoteTestnetFeeBump("A".repeat(TESTNET_TRANSACTION_ENVELOPE_MAX_XDR_BYTES + 1)),
    TESTNET_FEE_BUMP_ERROR_CODES.invalidRequest,
  );

  for (const kind of ["classic", "multi", "mixed", "fee_bump"] as const) {
    expectError(
      () => quoteTestnetFeeBump(buildGasTestEnvelope({ kind })),
      TESTNET_FEE_BUMP_ERROR_CODES.unsupportedTransaction,
    );
  }
});

test("rejects invalid fee values, inconsistent resource fees, and int64 overflow", () => {
  expectError(
    () => quoteTestnetFeeBump(VALID_INNER_XDR, -1n),
    TESTNET_FEE_BUMP_ERROR_CODES.invalidFee,
  );
  expectError(
    () => quoteTestnetFeeBump(VALID_INNER_XDR, 99n),
    TESTNET_FEE_BUMP_ERROR_CODES.insufficientBaseFee,
  );
  expectError(
    () => quoteTestnetFeeBump(VALID_INNER_XDR, MAX_SIGNED_INT64 + 1n),
    TESTNET_FEE_BUMP_ERROR_CODES.feeOverflow,
  );
  expectError(
    () => quoteTestnetFeeBump(buildGasTestEnvelope({ resourceFee: -1n })),
    TESTNET_FEE_BUMP_ERROR_CODES.invalidFee,
  );
  expectError(
    () => quoteTestnetFeeBump(rewriteSignedTransaction(RESOURCE_INNER_XDR, { fee: "40" })),
    TESTNET_FEE_BUMP_ERROR_CODES.invalidFee,
  );
  expectError(
    () => quoteTestnetFeeBump(VALID_INNER_XDR, MAX_SIGNED_INT64 / 2n + 1n),
    TESTNET_FEE_BUMP_ERROR_CODES.feeOverflow,
  );
});

test("rejects wrong keys, malformed signatures, invalid sources, and signer exceptions safely", () => {
  const wrongKey = keypairForLabel("gas-wrong-fee-bump-signer");
  expectError(
    () =>
      buildTestnetFeeBumpTransaction(
        VALID_INNER_XDR,
        100n,
        200n,
        signerFor(GAS_TEST_RELAYER_KEYPAIR, (payload) => wrongKey.sign(Buffer.from(payload))),
      ),
    TESTNET_FEE_BUMP_ERROR_CODES.invalidSigner,
  );
  expectError(
    () =>
      buildTestnetFeeBumpTransaction(VALID_INNER_XDR, 100n, 200n, {
        publicKey: GAS_TEST_RELAYER_KEYPAIR.publicKey(),
        sign: () => new Uint8Array(3),
      }),
    TESTNET_FEE_BUMP_ERROR_CODES.invalidSigner,
  );
  expectError(
    () =>
      buildTestnetFeeBumpTransaction(VALID_INNER_XDR, 100n, 200n, {
        publicKey: "not-a-public-key",
        sign: () => new Uint8Array(64),
      }),
    TESTNET_FEE_BUMP_ERROR_CODES.invalidSigner,
  );

  let error: unknown;
  try {
    buildTestnetFeeBumpTransaction(VALID_INNER_XDR, 100n, 200n, {
      publicKey: GAS_TEST_RELAYER_KEYPAIR.publicKey(),
      sign: () => {
        throw new Error(`secret=${GAS_TEST_RELAYER_KEYPAIR.secret()} xdr=${VALID_INNER_XDR}`);
      },
    });
  } catch (caught) {
    error = caught;
  }
  assert(error instanceof TestnetFeeBumpError);
  assert.equal(error.code, TESTNET_FEE_BUMP_ERROR_CODES.signerFailure);
  assert.equal(error.message, "FeeBump signer unavailable");
  assert.equal(String(error).includes(GAS_TEST_RELAYER_KEYPAIR.secret()), false);
  assert.equal(String(error).includes(VALID_INNER_XDR), false);
});

test("reproduces identical signed XDR and outer hash for identical inputs", () => {
  const first = buildTestnetFeeBumpTransaction(RESOURCE_INNER_XDR, 100n, 250n, signerFor());
  const second = buildTestnetFeeBumpTransaction(RESOURCE_INNER_XDR, 100n, 250n, signerFor());

  assert.deepEqual(second, first);
});
