import { v } from "convex/values";

import type { RelayerBalanceRefreshResult } from "./balance_internal";

import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import { readTestnetNativeBalance } from "./balance";
import { relayerBalanceRefreshResultValidator } from "./balance_internal";

/** Read and safely persist the authenticated project's configured Testnet relayer balance. */
export const refreshRelayerBalance = action({
  args: { projectId: v.id("projects") },
  returns: relayerBalanceRefreshResultValidator,
  handler: async (ctx, args): Promise<RelayerBalanceRefreshResult> => {
    if ((await ctx.auth.getUserIdentity()) === null) {
      throw new Error("Not authenticated");
    }

    const claim = await ctx.runMutation(internal.gas.balance_internal.claim, {
      projectId: args.projectId,
    });
    if (claim.status !== "claimed") return claim;

    const observation = await readTestnetNativeBalance(claim.publicKey);
    return await ctx.runMutation(internal.gas.balance_internal.complete, {
      projectId: args.projectId,
      relayerId: claim.relayerId,
      publicKey: claim.publicKey,
      network: claim.network,
      relayerStatus: claim.relayerStatus,
      refreshToken: claim.refreshToken,
      refreshStartedAt: claim.refreshStartedAt,
      authorization: claim.authorization,
      observation,
    });
  },
});
