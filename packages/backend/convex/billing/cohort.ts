import { v } from "convex/values";

import { mutation } from "../_generated/server";
import { requireBillingOperator } from "./access";
import { notifyOrganization } from "./notifications";

export const configure = mutation({
  args: {
    organizationId: v.id("organizations"),
    cohortStage: v.union(
      v.literal("internal"),
      v.literal("design_partner"),
      v.literal("paid_cohort"),
    ),
    enforcementEnabled: v.boolean(),
    graceUntil: v.number(),
    payAccessMirrorEnabled: v.boolean(),
    sendMigrationNotice: v.optional(v.boolean()),
    sendLowBalanceNotice: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const operator = await requireBillingOperator(ctx);
    const organization = await ctx.db.get(args.organizationId);
    if (!organization) throw new Error("Organization not found");
    if (organization.verificationStatus !== "verified") {
      throw new Error("Organization must be verified before cohort enrollment");
    }
    if (organization.trialState !== "granted") {
      throw new Error("Organization trial must be granted before cohort enrollment");
    }
    if (!Number.isFinite(args.graceUntil) || args.graceUntil <= 0) {
      throw new Error("An explicit grace deadline is required");
    }
    const existing = await ctx.db
      .query("organizationBillingSettings")
      .withIndex("by_organization_id", (q) => q.eq("organizationId", args.organizationId))
      .unique();
    const now = Date.now();
    const migrationNoticeSentAt =
      args.sendMigrationNotice === true ? now : existing?.migrationNoticeSentAt;
    const lowBalanceNoticeSentAt =
      args.sendLowBalanceNotice === true ? now : existing?.lowBalanceNoticeSentAt;
    if (args.enforcementEnabled && (!migrationNoticeSentAt || !lowBalanceNoticeSentAt)) {
      throw new Error("Migration and low-balance notices are required before enforcement");
    }
    const activationState = args.enforcementEnabled
      ? args.graceUntil > now
        ? ("grace" as const)
        : ("enabled" as const)
      : ("paused" as const);
    const values = {
      organizationId: args.organizationId,
      enforcementEnabled: args.enforcementEnabled,
      shadowEnabled: existing?.shadowEnabled ?? false,
      sandboxEnforcementEnabled: existing?.sandboxEnforcementEnabled ?? false,
      cohortStage: args.cohortStage,
      activationState,
      graceUntil: args.graceUntil,
      migrationNoticeSentAt,
      lowBalanceNoticeSentAt,
      enforcementEnabledAt: args.enforcementEnabled ? now : existing?.enforcementEnabledAt,
      payAccessMirrorEnabled: args.payAccessMirrorEnabled,
      updatedBy: `operator:${operator.walletAddress}`,
      updatedAt: now,
    };
    if (existing) await ctx.db.patch(existing._id, values);
    else await ctx.db.insert("organizationBillingSettings", values);
    if (args.sendMigrationNotice) {
      await notifyOrganization(ctx, {
        organizationId: args.organizationId,
        notificationType: "migration_notice",
        dedupeKey: `migration-notice:${args.organizationId}:${args.graceUntil}`,
        title: "Mainnet billing migration scheduled",
        message: `Credit enforcement is scheduled after ${new Date(args.graceUntil).toISOString()}.`,
      });
    }
    if (args.sendLowBalanceNotice) {
      await notifyOrganization(ctx, {
        organizationId: args.organizationId,
        notificationType: "low_balance",
        dedupeKey: `pre-enforcement-low-balance:${args.organizationId}:${args.graceUntil}`,
        title: "Check your Mainnet credit balance",
        message: "Review your balance and top-up instructions before enforcement begins.",
      });
    }
    await ctx.db.insert("billingOperationalEvents", {
      eventType: "cohort_changed",
      actor: operator.walletAddress,
      organizationId: args.organizationId,
      evidenceJson: JSON.stringify({
        cohortStage: args.cohortStage,
        activationState,
        graceUntil: args.graceUntil,
      }),
      occurredAt: now,
    });
    return { activationState };
  },
});
