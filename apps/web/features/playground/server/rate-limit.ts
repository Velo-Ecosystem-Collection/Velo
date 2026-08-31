import { env } from "@/core/config/env";
import { api } from "@repo/backend/convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";

export type PlaygroundRateLimitOperation = "contract_load" | "simulation" | "submission" | "status";

type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterMs: number;
};

const convex = new ConvexHttpClient(env.NEXT_PUBLIC_CONVEX_URL);

async function hmac(secret: string, value: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return [...new Uint8Array(bytes)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

export function trustedPlaygroundIdentity(request: Request) {
  if (process.env.VERCEL === "1") {
    const candidate = request.headers.get("x-vercel-forwarded-for")?.split(",", 1)[0]?.trim();
    if (candidate) return candidate;
  }
  return "shared-anonymous";
}

export async function consumePlaygroundRateLimit(
  request: Request,
  operation: PlaygroundRateLimitOperation,
): Promise<RateLimitResult | null> {
  const secret = process.env.VELO_PLAYGROUND_RATE_LIMIT_SECRET;
  if (!secret) return null;
  const scopeHash = await hmac(secret, `scope:${trustedPlaygroundIdentity(request)}`);
  const signedAt = Date.now();
  const signature = await hmac(secret, JSON.stringify([scopeHash, operation, signedAt]));
  return await convex.mutation(
    api.rate_limits.mutations.consumePlayground,
    { scopeHash, operation, signedAt, signature },
    { skipQueue: true },
  );
}

function rateHeaders(result: RateLimitResult) {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(Math.max(0, result.remaining)),
    ...(result.retryAfterMs > 0
      ? { "Retry-After": String(Math.max(1, Math.ceil(result.retryAfterMs / 1_000))) }
      : {}),
  };
}

export async function guardPlaygroundRequest(args: {
  request: Request;
  operation: PlaygroundRateLimitOperation;
  correlationId: string;
  maxBytes?: number;
}) {
  const contentLength = Number(args.request.headers.get("content-length") ?? "0");
  if (
    args.maxBytes !== undefined &&
    (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > args.maxBytes)
  ) {
    return Response.json(
      {
        error: {
          code: "PAYLOAD_TOO_LARGE",
          stage: "validate",
          message: "The Playground request payload is too large.",
          retryable: false,
          correlationId: args.correlationId,
        },
      },
      { status: 413, headers: { "Cache-Control": "no-store" } },
    );
  }
  let result: RateLimitResult | null;
  try {
    result = await consumePlaygroundRateLimit(args.request, args.operation);
  } catch {
    result = null;
  }
  if (!result) {
    const production = process.env.VERCEL_ENV === "production";
    const failClosed =
      production || args.operation === "simulation" || args.operation === "submission";
    if (failClosed) {
      return Response.json(
        {
          error: {
            code: "RATE_LIMIT_UNAVAILABLE",
            stage: "rate-limit",
            message: "Playground protection is temporarily unavailable. Try again shortly.",
            retryable: true,
            correlationId: args.correlationId,
          },
        },
        { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "30" } },
      );
    }
    return null;
  }
  if (!result.allowed) {
    return Response.json(
      {
        error: {
          code: "RATE_LIMITED",
          stage: "rate-limit",
          message: "Too many Playground requests. Wait and try again.",
          retryable: true,
          correlationId: args.correlationId,
        },
      },
      { status: 429, headers: { "Cache-Control": "no-store", ...rateHeaders(result) } },
    );
  }
  return null;
}
