import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type {
  GasTelemetryHistoryEntry,
  GasTelemetryProjection,
  GasTelemetryReasonCode,
} from "./projections";

import { addStroopValues, assertValidGasPolicyState, assertValidStroopValue } from "./validation";

type GasTelemetryContext = Pick<QueryCtx, "db">;
type GasPolicy = Doc<"gasPolicies">;
type GasDailyAccounting = Doc<"gasDailyAccounting">;
type DailyLookup = GasDailyAccounting | null | "ambiguous";

const UTC_DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const HISTORY_DAYS = 7;

/** Normalize the caller-supplied reporting day without consulting wall-clock time. */
export function normalizeTelemetryDayKey(value: string): string {
  if (!UTC_DAY_KEY_PATTERN.test(value)) throw new Error("Invalid UTC reporting day");

  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("Invalid UTC reporting day");
  }

  return value;
}

function addUtcDays(dayKey: string, days: number): string {
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isValidAccountingTimestamp(value: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    value > 0 &&
    Number.isFinite(value) &&
    Number.isFinite(new Date(value).getTime())
  );
}

function validPolicyTimestamps(policy: GasPolicy): boolean {
  return (
    isValidAccountingTimestamp(policy.createdAt) &&
    isValidAccountingTimestamp(policy.updatedAt) &&
    policy.updatedAt >= policy.createdAt
  );
}

function validateDailyAccounting(
  record: GasDailyAccounting,
  projectId: Id<"projects">,
  reportingDayKey: string,
): bigint | null {
  if (
    record.projectId !== projectId ||
    record.accountingDayKey !== reportingDayKey ||
    !UTC_DAY_KEY_PATTERN.test(record.accountingDayKey) ||
    !isValidAccountingTimestamp(record.createdAt) ||
    !isValidAccountingTimestamp(record.updatedAt) ||
    record.updatedAt < record.createdAt
  ) {
    return null;
  }

  try {
    return assertValidStroopValue(record.confirmedSpendStroops);
  } catch {
    return null;
  }
}

async function findPolicy(
  ctx: GasTelemetryContext,
  projectId: Id<"projects">,
): Promise<GasPolicy | null | "ambiguous"> {
  const matches = await ctx.db
    .query("gasPolicies")
    .withIndex("by_project_id", (q) => q.eq("projectId", projectId))
    .take(2);
  if (matches.length > 1) return "ambiguous";
  return matches[0] ?? null;
}

async function findDailyAccounting(
  ctx: GasTelemetryContext,
  projectId: Id<"projects">,
  accountingDayKey: string,
): Promise<DailyLookup> {
  const matches = await ctx.db
    .query("gasDailyAccounting")
    .withIndex("by_project_id_and_accounting_day_key", (q) =>
      q.eq("projectId", projectId).eq("accountingDayKey", accountingDayKey),
    )
    .take(2);
  if (matches.length > 1) return "ambiguous";
  return matches[0] ?? null;
}

function emptyHistory(dayKeys: readonly string[]): GasTelemetryHistoryEntry[] {
  return dayKeys.map((reportingDayKey) => ({
    reportingDayKey,
    confirmedFeeStroops: null,
    sourceUpdatedAt: null,
  }));
}

function unavailableTelemetry(
  reportingDayKey: string,
  reasonCode: GasTelemetryReasonCode,
  options: {
    policyCapStroops?: string | null;
    accountingBlockReason?: GasTelemetryProjection["accountingBlockReason"];
    sourceUpdatedAt?: number | null;
    history?: GasTelemetryHistoryEntry[];
    historyCompleteness?: GasTelemetryProjection["historyCompleteness"];
  } = {},
): GasTelemetryProjection {
  return {
    reportingDayKey,
    confirmedFeeStroops: null,
    outstandingHoldsStroops: null,
    effectiveUsageStroops: null,
    policyCapStroops: options.policyCapStroops ?? null,
    availability: "unavailable",
    reasonCode,
    accountingBlockReason: options.accountingBlockReason ?? null,
    sourceUpdatedAt: options.sourceUpdatedAt ?? null,
    historyCompleteness: options.historyCompleteness ?? "unavailable",
    history: options.history ?? [],
  };
}

/**
 * Read and validate fee telemetry without initializing, rolling, or blocking
 * accounting. Every identity lookup is bounded by the existing project/day
 * index and a two-row uniqueness check.
 */
