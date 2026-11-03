export const WALLET_AUTH_FAILURE_CODES = [
  "WALLET_AUTH_CONFIGURATION",
  "CONVEX_AUTH_CONFIGURATION",
  "CONVEX_CHALLENGE_BACKEND_NOT_DEPLOYED",
  "CONVEX_UNAVAILABLE",
  "WALLET_CHALLENGE_FAILED",
] as const;

export type WalletAuthFailureCode = (typeof WALLET_AUTH_FAILURE_CODES)[number];

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "";
}

export function classifyWalletAuthFailure(error: unknown): WalletAuthFailureCode {
  const message = errorMessage(error);

  if (
    /VELO_AUTH_(?:CHALLENGE_SECRET|JWT_PRIVATE_KEY_PEM).*required|private key.*required|invalid.*(?:PEM|Stellar secret|server key)/i.test(
      message,
    )
  ) {
    return "WALLET_AUTH_CONFIGURATION";
  }

  if (
    /no auth provider found|not authenticated|unauthorized|authentication.*(?:failed|required)|JWT|issuer|audience|applicationID/i.test(
      message,
    )
  ) {
    return "CONVEX_AUTH_CONFIGURATION";
  }

  if (
    /could not find public function|function .*not found|table .*not (?:found|exist)|index .*not (?:found|exist)|schema.*(?:mismatch|validation)/i.test(
      message,
    )
  ) {
    return "CONVEX_CHALLENGE_BACKEND_NOT_DEPLOYED";
  }

  if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network error|socket/i.test(message)) {
    return "CONVEX_UNAVAILABLE";
  }

  return "WALLET_CHALLENGE_FAILED";
}

export function walletAuthFailureMessage(value: unknown) {
  switch (value) {
    case "WALLET_AUTH_CONFIGURATION":
      return "Wallet verification needs the web server's wallet-auth signing keys configured.";
    case "CONVEX_AUTH_CONFIGURATION":
      return "Convex rejected the wallet-auth service token. Check that the deployment uses audience velo-web-v2, the issuer matches the web app, and VELO_AUTH_JWKS contains the matching public signing key.";
    case "CONVEX_CHALLENGE_BACKEND_NOT_DEPLOYED":
      return "The Convex wallet-challenge functions or schema are missing. Start or deploy the updated backend, then retry.";
    case "CONVEX_UNAVAILABLE":
      return "The web server could not reach Convex. Check NEXT_PUBLIC_CONVEX_URL and that the target Convex deployment is running.";
    default:
      return "Velo could not start wallet verification. Check the web server logs for the wallet.challenge failure code.";
  }
}
