import { describe, expect, test } from "vitest";

import { isValidStellarAccountId, isWalletSigningPayload } from "./wallet-validation.js";

describe("wallet response validation", () => {
  test("accepts checksummed Stellar account IDs and rejects malformed or damaged keys", () => {
    const address = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
    expect(isValidStellarAccountId(address)).toBe(true);
    expect(
      isValidStellarAccountId("GA54SPC34JL3I57ENALTO2V26XOFFG4VGQLFQXDGF6KJ5TJY7ODY56ST"),
    ).toBe(true);
    expect(isValidStellarAccountId("GABC")).toBe(false);
    expect(isValidStellarAccountId(`${address.slice(0, -1)}G`)).toBe(false);
    expect(isValidStellarAccountId(address.toLowerCase())).toBe(false);
    expect(isValidStellarAccountId(null)).toBe(false);
  });

  test("bounds signing payloads and rejects blank or non-string input", () => {
    expect(isWalletSigningPayload("signed payload")).toBe(true);
    expect(isWalletSigningPayload("  ")).toBe(false);
    expect(isWalletSigningPayload("x".repeat(1_048_577))).toBe(false);
    expect(isWalletSigningPayload({})).toBe(false);
  });
});
