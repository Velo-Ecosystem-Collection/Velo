import assert from "node:assert/strict";
import test from "node:test";

import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER,
} from "next/constants.js";

import { createNextConfig } from "../../next.config.js";

test("Gas fixture aliases are development-server-only", () => {
  assert.deepEqual(createNextConfig(PHASE_DEVELOPMENT_SERVER, false), {});

  const fixtureConfig = createNextConfig(PHASE_DEVELOPMENT_SERVER, true);
  assert.equal(fixtureConfig.distDir, ".next-gas-e2e");
  assert.deepEqual(Object.keys(fixtureConfig.turbopack.resolveAlias).sort(), [
    "@/core/providers/convex-provider",
    "@/core/wallet/wallet-provider",
    "convex/react",
  ]);

  for (const phase of [PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER]) {
    assert.throws(
      () => createNextConfig(phase, true),
      new RegExp("VELO_GAS_E2E_FIXTURES.*development-server-only"),
    );
    assert.deepEqual(createNextConfig(phase, false), {});
  }
});
