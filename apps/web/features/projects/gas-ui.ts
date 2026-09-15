import { assertValidContractId } from "@repo/stellar/validation";

import type { api } from "@repo/backend/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";

const STROOPS_PER_XLM = 10_000_000n;
const GAS_MAX_STROOPS = 2n ** 63n - 1n;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const XLM_AMOUNT_PATTERN = /^\d+(?:\.\d{1,7})?$/;
const NON_NEGATIVE_INTEGER_PATTERN = /^\d+$/;
const XLM_MAX_VALUE = "922337203685.4775807";
const MAX_ALLOWED_CONTRACT_IDS = 20;
export const GAS_POLICY_CAP_ERROR_CODE = "daily_cap_below_effective_usage" as const;
export const GAS_RELAYER_BALANCE_MAX_AGE_MS = 5 * 60 * 1_000;
export const GAS_RELAYER_LOCAL_COOLDOWN_MS = 30 * 1_000;

export type GasRelayerSnapshot = Exclude<
  FunctionReturnType<typeof api.gas.queries.getRelayerAccount>,
  null
>;
export type GasTelemetrySnapshot = FunctionReturnType<typeof api.gas.queries.getTelemetry>;
export type GasRelayerRefreshResult = FunctionReturnType<
  typeof api.gas.balance_action.refreshRelayerBalance
>;

export type GasRelayerBalanceState = "unverified" | "zero" | "observed";
export type GasRelayerBalanceFreshness = "fresh" | "stale" | "never_verified" | "invalid_timestamp";
export type GasRelayerRefreshFeedbackTone = "success" | "info" | "warning" | "error";
export type GasRelayerRefreshFeedback = {
  tone: GasRelayerRefreshFeedbackTone;
  message: string;
  /** The reactive relayer query remains the authoritative snapshot source. */
  retainsSnapshot: true;
};
export type GasRelayerRefreshRequest = {
  id: number;
  contextVersion: number;
};

export type GasAccessState = "connect" | "loading" | "unavailable" | "ready";

export type GasAccessSnapshot = {
  walletAddress: string | null;
  access: { role: "owner" | "editor" | "viewer" } | null | undefined;
  project: unknown | null | undefined;
};

export type GasPolicyRole = "owner" | "editor" | "viewer";

export type GasPolicySnapshot = {
  enabled: boolean;
  dailyCapStroops: string;
  walletHourlyLimit: number;
  allowedContractIds: string[];
  /** Read-only fields are intentionally excluded from draft identity. */
  dailyReservedStroops?: string;
  dailyWindowKey?: string;
  createdAt?: number;
  updatedAt?: number;
  network?: "testnet";
};

export type GasTelemetryHistoryRow = {
  reportingDayKey: string;
  confirmedFeeStroops: string | null;
  sourceUpdatedAt: number | null;
};

const GAS_TELEMETRY_HISTORY_DAYS = 7;

/** The browser-facing values kept while an operator edits a policy draft. */
export type GasPolicyDraft = {
  enabled: boolean;
  dailyCapXlm: string;
  walletHourlyLimit: string;
  allowedContractIdsText: string;
};

/** Arguments normalized for the existing Convex updatePolicy contract. */
export type GasPolicyUpdateArgs = {
  enabled: boolean;
  dailyCapStroops: string;
  walletHourlyLimit: number;
  allowedContractIds: string[];
};

export type GasPolicyDraftField = "dailyCapXlm" | "walletHourlyLimit" | "allowedContractIdsText";

export type GasPolicyDraftErrors = Partial<Record<GasPolicyDraftField, string>>;

export type GasPolicyValidationResult =
  | {
      ok: true;
      values: GasPolicyUpdateArgs;
      errors: Record<string, never>;
    }
  | {
      ok: false;
      values: null;
      errors: GasPolicyDraftErrors;
    };

export type GasPolicyStoredState = {
  presence: "absent" | "present";
  draft: GasPolicyDraft;
};

