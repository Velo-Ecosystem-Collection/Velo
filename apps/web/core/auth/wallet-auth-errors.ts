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

const GENERIC_CLIENT_AUTH_FAILURE = "Wallet verification failed. Reconnect and try again.";

export type WalletClientAuthStage =
  | "sep45_discovery"
  | "sep45_challenge_request"
  | "sep45_challenge_validation"
  | "passkey_authorization_signing"
  | "sep45_session_request"
  | "wallet_session_validation";

function stageFailureMessage(stage?: WalletClientAuthStage) {
  switch (stage) {
    case "sep45_discovery":
      return "Velo could not read its SEP-45 configuration. Refresh the page and check the Web Auth settings.";
    case "sep45_challenge_request":
      return "Velo could not create the SEP-45 challenge. Check Testnet RPC and the Web Auth contract.";
    case "sep45_challenge_validation":
      return "Velo received a SEP-45 challenge but could not validate its account, domain, network, or signature.";
    case "passkey_authorization_signing":
      return "The passkey prompt appeared, but Velo could not finish signing the smart-account authorization. Check the active account signer and Testnet RPC.";
    case "sep45_session_request":
      return "Velo could not submit the signed SEP-45 session. Check the connection and the Velo server logs.";
    case "wallet_session_validation":
      return "Velo could not validate the wallet session response. Check the web server logs.";
    default:
      return GENERIC_CLIENT_AUTH_FAILURE;
  }
}

export function walletClientAuthFailureMessage(error: unknown, stage?: WalletClientAuthStage) {
  const value =
    error && typeof error === "object" ? (error as { name?: unknown; message?: unknown }) : null;
  const name = typeof value?.name === "string" ? value.name : "";
  const message =
    error instanceof Error
      ? error.message.trim()
      : typeof value?.message === "string"
        ? value.message.trim()
        : "";

  if (name === "NotAllowedError" || /notallowederror|user cancelled|user canceled/i.test(message)) {
    return "Passkey approval was canceled or timed out. Try again and complete the device prompt.";
  }
  if (/failed to fetch|fetch failed|networkerror|load failed|timed out/i.test(message)) {
    return "Velo could not reach the SEP-45 authentication service. Check your connection and try again.";
  }
  if (/no signer found for credential id/i.test(message)) {
    return "Velo could not match the passkey response to an active signer on this smart account. Reconnect with the passkey that owns the selected account.";
  }
  if (
    !message ||
    message.length > 240 ||
    /private key|secret|token|bearer\s|authorization_entries|https?:\/\/\S+\?|eyJ[a-zA-Z0-9_-]{20,}/i.test(
      message,
    )
  ) {
    return stageFailureMessage(stage);
  }
  return message;
}

export function walletClientAuthDiagnosticMessage(error: unknown) {
  const value = error && typeof error === "object" ? (error as { message?: unknown }) : null;
  const rawMessage =
    error instanceof Error
      ? error.message.trim()
      : typeof value?.message === "string"
        ? value.message.trim()
        : "";
  if (!rawMessage) return "No error message was available.";

  return rawMessage
    .replace(/authorization[_\s]entries\b[\s\S]*/i, "authorization_entries=[redacted]")
    .replace(/\b(private[_ ]?key|secret|token|bearer)\b[ \t:=]+[^\s,;]+/gi, "$1=[redacted]")
    .replace(/\bcredential(?:_?id|\s+id)\b[ \t:=]+[^\s,;]+/gi, "credential_id=[redacted]")
    .replace(/https?:\/\/[^\s"')]+/gi, (candidate) => {
      try {
        const url = new URL(candidate);
        return `${url.origin}${url.pathname}`;
      } catch {
        return "[url redacted]";
      }
    })
    .replace(/\beyJ[a-zA-Z0-9_-]{20,}\b/g, "[token redacted]")
    .replace(/\b[A-Za-z0-9_-]{64,}\b/g, "[long value redacted]")
    .slice(0, 240);
}
