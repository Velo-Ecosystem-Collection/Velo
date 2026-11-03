import { consumeWalletChallenge } from "@/core/auth/wallet-auth-challenges";
import { createWalletJwt, verifyWalletChallenge } from "@/core/auth/wallet-jwt";
import { withRouteTelemetry } from "@/core/observability";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 24 * 1024;

export const POST = withRouteTelemetry("wallet.session", async (request) => {
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

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid wallet challenge" }, { status: 400 });
  }

  const { address, challengeId, signedChallenge } = body as Record<string, unknown>;
  if (
    typeof address !== "string" ||
    address.length > 56 ||
    typeof challengeId !== "string" ||
    !/^[A-Za-z0-9_-]{40,48}$/.test(challengeId) ||
    typeof signedChallenge !== "string" ||
    signedChallenge.length > 16_384
  ) {
    return NextResponse.json({ error: "Invalid wallet challenge" }, { status: 400 });
  }

  let verified: ReturnType<typeof verifyWalletChallenge>;
  try {
    verified = verifyWalletChallenge({ address, challenge: signedChallenge });
  } catch {
    return NextResponse.json({ error: "Wallet challenge verification failed" }, { status: 401 });
  }

  try {
    const consumed = await consumeWalletChallenge({
      challengeId,
      address: verified.address,
      transactionHash: verified.transactionHash,
    });
    if (!consumed) {
      return NextResponse.json(
        { error: "Wallet challenge expired or already used" },
        { status: 401 },
      );
    }

    return NextResponse.json(
      { token: createWalletJwt(verified.address), address: verified.address },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Unable to create wallet session" }, { status: 503 });
  }
});