export type GasPolicySavePhase = "idle" | "saving" | "saved" | "error";
export type GasPolicySaveError = "cap_below_effective_usage" | "generic";

export type GasPolicyFormState = {
  draft: GasPolicyDraft;
  baseline: GasPolicyStoredState;
  observed: GasPolicyStoredState;
  lastObservedKey: string;
  hasRemoteUpdate: boolean;
  savePhase: GasPolicySavePhase;
  saveError: GasPolicySaveError | null;
  saveOperation: {
    id: number;
    previousKey: string;
    expectedKey: string;
  } | null;
  ignoredRemoteKeys: string[];
};

export type GasPolicyFormAction =
  | { type: "edit"; draft: GasPolicyDraft }
  | { type: "remote"; stored: GasPolicyStoredState }
  | { type: "save-start"; id: number; expected: GasPolicyStoredState }
  | { type: "save-success"; id: number; stored: GasPolicyStoredState }
  | { type: "save-failure"; id: number; error: GasPolicySaveError }
  | { type: "reset" };

/** Distinguish a valid zero balance from an account that has never been observed. */
export function getGasRelayerBalanceState(balanceStroops: string | null): GasRelayerBalanceState {
  if (balanceStroops === null) return "unverified";
  if (balanceStroops === "0") return "zero";
  return "observed";
}

/** Accept only the millisecond timestamps persisted by the balance refresh boundary. */
export function isValidGasRelayerTimestamp(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    Number.isFinite(new Date(value).getTime())
  );
}

/** Mark a verified snapshot stale at exactly five minutes. */
export function getGasRelayerBalanceFreshness(
  balanceStroops: string | null,
  balanceUpdatedAt: number | null,
  now: number,
): GasRelayerBalanceFreshness {
  if (balanceStroops === null || balanceUpdatedAt === null) return "never_verified";
  if (!isValidGasRelayerTimestamp(balanceUpdatedAt) || !isValidGasRelayerTimestamp(now)) {
    return "invalid_timestamp";
  }
  if (balanceUpdatedAt > now) return "invalid_timestamp";
  return now - balanceUpdatedAt < GAS_RELAYER_BALANCE_MAX_AGE_MS ? "fresh" : "stale";
}

/** Return the non-negative local/shared cooldown remaining at a deterministic time. */
export function getGasRelayerRefreshCooldownRemaining(
  cooldownUntil: number | null,
  now: number,
): number {
  if (
    cooldownUntil === null ||
    !isValidGasRelayerTimestamp(cooldownUntil) ||
    !isValidGasRelayerTimestamp(now)
  ) {
    return 0;
  }

  return Math.max(0, cooldownUntil - now);
}

/** Start the local 30-second cooldown and extend it for a returned shared retry window. */
export function getGasRelayerRefreshCooldownUntil(
  dispatchedAt: number,
  now: number,
  retryAfterMs = 0,
): number {
  if (!isValidGasRelayerTimestamp(dispatchedAt)) return 0;

  const safeNow = isValidGasRelayerTimestamp(now) ? now : dispatchedAt;
  const safeRetryAfterMs =
    Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? Math.ceil(retryAfterMs) : 0;
  return Math.max(dispatchedAt + GAS_RELAYER_LOCAL_COOLDOWN_MS, safeNow + safeRetryAfterMs);
}

