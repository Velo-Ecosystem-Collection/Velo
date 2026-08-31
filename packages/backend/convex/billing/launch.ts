import { v } from "convex/values";

import type { MutationCtx, QueryCtx } from "../_generated/server";

import { mutation, query } from "../_generated/server";
import { requireBillingOperator } from "./access";
import { canonicalMainnetUsdcAsset, currentBillingEnvironment } from "./config";
import { launchApprovalAreaValidator } from "./schema";

const APPROVAL_AREAS = [
  "product",
  "finance",
  "legal",
  "tax",
  "compliance",
  "security",
  "operations",
] as const;

function requiredText(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

async function readiness(ctx: QueryCtx | MutationCtx, now: number) {
  const latestApprovals = await Promise.all(
    APPROVAL_AREAS.map(async (area) => {
      const rows = await ctx.db
        .query("billingLaunchApprovals")
        .withIndex("by_area_and_recorded_at", (q) => q.eq("area", area))
        .order("desc")
        .take(1);
      return [area, rows[0] ?? null] as const;
    }),
  );
  const approvals = Object.fromEntries(latestApprovals);
  const missingApprovals = APPROVAL_AREAS.filter((area) => approvals[area]?.status !== "approved");
  const approvedDigests = new Set(
    latestApprovals
      .map(([, approval]) => (approval?.status === "approved" ? approval.policyDigest : null))
      .filter((value): value is string => value !== null),
  );
  const treasury =
    (
      await ctx.db
        .query("billingTreasuries")
        .withIndex("by_network_and_active", (q) => q.eq("network", "public").eq("active", true))
        .order("desc")
        .take(1)
    )[0] ?? null;
  const offerCandidates = await ctx.db
    .query("billingOffers")
    .withIndex("by_network_and_active_and_active_from", (q) =>
      q.eq("network", "public").eq("active", true).lte("activeFrom", now),
    )
    .order("desc")
    .take(50);
  const offer =
    offerCandidates.find(
      (candidate) =>
        treasury &&
        candidate.treasuryId === treasury._id &&
        candidate.treasuryAddress === treasury.address &&
        candidate.asset === treasury.asset &&
        (candidate.activeUntil === undefined || candidate.activeUntil > now),
    ) ?? null;
  const canonicalAsset = canonicalMainnetUsdcAsset();
  const canonicalTreasury = treasury?.asset === canonicalAsset;
  const blockers = [
    ...missingApprovals.map((area) => `Missing approved ${area} launch record`),
    ...(approvedDigests.size <= 1 ? [] : ["Launch approvals reference different policy digests"]),
    ...(treasury ? [] : ["No active production treasury"]),
    ...(canonicalAsset ? [] : ["Canonical Mainnet USDC issuer is not configured"]),
    ...(treasury && !canonicalTreasury
      ? ["Production treasury does not use the configured canonical USDC issuer"]
      : []),
    ...(offer ? [] : ["No active Mainnet billing offer"]),
    ...(currentBillingEnvironment() === "production"
      ? []
      : ["Deployment environment is not production"]),
  ];
  return {
    approvals,
    approvalsReady: missingApprovals.length === 0 && approvedDigests.size <= 1,
    treasury,
    offer,
    ready: blockers.length === 0,
    blockers,
  };
}

async function rollbackIfArmed(ctx: MutationCtx, actor: string, reason: string) {
  const policy = await ctx.db
    .query("billingPolicies")
    .withIndex("by_key", (q) => q.eq("key", "global"))
    .unique();
  if (!policy?.mainnetCreditEnforcement) return;
  const now = Date.now();
  await ctx.db.patch(policy._id, {
    mainnetCreditEnforcement: false,
    billingTopupsEnabled: false,
    billingKillSwitch: true,
    version: policy.version + 1,
    updatedBy: `operator:${actor}`,
    updatedAt: now,
  });
  await ctx.db.insert("billingOperationalEvents", {
    eventType: "launch_rollback",
    actor,
    evidenceJson: JSON.stringify({ reason, previousPolicyVersion: policy.version }),
    occurredAt: now,
  });
}

export const getReadiness = query({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    await requireBillingOperator(ctx);
    return await readiness(ctx, args.now);
  },
});

export const recordApproval = mutation({
  args: {
    area: launchApprovalAreaValidator,
    status: v.union(v.literal("approved"), v.literal("rejected"), v.literal("revoked")),
    evidenceReference: v.string(),
    notes: v.string(),
    policyDigest: v.string(),
  },
  handler: async (ctx, args) => {
    const operator = await requireBillingOperator(ctx);
    const approvalId = await ctx.db.insert("billingLaunchApprovals", {
      area: args.area,
      status: args.status,
      approver: operator.walletAddress,
      evidenceReference: requiredText(args.evidenceReference, "Approval evidence"),
      notes: requiredText(args.notes, "Approval notes"),
      policyDigest: requiredText(args.policyDigest, "Policy digest"),
      recordedAt: Date.now(),
    });
    if (args.status !== "approved") {
      await rollbackIfArmed(ctx, operator.walletAddress, `${args.area}_${args.status}`);
    } else {
      const latest = await readiness(ctx, Date.now());
      if (!latest.approvalsReady) {
        await rollbackIfArmed(ctx, operator.walletAddress, "approval_set_no_longer_consistent");
      }
    }
    return approvalId;
  },
});

