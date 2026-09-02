/// <reference types="vite/client" />

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

const expectedEnvelopeDigests: Record<string, string> = {
  "gas-envelope-valid-testnet-soroban":
    "9f75133589e447a54c93c4867488cd8b7f8e1e5b156834500e98f3e1527ace26",
  "gas-envelope-unsigned-soroban":
    "3fa0c534d21edecd6744ec1ab5927e2fdaaa94d692d7c577609ee634adcff44c",
  "gas-envelope-mainnet-signed-soroban":
    "7d68e9a81924d86f6927d0791a652ba4c990544e145797b613bf52b3659f9e1f",
  "gas-envelope-classic-payment":
    "7efebc672ec7041d20b90322d582d03632666011c08ad01666cad26d5e84bdb2",
  "gas-envelope-multi-soroban": "2136129ba1f01f26f0fb605ee08138e958b23c1d72db897cc8c79f7c1c8d821d",
  "gas-envelope-mixed-soroban-payment":
    "e5eccc60edfc05abfaec39a12fe2578a37c8c4b4e654f885b5b5e57d3b43a22b",
  "gas-envelope-fee-bump-soroban":
    "8db9cd6c3025ef85c3c498eb106d375e469ae611d02c6987ce316d361bcbdf50",
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

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
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

test("valid and unsupported envelope constants remain byte-stable", async () => {
  for (const fixture of gasEnvelopeFixtures) {
    expect(fixture.xdr).toBeTypeOf("string");
    expect(fixture.xdr.length).toBeGreaterThan(0);
    expect(await sha256(fixture.xdr)).toBe(expectedEnvelopeDigests[fixture.id]);
  }
});
