import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyWalletAuthFailure,
  walletClientAuthDiagnosticMessage,
  walletAuthFailureMessage,
  walletClientAuthFailureMessage,
} from "../../core/auth/wallet-auth-errors.ts";

test("wallet challenge failures identify likely local setup problems", () => {
  assert.equal(
    classifyWalletAuthFailure(new Error("VELO_AUTH_JWT_PRIVATE_KEY_PEM is required")),
    "WALLET_AUTH_CONFIGURATION",
  );
  assert.equal(
    classifyWalletAuthFailure(new Error("No auth provider found matching given token")),
    "CONVEX_AUTH_CONFIGURATION",
  );
  assert.equal(
    classifyWalletAuthFailure(
      new Error("Could not find public function wallet_auth/challenges:issue"),
    ),
    "CONVEX_CHALLENGE_BACKEND_NOT_DEPLOYED",
  );
  assert.equal(
    classifyWalletAuthFailure(new Error("Table walletAuthChallenges not found")),
    "CONVEX_CHALLENGE_BACKEND_NOT_DEPLOYED",
  );
  assert.equal(
    classifyWalletAuthFailure(new Error("fetch failed: ECONNREFUSED")),
    "CONVEX_UNAVAILABLE",
  );
});

test("wallet challenge diagnostics expose safe guidance without echoing backend errors", () => {
  const message = walletAuthFailureMessage("CONVEX_AUTH_CONFIGURATION");

  assert.match(message, /issuer matches the web app/);
  assert.match(message, /velo-web-v2/);
  assert.match(message, /VELO_AUTH_JWKS/);
  assert.doesNotMatch(message, /secret|private key|token value/i);
  assert.match(walletAuthFailureMessage("unexpected"), /wallet\.challenge failure code/);
});

test("client wallet-auth failures retain safe SEP-45 details and classify common browser failures", () => {
  assert.equal(
    walletClientAuthFailureMessage(
      new Error("Velo's SEP-45 challenge is for a different network."),
    ),
    "Velo's SEP-45 challenge is for a different network.",
  );
  assert.match(
    walletClientAuthFailureMessage({ name: "NotAllowedError", message: "The request was denied" }),
    /Passkey approval was canceled or timed out/,
  );
  assert.match(
    walletClientAuthFailureMessage(new TypeError("Failed to fetch")),
    /could not reach the SEP-45 authentication service/,
  );
  assert.match(
    walletClientAuthFailureMessage(
      new Error("No signer found for credential ID: credential-value"),
    ),
    /could not match the passkey response to an active signer/,
  );
});

test("client wallet-auth diagnostics do not expose sensitive or oversized errors", () => {
  assert.equal(
    walletClientAuthFailureMessage(new Error("request authorization_entries=private-value")),
    "Wallet verification failed. Reconnect and try again.",
  );
  assert.equal(
    walletClientAuthFailureMessage(new Error("JWT token rejected")),
    "Wallet verification failed. Reconnect and try again.",
  );
  assert.equal(
    walletClientAuthFailureMessage(new Error("x".repeat(241))),
    "Wallet verification failed. Reconnect and try again.",
  );
  assert.match(
    walletClientAuthFailureMessage(
      new Error("request authorization_entries=private-value"),
      "passkey_authorization_signing",
    ),
    /could not finish signing the smart-account authorization/,
  );
});

test("client auth console diagnostics redact credentials, query values, and authorization payloads", () => {
  const message = walletClientAuthDiagnosticMessage(
    new Error(
      "No signer found for credential ID: abcdefghijklmnop https://rpc.example.test/simulate?token=private request authorization_entries=large-secret-payload",
    ),
  );

  assert.match(message, /No signer found/);
  assert.match(message, /credential_id=\[redacted\]/);
  assert.match(message, /https:\/\/rpc\.example\.test\/simulate/);
  assert.doesNotMatch(message, /abcdefghijklmnop|\?token=private|large-secret-payload/);
});