/** Keep provider/action details out of the operator-facing refresh status. */
export function getGasRelayerRefreshFeedback(
  outcome: GasRelayerRefreshResult,
): GasRelayerRefreshFeedback {
  switch (outcome.status) {
    case "success":
      return {
        tone: "success",
        message:
          "Balance verification completed. The displayed balance will update from the reactive relayer snapshot.",
        retainsSnapshot: true,
      };
    case "cooldown":
      return {
        tone: "info",
        message: "A shared refresh cooldown is active. The last verified snapshot is unchanged.",
        retainsSnapshot: true,
      };
    case "missing_relayer":
      return {
        tone: "info",
        message: "No relayer is configured for this project, so there is no account to verify.",
        retainsSnapshot: true,
      };
    case "account_not_found":
      return {
        tone: "warning",
        message:
          "Stellar Testnet did not find the configured account. Fund this existing address, then refresh; the last verified snapshot is unchanged.",
        retainsSnapshot: true,
      };
    case "reader_failure":
      return {
        tone: "error",
        message: `${getGasRelayerReaderFailureMessage(outcome.reason)} The last verified balance and verification time are unchanged.`,
        retainsSnapshot: true,
      };
    case "stale_refresh":
      return {
        tone: "warning",
        message:
          "This refresh became obsolete before it could be saved. The last verified balance and verification time are unchanged.",
        retainsSnapshot: true,
      };
  }
}

/** Ignore a completion unless it belongs to the current identity-scoped request. */
export function isCurrentGasRelayerRefreshRequest(
  activeRequest: GasRelayerRefreshRequest | null,
  request: GasRelayerRefreshRequest,
): boolean {
  return (
    activeRequest?.id === request.id && activeRequest.contextVersion === request.contextVersion
  );
}

function getGasRelayerReaderFailureMessage(reason: string): string {
  switch (reason) {
    case "invalid_address":
      return "The configured relayer address could not be verified.";
    case "invalid_configuration":
      return "Testnet balance verification is not configured correctly.";
    case "wrong_network":
      return "The balance provider did not confirm Stellar Testnet.";
    case "timeout":
      return "Testnet balance verification timed out. Try again after the cooldown.";
    case "provider_failure":
      return "Stellar Testnet balance verification is temporarily unavailable.";
    case "malformed_response":
      return "The balance provider returned an invalid response.";
    default:
      return "The Testnet balance could not be verified.";
  }
}

/** Format a Convex decimal stroop string without converting through a Number. */
export function formatStroopsAsXlm(stroops: string): string {
  if (!/^(0|[1-9]\d*)$/.test(stroops)) {
    return "Unavailable";
  }

  const value = BigInt(stroops);
  const wholeXlm = value / STROOPS_PER_XLM;
  const fractionalStroops = (value % STROOPS_PER_XLM).toString().padStart(7, "0");

  return `${wholeXlm.toString()}.${fractionalStroops} XLM`;
}

/** Format an optional telemetry total while keeping null distinct from zero. */
export function formatGasTelemetryStroops(stroops: string | null): string {
  return stroops === null ? "Unavailable" : formatStroopsAsXlm(stroops);
}

/** Return the canonical UTC calendar day for a valid instant. */
export function getUtcDayKey(value: Date | number): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid UTC date");
  return date.toISOString().slice(0, 10);
}

/** Calculate the delay until the next UTC midnight without local-time assumptions. */
export function getMillisecondsUntilNextUtcMidnight(value: Date | number): number {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid UTC date");

  const nextMidnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
  return Math.max(1, nextMidnight - date.getTime());
}

/** Build seven ascending UTC days ending at the requested reporting day. */
export function getGasTelemetryDayKeys(reportingDayKey: string): string[] {
  const start = new Date(`${reportingDayKey}T00:00:00.000Z`);
  if (!Number.isFinite(start.getTime()) || getUtcDayKey(start) !== reportingDayKey) {
    return [];
  }

  return Array.from({ length: GAS_TELEMETRY_HISTORY_DAYS }, (_, index) => {
    const day = new Date(start.getTime());
    day.setUTCDate(day.getUTCDate() - (GAS_TELEMETRY_HISTORY_DAYS - 1 - index));
    return getUtcDayKey(day);
  });
}