export async function readGasTelemetry(
  ctx: GasTelemetryContext,
  projectId: Id<"projects">,
  requestedDayKey: string,
): Promise<GasTelemetryProjection> {
  const reportingDayKey = normalizeTelemetryDayKey(requestedDayKey);
  const dayKeys = Array.from({ length: HISTORY_DAYS }, (_, index) =>
    addUtcDays(reportingDayKey, index - (HISTORY_DAYS - 1)),
  );

  const policyLookup = await findPolicy(ctx, projectId);
  if (policyLookup === "ambiguous") {
    return unavailableTelemetry(reportingDayKey, "ambiguous_policy_identity", {
      history: emptyHistory(dayKeys),
    });
  }
  if (policyLookup === null) {
    return unavailableTelemetry(reportingDayKey, "missing_policy", {
      history: emptyHistory(dayKeys),
    });
  }

  const policy = policyLookup;
  const dailyLookups = new Map<string, DailyLookup>();
  for (const dayKey of dayKeys) {
    dailyLookups.set(dayKey, await findDailyAccounting(ctx, projectId, dayKey));
  }

  let policyCapStroops: bigint | null = null;
  let policyShapeValid = true;
  try {
    assertValidGasPolicyState(policy);
    if (!validPolicyTimestamps(policy)) throw new Error("Invalid Gas policy timestamps");
    policyCapStroops = assertValidStroopValue(policy.dailyCapStroops);
  } catch {
    policyShapeValid = false;
  }

  const policySourceUpdatedAt = validPolicyTimestamps(policy) ? policy.updatedAt : null;
  const policyCapString = policyCapStroops?.toString() ?? null;
  const history = emptyHistory(dayKeys);
  const validDailyValues = new Map<string, bigint>();
  const dailyUpdatedAt = new Map<string, number>();
  let hasAmbiguousDailyIdentity = false;
  let hasInvalidDailyRecord = false;

  for (const [index, dayKey] of dayKeys.entries()) {
    const lookup = dailyLookups.get(dayKey);
    if (lookup === "ambiguous") {
      hasAmbiguousDailyIdentity = true;
      continue;
    }
    if (lookup === null || lookup === undefined) continue;

    const value = validateDailyAccounting(lookup, projectId, dayKey);
    if (value === null) {
      hasInvalidDailyRecord = true;
      continue;
    }

    validDailyValues.set(dayKey, value);
    dailyUpdatedAt.set(dayKey, lookup.updatedAt);
    history[index] = {
      reportingDayKey: dayKey,
      confirmedFeeStroops: value.toString(),
      sourceUpdatedAt: lookup.updatedAt,
    };
  }

  const policyWindowKey = policy.dailyWindowKey;
  const requestedDayIsForward =
    policyShapeValid &&
    UTC_DAY_KEY_PATTERN.test(policyWindowKey) &&
    reportingDayKey > policyWindowKey;
  const policyWindowIsInHistory = dayKeys.includes(policyWindowKey);
  let policyWindowLookup: DailyLookup | undefined = policyWindowIsInHistory
    ? dailyLookups.get(policyWindowKey)
    : undefined;

  const accountingInitialized =
    policyShapeValid &&
    policy.accountingState === "initialized" &&
    policy.outstandingHoldsStroops !== undefined &&
    policy.dailyConfirmedSpendStroops !== undefined;

  // A forward report can be more recent than the seven returned history rows.
  // Validate the stored accounting day only in that case; this keeps the
  // maximum Gas reads at two policy rows + fourteen history rows + two rows.
  if (accountingInitialized && requestedDayIsForward && !policyWindowIsInHistory) {
    policyWindowLookup = await findDailyAccounting(ctx, projectId, policyWindowKey);
  }

  let accountingIssue: GasTelemetryReasonCode | null = null;
  let currentAccountingBlockReason: GasTelemetryProjection["accountingBlockReason"] =
    policy.accountingBlockReason ?? null;

  if (!policyShapeValid) {
    accountingIssue = "invalid_policy";
  } else if (policy.accountingBlockReason !== undefined) {
    accountingIssue = "accounting_blocked";
  } else if (policy.accountingState === "overflow") {
    accountingIssue = "overflow";
  } else if (!accountingInitialized) {
    accountingIssue = "uninitialized_accounting";
  }

  let outstandingHoldsStroops: bigint | null = null;
  let storedConfirmedSpendStroops: bigint | null = null;
  let accountingStateValidated = false;

  if (accountingInitialized) {
    const policyOutstandingHoldsStroops = policy.outstandingHoldsStroops;
    const policyDailyConfirmedSpendStroops = policy.dailyConfirmedSpendStroops;
    try {
      if (
        policyOutstandingHoldsStroops === undefined ||
        policyDailyConfirmedSpendStroops === undefined
      ) {
        throw new Error("Missing initialized accounting counters");
      }
      outstandingHoldsStroops = assertValidStroopValue(policyOutstandingHoldsStroops);
      storedConfirmedSpendStroops = assertValidStroopValue(policyDailyConfirmedSpendStroops);
      const storedEffectiveUsageStroops = addStroopValues(
        storedConfirmedSpendStroops,
        outstandingHoldsStroops,
      );
      if (
        storedEffectiveUsageStroops !== policy.dailyReservedStroops ||
        storedEffectiveUsageStroops > policy.dailyCapStroops
      ) {
        accountingIssue ??= "inconsistent_counters";
      } else {
        accountingStateValidated = true;
      }
    } catch {
      accountingIssue ??= "overflow";
    }
  }

  const policyWindowValue =
    policyWindowLookup === null || policyWindowLookup === undefined
      ? null
      : policyWindowLookup === "ambiguous"
        ? null
        : validateDailyAccounting(policyWindowLookup, projectId, policyWindowKey);

  if (accountingInitialized) {
    if (policyWindowLookup === "ambiguous") {
      accountingIssue ??= "ambiguous_accounting_identity";
    } else if (policyWindowLookup !== null && policyWindowLookup !== undefined) {
      if (policyWindowValue === null) {
        accountingIssue ??= "inconsistent_counters";
      } else if (policyWindowValue !== storedConfirmedSpendStroops) {
        accountingIssue ??= "inconsistent_counters";
      }
    } else if (
      requestedDayIsForward &&
      !policyWindowIsInHistory &&
      storedConfirmedSpendStroops !== 0n
    ) {
      // A forward rollover cannot treat an absent out-of-window source row as
      // complete when the stored policy counter says non-zero spend.
      accountingIssue ??= "inconsistent_counters";
    }
  }

  if (hasAmbiguousDailyIdentity) accountingIssue ??= "ambiguous_accounting_identity";
  if (hasInvalidDailyRecord) accountingIssue ??= "inconsistent_counters";

  const historyCanUseInitializedZeros =
    accountingStateValidated && accountingIssue === null && policyWindowLookup !== "ambiguous";
  if (historyCanUseInitializedZeros) {
    for (const [index, dayKey] of dayKeys.entries()) {
      const historyEntry = history[index];
      if (!historyEntry || historyEntry.confirmedFeeStroops !== null) continue;
      if (dayKey === policyWindowKey && storedConfirmedSpendStroops !== null) {
        history[index] = {
          reportingDayKey: dayKey,
          confirmedFeeStroops: storedConfirmedSpendStroops.toString(),
          sourceUpdatedAt: policySourceUpdatedAt,
        };
      } else if (dayKey > policyWindowKey) {
        history[index] = {
          reportingDayKey: dayKey,
          confirmedFeeStroops: "0",
          sourceUpdatedAt: policySourceUpdatedAt,
        };
      }
    }
  }

  if (
    accountingIssue === null &&
    policyShapeValid &&
    !requestedDayIsForward &&
    reportingDayKey < policyWindowKey
  ) {
    accountingIssue = "requested_day_before_policy_window";
  }

  let confirmedFeeStroops: bigint | null = null;
  let effectiveUsageStroops: bigint | null = null;
  let sourceUpdatedAt = policySourceUpdatedAt;

  if (accountingIssue === null && accountingStateValidated && reportingDayKey >= policyWindowKey) {
    const reportingDayLookup = dailyLookups.get(reportingDayKey);
    if (reportingDayLookup === "ambiguous") {
      accountingIssue = "ambiguous_accounting_identity";
    } else if (reportingDayLookup !== null && reportingDayLookup !== undefined) {
      confirmedFeeStroops = validDailyValues.get(reportingDayKey) ?? null;
      sourceUpdatedAt = dailyUpdatedAt.get(reportingDayKey) ?? sourceUpdatedAt;
      if (confirmedFeeStroops === null) accountingIssue = "inconsistent_counters";
    } else if (reportingDayKey === policyWindowKey) {
      confirmedFeeStroops = storedConfirmedSpendStroops;
    } else {
      // Initialized accounting establishes that an unrecorded future day has
      // no confirmed spend yet. Outstanding holds still carry across rollover.
      confirmedFeeStroops = 0n;
    }

    if (
      accountingIssue === null &&
      confirmedFeeStroops !== null &&
      outstandingHoldsStroops !== null
    ) {
      try {
        effectiveUsageStroops = addStroopValues(confirmedFeeStroops, outstandingHoldsStroops);
        if (effectiveUsageStroops > policy.dailyCapStroops) {
          accountingIssue = "inconsistent_counters";
          effectiveUsageStroops = null;
        }
      } catch {
        accountingIssue = "overflow";
      }
    }
  }

  const historyCompleteness = history.every((entry) => entry.confirmedFeeStroops !== null)
    ? "complete"
    : policyShapeValid
      ? "partial"
      : "unavailable";

  if (accountingIssue !== null) {
    return unavailableTelemetry(reportingDayKey, accountingIssue, {
      policyCapStroops: policyCapString,
      accountingBlockReason: currentAccountingBlockReason,
      sourceUpdatedAt,
      history,
      historyCompleteness,
    });
  }

  return {
    reportingDayKey,
    confirmedFeeStroops: confirmedFeeStroops?.toString() ?? null,
    outstandingHoldsStroops: outstandingHoldsStroops?.toString() ?? null,
    effectiveUsageStroops: effectiveUsageStroops?.toString() ?? null,
    policyCapStroops: policyCapString,
    availability: "available",
    reasonCode: null,
    accountingBlockReason: currentAccountingBlockReason,
    sourceUpdatedAt,
    historyCompleteness,
    history,
  };
}
