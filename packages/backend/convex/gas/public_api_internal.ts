import { v } from "convex/values";

import { internalQuery } from "../_generated/server";
import { gasApiKeyAuthorizationResultValidator, verifyApiKeyForGas } from "./authorization";
import { gasNetworkValidator, gasRelayerStatusValidator } from "./schema";
import { GAS_NETWORK } from "./types";

export type GasRelayerMetadataLookup =
  | { status: "ambiguous" }
  | { status: "active" | "disabled"; network: typeof GAS_NETWORK; publicKey: string }
  | null;

const gasRelayerMetadataLookupValidator = v.union(
  v.null(),
  v.object({ status: v.literal("ambiguous") }),
  v.object({
    status: gasRelayerStatusValidator,
    network: gasNetworkValidator,
    publicKey: v.string(),
  }),
);

/** Resolve a valid Gas API-key hash to its stored scope without consulting payment access. */
export const authorize = internalQuery({
  args: { apiKeyHash: v.string() },
  returns: gasApiKeyAuthorizationResultValidator,
  handler: async (ctx, args) => verifyApiKeyForGas(ctx, args.apiKeyHash),
});

/** Resolve one project's Testnet relayer metadata with bounded ambiguity detection. */
export const getRelayerMetadata = internalQuery({
  args: { projectId: v.id("projects") },
  returns: gasRelayerMetadataLookupValidator,
  handler: async (ctx, args): Promise<GasRelayerMetadataLookup> => {
    const matches = await ctx.db
      .query("relayerAccounts")
      .withIndex("by_project_id_and_network", (q) =>
        q.eq("projectId", args.projectId).eq("network", GAS_NETWORK),
      )
      .take(2);

    if (matches.length > 1) return { status: "ambiguous" };
    const account = matches[0];
    if (!account) return null;

    return {
      status: account.status,
      network: account.network,
      publicKey: account.publicKey,
    } satisfies Exclude<GasRelayerMetadataLookup, null | { status: "ambiguous" }>;
  },
});
