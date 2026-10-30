import { WALLET_AUTH_APPLICATION_ID } from "./auth.constants";

const DEFAULT_LOCAL_ISSUER = "http://localhost:3000";

type WalletAuthEnvironment = {
  VELO_AUTH_ISSUER?: string;
  NEXT_PUBLIC_APP_URL?: string;
  VELO_AUTH_JWKS?: string;
};

export function resolveWalletAuthProvider(env: WalletAuthEnvironment) {
  const issuer = (env.VELO_AUTH_ISSUER || env.NEXT_PUBLIC_APP_URL || DEFAULT_LOCAL_ISSUER).replace(
    /\/$/,
    "",
  );
  const jwks = env.VELO_AUTH_JWKS;

  if (!jwks) {
    throw new Error(
      "VELO_AUTH_JWKS is required. Convex Cloud cannot fetch a JWKS endpoint from localhost; use an HTTPS URL or a data URI.",
    );
  }

  if (!jwks.startsWith("https://") && !jwks.startsWith("data:")) {
    throw new Error("VELO_AUTH_JWKS must be an HTTPS URL or a data URI");
  }

  return {
    type: "customJwt" as const,
    applicationID: WALLET_AUTH_APPLICATION_ID,
    issuer,
    jwks,
    algorithm: "ES256" as const,
  };
}