/** Keep backend null gaps as null while normalizing history to seven ascending days. */
export function getGasTelemetryHistoryRows(
  telemetry: GasTelemetrySnapshot | null | undefined,
  reportingDayKey: string,
): GasTelemetryHistoryRow[] {
  const dayKeys = getGasTelemetryDayKeys(reportingDayKey);
  const historyByDay = new Map(
    telemetry?.reportingDayKey === reportingDayKey
      ? telemetry.history.map((entry) => [entry.reportingDayKey, entry] as const)
      : [],
  );

  return dayKeys.map((dayKey) => {
    const entry = historyByDay.get(dayKey);
    return {
      reportingDayKey: dayKey,
      confirmedFeeStroops: entry?.confirmedFeeStroops ?? null,
      sourceUpdatedAt: entry?.sourceUpdatedAt ?? null,
    };
  });
}

/** Convert exact stroops to an approximate chart coordinate only. */
export function getGasTelemetryChartValue(stroops: string | null): number | null {
  if (stroops === null || !/^(0|[1-9]\d*)$/.test(stroops)) return null;

  const value = Number(BigInt(stroops)) / Number(STROOPS_PER_XLM);
  return Number.isFinite(value) ? value : null;
}

/** Calculate a bounded visual cap percentage using integer arithmetic. */
export function getGasUsagePercentage(
  effectiveUsageStroops: string | null,
  policyCapStroops: string | null,
): number | null {
  if (effectiveUsageStroops === null || policyCapStroops === null) return null;
  if (!/^(0|[1-9]\d*)$/.test(effectiveUsageStroops) || !/^(0|[1-9]\d*)$/.test(policyCapStroops)) {
    return null;
  }

  const effectiveUsage = BigInt(effectiveUsageStroops);
  const policyCap = BigInt(policyCapStroops);
  if (policyCap === 0n) return null;

  const boundedPercentage =
    effectiveUsage >= policyCap
      ? 100n
      : effectiveUsage <= 0n
        ? 0n
        : (effectiveUsage * 100n) / policyCap;
  return Number(boundedPercentage);
}

/** Explain why current accounting totals are unavailable without exposing backend details. */
export function getGasTelemetryAvailabilityMessage(
  telemetry: Pick<GasTelemetrySnapshot, "availability" | "reasonCode"> | undefined,
): string {
  if (telemetry === undefined) return "Loading fee telemetry from the accounting source.";
  if (telemetry.availability === "available") {
    return "Effective usage combines today’s confirmed fees with outstanding holds across days.";
  }

  switch (telemetry.reasonCode) {
    case "missing_policy":
      return "No Gas policy is configured, so current fee totals are unavailable.";
    case "uninitialized_accounting":
      return "Accounting has not been initialized, so current fee totals are unavailable.";
    case "accounting_blocked":
      return "Accounting is blocked for review. Current totals are unavailable; valid history remains visible when available.";
    case "inconsistent_counters":
      return "Accounting counters are inconsistent, so current fee totals are unavailable.";
    case "overflow":
      return "Accounting exceeded its supported exact-value range, so current totals are unavailable.";
    case "ambiguous_policy_identity":
      return "The project has an ambiguous policy record, so current fee totals are unavailable.";
    case "ambiguous_accounting_identity":
      return "The project has ambiguous accounting records, so current fee totals are unavailable.";
    case "requested_day_before_policy_window":
      return "This reporting day precedes the policy accounting window, so current totals are unavailable.";
    case "invalid_policy":
      return "The stored Gas policy could not be verified, so current fee totals are unavailable.";
    case null:
      return "Fee totals are unavailable from the accounting source.";
  }
}

/** Keep history completeness language explicit about unknown gaps. */
export function getGasTelemetryHistoryMessage(
  completeness: GasTelemetrySnapshot["historyCompleteness"] | undefined,
): string {
  switch (completeness) {
    case "complete":
      return "Complete seven-day history is available.";
    case "partial":
      return "Partial history: unavailable days remain gaps and are not treated as zero.";
    case "unavailable":
    case undefined:
      return "Seven-day history is unavailable until trustworthy accounting data exists.";
  }
}