export const configureTreasury = mutation({
  args: {
    network: v.literal("public"),
    address: v.string(),
    asset: v.string(),
    verificationEvidenceReference: v.string(),
    signerPolicyReference: v.string(),
    withdrawalPolicyReference: v.string(),
    monitoringOwner: v.string(),
    reconciliationOwner: v.string(),
    incidentProcedureReference: v.string(),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    const operator = await requireBillingOperator(ctx);
    const address = args.address.trim().toUpperCase();
    const asset = args.asset.trim().toUpperCase();
    const canonicalAsset = canonicalMainnetUsdcAsset();
    if (!/^G[A-Z0-9]{3,}$/.test(address)) throw new Error("Treasury must be a Stellar account");
    if (!/^USDC:G[A-Z0-9]{3,}$/.test(asset)) {
      throw new Error("Production treasury asset must be canonical USDC");
    }
    if (canonicalAsset && asset !== canonicalAsset) {
      throw new Error("Production treasury asset does not match the configured canonical USDC");
    }
    if (args.active) {
      const active = await ctx.db
        .query("billingTreasuries")
        .withIndex("by_network_and_active", (q) => q.eq("network", "public").eq("active", true))
        .take(100);
      for (const treasury of active) await ctx.db.patch(treasury._id, { active: false });
    }
    const treasuryId = await ctx.db.insert("billingTreasuries", {
      network: args.network,
      address,
      asset,
      verificationEvidenceReference: requiredText(
        args.verificationEvidenceReference,
        "Verification evidence",
      ),
      signerPolicyReference: requiredText(args.signerPolicyReference, "Signer policy"),
      withdrawalPolicyReference: requiredText(args.withdrawalPolicyReference, "Withdrawal policy"),
      monitoringOwner: requiredText(args.monitoringOwner, "Monitoring owner"),
      reconciliationOwner: requiredText(args.reconciliationOwner, "Reconciliation owner"),
      incidentProcedureReference: requiredText(
        args.incidentProcedureReference,
        "Incident procedure",
      ),
      active: args.active,
      createdBy: operator.walletAddress,
      createdAt: Date.now(),
    });
    await rollbackIfArmed(ctx, operator.walletAddress, "production_treasury_changed");
    return treasuryId;
  },
});

export const activatePlatform = mutation({
  args: {
    action: v.union(v.literal("arm_mainnet"), v.literal("activate_mainnet"), v.literal("rollback")),
  },
  handler: async (ctx, args) => {
    const operator = await requireBillingOperator(ctx);
    const policy = await ctx.db
      .query("billingPolicies")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .unique();
    if (!policy) throw new Error("Billing policy is not initialized");
    const now = Date.now();
    if (args.action === "rollback") {
      await ctx.db.patch(policy._id, {
        mainnetCreditEnforcement: false,
        billingTopupsEnabled: false,
        billingKillSwitch: true,
        version: policy.version + 1,
        updatedBy: `operator:${operator.walletAddress}`,
        updatedAt: now,
      });
      await ctx.db.insert("billingOperationalEvents", {
        eventType: "launch_rollback",
        actor: operator.walletAddress,
        evidenceJson: JSON.stringify({ previousPolicyVersion: policy.version }),
        occurredAt: now,
      });
      return { active: false };
    }
    const gate = await readiness(ctx, now);
    if (!gate.ready) throw new Error(`Mainnet launch is not ready: ${gate.blockers.join("; ")}`);
    const activating = args.action === "activate_mainnet";
    await ctx.db.patch(policy._id, {
      mainnetCreditEnforcement: true,
      billingTopupsEnabled: true,
      billingKillSwitch: !activating,
      version: policy.version + 1,
      updatedBy: `operator:${operator.walletAddress}`,
      updatedAt: now,
    });
    await ctx.db.insert("billingOperationalEvents", {
      eventType: activating ? "launch_activated" : "launch_armed",
      actor: operator.walletAddress,
      evidenceJson: JSON.stringify({
        approvalIds: Object.values(gate.approvals)
          .filter((entry) => entry !== null)
          .map((entry) => entry!._id),
        treasuryId: gate.treasury?._id,
        offerId: gate.offer?._id,
      }),
      occurredAt: now,
    });
    return { active: activating };
  },
});
