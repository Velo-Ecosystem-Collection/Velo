import { v } from "convex/values";

import type { GasPolicyProjection, RelayerAccountProjection } from "./projections";

import { mutation } from "../_generated/server";
import { requireGasConsoleAccess } from "./authorization";
import {
  gasPolicyProjectionValidator,
  projectGasPolicy,
  projectRelayerAccount,
  relayerAccountProjectionValidator,
} from "./projections";
import { gasRelayerStatusValidator } from "./schema";
import { GAS_NETWORK } from "./types";
import {
  assertNonNegativeSafeInteger,
  normalizeContractAllowlist,
  normalizeRelayerPublicKey,
  parseStroopAmount,
} from "./validation";

function utcDayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/** Create or update the authenticated project's Testnet Gas policy. */
export const updatePolicy = mutation({
  args: {
    projectId: v.id("projects"),
    enabled: v.boolean(),
    dailyCapStroops: v.string(),
    walletHourlyLimit: v.number(),
    allowedContractIds: v.array(v.string()),
  },
  returns: gasPolicyProjectionValidator,
  handler: async (ctx, args): Promise<GasPolicyProjection> => {
    await requireGasConsoleAccess(ctx, args.projectId, "updatePolicy");

    const dailyCapStroops = parseStroopAmount(args.dailyCapStroops);
    const walletHourlyLimit = assertNonNegativeSafeInteger(
      args.walletHourlyLimit,
      "walletHourlyLimit",
    );
    const allowedContractIds = normalizeContractAllowlist(args.allowedContractIds);
    const existing = await ctx.db
      .query("gasPolicies")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .unique();
    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        enabled: args.enabled,
        network: GAS_NETWORK,
        dailyCapStroops,
        walletHourlyLimit,
        allowedContractIds,
        updatedAt: now,
      });

      const updated = await ctx.db.get("gasPolicies", existing._id);
      if (!updated) throw new Error("Gas policy disappeared during update");
      return projectGasPolicy(updated);
    }

    const policyId = await ctx.db.insert("gasPolicies", {
      projectId: args.projectId,
      enabled: args.enabled,
      network: GAS_NETWORK,
      dailyCapStroops,
      dailyReservedStroops: 0n,
      dailyWindowKey: utcDayKey(now),
      walletHourlyLimit,
      allowedContractIds,
      createdAt: now,
      updatedAt: now,
    });
    const created = await ctx.db.get("gasPolicies", policyId);
    if (!created) throw new Error("Gas policy was not created");
    return projectGasPolicy(created);
  },
});

/** Create or update the authenticated project's Testnet relayer metadata. */
export const updateRelayerAccount = mutation({
  args: {
    projectId: v.id("projects"),
    publicKey: v.string(),
    status: gasRelayerStatusValidator,
  },
  returns: relayerAccountProjectionValidator,
  handler: async (ctx, args): Promise<RelayerAccountProjection> => {
    await requireGasConsoleAccess(ctx, args.projectId, "updateRelayer");

    const publicKey = normalizeRelayerPublicKey(args.publicKey);
    const existing = await ctx.db
      .query("relayerAccounts")
      .withIndex("by_project_id_and_network", (q) =>
        q.eq("projectId", args.projectId).eq("network", GAS_NETWORK),
      )
      .unique();
    const assigned = await ctx.db
      .query("relayerAccounts")
      .withIndex("by_public_key", (q) => q.eq("publicKey", publicKey))
      .unique();

    if (assigned && assigned.projectId !== args.projectId) {
      throw new Error("Relayer public key is already assigned to another project");
    }

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        publicKey,
        status: args.status,
        network: GAS_NETWORK,
        updatedAt: now,
      });

      const updated = await ctx.db.get("relayerAccounts", existing._id);
      if (!updated) throw new Error("Relayer account disappeared during update");
      return projectRelayerAccount(updated);
    }

    const accountId = await ctx.db.insert("relayerAccounts", {
      projectId: args.projectId,
      publicKey,
      network: GAS_NETWORK,
      status: args.status,
      createdAt: now,
      updatedAt: now,
    });
    const created = await ctx.db.get("relayerAccounts", accountId);
    if (!created) throw new Error("Relayer account was not created");
    return projectRelayerAccount(created);
  },
});
