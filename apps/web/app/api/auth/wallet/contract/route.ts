import {
  ContractAccountAuthorizationRejectedError,
  createContractAccountChallenge,
  verifyContractAccountAuthorization,
} from "@/core/auth/contract-wallet-auth";
import {
  consumeContractAccountChallenge,
  issueContractAccountChallenge,
} from "@/core/auth/contract-wallet-auth-challenges";
import { createWalletJwt, walletAuthIssuer } from "@/core/auth/wallet-jwt";
import { withRouteTelemetry } from "@/core/observability";
import { assertValidContractId } from "@repo/stellar/validation";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 24 * 1024;
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { ...CORS_HEADERS, "cache-control": "no-store" },
  });
}

function homeDomain() {
  return new URL(walletAuthIssuer()).host;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "SEP-45 authentication failed.";
}

function looksLikeRpcFailure(error: unknown) {
  if (error instanceof ContractAccountAuthorizationRejectedError) return false;
  const message = errorMessage(error).toLowerCase();
  return (
    message.includes("rpc") ||
    message.includes("network") ||
    message.includes("fetch") ||
    message.includes("timeout") ||
    message.includes("web auth contract is not configured")
  );
}

export const OPTIONS = withRouteTelemetry("wallet.contract.options", async () => {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
});

export const GET = withRouteTelemetry("wallet.contract.challenge", async (request) => {
  const url = new URL(request.url);
  const accountValue = url.searchParams.get("account");
  const requestedHomeDomain = url.searchParams.get("home_domain");
  if (!accountValue || accountValue.length > 56) {
    return json({ error: "A valid contract account is required." }, 400);
  }
  if (requestedHomeDomain && requestedHomeDomain !== homeDomain()) {
    return json({ error: "The requested home domain does not match Velo." }, 400);
  }

  let account: string;
  try {
    account = assertValidContractId(accountValue);
  } catch {
    return json(
      { error: "SEP-45 authentication only supports valid C... contract accounts." },
      400,
    );
  }

  try {
    const challenge = await createContractAccountChallenge(account);
    await issueContractAccountChallenge({
      challengeId: challenge.challengeId,
      address: challenge.account,
      nonce: challenge.nonce,
      challengeHash: challenge.challengeHash,
      expiresAt: challenge.expiresAt,
    });
    return json({
      authorization_entries: challenge.authorizationEntries,
      network_passphrase: challenge.networkPassphrase,
      signature_expiration_ledger: challenge.signatureExpirationLedger,
    });
  } catch (error) {
    console.error("[wallet.contract.challenge] Challenge creation failed", {
      reason: errorMessage(error),
    });
    return json(
      {
        error: looksLikeRpcFailure(error)
          ? errorMessage(error)
          : "Unable to create SEP-45 challenge.",
      },
      503,
    );
  }
});

async function readAuthorizationEntries(request: Request): Promise<string | null> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_REQUEST_BYTES) return null;
  const bodyText = await request.text();
  if (new TextEncoder().encode(bodyText).byteLength > MAX_REQUEST_BYTES) return null;

  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (contentType === "application/x-www-form-urlencoded") {
    const form = new URLSearchParams(bodyText);
    return form.get("authorization_entries");
  }
  if (contentType !== "application/json") return null;
  try {
    const value: unknown = JSON.parse(bodyText);
    if (!value || typeof value !== "object") return null;
    const entries = (value as Record<string, unknown>).authorization_entries;
    return typeof entries === "string" ? entries : null;
  } catch {
    return null;
  }
}

export const POST = withRouteTelemetry("wallet.contract.session", async (request) => {
  let authorizationEntries: string | null;
  try {
    authorizationEntries = await readAuthorizationEntries(request);
  } catch {
    return json({ error: "Invalid SEP-45 request body." }, 400);
  }
  if (!authorizationEntries)
    return json({ error: "Missing or oversized authorization entries." }, 400);

  let verified: Awaited<ReturnType<typeof verifyContractAccountAuthorization>>;
  try {
    verified = await verifyContractAccountAuthorization(authorizationEntries);
  } catch (error) {
    const diagnostic = {
      reason: errorMessage(error),
      ...(error instanceof ContractAccountAuthorizationRejectedError
        ? {
            sorobanSimulationError: error.simulationError,
            latestLedger: error.latestLedger,
            diagnosticEventCount: error.diagnosticEventCount,
          }
        : {}),
    };
    console.error(
      `[wallet.contract.session] Authorization verification failed ${JSON.stringify(diagnostic)}`,
    );
    return json(
      {
        error: looksLikeRpcFailure(error)
          ? errorMessage(error)
          : "SEP-45 authorization verification failed.",
      },
      looksLikeRpcFailure(error) ? 503 : 401,
    );
  }

  try {
    const consumed = await consumeContractAccountChallenge({
      address: verified.account,
      nonce: verified.nonce,
      challengeHash: verified.challengeHash,
    });
    if (!consumed) return json({ error: "SEP-45 challenge expired or already used." }, 401);

    return json({ token: createWalletJwt(verified.account), address: verified.account });
  } catch (error) {
    console.error("[wallet.contract.session] Challenge consumption failed", {
      reason: errorMessage(error),
    });
    return json({ error: "Velo could not create the contract account session." }, 503);
  }
});
