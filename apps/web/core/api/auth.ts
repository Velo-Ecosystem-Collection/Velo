import crypto from "crypto";

import type { NextRequest } from "next/server";

/**
 * Extracts the API Key from the authorization header or the custom x-api-key header.
 */
export function getApiKeyFromRequest(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.substring(7).trim();
  }

  const apiKey = request.headers.get("x-api-key");
  return apiKey ? apiKey.trim() : null;
}

/**
 * Computes the SHA-256 hash of the API key to compare against the stored hash in the database.
 */
export function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}
