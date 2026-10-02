import { requirePublicContractConfig, resolvePublicContractConfig } from "@repo/stellar";
import { z } from "zod";

const envSchema = z.object({
  NEXT_PUBLIC_CONVEX_URL: z.string().url({
    message: "NEXT_PUBLIC_CONVEX_URL must be a valid URL",
  }),
  NEXT_PUBLIC_CONVEX_SITE_URL: z.string().url().optional(),
  NEXT_PUBLIC_STELLAR_NETWORK: z.literal("testnet").default("testnet"),
  NEXT_PUBLIC_STELLAR_RPC_URL: z.string().url().default("https://soroban-testnet.stellar.org"),
  NEXT_PUBLIC_VELO_REGISTRY_CONTRACT_ID: z.string().optional(),
  NEXT_PUBLIC_VELO_PAY_ACCESS_CONTRACT_ID: z.string().optional(),
  NEXT_PUBLIC_USDC_ISSUER: z.string().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_WALLETS_CDN_BASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || undefined),
  NEXT_PUBLIC_VELO_BENCHMARK_MARKERS: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

type RawEnv = Record<string, string | undefined>;

type ParseEnvOptions = {
  requireContractIds?: boolean;
};

function shouldRequireContractIds(rawEnv: RawEnv, options: ParseEnvOptions) {
  return (
    options.requireContractIds ??
    (rawEnv.VELO_REQUIRE_CONTRACT_IDS === "true" || rawEnv.VERCEL_ENV === "production")
  );
}

export const parseEnv = (rawEnv: RawEnv, options: ParseEnvOptions = {}) => {
  const parsed = envSchema.safeParse({
    NEXT_PUBLIC_CONVEX_URL: rawEnv.NEXT_PUBLIC_CONVEX_URL,
    NEXT_PUBLIC_CONVEX_SITE_URL: rawEnv.NEXT_PUBLIC_CONVEX_SITE_URL,
    NEXT_PUBLIC_STELLAR_NETWORK: rawEnv.NEXT_PUBLIC_STELLAR_NETWORK,
    NEXT_PUBLIC_STELLAR_RPC_URL: rawEnv.NEXT_PUBLIC_STELLAR_RPC_URL,
    NEXT_PUBLIC_VELO_REGISTRY_CONTRACT_ID: rawEnv.NEXT_PUBLIC_VELO_REGISTRY_CONTRACT_ID,
    NEXT_PUBLIC_VELO_PAY_ACCESS_CONTRACT_ID: rawEnv.NEXT_PUBLIC_VELO_PAY_ACCESS_CONTRACT_ID,
    NEXT_PUBLIC_USDC_ISSUER: rawEnv.NEXT_PUBLIC_USDC_ISSUER,
    NEXT_PUBLIC_APP_URL: rawEnv.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    NEXT_PUBLIC_WALLETS_CDN_BASE_URL: rawEnv.NEXT_PUBLIC_WALLETS_CDN_BASE_URL,
    NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: rawEnv.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
    NEXT_PUBLIC_VELO_BENCHMARK_MARKERS: rawEnv.NEXT_PUBLIC_VELO_BENCHMARK_MARKERS,
  });

  if (!parsed.success) {
    console.error(
      "❌ Invalid environment variables:",
      JSON.stringify(parsed.error.format(), null, 2),
    );
    throw new Error("Invalid environment variables");
  }

  const contractConfigInput = {
    registryContractId: parsed.data.NEXT_PUBLIC_VELO_REGISTRY_CONTRACT_ID,
    payAccessContractId: parsed.data.NEXT_PUBLIC_VELO_PAY_ACCESS_CONTRACT_ID,
  };
  const contractConfig = shouldRequireContractIds(rawEnv, options)
    ? requirePublicContractConfig(contractConfigInput)
    : resolvePublicContractConfig(contractConfigInput);

  return {
    ...parsed.data,
    NEXT_PUBLIC_VELO_REGISTRY_CONTRACT_ID: contractConfig.registryContractId,
    NEXT_PUBLIC_VELO_PAY_ACCESS_CONTRACT_ID: contractConfig.payAccessContractId,
  };
};

// Keep direct process.env property access here so Next can inline NEXT_PUBLIC_* values
// into client bundles.
const validateEnv = () =>
  parseEnv({
    NEXT_PUBLIC_CONVEX_URL: process.env.NEXT_PUBLIC_CONVEX_URL,
    NEXT_PUBLIC_CONVEX_SITE_URL: process.env.NEXT_PUBLIC_CONVEX_SITE_URL,
    NEXT_PUBLIC_STELLAR_NETWORK: process.env.NEXT_PUBLIC_STELLAR_NETWORK,
    NEXT_PUBLIC_STELLAR_RPC_URL: process.env.NEXT_PUBLIC_STELLAR_RPC_URL,
    NEXT_PUBLIC_VELO_REGISTRY_CONTRACT_ID: process.env.NEXT_PUBLIC_VELO_REGISTRY_CONTRACT_ID,
    NEXT_PUBLIC_VELO_PAY_ACCESS_CONTRACT_ID: process.env.NEXT_PUBLIC_VELO_PAY_ACCESS_CONTRACT_ID,
    NEXT_PUBLIC_USDC_ISSUER: process.env.NEXT_PUBLIC_USDC_ISSUER,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_WALLETS_CDN_BASE_URL: process.env.NEXT_PUBLIC_WALLETS_CDN_BASE_URL,
    NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
    NEXT_PUBLIC_VELO_BENCHMARK_MARKERS: process.env.NEXT_PUBLIC_VELO_BENCHMARK_MARKERS,
    VELO_REQUIRE_CONTRACT_IDS: process.env.VELO_REQUIRE_CONTRACT_IDS,
    VERCEL_ENV: process.env.VERCEL_ENV,
  });

export const env = validateEnv();