/** Format a source-update timestamp without applying relayer freshness rules. */
export function formatGasTelemetryTimestamp(value: number | null): string {
  if (
    value === null ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    !Number.isFinite(new Date(value).getTime())
  ) {
    return "Unavailable";
  }
  return new Date(value).toISOString();
}

/** Format stored stroops as an exact, editable XLM decimal string. */
export function formatStroopsAsXlmInput(stroops: string): string {
  if (!/^(0|[1-9]\d*)$/.test(stroops)) {
    return "0";
  }

  const value = BigInt(stroops);
  const wholeXlm = value / STROOPS_PER_XLM;
  const fractionalStroops = (value % STROOPS_PER_XLM).toString().padStart(7, "0");
  const trimmedFraction = fractionalStroops.replace(/0+$/, "");

  return trimmedFraction ? `${wholeXlm.toString()}.${trimmedFraction}` : wholeXlm.toString();
}

/** Initialize a local draft from stored policy data or deny-by-default values. */
export function initializeGasPolicyDraft(policy: GasPolicySnapshot | null): GasPolicyDraft {
  return {
    enabled: policy?.enabled ?? false,
    dailyCapXlm: policy ? formatStroopsAsXlmInput(policy.dailyCapStroops) : "0",
    walletHourlyLimit: policy ? String(policy.walletHourlyLimit) : "0",
    allowedContractIdsText: policy?.allowedContractIds.join("\n") ?? "",
  };
}

/** Track policy presence separately from editable values for remote-update detection. */
export function createGasPolicyStoredState(policy: GasPolicySnapshot | null): GasPolicyStoredState {
  return {
    presence: policy === null ? "absent" : "present",
    draft: initializeGasPolicyDraft(policy),
  };
}

/** Key only the policy fields an operator can edit; accounting changes are ignored. */
export function gasPolicyStoredStateKey(stored: GasPolicyStoredState): string {
  return JSON.stringify([stored.presence, stored.draft]);
}

/** Convert normalized mutation arguments into the stored editable projection shape. */
export function gasPolicyStoredStateFromUpdate(values: GasPolicyUpdateArgs): GasPolicyStoredState {
  return {
    presence: "present",
    draft: {
      enabled: values.enabled,
      dailyCapXlm: formatStroopsAsXlmInput(values.dailyCapStroops),
      walletHourlyLimit: String(values.walletHourlyLimit),
      allowedContractIdsText: values.allowedContractIds.join("\n"),
    },
  };
}

export function areGasPolicyDraftsEqual(left: GasPolicyDraft, right: GasPolicyDraft): boolean {
  return (
    left.enabled === right.enabled &&
    left.dailyCapXlm === right.dailyCapXlm &&
    left.walletHourlyLimit === right.walletHourlyLimit &&
    left.allowedContractIdsText === right.allowedContractIdsText
  );
}

function isGasPolicyDraftDirty(state: GasPolicyFormState): boolean {
  return !areGasPolicyDraftsEqual(state.draft, state.baseline.draft);
}

function appendIgnoredRemoteKey(state: GasPolicyFormState, key: string): string[] {
  return state.ignoredRemoteKeys.includes(key)
    ? state.ignoredRemoteKeys
    : [...state.ignoredRemoteKeys, key];
}

/** Create the initial synchronization state for an editable Gas policy form. */
export function createGasPolicyFormState(stored: GasPolicyStoredState): GasPolicyFormState {
  const key = gasPolicyStoredStateKey(stored);
  return {
    draft: stored.draft,
    baseline: stored,
    observed: stored,
    lastObservedKey: key,
    hasRemoteUpdate: false,
    savePhase: "idle",
    saveError: null,
    saveOperation: null,
    ignoredRemoteKeys: [],
  };
}

/**
 * Reconcile Convex policy snapshots with a local draft. The reducer ignores known
 * pre-save and acknowledged values so reactive snapshots cannot roll a successful
 * save backwards, while unexpected editable changes become a blocking conflict.
 */
