/// <reference types="vite/client" />

import {
  TestnetTransactionEnvelopeError,
  type TestnetTransactionEnvelopeErrorCode,
} from "@repo/stellar/transaction-envelope";
import { expect, test } from "vitest";

import { deriveGasTransactionFacts } from "../../gas/envelope.ts";
import { gasEnvelopeFixtures, gasMalformedInputFixtures } from "./fixtures.ts";

function envelopeFixtureById(id: string) {
  const fixture = gasEnvelopeFixtures.find((candidate) => candidate.id === id);
  if (!fixture) {
    throw new Error(`Missing gas envelope fixture: ${id}`);
  }

  return fixture;
}

function expectEnvelopeError(transactionXdr: string, code: TestnetTransactionEnvelopeErrorCode) {
  try {
    deriveGasTransactionFacts(transactionXdr);
    throw new Error("Expected transaction envelope to be rejected");
  } catch (error) {
    expect(error).toBeInstanceOf(TestnetTransactionEnvelopeError);
    if (error instanceof TestnetTransactionEnvelopeError) {
      expect(error.code).toBe(code);
      expect(error.message).not.toContain(transactionXdr);
    }
  }
}

test("derives the exact Gas facts and locked literals from the valid fixture", () => {
  const fixture = envelopeFixtureById("gas-envelope-valid-testnet-soroban");

  expect(deriveGasTransactionFacts(fixture.xdr)).toEqual({
    network: "testnet",
    operation: "invokeHostFunction",
    sourceWallet: fixture.metadata.expectedSource,
    transactionHash: "a4d98992d858b947bc3e76e42f8ff2aae3d5734ddcb0cd2ace094055eb93f1ed",
    innerMaxFeeStroops: 100n,
    targetContractIds: [fixture.metadata.expectedTarget],
  });
});

test("maps signed Gas envelope fixture failures to API-safe codes", () => {
  expectEnvelopeError(
    envelopeFixtureById("gas-envelope-unsigned-soroban").xdr,
    "invalid_signature",
  );
  expectEnvelopeError(
    envelopeFixtureById("gas-envelope-mainnet-signed-soroban").xdr,
    "wrong_network",
  );

  for (const id of [
    "gas-envelope-classic-payment",
    "gas-envelope-mixed-soroban-payment",
    "gas-envelope-multi-soroban",
    "gas-envelope-fee-bump-soroban",
  ]) {
    expectEnvelopeError(envelopeFixtureById(id).xdr, "unsupported_transaction");
  }
});

test("maps malformed XDR fixtures to invalid_request", () => {
  for (const fixture of gasMalformedInputFixtures.filter(
    (candidate) => candidate.category === "xdr",
  )) {
    expectEnvelopeError(fixture.value, "invalid_request");
  }
});
