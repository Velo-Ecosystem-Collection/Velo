import { v } from "convex/values";

import type { GasPolicyProjection, RelayerAccountProjection } from "./projections";

import { query } from "../_generated/server";
import { requireGasConsoleAccess } from "./authorization";
import {
  gasPolicyProjectionValidator,
  projectGasPolicy,
  projectRelayerAccount,
  relayerAccountProjectionValidator,
} from "./projections";
import { GAS_NETWORK } from "./types";

/** Read the authenticated project's Testnet Gas policy. */
export const getPolicy = query({
  args: { projectId: v.id("projects") },
  returns: v.union(gasPolicyProjectionValidator, v.null()),
  handler: async (ctx, args): Promise<GasPolicyProjection | null> => {
    await requireGasConsoleAccess(ctx, args.projectId, "read");

    const policy = await ctx.db
      .query("gasPolicies")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .unique();

    return policy ? projectGasPolicy(policy) : null;
  },
});

/** Read the authenticated project's Testnet relayer metadata. */
export const getRelayerAccount = query({
  args: { projectId: v.id("projects") },
  returns: v.union(relayerAccountProjectionValidator, v.null()),
  handler: async (ctx, args): Promise<RelayerAccountProjection | null> => {
    await requireGasConsoleAccess(ctx, args.projectId, "read");

    const account = await ctx.db
      .query("relayerAccounts")
      .withIndex("by_project_id_and_network", (q) =>
        q.eq("projectId", args.projectId).eq("network", GAS_NETWORK),
      )
      .unique();

    return account ? projectRelayerAccount(account) : null;
  },
});
