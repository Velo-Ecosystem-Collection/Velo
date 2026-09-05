/// <reference types="vite/client" />

import { buildGasTestEnvelope } from "@repo/stellar/test-fixtures";
import { expect, test } from "vitest";

import { GAS_LIFECYCLE_STATES, GAS_NETWORK, GAS_SUPPORTED_OPERATION } from "../../gas/types.ts";
import { gasEnvelopeFixtures, gasMalformedInputFixtures, gasPolicyFixtures } from "./fixtures.ts";

const expectedEnvelopeCategories = {
  "gas-envelope-valid-testnet-soroban": "accepted",
  "gas-envelope-unsigned-soroban": "rejected",
  "gas-envelope-mainnet-signed-soroban": "rejected",
  "gas-envelope-classic-payment": "rejected",
  "gas-envelope-multi-soroban": "rejected",
  "gas-envelope-mixed-soroban-payment": "rejected",
  "gas-envelope-fee-bump-soroban": "rejected",
} as const;

const expectedMalformedInputCategories = {
  "gas-input-malformed-xdr-truncated": "xdr",
  "gas-input-malformed-xdr-text": "xdr",
  "gas-input-malformed-wallet-prefix": "wallet",
  "gas-input-malformed-wallet-checksum": "wallet",
  "gas-input-malformed-contract-prefix": "contract",
  "gas-input-malformed-transaction-hash-text": "transaction-hash",
  "gas-input-malformed-transaction-hash-short-hex": "transaction-hash",
} as const;

const expectedPolicyBoundaries = {
  "gas-policy-enabled-testnet": "enabled",
  "gas-policy-disabled-testnet": "disabled",
  "gas-policy-daily-cap-under": "daily-cap-under",
  "gas-policy-daily-cap-at": "daily-cap-at",
  "gas-policy-daily-cap-over": "daily-cap-over",
  "gas-policy-wallet-quota-under": "wallet-quota-under",
  "gas-policy-wallet-quota-at": "wallet-quota-at",
  "gas-policy-wallet-quota-over": "wallet-quota-over",
  "gas-policy-allowlist-empty": "allowlist-empty",
  "gas-policy-allowlist-allowed": "allowlist-allowed",
  "gas-policy-allowlist-disallowed": "allowlist-disallowed",
  "gas-policy-payment-access-independent": "payment-access-independent",
} as const;

function idsAreUnique(ids: readonly string[]) {
  return new Set(ids).size === ids.length;
}

function assertNoSecretLikeData(value: unknown, key = ""): void {
  if (/(?:secret|seed|private(?:[_-]?key)?|mnemonic|password)/i.test(key)) {
    throw new Error(`secret-like fixture field: ${key}`);
  }

  if (typeof value === "string") {
    expect(value).not.toMatch(/^S[A-Z2-7]{55}$/);
    expect(value).not.toMatch(/bearer\s+[A-Za-z0-9._~+/=-]{16,}/i);
    expect(value).not.toMatch(/(?:api[_-]?key|private[_-]?key)\s*[:=]\s*\S{12,}/i);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) assertNoSecretLikeData(item, key);
    return;
  }

  if (value && typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value)) {
      assertNoSecretLikeData(childValue, childKey);
    }
  }
}

test("gas domain exposes only the locked D1 vocabulary", () => {
  expect(GAS_NETWORK).toBe("testnet");
  expect(GAS_SUPPORTED_OPERATION).toBe("invokeHostFunction");
  expect(GAS_LIFECYCLE_STATES).toEqual({
    reserved: "reserved",
    rejected: "rejected",
    expired: "expired",
  });
});

test("required envelope, malformed-input, and policy categories have unique deterministic IDs", () => {
  expect(idsAreUnique(gasEnvelopeFixtures.map((fixture) => fixture.id))).toBe(true);
  expect(
    Object.fromEntries(gasEnvelopeFixtures.map((fixture) => [fixture.id, fixture.decision])),
  ).toEqual(expectedEnvelopeCategories);

  expect(idsAreUnique(gasMalformedInputFixtures.map((fixture) => fixture.id))).toBe(true);
  expect(
    Object.fromEntries(gasMalformedInputFixtures.map((fixture) => [fixture.id, fixture.category])),
  ).toEqual(expectedMalformedInputCategories);

  expect(idsAreUnique(gasPolicyFixtures.map((fixture) => fixture.id))).toBe(true);
  expect(
    Object.fromEntries(gasPolicyFixtures.map((fixture) => [fixture.id, fixture.boundary])),
  ).toEqual(expectedPolicyBoundaries);
});

test("fixtures contain no Stellar secret seed, API-key-like, bearer, or private-key data", () => {
  expect(() =>
    assertNoSecretLikeData({
      envelopes: gasEnvelopeFixtures,
      malformedInputs: gasMalformedInputFixtures,
      policies: gasPolicyFixtures,
    }),
  ).not.toThrow();
});

test("valid and unsupported envelopes are deterministic runtime builds", () => {
  const builders = {
    "gas-envelope-valid-testnet-soroban": "valid",
    "gas-envelope-unsigned-soroban": "unsigned",
    "gas-envelope-mainnet-signed-soroban": "wrong_network",
    "gas-envelope-classic-payment": "classic",
    "gas-envelope-multi-soroban": "multi",
    "gas-envelope-mixed-soroban-payment": "mixed",
    "gas-envelope-fee-bump-soroban": "fee_bump",
  } as const;
  for (const fixture of gasEnvelopeFixtures) {
    const fixtureId = fixture.id as keyof typeof builders;
    expect(fixture.xdr).toBe(
      buildGasTestEnvelope({
        kind: builders[fixtureId],
        ...(fixture.id === "gas-envelope-valid-testnet-soroban" ? { maxTime: "1788362232" } : {}),
      }),
    );
  }
});
