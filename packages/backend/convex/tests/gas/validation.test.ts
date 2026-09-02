/// <reference types="vite/client" />

import { expect, test } from "vitest";

import { GAS_MAX_ALLOWED_CONTRACT_IDS, GAS_MAX_STROOPS, GAS_NETWORK } from "../../gas/types.ts";
import {
  addStroopValues,
  assertValidStroopValue,
  normalizeContractAllowlist,
  normalizeContractId,
  normalizeGasNetwork,
  normalizeTransactionHash,
  normalizeWalletAddress,
  parseStroopAmount,
} from "../../gas/validation.ts";
import { gasEnvelopeFixtures, gasMalformedInputFixtures } from "./fixtures.ts";

const validWallet = gasEnvelopeFixtures[0].metadata.expectedSource;
const validContract = gasEnvelopeFixtures[0].metadata.expectedTarget;
const validTransactionHash = "A".repeat(64);

const validContractIds = [
  "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA2ZMN",
  "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4BV5",
  "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA6J5N",
  "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
  "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFCT4",
  "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHK3M",
  "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAITA4",
  "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAK3IM",
  "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMDR4",
  "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOLZM",
  "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAARQG5",
  "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAATYON",
  "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVAX5",
  "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAXI7N",
  "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAYRE5",
  "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABB6KO",
  "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABDWC6",
  "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABFO3O",
  "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABHGT6",
] as const;

test("stroop parsing accepts zero and the maximum signed int64", () => {
  expect(parseStroopAmount("0")).toBe(0n);
  expect(parseStroopAmount(` ${GAS_MAX_STROOPS} `)).toBe(GAS_MAX_STROOPS);
  expect(assertValidStroopValue(0n)).toBe(0n);
  expect(assertValidStroopValue(GAS_MAX_STROOPS)).toBe(GAS_MAX_STROOPS);
});

test("stroop parsing rejects negative, malformed, non-canonical, and overflowing amounts", () => {
  for (const value of [
    "-1",
    "+1",
    "01",
    "00",
    "1.0",
    "1e3",
    "1_000",
    "",
    "   ",
    "not-a-number",
    (GAS_MAX_STROOPS + 1n).toString(),
  ]) {
    expect(() => parseStroopAmount(value), value).toThrow();
  }

  expect(() => assertValidStroopValue(-1n)).toThrow();
  expect(() => assertValidStroopValue(GAS_MAX_STROOPS + 1n)).toThrow();
});

test("stroop addition accepts the maximum boundary and rejects overflow", () => {
  expect(addStroopValues(0n, GAS_MAX_STROOPS)).toBe(GAS_MAX_STROOPS);
  expect(addStroopValues(GAS_MAX_STROOPS, 0n)).toBe(GAS_MAX_STROOPS);
  expect(() => addStroopValues(GAS_MAX_STROOPS, 1n)).toThrow();
  expect(() => addStroopValues(GAS_MAX_STROOPS, GAS_MAX_STROOPS)).toThrow();
});

test("Stellar wallet, contract, and transaction hash normalization is canonical", () => {
  expect(normalizeWalletAddress(` ${validWallet.toLowerCase()} `)).toBe(validWallet);
  expect(normalizeContractId(` ${validContract.toLowerCase()} `)).toBe(validContract);
  expect(normalizeTransactionHash(` ${validTransactionHash} `)).toBe(
    validTransactionHash.toLowerCase(),
  );
});

test("malformed Stellar identifiers are rejected by their respective boundaries", () => {
  for (const fixture of gasMalformedInputFixtures) {
    if (fixture.category === "wallet") {
      expect(() => normalizeWalletAddress(fixture.value), fixture.id).toThrow();
    } else if (fixture.category === "contract") {
      expect(() => normalizeContractId(fixture.value), fixture.id).toThrow();
    } else if (fixture.category === "transaction-hash") {
      expect(() => normalizeTransactionHash(fixture.value), fixture.id).toThrow();
    }
  }
});

test("only the Testnet network literal is accepted", () => {
  expect(normalizeGasNetwork(GAS_NETWORK)).toBe(GAS_NETWORK);
  expect(() => normalizeGasNetwork("mainnet")).toThrow();
  expect(() => normalizeGasNetwork("unknown")).toThrow();
});

test("contract allowlists are empty-safe, normalized, deduplicated, and bounded", () => {
  expect(normalizeContractAllowlist([])).toEqual([]);
  expect(normalizeContractAllowlist([validContract.toLowerCase(), ` ${validContract} `])).toEqual([
    validContract,
  ]);

  const maximumAllowlist = validContractIds.slice(0, GAS_MAX_ALLOWED_CONTRACT_IDS);
  expect(normalizeContractAllowlist(maximumAllowlist)).toEqual([...maximumAllowlist]);
  expect(() => normalizeContractAllowlist([...maximumAllowlist, validContract])).toThrow();
  expect(() => normalizeContractAllowlist(["CNOTASTELLARCONTRACT"])).toThrow();
});
