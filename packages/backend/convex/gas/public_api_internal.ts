import { v } from "convex/values";

import { internalQuery } from "../_generated/server";
import { gasApiKeyAuthorizationResultValidator, verifyApiKeyForGas } from "./authorization";

/** Resolve a valid Gas API-key hash to its stored scope without consulting payment access. */
export const authorize = internalQuery({
  args: { apiKeyHash: v.string() },
  returns: gasApiKeyAuthorizationResultValidator,
  handler: async (ctx, args) => verifyApiKeyForGas(ctx, args.apiKeyHash),
});
