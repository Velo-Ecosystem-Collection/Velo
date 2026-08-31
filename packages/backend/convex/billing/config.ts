import type { BillingNetwork } from "./helpers";

import { env } from "../_generated/server";

export function currentBillingNetwork(): BillingNetwork {
  return env.VELO_STELLAR_NETWORK === "public" ? "public" : "testnet";
}

export function currentBillingEnvironment(): "development" | "preview" | "production" {
  if (env.VELO_DEPLOYMENT_ENVIRONMENT === "preview") return "preview";
  if (env.VELO_DEPLOYMENT_ENVIRONMENT === "production") return "production";
  return "development";
}

export function canonicalMainnetUsdcAsset() {
  const issuer = env.VELO_MAINNET_USDC_ISSUER?.trim().toUpperCase();
  return issuer ? `USDC:${issuer}` : null;
}
