import { assertValidContractId } from "@repo/stellar/validation";

const STROOPS_PER_XLM = 10_000_000n;
const GAS_MAX_STROOPS = 2n ** 63n - 1n;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const XLM_AMOUNT_PATTERN = /^\d+(?:\.\d{1,7})?$/;
const NON_NEGATIVE_INTEGER_PATTERN = /^\d+$/;
const XLM_MAX_VALUE = "922337203685.4775807";
const MAX_ALLOWED_CONTRACT_IDS = 20;
export const GAS_POLICY_CAP_ERROR_CODE = "daily_cap_below_effective_usage" as const;

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
