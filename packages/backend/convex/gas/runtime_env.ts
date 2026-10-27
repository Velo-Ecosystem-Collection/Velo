type GeneratedConvexEnv = typeof import("../_generated/server").env;

export type GasRuntimeEnv = GeneratedConvexEnv & {
  readonly VELO_GAS_CUSTODY_DEPLOYMENT_ID: string | undefined;
  readonly VELO_GAS_CUSTODY_KEYRING_JSON: string | undefined;
  readonly VELO_GAS_D2_HORIZON_URL: string | undefined;
  readonly VELO_GAS_MANAGED_RELAYER_PROVISIONING_ENABLED: string | undefined;
  readonly VELO_GAS_TESTNET_FALLBACK_RPC_URL: string | undefined;
  readonly VELO_GAS_TESTNET_RELAYER_SIGNERS_JSON: string | undefined;
};

/** Read deployment configuration at invocation time rather than caching Convex's env object. */
export function getGasRuntimeEnv(): GasRuntimeEnv {
  return process.env as unknown as GasRuntimeEnv;
}
