import assert from "node:assert/strict";
import test from "node:test";

import {
  isSidebarPathActive,
  projectDestination,
} from "../../../../packages/ui/src/components/ui-customs/sidebar/project-navigation.ts";
import {
  formatStroopsAsXlm,
  formatGasTelemetryStroops,
  createGasPolicyFormState,
  createGasPolicyStoredState,
  gasPolicyStoredStateFromUpdate,
  reduceGasPolicyFormState,
  getGasPolicySaveError,
  initializeGasPolicyDraft,
  getGasAccessState,
  getGasRelayerBalanceFreshness,
  getGasRelayerBalanceState,
  getGasRelayerRefreshCooldownRemaining,
  getGasRelayerRefreshCooldownUntil,
  getGasRelayerRefreshFeedback,
  getGasTelemetryAvailabilityMessage,
  getGasTelemetryDayKeys,
  getGasTelemetryHistoryRows,
  getGasUsagePercentage,
  getMillisecondsUntilNextUtcMidnight,
  getUtcDayKey,
  isCurrentGasRelayerRefreshRequest,
  parseXlmToStroops,
  type GasPolicyDraft,
  type GasPolicyFormState,
  type GasRelayerRefreshResult,
  type GasRelayerSnapshot,
  type GasTelemetrySnapshot,
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

test("keeps telemetry zero, one stroop, and large exact values distinct", () => {
  assert.equal(formatGasTelemetryStroops(null), "Unavailable");
  assert.equal(formatGasTelemetryStroops("0"), "0.0000000 XLM");
  assert.equal(formatGasTelemetryStroops("1"), "0.0000001 XLM");
  assert.equal(formatGasTelemetryStroops("9223372036854775807"), "922337203685.4775807 XLM");
});

test("bounds cap usage with bigint arithmetic and never divides a zero cap", () => {
  assert.equal(getGasUsagePercentage("0", "0"), null);
  assert.equal(getGasUsagePercentage("0", "100"), 0);
  assert.equal(getGasUsagePercentage("100", "100"), 100);
  assert.equal(getGasUsagePercentage("101", "100"), 100);
  assert.equal(getGasUsagePercentage("9007199254740991", "9223372036854775807"), 0);
  assert.equal(getGasUsagePercentage(null, "100"), null);
});

function telemetryFixture(overrides: Partial<GasTelemetrySnapshot> = {}): GasTelemetrySnapshot {
  return {
    reportingDayKey: "2026-01-01",
    confirmedFeeStroops: "1",
    outstandingHoldsStroops: "2",
    effectiveUsageStroops: "3",
    policyCapStroops: "100",
    availability: "available",
    reasonCode: null,
    accountingBlockReason: null,
    sourceUpdatedAt: 1_767_242_800_000,
    historyCompleteness: "partial",
    history: [
      {
        reportingDayKey: "2025-12-26",
        confirmedFeeStroops: null,
        sourceUpdatedAt: null,
      },
      {
        reportingDayKey: "2025-12-27",
        confirmedFeeStroops: "0",
        sourceUpdatedAt: 1_767_242_800_000,
      },
      {
        reportingDayKey: "2025-12-28",
        confirmedFeeStroops: null,
        sourceUpdatedAt: null,
      },
      {
        reportingDayKey: "2025-12-29",
        confirmedFeeStroops: null,
        sourceUpdatedAt: null,
      },
      {
        reportingDayKey: "2025-12-30",
        confirmedFeeStroops: null,
        sourceUpdatedAt: null,
      },
      {
        reportingDayKey: "2025-12-31",
        confirmedFeeStroops: null,
        sourceUpdatedAt: null,
      },
      {
        reportingDayKey: "2026-01-01",
        confirmedFeeStroops: "1",
        sourceUpdatedAt: 1_767_242_800_000,
      },
    ],
    ...overrides,
  };
}

test("preserves partial history gaps and blocked totals with valid history", () => {
  const partial = telemetryFixture();
  const rows = getGasTelemetryHistoryRows(partial, "2026-01-01");
  assert.deepEqual(rows, partial.history);
  assert.equal(rows[0]?.confirmedFeeStroops, null);
  assert.equal(rows[1]?.confirmedFeeStroops, "0");

  const blocked = telemetryFixture({
    availability: "unavailable",
    reasonCode: "accounting_blocked",
    confirmedFeeStroops: null,
    outstandingHoldsStroops: null,
    effectiveUsageStroops: null,
  });
  assert.match(getGasTelemetryAvailabilityMessage(blocked), /valid history remains visible/);
  assert.equal(getGasTelemetryHistoryRows(blocked, "2026-01-01")[6]?.confirmedFeeStroops, "1");
});

test("refreshes reporting days across UTC month and year rollover", () => {
  assert.equal(getUtcDayKey(Date.parse("2025-12-31T23:59:59.999Z")), "2025-12-31");
  assert.equal(getUtcDayKey(Date.parse("2026-01-01T00:00:00.000Z")), "2026-01-01");
  assert.equal(getMillisecondsUntilNextUtcMidnight(Date.parse("2025-12-31T23:59:59.999Z")), 1);
  assert.deepEqual(getGasTelemetryDayKeys("2026-01-01"), [
    "2025-12-26",
    "2025-12-27",
    "2025-12-28",
    "2025-12-29",
    "2025-12-30",
    "2025-12-31",
    "2026-01-01",
  ]);
});

const RELAYER_SNAPSHOT = {
  publicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  network: "testnet",
  status: "active",
  balanceStroops: "12345678",
  balanceUpdatedAt: 1_700_000_000_000,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
} satisfies GasRelayerSnapshot;

test("distinguishes an exact zero balance from an absent balance", () => {
  assert.equal(getGasRelayerBalanceState("0"), "zero");
  assert.equal(getGasRelayerBalanceState("1"), "observed");
  assert.equal(getGasRelayerBalanceState(null), "unverified");
  assert.equal(formatStroopsAsXlm("0"), "0.0000000 XLM");
  assert.equal(formatStroopsAsXlm(RELAYER_SNAPSHOT.balanceStroops), "1.2345678 XLM");
});

test("marks relayer snapshots fresh before five minutes and stale at the boundary", () => {
  const now = RELAYER_SNAPSHOT.balanceUpdatedAt + 5 * 60 * 1_000;
  assert.equal(
    getGasRelayerBalanceFreshness(RELAYER_SNAPSHOT.balanceStroops, now - 1, now),
    "fresh",
  );
  assert.equal(
    getGasRelayerBalanceFreshness(RELAYER_SNAPSHOT.balanceStroops, now - 5 * 60 * 1_000, now),
    "stale",
  );
  assert.equal(getGasRelayerBalanceFreshness(null, null, now), "never_verified");
});

test("does not treat malformed or future verification timestamps as fresh", () => {
  const now = RELAYER_SNAPSHOT.balanceUpdatedAt + 1_000;
  assert.equal(
    getGasRelayerBalanceFreshness(RELAYER_SNAPSHOT.balanceStroops, Number.NaN, now),
    "invalid_timestamp",
  );
  assert.equal(
    getGasRelayerBalanceFreshness(RELAYER_SNAPSHOT.balanceStroops, now + 1, now),
    "invalid_timestamp",
  );
  assert.equal(getGasRelayerBalanceFreshness("1", null, now), "never_verified");
});

test("starts a 30-second cooldown, honors shared retry windows, and expires exactly", () => {
  const dispatchedAt = RELAYER_SNAPSHOT.balanceUpdatedAt;
  const localUntil = getGasRelayerRefreshCooldownUntil(dispatchedAt, dispatchedAt);
  assert.equal(getGasRelayerRefreshCooldownRemaining(localUntil, dispatchedAt), 30_000);
  assert.equal(getGasRelayerRefreshCooldownRemaining(localUntil, localUntil), 0);

  const sharedUntil = getGasRelayerRefreshCooldownUntil(dispatchedAt, dispatchedAt + 2_000, 45_000);
  assert.equal(getGasRelayerRefreshCooldownRemaining(sharedUntil, dispatchedAt + 2_000), 45_000);
});

test("sanitizes every refresh outcome and retains the subscription snapshot", () => {
  const outcomes: GasRelayerRefreshResult[] = [
    { status: "success", relayer: RELAYER_SNAPSHOT },
    { status: "cooldown", retryAfterMs: 1_000 },
    { status: "missing_relayer" },
    { status: "account_not_found", relayer: RELAYER_SNAPSHOT },
    { status: "reader_failure", reason: "timeout", relayer: RELAYER_SNAPSHOT },
    { status: "stale_refresh" },
  ];

  for (const outcome of outcomes) {
    const feedback = getGasRelayerRefreshFeedback(outcome);
    assert.equal(feedback.retainsSnapshot, true, outcome.status);
    assert.ok(feedback.message.length > 0, outcome.status);
    assert.doesNotMatch(feedback.message, /secret|token|provider body|stack/i, outcome.status);
  }

  assert.match(
    getGasRelayerRefreshFeedback({
      status: "account_not_found",
      relayer: RELAYER_SNAPSHOT,
    }).message,
    /last verified snapshot is unchanged/,
  );
  assert.match(
    getGasRelayerRefreshFeedback({
      status: "reader_failure",
      reason: "malformed_response",
      relayer: RELAYER_SNAPSHOT,
    }).message,
    /last verified balance and verification time are unchanged/,
  );
});

test("rejects obsolete refresh completions from another request or identity context", () => {
  const request = { id: 1, contextVersion: 1 } as const;
  assert.equal(isCurrentGasRelayerRefreshRequest(request, request), true);
  assert.equal(isCurrentGasRelayerRefreshRequest(null, request), false);
  assert.equal(isCurrentGasRelayerRefreshRequest({ id: 2, contextVersion: 1 }, request), false);
  assert.equal(isCurrentGasRelayerRefreshRequest({ id: 1, contextVersion: 2 }, request), false);
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

function formState(policy: Parameters<typeof createGasPolicyStoredState>[0] = null) {
  return createGasPolicyFormState(createGasPolicyStoredState(policy));
}

function updateValues(overrides: Partial<GasPolicyDraft> = {}) {
  const values = validateGasPolicyDraft(draft(overrides));
  assert.equal(values.ok, true);
  if (!values.ok) throw new Error("Expected valid Gas policy values");
  return values.values;
}

function editState(state: GasPolicyFormState, overrides: Partial<GasPolicyDraft>) {
  return reduceGasPolicyFormState(state, { type: "edit", draft: draft(overrides) });
}

test("transitions through saving, saved readback, and duplicate-submit guard", () => {
  const initial = formState();
  const values = updateValues({ enabled: false, dailyCapXlm: "2.5", walletHourlyLimit: "8" });
  const expected = gasPolicyStoredStateFromUpdate(values);
  const edited = editState(initial, {
    enabled: false,
    dailyCapXlm: "2.5",
    walletHourlyLimit: "8",
  });
  const saving = reduceGasPolicyFormState(edited, { type: "save-start", id: 1, expected });
  assert.equal(saving.savePhase, "saving");
  assert.equal(reduceGasPolicyFormState(saving, { type: "save-start", id: 2, expected }), saving);

  const saved = reduceGasPolicyFormState(saving, {
    type: "save-success",
    id: 1,
    stored: expected,
  });
  assert.equal(saved.savePhase, "saved");
  assert.equal(saved.hasRemoteUpdate, false);
  assert.deepEqual(saved.draft, expected.draft);
});

test("preserves a rejected draft and maps only the structured cap error", () => {
  const values = updateValues({ dailyCapXlm: "3" });
  const expected = gasPolicyStoredStateFromUpdate(values);
  const edited = editState(formState(), { dailyCapXlm: "3" });
  const saving = reduceGasPolicyFormState(edited, { type: "save-start", id: 7, expected });
  const rejected = reduceGasPolicyFormState(saving, {
    type: "save-failure",
    id: 7,
    error: "cap_below_effective_usage",
  });

  assert.equal(rejected.savePhase, "error");
  assert.equal(rejected.saveError, "cap_below_effective_usage");
  assert.equal(rejected.draft.dailyCapXlm, "3");
  assert.equal(
    getGasPolicySaveError({ data: { code: "daily_cap_below_effective_usage" } }),
    "cap_below_effective_usage",
  );
  assert.equal(getGasPolicySaveError({ data: { code: "permission_denied" } }), "generic");
});

test("preserves dirty drafts and blocks save on editable remote conflicts", () => {
  const original = {
    enabled: true,
    dailyCapStroops: "10000000",
    walletHourlyLimit: 4,
    allowedContractIds: [VALID_CONTRACT_ID],
  };
  const edited = editState(formState(original), { dailyCapXlm: "2" });
  const remote = createGasPolicyStoredState({
    ...original,
    dailyCapStroops: "30000000",
    updatedAt: 2,
  });
  const conflicted = reduceGasPolicyFormState(edited, { type: "remote", stored: remote });
  assert.equal(conflicted.hasRemoteUpdate, true);
  assert.equal(conflicted.draft.dailyCapXlm, "2");
  assert.equal(
    reduceGasPolicyFormState(conflicted, {
      type: "save-start",
      id: 1,
      expected: gasPolicyStoredStateFromUpdate(updateValues({ dailyCapXlm: "2" })),
    }),
    conflicted,
  );

  const reset = reduceGasPolicyFormState(conflicted, { type: "reset" });
  assert.equal(reset.hasRemoteUpdate, false);
  assert.deepEqual(reset.draft, remote.draft);
  assert.equal(reset.savePhase, "idle");
});

test("keeps Reset available when a remote change races a successful acknowledgement", () => {
  const original = {
    enabled: true,
    dailyCapStroops: "10000000",
    walletHourlyLimit: 4,
    allowedContractIds: [VALID_CONTRACT_ID],
  };
  const values = updateValues({ dailyCapXlm: "2" });
  const expected = gasPolicyStoredStateFromUpdate(values);
  const saving = reduceGasPolicyFormState(editState(formState(original), { dailyCapXlm: "2" }), {
    type: "save-start",
    id: 4,
    expected,
  });
  const remote = createGasPolicyStoredState({ ...original, dailyCapStroops: "3" });
  const conflict = reduceGasPolicyFormState(saving, { type: "remote", stored: remote });
  const acknowledged = reduceGasPolicyFormState(conflict, {
    type: "save-success",
    id: 4,
    stored: expected,
  });

  assert.equal(acknowledged.hasRemoteUpdate, true);
  assert.deepEqual(acknowledged.draft, expected.draft);
  assert.deepEqual(reduceGasPolicyFormState(acknowledged, { type: "reset" }).draft, remote.draft);
});

test("pristine forms follow remote editable values while accounting-only updates are ignored", () => {
  const original = {
    enabled: true,
    dailyCapStroops: "10000000",
    dailyReservedStroops: "0",
    walletHourlyLimit: 4,
    allowedContractIds: [VALID_CONTRACT_ID],
    updatedAt: 1,
  };
  const initial = formState(original);
  const accountingOnly = createGasPolicyStoredState({
    ...original,
    dailyReservedStroops: "9",
    updatedAt: 2,
  });
  assert.equal(
    reduceGasPolicyFormState(initial, { type: "remote", stored: accountingOnly }),
    initial,
  );

  const changed = createGasPolicyStoredState({ ...original, dailyCapStroops: "20000000" });
  const followed = reduceGasPolicyFormState(initial, { type: "remote", stored: changed });
  assert.equal(followed.hasRemoteUpdate, false);
  assert.deepEqual(followed.draft, changed.draft);
});

test("ignores stale subscription ordering around a successful save", () => {
  const original = {
    enabled: true,
    dailyCapStroops: "10000000",
    walletHourlyLimit: 4,
    allowedContractIds: [VALID_CONTRACT_ID],
  };
  const initial = formState(original);
  const values = updateValues({ dailyCapXlm: "2", walletHourlyLimit: "6" });
  const expected = gasPolicyStoredStateFromUpdate(values);
  const saving = reduceGasPolicyFormState(
    editState(initial, { dailyCapXlm: "2", walletHourlyLimit: "6" }),
    { type: "save-start", id: 3, expected },
  );
  const sawExpectedBeforeResponse = reduceGasPolicyFormState(saving, {
    type: "remote",
    stored: expected,
  });
  const acknowledged = reduceGasPolicyFormState(sawExpectedBeforeResponse, {
    type: "save-success",
    id: 3,
    stored: expected,
  });
  const stale = reduceGasPolicyFormState(acknowledged, {
    type: "remote",
    stored: createGasPolicyStoredState(original),
  });

  assert.equal(stale.hasRemoteUpdate, false);
  assert.deepEqual(stale.draft, expected.draft);
  const editedAfterAcknowledgement = reduceGasPolicyFormState(stale, {
    type: "edit",
    draft: draft({ dailyCapXlm: "4", walletHourlyLimit: "6" }),
  });
  const staleAfterEdit = reduceGasPolicyFormState(editedAfterAcknowledgement, {
    type: "remote",
    stored: createGasPolicyStoredState(original),
  });
  assert.equal(staleAfterEdit.hasRemoteUpdate, false);
  assert.equal(staleAfterEdit.draft.dailyCapXlm, "4");
  assert.deepEqual(
    reduceGasPolicyFormState(acknowledged, {
      type: "save-success",
      id: 2,
      stored: createGasPolicyStoredState(original),
    }),
    acknowledged,
  );
});