export function reduceGasPolicyFormState(
  state: GasPolicyFormState,
  action: GasPolicyFormAction,
): GasPolicyFormState {
  switch (action.type) {
    case "edit":
      return {
        ...state,
        draft: action.draft,
        savePhase: state.savePhase === "saving" ? state.savePhase : "idle",
        saveError: null,
      };

    case "remote": {
      const storedKey = gasPolicyStoredStateKey(action.stored);
      if (storedKey === state.lastObservedKey) return state;

      const isKnownSaveSnapshot =
        state.ignoredRemoteKeys.includes(storedKey) ||
        state.saveOperation?.previousKey === storedKey ||
        state.saveOperation?.expectedKey === storedKey;
      if (isKnownSaveSnapshot) {
        return {
          ...state,
          lastObservedKey: storedKey,
        };
      }

      const dirty = isGasPolicyDraftDirty(state);
      return {
        ...state,
        baseline: action.stored,
        observed: action.stored,
        lastObservedKey: storedKey,
        draft: dirty ? state.draft : action.stored.draft,
        hasRemoteUpdate: dirty,
        savePhase: dirty ? state.savePhase : "idle",
        saveError: dirty ? state.saveError : null,
      };
    }

    case "save-start": {
      if (state.saveOperation || !isGasPolicyDraftDirty(state) || state.hasRemoteUpdate) {
        return state;
      }

      const previousKey = gasPolicyStoredStateKey(state.baseline);
      const expectedKey = gasPolicyStoredStateKey(action.expected);
      return {
        ...state,
        savePhase: "saving",
        saveError: null,
        saveOperation: { id: action.id, previousKey, expectedKey },
      };
    }

    case "save-success": {
      if (state.saveOperation?.id !== action.id) return state;

      const acknowledgedKey = gasPolicyStoredStateKey(action.stored);
      const conflictWasObserved = state.hasRemoteUpdate;
      return {
        ...state,
        draft: action.stored.draft,
        baseline: action.stored,
        observed: conflictWasObserved ? state.observed : action.stored,
        lastObservedKey: conflictWasObserved ? state.lastObservedKey : acknowledgedKey,
        hasRemoteUpdate: conflictWasObserved,
        savePhase: "saved",
        saveError: null,
        saveOperation: null,
        ignoredRemoteKeys: [
          ...appendIgnoredRemoteKey(state, state.saveOperation.previousKey).filter(
            (key) => key !== acknowledgedKey,
          ),
          acknowledgedKey,
        ],
      };
    }

    case "save-failure":
      if (state.saveOperation?.id !== action.id) return state;
      return {
        ...state,
        savePhase: "error",
        saveError: action.error,
        saveOperation: null,
      };

    case "reset": {
      const storedKey = gasPolicyStoredStateKey(state.observed);
      return {
        ...state,
        draft: state.observed.draft,
        baseline: state.observed,
        lastObservedKey: storedKey,
        hasRemoteUpdate: false,
        savePhase: "idle",
        saveError: null,
        ignoredRemoteKeys: [],
      };
    }
  }
}

/** Narrow ConvexError data without displaying raw server failures in the UI. */
export function getGasPolicySaveError(error: unknown): GasPolicySaveError {
  if (!error || typeof error !== "object") return "generic";

  const data = (error as { data?: unknown }).data;
  if (
    data &&
    typeof data === "object" &&
    (data as { code?: unknown }).code === GAS_POLICY_CAP_ERROR_CODE
  ) {
    return "cap_below_effective_usage";
  }

  return "generic";
}

