import { randomBytes } from "node:crypto";

import { issueWalletChallenge } from "@/core/auth/wallet-auth-challenges";
import { createWalletChallenge, WALLET_CHALLENGE_TTL_MS } from "@/core/auth/wallet-jwt";
import { withRouteTelemetry } from "@/core/observability";
import { assertValidPublicKey } from "@repo/stellar";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 1_024;

export const POST = withRouteTelemetry("wallet.challenge", async (request) => {
  let body: unknown;
  try {
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_REQUEST_BYTES) {
      return NextResponse.json({ error: "Request is too large" }, { status: 413 });
    }
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
      return NextResponse.json({ error: "Request is too large" }, { status: 413 });
    }
    body = JSON.parse(rawBody) as unknown;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || !("address" in body)) {
    return NextResponse.json({ error: "Missing wallet address" }, { status: 400 });
  }

  const requestedAddress = body.address;
  if (typeof requestedAddress !== "string" || requestedAddress.length > 56) {
    return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
  }

  let address: string;
  try {
    address = assertValidPublicKey(requestedAddress);
  } catch {
    return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
  }

  try {
    const { challenge, transactionHash } = createWalletChallenge(address);
    const challengeId = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + WALLET_CHALLENGE_TTL_MS;
    await issueWalletChallenge({ challengeId, address, transactionHash, expiresAt });
    return NextResponse.json(
      { challengeId, challenge, expiresAt },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Unable to create wallet challenge" }, { status: 503 });
  }
});
