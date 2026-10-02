import assert from "node:assert/strict";
import test from "node:test";

import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER,
} from "next/constants.js";

import { createNextConfig } from "../../next.config.js";

test("wallet auth fixtures cannot enable an authentication bypass in production", () => {
  const previous = process.env.VELO_WALLET_AUTH_E2E_FIXTURES;
  process.env.VELO_WALLET_AUTH_E2E_FIXTURES = "1";
  try {
    assert.equal(
      createNextConfig(PHASE_DEVELOPMENT_SERVER, false).distDir,
      ".next-wallet-auth-e2e",
    );
    assert.throws(() => createNextConfig(PHASE_DEVELOPMENT_SERVER, true), /isolated development/);
    for (const phase of [PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER]) {
      assert.throws(() => createNextConfig(phase, false), /isolated development/);
    }
  } finally {
    if (previous === undefined) delete process.env.VELO_WALLET_AUTH_E2E_FIXTURES;
    else process.env.VELO_WALLET_AUTH_E2E_FIXTURES = previous;
  }
});
