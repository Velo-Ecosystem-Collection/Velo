import assert from "node:assert/strict";
import test from "node:test";

import { Keypair, StrKey } from "@stellar/stellar-sdk";

import { validateSep45Challenge } from "./sep45-client.ts";

const account = StrKey.encodeContract(Buffer.alloc(32, 9));
const config = {
  endpoint: "https://velo.example/api/auth/wallet/contract",
  contractId: StrKey.encodeContract(Buffer.alloc(32, 8)),
  signingKey: Keypair.random().publicKey(),
};
const networkPassphrase = "Test SDF Network ; September 2015";

test("SEP-45 client rejects a challenge for a different network", () => {
  assert.throws(
    () =>
      validateSep45Challenge({
        account,
        config,
        homeDomain: "velo.example",
        networkPassphrase,
        challenge: {
          authorization_entries: "not-xdr",
          network_passphrase: "Public Global Stellar Network ; September 2015",
          signature_expiration_ledger: 1,
        },
      }),
    /different Stellar network/,
  );
});

test("SEP-45 client rejects malformed authorization entries", () => {
  assert.throws(
    () =>
      validateSep45Challenge({
        account,
        config,
        homeDomain: "velo.example",
        networkPassphrase,
        challenge: {
          authorization_entries: "not-xdr",
          network_passphrase: networkPassphrase,
          signature_expiration_ledger: 1,
        },
      }),
    /malformed SEP-45 authorization entries/,
  );
});
