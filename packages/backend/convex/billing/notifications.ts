import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

import { mutation } from "../_generated/server";
import { findOrganizationForIdentity } from "../organizations/helpers";

export async function notifyOrganization(
  ctx: MutationCtx,
  args: {
    organizationId: Id<"organizations">;
    notificationType:
      | "low_balance"
      | "zero_balance"
      | "promotional_expiry"
      | "reservation_recovery"
      | "topup_success"
      | "topup_failure"
      | "migration_notice"
      | "enforcement_scheduled";
    dedupeKey: string;
    title: string;
    message: string;
    topupId?: Id<"billingTopups">;
    paymentIntentId?: Id<"paymentIntents">;
    reservationId?: Id<"creditReservations">;
  },
) {
  const existing = await ctx.db
    .query("billingNotifications")
    .withIndex("by_organization_id_and_created_at", (q) =>
      q.eq("organizationId", args.organizationId),
    )
    .order("desc")
    .take(100);
  const duplicate = existing.find((notification) => notification.dedupeKey === args.dedupeKey);
  if (duplicate) return duplicate._id;
  return await ctx.db.insert("billingNotifications", {
    ...args,
    createdAt: Date.now(),
  });
}

export const markRead = mutation({
  args: { notificationId: v.id("billingNotifications") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const organization = await findOrganizationForIdentity(ctx, identity.tokenIdentifier);
    const notification = await ctx.db.get(args.notificationId);
    if (!organization || !notification || notification.organizationId !== organization._id) {
      throw new Error("Notification not found");
    }
    if (notification.readAt === undefined) {
      await ctx.db.patch(notification._id, { readAt: Date.now() });
    }
    return notification._id;
  },
});
