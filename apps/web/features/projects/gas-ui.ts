const STROOPS_PER_XLM = 10_000_000n;

export type GasAccessState = "connect" | "loading" | "unavailable" | "ready";

export type GasAccessSnapshot = {
  walletAddress: string | null;
  access: { role: "owner" | "editor" | "viewer" } | null | undefined;
  project: unknown | null | undefined;
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
