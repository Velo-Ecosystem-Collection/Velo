import { Migrations } from "@convex-dev/migrations";

import { components, internal } from "./_generated/api";
import schema from "./schema";

export const migrations = new Migrations(components.migrations, { schema });

export const backfillProjectRateLimitBackend = migrations.define({
  table: "projects",
  migrateOne: (_ctx, project) =>
    project.rateLimitBackend === undefined ? { rateLimitBackend: "convex" as const } : undefined,
});

export const backfillProjectOrganizations = migrations.define({
  table: "projects",
  migrateOne: async (ctx, project) => {
    if (project.organizationId !== undefined) return;

    const ownerAddress = project.ownerAddress.trim().toUpperCase();
    let ownerTokenIdentifier = project.ownerTokenIdentifier;
    if (!ownerTokenIdentifier) {
      const ownerProjects = await ctx.db
        .query("projects")
        .withIndex("by_owner", (q) => q.eq("ownerAddress", ownerAddress))
        .take(100);
      const tokenIdentifiers = [
        ...new Set(
          ownerProjects.flatMap((candidate) =>
            candidate.ownerTokenIdentifier ? [candidate.ownerTokenIdentifier] : [],
          ),
        ),
      ];
      if (tokenIdentifiers.length === 1) {
        ownerTokenIdentifier = tokenIdentifiers[0];
      } else {
        ownerTokenIdentifier = `legacy-wallet:${ownerAddress}`;
      }

      if (tokenIdentifiers.length > 1) {
        const existingCollision = await ctx.db
          .query("organizationMigrationCollisions")
          .withIndex("by_owner_address", (q) => q.eq("ownerAddress", ownerAddress))
          .unique();
        if (!existingCollision) {
          await ctx.db.insert("organizationMigrationCollisions", {
            ownerAddress,
            tokenIdentifiers,
            projectIds: ownerProjects.map((candidate) => candidate._id),
            reason: "multiple_authenticated_owners_share_wallet_address",
            detectedAt: Date.now(),
          });
        }
      }
    }
    if (!ownerTokenIdentifier) throw new Error("Organization owner identity could not be derived");
    const resolvedOwnerTokenIdentifier = ownerTokenIdentifier;

    let organization = await ctx.db
      .query("organizations")
      .withIndex("by_owner_token_identifier", (q) =>
        q.eq("ownerTokenIdentifier", resolvedOwnerTokenIdentifier),
      )
      .unique();
    if (!organization) {
      const now = Date.now();
      const organizationId = await ctx.db.insert("organizations", {
        ownerTokenIdentifier: resolvedOwnerTokenIdentifier,
        ownerAddress,
        displayName: `${project.name} organization`,
        verificationStatus: "provisional",
        trialState: "pending_verification",
        createdAt: now,
        updatedAt: now,
      });
      organization = await ctx.db.get(organizationId);
    }
    if (!organization) throw new Error("Organization backfill failed");
    await ctx.db.patch(project._id, { organizationId: organization._id });
  },
});

export const backfillBillingExceptionOperations = migrations.define({
  table: "billingExceptions",
  migrateOne: (_ctx, exception) =>
    exception.severity === undefined ||
    exception.slaDueAt === undefined ||
    exception.investigationStatus === undefined ||
    exception.assignee === undefined
      ? {
          severity: exception.severity ?? ("medium" as const),
          slaDueAt: exception.slaDueAt ?? exception.createdAt + 24 * 60 * 60_000,
          investigationStatus: exception.investigationStatus ?? ("investigating" as const),
          assignee: exception.assignee ?? "billing-operations",
        }
      : undefined,
});

export const runAll = migrations.runner([
  internal.migrations.backfillProjectRateLimitBackend,
  internal.migrations.backfillProjectOrganizations,
  internal.migrations.backfillBillingExceptionOperations,
]);
