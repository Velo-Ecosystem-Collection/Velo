type InhouseApiKeyEnvironment = {
  VELO_INHOUSE_API_KEY?: string;
};

export function getDemoRedirectUrls(requestUrl: string) {
  return {
    successUrl: new URL("/success", requestUrl).toString(),
    cancelUrl: new URL("/cancel", requestUrl).toString(),
  };
}

export function requireInhouseApiKey(
  env: InhouseApiKeyEnvironment = {
    VELO_INHOUSE_API_KEY: process.env.VELO_INHOUSE_API_KEY,
  },
) {
  const inhouseApiKey = env.VELO_INHOUSE_API_KEY?.trim();
  if (!inhouseApiKey) {
    throw new Error("VELO_INHOUSE_API_KEY is required for checkout.");
  }

  return inhouseApiKey;
}

export function getCheckoutAnchorError(anchor: unknown) {
  if (anchor === undefined || anchor === "inhouse") return null;
  if (anchor === "pdax") {
    return {
      status: 409,
      error: "PDAX payment routing is no longer available. Use an in-house API key and checkout.",
    } as const;
  }
  return { status: 400, error: "anchor must be 'inhouse'." } as const;
}
