import assert from "node:assert/strict";
import test from "node:test";

import {
  isSidebarPathActive,
  projectDestination,
} from "../../../../packages/ui/src/components/ui-customs/sidebar/project-navigation.ts";
import {
  formatStroopsAsXlm,
  initializeGasPolicyDraft,
  getGasAccessState,
  parseXlmToStroops,
  type GasPolicyDraft,
  validateGasPolicyDraft,
} from "./gas-ui.ts";

const VALID_CONTRACT_ID = "CC7RENKPGXGF6MMEMGJ4YWUBOBGQYOCGG33PNSONQF56UMMAQ22TWH6R";
const SECOND_VALID_CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA2ZMN";

function draft(overrides: Partial<GasPolicyDraft> = {}): GasPolicyDraft {
  return {
    enabled: true,
    dailyCapXlm: "1.25",
    walletHourlyLimit: "3",
    allowedContractIdsText: VALID_CONTRACT_ID,
    ...overrides,
  };
}

test("formats exact stroops as seven-decimal XLM without floating point conversion", () => {
  assert.equal(formatStroopsAsXlm("0"), "0.0000000 XLM");
  assert.equal(formatStroopsAsXlm("1"), "0.0000001 XLM");
  assert.equal(formatStroopsAsXlm("12345678"), "1.2345678 XLM");
  assert.equal(formatStroopsAsXlm("9223372036854775807"), "922337203685.4775807 XLM");
  assert.equal(formatStroopsAsXlm("1.0"), "Unavailable");
});

test("parses exact XLM boundaries into stroops", () => {
  assert.equal(parseXlmToStroops("0"), "0");
  assert.equal(parseXlmToStroops("0.0000001"), "1");
  assert.equal(parseXlmToStroops("922337203685.4775807"), "9223372036854775807");
  assert.equal(parseXlmToStroops(" 001.2500000 "), "12500000");
});

test("rejects malformed, negative, exponent, over-precision, and overflowing XLM input", () => {
  for (const value of [
    "",
    "   ",
    "-1",
    "+1",
    "1e3",
    "1_000",
    ".1",
    "1.",
    "1.12345678",
    "922337203685.4775808",
    "922337203686",
  ]) {
    assert.equal(validateGasPolicyDraft(draft({ dailyCapXlm: value })).ok, false, value);
  }
});

test("normalizes safe integer quota and rejects fractional or overflowing quota", () => {
  const valid = validateGasPolicyDraft(
    draft({ walletHourlyLimit: String(Number.MAX_SAFE_INTEGER) }),
  );
  assert.equal(valid.ok, true);
  if (valid.ok) assert.equal(valid.values.walletHourlyLimit, Number.MAX_SAFE_INTEGER);

  for (const value of ["1.5", "-1", "1e3", "", "9007199254740992"]) {
    const result = validateGasPolicyDraft(draft({ walletHourlyLimit: value }));
    assert.equal(result.ok, false, value);
    if (!result.ok)
      assert.match(result.errors.walletHourlyLimit ?? "", /whole number|safe integer/);
  }
});

test("initializes absent policy with restrictive zero and empty defaults", () => {
  assert.deepEqual(initializeGasPolicyDraft(null), {
    enabled: false,
    dailyCapXlm: "0",
    walletHourlyLimit: "0",
    allowedContractIdsText: "",
  });
});

test("normalizes, ignores blanks, deduplicates, and preserves allowlist order", () => {
  const result = validateGasPolicyDraft(
    draft({
      allowedContractIdsText: `\n ${VALID_CONTRACT_ID.toLowerCase()} \n${SECOND_VALID_CONTRACT_ID}\n ${VALID_CONTRACT_ID} \n`,
    }),
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.values.allowedContractIds, [
      VALID_CONTRACT_ID,
      SECOND_VALID_CONTRACT_ID,
    ]);
  }
});

test("returns updatePolicy-compatible normalized fields without a project or mutation", () => {
  const result = validateGasPolicyDraft(
    draft({
      enabled: false,
      dailyCapXlm: "0.0000001",
      walletHourlyLimit: "7",
      allowedContractIdsText: VALID_CONTRACT_ID.toLowerCase(),
    }),
  );

  assert.deepEqual(result, {
    ok: true,
    values: {
      enabled: false,
      dailyCapStroops: "1",
      walletHourlyLimit: 7,
      allowedContractIds: [VALID_CONTRACT_ID],
    },
    errors: {},
  });
});

test("rejects invalid checksums and counts 21 nonblank entries before deduplication", () => {
  const invalid = validateGasPolicyDraft(
    draft({ allowedContractIdsText: `${VALID_CONTRACT_ID.slice(0, -1)}A` }),
  );
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.match(invalid.errors.allowedContractIdsText ?? "", /valid Stellar/);

  const tooMany = validateGasPolicyDraft(
    draft({ allowedContractIdsText: Array(21).fill(VALID_CONTRACT_ID).join("\n") }),
  );
  assert.equal(tooMany.ok, false);
  if (!tooMany.ok) assert.match(tooMany.errors.allowedContractIdsText ?? "", /20/);

  const exactlyTwenty = validateGasPolicyDraft(
    draft({ allowedContractIdsText: Array(20).fill(VALID_CONTRACT_ID).join("\n") }),
  );
  assert.equal(exactlyTwenty.ok, true);
  if (exactlyTwenty.ok)
    assert.deepEqual(exactlyTwenty.values.allowedContractIds, [VALID_CONTRACT_ID]);
});

test("keeps membership loading, denied, and ready states distinct", () => {
  assert.equal(
    getGasAccessState({ walletAddress: null, access: undefined, project: undefined }),
    "connect",
  );
  assert.equal(
    getGasAccessState({ walletAddress: "G...", access: undefined, project: undefined }),
    "loading",
  );
  assert.equal(
    getGasAccessState({ walletAddress: "G...", access: null, project: undefined }),
    "unavailable",
  );
  assert.equal(
    getGasAccessState({
      walletAddress: "G...",
      access: { role: "viewer" },
      project: null,
    }),
    "unavailable",
  );
  assert.equal(
    getGasAccessState({
      walletAddress: "G...",
      access: { role: "viewer" },
      project: { _id: "member-project" },
    }),
    "ready",
  );
});

test("builds member deep links even when the owner switcher list is empty", () => {
  assert.equal(projectDestination("member-project", "/gas"), "/projects/member-project/gas");
  assert.equal(projectDestination(null, "/gas"), null);
  assert.equal(
    isSidebarPathActive("/projects/member-project/gas", "/projects/member-project/gas"),
    true,
  );
  assert.equal(isSidebarPathActive("/dashboard", "/projects/member-project/gas"), false);
});
