import assert from "node:assert/strict";
import test from "node:test";

import { Account, Keypair, Networks, rpc, StrKey, Transaction, xdr } from "@stellar/stellar-sdk";

import {
  buildRegisterProjectTransaction,
  registrationTimebounds,
  transactionSubmissionErrorMessage,
} from "./registry.ts";

test("registration timebounds are derived from the latest ledger close time", () => {
  assert.deepEqual(registrationTimebounds(1_800_000_000), {
    minTime: 0,
    maxTime: 1_800_000_900,
  });
});

test("registration timebounds accept the close-time string returned by Stellar RPC", () => {
  assert.deepEqual(registrationTimebounds("1785032109"), {
    minTime: 0,
    maxTime: 1_785_033_009,
  });
});

test("registration timebounds reject an invalid ledger close time", () => {
  assert.throws(() => registrationTimebounds(0), /latest ledger close time/i);
  assert.throws(() => registrationTimebounds(Number.NaN), /latest ledger close time/i);
});

test("registration transaction uses Stellar ledger time instead of the local clock", async () => {
  const source = Keypair.random().publicKey();
  const contract = StrKey.encodeContract(Keypair.random().rawPublicKey());
  const originalGetAccount = rpc.Server.prototype.getAccount;
  const originalGetTransaction = rpc.Server.prototype.getTransaction;
  const originalPrepareTransaction = rpc.Server.prototype.prepareTransaction;

  rpc.Server.prototype.getAccount = async () => new Account(source, "1");
  rpc.Server.prototype.getTransaction = async () =>
    ({
      status: "NOT_FOUND",
      latestLedger: 10,
      latestLedgerCloseTime: 1_800_000_000,
      oldestLedger: 1,
      oldestLedgerCloseTime: 1_799_999_000,
    }) as rpc.Api.GetTransactionResponse;
  rpc.Server.prototype.prepareTransaction = async (transaction) => {
    if (!(transaction instanceof Transaction)) {
      throw new Error("Expected a regular transaction");
    }
    return transaction;
  };

  try {
    const transactionXdr = await buildRegisterProjectTransaction({
      rpcUrl: "https://rpc.example",
      networkPassphrase: Networks.TESTNET,
      registryContractId: contract,
      sourcePublicKey: source,
      ownerAddress: source,
      projectName: "Clock-safe registration",
      metadataHash: "ab".repeat(32),
    });
    const transaction = new Transaction(transactionXdr, Networks.TESTNET);

    assert.deepEqual(transaction.timeBounds, {
      minTime: "0",
      maxTime: "1800000900",
    });
  } finally {
    rpc.Server.prototype.getAccount = originalGetAccount;
    rpc.Server.prototype.getTransaction = originalGetTransaction;
    rpc.Server.prototype.prepareTransaction = originalPrepareTransaction;
  }
});

test("transaction submission decodes txTooLate into an actionable message", () => {
  const errorResult = xdr.TransactionResult.fromXDR("AAAAAAABPZz////9AAAAAA==", "base64");

  assert.equal(
    transactionSubmissionErrorMessage(errorResult),
    "This transaction expired before it reached Stellar. Please try the action again.",
  );
});

test("unknown transaction submission errors retain their XDR for diagnostics", () => {
  const errorResult = new xdr.TransactionResult({
    feeCharged: xdr.Int64.fromString("0"),
    result: xdr.TransactionResultResult.txBadSeq(),
    ext: new xdr.TransactionResultExt(0),
  });

  assert.match(transactionSubmissionErrorMessage(errorResult), /txBadSeq/);
  assert.match(transactionSubmissionErrorMessage(errorResult), /AAAA/);
});