function parseXlmAmount(value: string): bigint {
  const normalized = value.trim();
  if (!XLM_AMOUNT_PATTERN.test(normalized)) {
    throw new Error("Enter a valid XLM amount");
  }

  const [wholePart = "", fractionalPart = ""] = normalized.split(".");
  const significantWholePart = wholePart.replace(/^0+(?=\d)/, "");
  const maximumWholePart = XLM_MAX_VALUE.split(".")[0] ?? "";
  if (
    significantWholePart.length > maximumWholePart.length ||
    (significantWholePart.length === maximumWholePart.length &&
      significantWholePart > maximumWholePart)
  ) {
    throw new Error("XLM amount is above the supported maximum");
  }

  const stroops =
    BigInt(significantWholePart) * STROOPS_PER_XLM + BigInt(fractionalPart.padEnd(7, "0") || "0");
  if (stroops > GAS_MAX_STROOPS) {
    throw new Error("XLM amount is above the supported maximum");
  }

  return stroops;
}

/** Convert an exact decimal XLM input to the signed-int64 stroop string used by Convex. */
export function parseXlmToStroops(value: string): string {
  return parseXlmAmount(value).toString();
}

function parseWalletHourlyLimit(value: string): number {
  const normalized = value.trim();
  if (!NON_NEGATIVE_INTEGER_PATTERN.test(normalized)) {
    throw new Error("Enter a non-negative whole number for the hourly wallet quota");
  }

  const integer = BigInt(normalized);
  if (integer > MAX_SAFE_INTEGER_BIGINT) {
    throw new Error("Hourly wallet quota is above the safe integer maximum");
  }

  return Number(integer);
}

function normalizeAllowlist(value: string): string[] {
  const entries = value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (entries.length > MAX_ALLOWED_CONTRACT_IDS) {
    throw new Error("Use no more than 20 nonblank contract IDs");
  }

  const normalizedIds: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    let normalized: string;
    try {
      // This shared assertion performs checksum validation and canonical
      // normalization, matching the backend and Stellar package boundaries.
      normalized = assertValidContractId(entry);
    } catch {
      throw new Error("Enter valid Stellar contract IDs, one per line");
    }

    if (!seen.has(normalized)) {
      seen.add(normalized);
      normalizedIds.push(normalized);
    }
  }

  return normalizedIds;
}

/** Validate and normalize a local policy draft without performing any write. */
export function validateGasPolicyDraft(draft: GasPolicyDraft): GasPolicyValidationResult {
  const errors: GasPolicyDraftErrors = {};
  let dailyCapStroops: string | null = null;
  let walletHourlyLimit: number | null = null;
  let allowedContractIds: string[] | null = null;

  try {
    dailyCapStroops = parseXlmToStroops(draft.dailyCapXlm);
  } catch {
    errors.dailyCapXlm = `Enter an XLM amount from 0 to ${XLM_MAX_VALUE} with at most 7 decimal places`;
  }

  try {
    walletHourlyLimit = parseWalletHourlyLimit(draft.walletHourlyLimit);
  } catch {
    errors.walletHourlyLimit = "Enter a non-negative whole number no larger than 9007199254740991";
  }

  try {
    allowedContractIds = normalizeAllowlist(draft.allowedContractIdsText);
  } catch (error) {
    errors.allowedContractIdsText =
      error instanceof Error && error.message.includes("20")
        ? error.message
        : "Enter valid Stellar contract IDs, one per line";
  }

  if (
    Object.keys(errors).length > 0 ||
    dailyCapStroops === null ||
    walletHourlyLimit === null ||
    allowedContractIds === null
  ) {
    return { ok: false, values: null, errors };
  }

  return {
    ok: true,
    values: {
      enabled: draft.enabled,
      dailyCapStroops,
      walletHourlyLimit,
      allowedContractIds,
    },
    errors: {},
  };
}

/** Keep membership and project loading transitions explicit before Gas reads mount. */
export function getGasAccessState({
  walletAddress,
  access,
  project,
}: GasAccessSnapshot): GasAccessState {
  if (!walletAddress) return "connect";
  if (access === undefined || (access !== null && project === undefined)) return "loading";
  if (access === null || project === null) return "unavailable";
  return "ready";
}
