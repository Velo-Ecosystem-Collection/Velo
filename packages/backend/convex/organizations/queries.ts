import { internalQuery, query } from "../_generated/server";
import { requireIdentity } from "../auth/identity";
import { findOrganizationForIdentity } from "./helpers";

export const getCurrent = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);

    const organization = await findOrganizationForIdentity(ctx, identity.tokenIdentifier);
    if (!organization) return null;

    const projects = await ctx.db
      .query("projects")
      .withIndex("by_organization_id", (q) => q.eq("organizationId", organization._id))
      .take(100);
    const balance = await ctx.db
      .query("billingBalances")
      .withIndex("by_organization_id_and_book", (q) =>
        q.eq("organizationId", organization._id).eq("book", "shadow"),
      )
      .unique();

    return {
      ...organization,
      projectIds: projects.map((project) => project._id),
      shadowBalance: balance
        ? {
            promotional: {
              available: balance.promoAvailable,
              reserved: balance.promoReserved,
            },
            paid: {
              available: balance.paidAvailable,
              reserved: balance.paidReserved,
            },
          }
        : {
            promotional: { available: 0n, reserved: 0n },
            paid: { available: 0n, reserved: 0n },
          },
    };
  },
});

export const migrationReport = internalQuery({
  args: {},
  handler: async (ctx) => {
    const projects = await ctx.db.query("projects").take(1_000);
    const collisions = await ctx.db.query("organizationMigrationCollisions").take(100);
    const unmigrated = projects
      .filter((project) => project.organizationId === undefined)
      .slice(0, 100)
      .map((project) => project._id);
    return {
      sampledProjects: projects.length,
      truncated: projects.length === 1_000,
      unmigrated,
      collisionCount: collisions.length,
      collisions,
    };
  },
});
