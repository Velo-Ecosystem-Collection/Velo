import assert from "node:assert/strict";
import test from "node:test";

import { xdr } from "@stellar/stellar-sdk";

import {
  isSignedSmartAccountAuthPayload,
  isSignedSmartAccountAuthorization,
} from "./smart-account-auth-payload.ts";

function authPayload(overrides: { contextRuleIds?: xdr.ScVal; signers?: xdr.ScVal } = {}) {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("context_rule_ids"),
      val: overrides.contextRuleIds ?? xdr.ScVal.scvVec([xdr.ScVal.scvU32(0)]),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("signers"),
      val:
        overrides.signers ??
        xdr.ScVal.scvMap([
          new xdr.ScMapEntry({
            key: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("External")]),
            val: xdr.ScVal.scvBytes(Buffer.from("signed-payload")),
          }),
        ]),
    }),
  ]);
}

test("accepts context-aware smart-account authorization payloads", () => {
  assert.equal(isSignedSmartAccountAuthPayload(authPayload()), true);
  assert.equal(isSignedSmartAccountAuthorization(authPayload()), true);
  assert.equal(isSignedSmartAccountAuthorization(xdr.ScVal.scvVec([xdr.ScVal.scvVoid()])), true);
});

test("rejects malformed, empty, or legacy-untyped smart-account auth payloads", () => {
  assert.equal(isSignedSmartAccountAuthPayload(xdr.ScVal.scvVoid()), false);
  assert.equal(
    isSignedSmartAccountAuthPayload(authPayload({ contextRuleIds: xdr.ScVal.scvVec([]) })),
    false,
  );
  assert.equal(
    isSignedSmartAccountAuthPayload(
      authPayload({ contextRuleIds: xdr.ScVal.scvVec([xdr.ScVal.scvString("0")]) }),
    ),
    false,
  );
  assert.equal(
    isSignedSmartAccountAuthPayload(authPayload({ signers: xdr.ScVal.scvMap([]) })),
    false,
  );
  assert.equal(
    isSignedSmartAccountAuthPayload(
      xdr.ScVal.scvMap([
        ...authPayload().map()!,
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol("unexpected"),
          val: xdr.ScVal.scvVoid(),
        }),
      ]),
    ),
    false,
  );
});
