import assert from "node:assert/strict";
import test from "node:test";

import {
  isCurrentWalletAuthKeyId,
  shouldReportWalletAuthenticated,
  shouldReuseWalletToken,
} from "../../core/auth/convex-auth.ts";

test("protected routes stay unauthenticated until the Convex token exists", () => {
  assert.equal(
    shouldReportWalletAuthenticated({
      walletStatus: "connected",
      walletAddress: "GABC",
      hasValidToken: false,
    }),
    false,
  );
});

test("a connected wallet with a valid Convex token is authenticated", () => {
  assert.equal(
    shouldReportWalletAuthenticated({
      walletStatus: "connected",
      walletAddress: "GABC",
      hasValidToken: true,
    }),
    true,
  );
});

test("public routes do not start wallet auth without a cached token", () => {
  assert.equal(
    shouldReportWalletAuthenticated({
      walletStatus: "connected",
      walletAddress: "GABC",
      hasValidToken: false,
    }),
    false,
  );
});

test("a cached token keeps a connected wallet authenticated on public routes", () => {
  assert.equal(
    shouldReportWalletAuthenticated({
      walletStatus: "connected",
      walletAddress: "GABC",
      hasValidToken: true,
    }),
    true,
  );
});

test("a forced refresh never reuses a cached wallet token", () => {
  assert.equal(
    shouldReuseWalletToken({
      forceRefreshToken: true,
      hasValidToken: true,
    }),
    false,
  );
});

test("a normal token request reuses a valid cached wallet token", () => {
  assert.equal(
    shouldReuseWalletToken({
      forceRefreshToken: false,
      hasValidToken: true,
    }),
    true,
  );
});

test("a cached token from the retired signing key is invalid", () => {
  assert.equal(isCurrentWalletAuthKeyId("velo-wallet-auth-v1"), false);
  assert.equal(isCurrentWalletAuthKeyId("velo-wallet-auth-v2"), false);
  assert.equal(isCurrentWalletAuthKeyId("velo-wallet-auth-v3"), true);
});
