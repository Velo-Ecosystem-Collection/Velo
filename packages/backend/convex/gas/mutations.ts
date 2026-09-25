import { ConvexError, v } from "convex/values";

import type { GasPolicyProjection, RelayerAccountProjection } from "./projections";

import { mutation } from "../_generated/server";
import { ensureGasAccounting } from "./accounting";
import { requireGasConsoleAccess, requireGasFundsOwnerAccess } from "./authorization";
import { startOwnerProvisioningAttempt } from "./custody_internal";
import {
  gasPolicyProjectionValidator,
  projectGasPolicy,
  projectRelayerAccount,
  relayerAccountProjectionValidator,
} from "./projections";
import { gasRelayerStatusValidator } from "./schema";
import { GAS_NETWORK, GAS_POLICY_ERROR_CODES } from "./types";
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

    const maintenanceMatches = await ctx.db
      .query("gasProjectMaintenance")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .take(2);
    if (maintenanceMatches.length > 0) throw new Error("Gas account maintenance is in progress");

    const dailyCapStroops = parseStroopAmount(args.dailyCapStroops);
    const walletHourlyLimit = assertNonNegativeSafeInteger(
      args.walletHourlyLimit,
      "walletHourlyLimit",
    );
    const allowedContractIds = normalizeContractAllowlist(args.allowedContractIds);
    const policyMatches = await ctx.db
      .query("gasPolicies")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .take(2);
    if (policyMatches.length > 1) throw new Error("Multiple Gas policies exist for project");
    const existing = policyMatches[0] ?? null;
    const custodyMatches = await ctx.db
      .query("gasRelayerCustody")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .take(2);
    if (custodyMatches.length > 1)
      throw new Error("Multiple Gas custody records exist for project");
    if (custodyMatches[0]?.status === "ready" && args.enabled && existing?.enabled !== true) {
      throw new Error("Review and enable managed sponsorship from the owner controls");
    }
    const now = Date.now();
    const currentDayKey = utcDayKey(now);

    if (existing) {
      const accounting = await ensureGasAccounting(ctx, existing, now);
      if (!accounting.ok) {
        throw new Error(
          accounting.reason === "overflow"
            ? "Gas policy accounting has too many legacy rows"
            : "Current-day Gas policy accounting is invalid",
        );
      }
      if (dailyCapStroops < accounting.snapshot.effectiveUsageStroops) {
        throw new ConvexError({
          code: GAS_POLICY_ERROR_CODES.dailyCapBelowEffectiveUsage,
          message: "Daily Gas cap cannot be lower than current effective usage.",
        });
      }

      await ctx.db.patch(existing._id, {
        enabled: args.enabled,
        network: GAS_NETWORK,
        dailyCapStroops,
        dailyReservedStroops: accounting.snapshot.effectiveUsageStroops,
        dailyWindowKey: currentDayKey,
        outstandingHoldsStroops: accounting.snapshot.outstandingHoldsStroops,
        dailyConfirmedSpendStroops: accounting.snapshot.dailyConfirmedSpendStroops,
        accountingState: "initialized",
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
      outstandingHoldsStroops: 0n,
      dailyConfirmedSpendStroops: 0n,
      accountingState: "initialized",
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

    const maintenanceMatches = await ctx.db
      .query("gasProjectMaintenance")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .take(1);
    if (maintenanceMatches.length > 0) throw new Error("Gas account maintenance is in progress");

    const publicKey = normalizeRelayerPublicKey(args.publicKey);
    const custodyMatches = await ctx.db
      .query("gasRelayerCustody")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .take(2);
    if (custodyMatches.length > 1)
      throw new Error("Multiple Gas custody records exist for project");
    const managedCustody = custodyMatches[0]?.status === "ready" ? custodyMatches[0] : null;
    if (managedCustody && managedCustody.publicKey !== publicKey) {
      throw new Error("Managed relayer address cannot be changed through metadata settings");
    }

    const existingMatches = await ctx.db
      .query("relayerAccounts")
      .withIndex("by_project_id_and_network", (q) =>
        q.eq("projectId", args.projectId).eq("network", GAS_NETWORK),
      )
      .take(2);
    if (existingMatches.length > 1) throw new Error("Multiple Gas relayers exist for project");
    const existing = existingMatches[0] ?? null;
    if (existing && existing.publicKey !== publicKey) {
      if (existing.status !== "disabled" || args.status !== "disabled") {
        throw new Error("Pause the existing relayer before changing its address");
      }
      const policies = await ctx.db
        .query("gasPolicies")
        .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
        .take(2);
      if (policies.length > 1) throw new Error("Multiple Gas policies exist for project");
      const policy = policies[0];
      if (policy?.enabled)
        throw new Error("Disable sponsorship before changing the relayer address");
      if (policy) {
        const accounting = await ensureGasAccounting(ctx, policy, Date.now());
        if (!accounting.ok || accounting.snapshot.outstandingHoldsStroops > 0n) {
          throw new Error("Resolve all Gas commitments before changing the relayer address");
        }
      }
    }
    const assignedMatches = await ctx.db
      .query("relayerAccounts")
      .withIndex("by_public_key", (q) => q.eq("publicKey", publicKey))
      .take(2);
    if (assignedMatches.length > 1) throw new Error("Multiple Gas relayers use public key");
    const assigned = assignedMatches[0] ?? null;

    if (assigned && assigned.projectId !== args.projectId) {
      throw new Error("Relayer public key is already assigned to another project");
    }

    const now = Date.now();
    if (existing) {
      const publicKeyChanged = existing.publicKey !== publicKey;
      const statusChanged = existing.status !== args.status;
      await ctx.db.patch(existing._id, {
        publicKey,
        status: args.status,
        network: GAS_NETWORK,
        ...(publicKeyChanged ? { balanceStroops: undefined, balanceUpdatedAt: undefined } : {}),
        ...(publicKeyChanged || statusChanged
          ? { refreshToken: undefined, refreshStartedAt: undefined }
          : {}),
        updatedAt: now,
      });

      if (args.status === "disabled") {
        const policyMatches = await ctx.db
          .query("gasPolicies")
          .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
          .take(2);
        if (policyMatches.length > 1) throw new Error("Multiple Gas policies exist for project");
        const policy = policyMatches[0];
        if (policy?.enabled) await ctx.db.patch(policy._id, { enabled: false, updatedAt: now });
      }

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

export const retryProvisioning = mutation({
  args: { projectId: v.id("projects") },
  returns: v.union(
    v.literal("queued"),
    v.literal("already_pending"),
    v.literal("already_ready"),
    v.literal("legacy_relayer_exists"),
  ),
  handler: async (ctx, args) => {
    await requireGasConsoleAccess(ctx, args.projectId, "updateRelayer");
    return await startOwnerProvisioningAttempt(ctx, args.projectId);
  },
});

export const setManagedRelayerStatus = mutation({
  args: {
    projectId: v.id("projects"),
    status: v.union(v.literal("active"), v.literal("disabled")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireGasConsoleAccess(ctx, args.projectId, "updateRelayer");
    const maintenanceMatches = await ctx.db
      .query("gasProjectMaintenance")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .take(1);
    if (maintenanceMatches.length > 0) throw new Error("Gas account maintenance is in progress");
    const custodyMatches = await ctx.db
      .query("gasRelayerCustody")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .take(2);
    const custody = custodyMatches[0];
    if (custodyMatches.length !== 1 || !custody || custody.status !== "ready") {
      throw new Error("Managed relayer is not ready");
    }
    const accountMatches = await ctx.db
      .query("relayerAccounts")
      .withIndex("by_project_id_and_network", (q) =>
        q.eq("projectId", args.projectId).eq("network", GAS_NETWORK),
      )
      .take(2);
    const account = accountMatches[0];
    if (accountMatches.length !== 1 || !account || account.publicKey !== custody.publicKey) {
      throw new Error("Managed relayer metadata is inconsistent");
    }

    const now = Date.now();
    await ctx.db.patch(account._id, {
      status: args.status,
      refreshToken: undefined,
      refreshStartedAt: undefined,
      updatedAt: now,
    });
    if (args.status === "disabled") {
      const policyMatches = await ctx.db
        .query("gasPolicies")
        .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
        .take(2);
      if (policyMatches.length > 1) throw new Error("Multiple Gas policies exist for project");
      const policy = policyMatches[0];
      if (policy?.enabled) await ctx.db.patch(policy._id, { enabled: false, updatedAt: now });
    }
    return null;
  },
});

export const activateManagedSponsorship = mutation({
  args: { projectId: v.id("projects") },
  returns: gasPolicyProjectionValidator,
  handler: async (ctx, args): Promise<GasPolicyProjection> => {
    const access = await requireGasFundsOwnerAccess(ctx, args.projectId);
    if (access.project.retiredAt !== undefined) throw new Error("Project is retired");
    const maintenanceMatches = await ctx.db
      .query("gasProjectMaintenance")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .take(1);
    if (maintenanceMatches.length > 0) throw new Error("Gas account maintenance is in progress");

    const custodyMatches = await ctx.db
      .query("gasRelayerCustody")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .take(2);
    const custody = custodyMatches[0];
    if (
      custodyMatches.length !== 1 ||
      !custody ||
      custody.status !== "ready" ||
      !custody.publicKey
    ) {
      throw new Error("Managed relayer is not ready");
    }
    const relayerMatches = await ctx.db
      .query("relayerAccounts")
      .withIndex("by_project_id_and_network", (q) =>
        q.eq("projectId", args.projectId).eq("network", GAS_NETWORK),
      )
      .take(2);
    const relayer = relayerMatches[0];
    if (
      relayerMatches.length !== 1 ||
      !relayer ||
      relayer.publicKey !== custody.publicKey ||
      relayer.status !== "active"
    ) {
      throw new Error("Managed relayer must be resumed before sponsorship is enabled");
    }

    const projectContracts = await ctx.db
      .query("projectContracts")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .take(100);
    const allowedContractIds = projectContracts
      .filter((contract) => contract.status === "active")
      .map((contract) => contract.contractId);
    if (allowedContractIds.length > 20) {
      throw new Error("Managed sponsorship supports at most 20 active linked contracts");
    }

    const policyMatches = await ctx.db
      .query("gasPolicies")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .take(2);
    if (policyMatches.length > 1) throw new Error("Multiple Gas policies exist for project");
    const existing = policyMatches[0] ?? null;
    const now = Date.now();
    const dailyCapStroops = existing?.dailyCapStroops ?? 100_000_000n;
    const walletHourlyLimit = existing?.walletHourlyLimit ?? 100;
    const currentDayKey = utcDayKey(now);
    let usage = 0n;
    let outstandingHolds = 0n;
    let dailyConfirmedSpend = 0n;
    if (existing) {
      const accounting = await ensureGasAccounting(ctx, existing, now);
      if (!accounting.ok) throw new Error("Gas policy accounting is unavailable");
      if (dailyCapStroops < accounting.snapshot.effectiveUsageStroops) {
        throw new ConvexError({
          code: GAS_POLICY_ERROR_CODES.dailyCapBelowEffectiveUsage,
          message: "Daily Gas cap cannot be lower than current effective usage.",
        });
      }
      usage = accounting.snapshot.effectiveUsageStroops;
      outstandingHolds = accounting.snapshot.outstandingHoldsStroops;
      dailyConfirmedSpend = accounting.snapshot.dailyConfirmedSpendStroops;
    }
    const policyId = existing
      ? existing._id
      : await ctx.db.insert("gasPolicies", {
          projectId: args.projectId,
          enabled: false,
          network: GAS_NETWORK,
          dailyCapStroops,
          dailyReservedStroops: 0n,
          dailyWindowKey: currentDayKey,
          outstandingHoldsStroops: 0n,
          dailyConfirmedSpendStroops: 0n,
          accountingState: "initialized",
          walletHourlyLimit,
          allowedContractIds,
          createdAt: now,
          updatedAt: now,
        });
    await ctx.db.patch(policyId, {
      enabled: allowedContractIds.length > 0,
      network: GAS_NETWORK,
      dailyCapStroops,
      dailyReservedStroops: usage,
      dailyWindowKey: currentDayKey,
      outstandingHoldsStroops: outstandingHolds,
      dailyConfirmedSpendStroops: dailyConfirmedSpend,
      accountingState: "initialized",
      walletHourlyLimit,
      allowedContractIds,
      updatedAt: now,
    });
    const policy = await ctx.db.get("gasPolicies", policyId);
    if (!policy) throw new Error("Gas policy was not created");
    return projectGasPolicy(policy);
  },
});
