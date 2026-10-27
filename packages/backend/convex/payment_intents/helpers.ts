import { ConvexError } from "convex/values";

import type { MutationCtx, QueryCtx } from "../_generated/server";

import { canUseGeneralApi } from "../api_keys/helpers";

/**
 * Validates an API key hash and returns the associated project if authorized.
 * Checks that the key exists, is not revoked, and the project has payment access active.
 */
export async function verifyApiKeyForPayments(ctx: QueryCtx | MutationCtx, apiKeyHash: string) {
  const apiKey = await ctx.db
    .query("apiKeys")
    .withIndex("by_key_hash", (q) => q.eq("keyHash", apiKeyHash))
    .unique();

  if (!apiKey || apiKey.revoked || !canUseGeneralApi(apiKey)) {
    return { authorized: false as const };
  }

  const project = await ctx.db.get(apiKey.projectId);
  if (!project) {
    return { authorized: false as const };
  }

  if (!project.paymentAccessActive) {
    return { authorized: false as const, reason: "Payment access not activated" };
  }

  return {
    authorized: true as const,
    project,
    apiKey,
    apiKeyId: apiKey._id,
  };
}

export function createPaymentIntentFingerprint(args: {
  amount: string;
  asset: string;
  description?: string;
  successUrl?: string;
  cancelUrl?: string;
  anchor?: string;
}) {
  return JSON.stringify({
    amount: args.amount,
    asset: args.asset,
    cancelUrl: args.cancelUrl ?? null,
    description: args.description ?? null,
    successUrl: args.successUrl ?? null,
    anchor: args.anchor ?? null,
  });
}

/** Default payment intent expiry: 30 minutes in milliseconds. */
export const PAYMENT_INTENT_EXPIRY_MS = 30 * 60 * 1000;

export function mapAssetToPdax(asset: string): string {
  if (asset === "native" || asset === "XLM") return "XLM";
  if (asset === "USDC" || asset.startsWith("USDC:")) return "USDCXLM";
  return asset;
}

/**
 * Valid status transitions for payment intents.
 * Key = current status, Value = set of allowed next statuses.
 */
export const STATUS_TRANSITIONS: Record<string, ReadonlySet<string>> = {
  awaiting_route: new Set(["created", "failed", "expired", "cancelled"]),
  created: new Set(["pending", "expired", "cancelled", "failed"]),
  pending: new Set(["paid", "failed", "expired", "cancelled"]),
};

/**
 * Resolves the payment anchor based on the requested anchor, API key scope, and project defaults.
 * Throws a ConvexError if an explicit anchor request conflicts with the API key's scoped anchor.
 */
export function resolvePaymentAnchor(args: {
  requestedAnchor?: "inhouse" | "pdax";
  apiKeyAnchor?: "inhouse" | "pdax";
  projectDefaultAnchor?: "inhouse" | "pdax";
}): "inhouse" | "pdax" {
  if (args.requestedAnchor !== undefined) {
    if (args.apiKeyAnchor !== undefined && args.requestedAnchor !== args.apiKeyAnchor) {
      throw new ConvexError(
        "Anchor mismatch: Requested anchor does not match the API key's scoped anchor.",
      );
    }
    return args.requestedAnchor;
  }

  if (args.apiKeyAnchor !== undefined) {
    return args.apiKeyAnchor;
  }

  if (args.projectDefaultAnchor !== undefined) {
    return args.projectDefaultAnchor;
  }

  return "inhouse";
}
