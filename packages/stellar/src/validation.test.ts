import assert from "node:assert/strict";
import test from "node:test";

import { Keypair, StrKey } from "@stellar/stellar-sdk";

import { assertValidAccountAddress, assertValidPublicKey } from "./validation.ts";

test("account identity validation accepts checksum-valid classic and contract addresses", () => {
  const classicAddress = Keypair.random().publicKey();
  const contractAddress = StrKey.encodeContract(Keypair.random().rawPublicKey());

  assert.equal(assertValidAccountAddress(classicAddress.toLowerCase()), classicAddress);
  assert.equal(assertValidAccountAddress(contractAddress.toLowerCase()), contractAddress);
});

test("classic transaction source validation continues to reject contract accounts", () => {
  const contractAddress = StrKey.encodeContract(Keypair.random().rawPublicKey());

  assert.throws(() => assertValidPublicKey(contractAddress), /Invalid Stellar public key/);
  const invalidContractAddress = `${contractAddress.slice(0, -1)}${
    contractAddress.endsWith("A") ? "B" : "A"
  }`;
  assert.throws(() => assertValidAccountAddress(invalidContractAddress));
});
