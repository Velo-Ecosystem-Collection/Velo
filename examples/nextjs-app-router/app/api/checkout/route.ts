import { Velo } from "@carts1024/velo-sdk";
import { NextResponse } from "next/server";

import { getCheckoutAnchorError, getDemoRedirectUrls, requireInhouseApiKey } from "./config";

function createVeloClient() {
  return new Velo({
    apiKey: requireInhouseApiKey(),
    environment: (process.env.VELO_ENV as "testnet" | "production" | "development") || "testnet",
    baseUrl: process.env.VELO_BASE_URL,
  });
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json().catch(() => null);
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: "Request body must be an object." }, { status: 400 });
    }
    const input = body as Record<string, unknown>;
    const anchorError = getCheckoutAnchorError(input.anchor);
    if (anchorError) {
      return NextResponse.json({ error: anchorError.error }, { status: anchorError.status });
    }
    const assetValue = input.asset;
    if (assetValue !== undefined && typeof assetValue !== "string") {
      return NextResponse.json({ error: "asset must be a string." }, { status: 400 });
    }
    const asset = typeof assetValue === "string" && assetValue ? assetValue : "USDC";

    const velo = createVeloClient();
    const redirectUrls = getDemoRedirectUrls(request.url);

    const session = await velo.checkout.sessions.create(
      {
        amount: "10.00",
        asset,
        anchor: "inhouse",
        description: `Order #1001 (${asset === "native" ? "XLM" : asset})`,
        ...redirectUrls,
      },
      {
        // Supplying an idempotency key is recommended to prevent duplicates on retries
        idempotencyKey: `order-1001-${asset.toLowerCase()}-${Date.now()}`,
      },
    );

    return NextResponse.json({ checkoutUrl: session.checkoutUrl });
  } catch (error) {
    console.error("Velo Checkout error:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
