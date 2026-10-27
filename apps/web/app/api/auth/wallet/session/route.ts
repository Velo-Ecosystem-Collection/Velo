import { createWalletJwt } from "@/core/auth/wallet-jwt";
import { withRouteTelemetry } from "@/core/observability";
import { assertValidPublicKey } from "@repo/stellar";
import { NextResponse } from "next/server";

export const POST = withRouteTelemetry("wallet.session", async (request) => {
  try {
    const body = (await request.json()) as { address?: string };
    if (!body.address) {
      return NextResponse.json({ error: "Missing wallet address" }, { status: 400 });
    }

    const address = assertValidPublicKey(body.address);
    return NextResponse.json({ token: createWalletJwt(address), address });
  } catch {
    return NextResponse.json({ error: "Unable to create wallet session" }, { status: 400 });
  }
});
