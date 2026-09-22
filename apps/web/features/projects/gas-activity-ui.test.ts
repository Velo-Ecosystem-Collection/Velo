import assert from "node:assert/strict";
import test from "node:test";

import {
  formatGasActivityFee,
  formatGasActivityTimestamp,
  GAS_DECISION_LABELS,
  GAS_EXECUTION_STATUS_LABELS,
  GAS_LIFECYCLE_LABELS,
  GAS_REJECTION_LABELS,
  getGasExplorerLink,
  STELLAR_EXPERT_TESTNET_ORIGIN,
} from "./gas-ui.ts";

test("labels every stored lifecycle, decision, and rejection state", () => {
  assert.deepEqual(Object.keys(GAS_LIFECYCLE_LABELS).sort(), [
    "cancelled",
    "claimed",
    "expired",
    "failed",
    "rejected",
    "reserved",
    "submission_unknown",
    "submitted",
    "succeeded",
  ]);
  assert.deepEqual(Object.keys(GAS_DECISION_LABELS).sort(), ["rejected", "reserved"]);
  assert.deepEqual(Object.keys(GAS_REJECTION_LABELS).sort(), [
    "contract_not_whitelisted",
    "daily_cap_exceeded",
    "duplicate_transaction",
    "invalid_signature",
    "policy_disabled",
    "unsupported_transaction",
    "wallet_rate_limited",
    "wrong_network",
  ]);
  assert.match(GAS_EXECUTION_STATUS_LABELS.submitted, /unresolved/);
  assert.match(GAS_EXECUTION_STATUS_LABELS.submission_unknown, /uncertain/);
});

test("keeps unknown fees distinct from exact zero and preserves exact amounts", () => {
  assert.equal(formatGasActivityFee(null), "Unknown");
  assert.equal(formatGasActivityFee(undefined), "Unknown");
  assert.equal(formatGasActivityFee("0"), "0.0000000 XLM");
  assert.equal(formatGasActivityFee("12345678"), "1.2345678 XLM");
  assert.equal(formatGasActivityFee("9223372036854775807"), "922337203685.4775807 XLM");
});

test("formats activity and receipt timestamps as UTC values", () => {
  assert.equal(
    formatGasActivityTimestamp(Date.parse("2026-09-16T12:00:00.000Z")),
    "2026-09-16T12:00:00.000Z",
  );
  assert.equal(formatGasActivityTimestamp("2026-09-16T12:15:00.000Z"), "2026-09-16T12:15:00.000Z");
  assert.equal(formatGasActivityTimestamp(null), "Unavailable");
  assert.equal(formatGasActivityTimestamp("not-a-date"), "Unavailable");
});

test("creates distinct validated Testnet inner and outer FeeBump lookups", () => {
  const hash = "a".repeat(64);
  const inner = getGasExplorerLink(hash, "inner");
  const outer = getGasExplorerLink(hash, "outer");

  assert.deepEqual(inner, {
    kind: "inner",
    hash,
    label: "Inner transaction lookup",
    url: `${STELLAR_EXPERT_TESTNET_ORIGIN}/tx/${hash}`,
  });
  assert.deepEqual(outer, {
    kind: "outer",
    hash,
    label: "Outer FeeBump lookup",
    url: `${STELLAR_EXPERT_TESTNET_ORIGIN}/tx/${hash}`,
  });
  assert.notEqual(inner?.label, outer?.label);
});

test("rejects invalid, absent, and non-hex transaction hashes for explorer links", () => {
  for (const hash of [null, undefined, "", "f".repeat(63), "g".repeat(64), "0x" + "a".repeat(64)]) {
    assert.equal(getGasExplorerLink(hash, "inner"), null, String(hash));
  }
  assert.ok(getGasExplorerLink("A".repeat(64), "outer"));
});
