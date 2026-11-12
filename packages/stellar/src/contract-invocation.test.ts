import assert from "node:assert/strict";
import test from "node:test";

import {
  Account,
  Address,
  Contract,
  Keypair,
  Networks,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";

import { assertTransactionMatchesContractCall } from "./contract-invocation.ts";

const registryContractId = StrKey.encodeContract(Keypair.random().rawPublicKey());
const projectOwner = Keypair.random().publicKey();
const smartAccountAddress = StrKey.encodeContract(Keypair.random().rawPublicKey());
const targetContractId = StrKey.encodeContract(Keypair.random().rawPublicKey());
const projectId = nativeToScVal(12n, { type: "u64" });
const contractAddress = Address.fromString(targetContractId).toScVal();
const args = [projectId, contractAddress];

function envelope(operation: xdr.Operation) {
  return new TransactionBuilder(new Account(projectOwner, "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(operation)
    .setTimeout(60)
    .build()
    .toEnvelope();
}

const intent = {
  targetContractId: registryContractId,
  functionName: "add_contract",
  args,
};

test("contract-call confirmation accepts the intended classic invocation", () => {
  const operation = new Contract(registryContractId).call("add_contract", ...args);
  assert.doesNotThrow(() =>
    assertTransactionMatchesContractCall(envelope(operation), Networks.TESTNET, intent),
  );
});

test("contract-call confirmation rejects changed target arguments", () => {
  const operation = new Contract(registryContractId).call(
    "add_contract",
    nativeToScVal(13n, { type: "u64" }),
    contractAddress,
  );
  assert.throws(
    () => assertTransactionMatchesContractCall(envelope(operation), Networks.TESTNET, intent),
    /expected contract call/i,
  );
});

test("contract-call confirmation accepts an execute wrapper only for the selected smart account", () => {
  const operation = new Contract(smartAccountAddress).call(
    "execute",
    Address.fromString(registryContractId).toScVal(),
    xdr.ScVal.scvSymbol("add_contract"),
    xdr.ScVal.scvVec(args),
  );
  assert.doesNotThrow(() =>
    assertTransactionMatchesContractCall(envelope(operation), Networks.TESTNET, {
      ...intent,
      smartAccountAddress,
    }),
  );
  assert.throws(
    () =>
      assertTransactionMatchesContractCall(envelope(operation), Networks.TESTNET, {
        ...intent,
        smartAccountAddress: StrKey.encodeContract(Keypair.random().rawPublicKey()),
      }),
    /expected smart-account invocation/i,
  );
});
