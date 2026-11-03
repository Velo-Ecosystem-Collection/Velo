import assert from "node:assert/strict";
import test from "node:test";

import { getCheckoutAnchorError, requireInhouseApiKey } from "./config.ts";

test("checkout requires and trims the in-house API key", () => {
  assert.equal(
    requireInhouseApiKey({ VELO_INHOUSE_API_KEY: " tk_live_inhouse " }),
    "tk_live_inhouse",
  );
  assert.throws(() => requireInhouseApiKey({}), /VELO_INHOUSE_API_KEY is required/);
});

test("checkout accepts only omitted or in-house routing", () => {
  assert.equal(getCheckoutAnchorError(undefined), null);
  assert.equal(getCheckoutAnchorError("inhouse"), null);
  assert.deepEqual(getCheckoutAnchorError("pdax"), {
    status: 409,
    error: "PDAX payment routing is no longer available. Use an in-house API key and checkout.",
  });
  assert.deepEqual(getCheckoutAnchorError("other"), {
    status: 400,
    error: "anchor must be 'inhouse'.",
  });
});
