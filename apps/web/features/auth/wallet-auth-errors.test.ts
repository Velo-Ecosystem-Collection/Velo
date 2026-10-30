import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyWalletAuthFailure,
  walletAuthFailureMessage,
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
