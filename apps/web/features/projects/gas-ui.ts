import { assertValidContractId } from "@repo/stellar/validation";

const STROOPS_PER_XLM = 10_000_000n;
const GAS_MAX_STROOPS = 2n ** 63n - 1n;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const XLM_AMOUNT_PATTERN = /^\d+(?:\.\d{1,7})?$/;
const NON_NEGATIVE_INTEGER_PATTERN = /^\d+$/;
const XLM_MAX_VALUE = "922337203685.4775807";
const MAX_ALLOWED_CONTRACT_IDS = 20;

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
