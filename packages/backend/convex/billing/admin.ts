import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import { mutation, query } from "../_generated/server";
import { requireBillingOperator } from "./access";
import { currentBillingNetwork } from "./config";

const updatePolicyRef = makeFunctionReference<"mutation">("billing/mutations:updatePolicy");
const initializePolicyRef = makeFunctionReference<"mutation">("billing/mutations:initializePolicy");
const setOrganizationPolicyRef = makeFunctionReference<"mutation">(
  "billing/mutations:setOrganizationPolicy",
);
const verifyOrganizationRef = makeFunctionReference<"mutation">("organizations/mutations:verify");
const grantPromotionRef = makeFunctionReference<"mutation">("billing/mutations:grantPromotion");

export const listOrganizations = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireBillingOperator(ctx);
    const limit = Math.min(100, Math.max(1, Math.floor(args.limit ?? 50)));
    const organizations = await ctx.db.query("organizations").order("desc").take(limit);
    return await Promise.all(
      organizations.map(async (organization) => ({
        ...organization,
        billingSettings: await ctx.db
          .query("organizationBillingSettings")
          .withIndex("by_organization_id", (q) => q.eq("organizationId", organization._id))
          .unique(),
      })),
    );
  },
});

export const getPolicy = query({
  args: {},
  handler: async (ctx) => {
    await requireBillingOperator(ctx);
    return await ctx.db
      .query("billingPolicies")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .unique();
  },
});

export const initializePolicy = mutation({
  args: {},
  handler: async (ctx) => {
    const operator = await requireBillingOperator(ctx);
    return await ctx.runMutation(initializePolicyRef, {
      actor: `operator:${operator.walletAddress}`,
    });
  },
});

export const updatePolicy = mutation({
  args: {
    billingLedgerWrite: v.boolean(),
    billingShadowMode: v.boolean(),
    mainnetCreditEnforcement: v.boolean(),
    billingTopupsEnabled: v.boolean(),
    promoGrantEnabled: v.boolean(),
    pdaxBillingEnabled: v.boolean(),
    billingKillSwitch: v.boolean(),
    promoCredits: v.optional(v.int64()),
    promoValidityMs: v.optional(v.number()),
    reservationTtlMs: v.optional(v.number()),
    promoFirst: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const operator = await requireBillingOperator(ctx);
    const existing = await ctx.db
      .query("billingPolicies")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .unique();
    if (
      args.mainnetCreditEnforcement ||
      (currentBillingNetwork() === "public" && !args.billingKillSwitch)
    ) {
      throw new Error("Use the guarded Mainnet launch workflow for production activation");
    }
    const policyId = await ctx.runMutation(updatePolicyRef, {
      ...args,
      actor: `operator:${operator.walletAddress}`,
    });
    if (existing && existing.billingKillSwitch !== args.billingKillSwitch) {
      await ctx.db.insert("billingOperationalEvents", {
        eventType: "kill_switch_changed",
        actor: operator.walletAddress,
        evidenceJson: JSON.stringify({
          previous: existing.billingKillSwitch,
          next: args.billingKillSwitch,
          previousPolicyVersion: existing.version,
        }),
        occurredAt: Date.now(),
      });
    }
    return policyId;
  },
});

export const setOrganizationPolicy = mutation({
  args: {
    organizationId: v.id("organizations"),
    enforcementEnabled: v.boolean(),
    shadowEnabled: v.boolean(),
    sandboxEnforcementEnabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const operator = await requireBillingOperator(ctx);
    return await ctx.runMutation(setOrganizationPolicyRef, {
      ...args,
      actor: `operator:${operator.walletAddress}`,
    });
  },
});

export const verifyAndGrantTrial = mutation({
  args: {
    organizationId: v.id("organizations"),
    evidenceReference: v.string(),
    reason: v.string(),
    grantTrial: v.boolean(),
  },
  handler: async (ctx, args) => {
    const operator = await requireBillingOperator(ctx);
    const actor = `operator:${operator.walletAddress}`;
    await ctx.runMutation(verifyOrganizationRef, {
      organizationId: args.organizationId,
      evidenceType: "manual_review",
      evidenceReference: args.evidenceReference,
      actor,
      reason: args.reason,
    });
    if (!args.grantTrial) return { verified: true, granted: false };
    const grant = await ctx.runMutation(grantPromotionRef, {
      organizationId: args.organizationId,
      book: "commercial",
      idempotencyKey: `commercial-promo:${args.organizationId}`,
      actor,
    });
    return { verified: true, granted: grant.applied };
  },
});
