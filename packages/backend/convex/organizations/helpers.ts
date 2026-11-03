import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { UserIdentity } from "convex/server";

import { requireIdentity } from "../auth/identity";

function normalizeOwnerAddress(value: string) {
  return value.trim().toUpperCase();
}

export async function findOrganizationForIdentity(
  ctx: QueryCtx | MutationCtx,
  tokenIdentifier: string,
) {
  return await ctx.db
    .query("organizations")
    .withIndex("by_owner_token_identifier", (q) => q.eq("ownerTokenIdentifier", tokenIdentifier))
    .unique();
}

export async function ensureOrganizationForIdentity(
  ctx: MutationCtx,
  identity: Pick<UserIdentity, "tokenIdentifier">,
  ownerAddress: string,
  displayName?: string,
) {
  const existing = await findOrganizationForIdentity(ctx, identity.tokenIdentifier);
  if (existing) return existing;

  const now = Date.now();
  const organizationId = await ctx.db.insert("organizations", {
    ownerTokenIdentifier: identity.tokenIdentifier,
    ownerAddress: normalizeOwnerAddress(ownerAddress),
    displayName: displayName?.trim() || "My organization",
    verificationStatus: "provisional",
    trialState: "pending_verification",
    createdAt: now,
    updatedAt: now,
  });
  const organization = await ctx.db.get(organizationId);
  if (!organization) throw new Error("Organization not found after creation");
  return organization;
}

export async function requireOrganizationOwner(
  ctx: QueryCtx | MutationCtx,
  organizationId: Id<"organizations">,
) {
  const identity = await requireIdentity(ctx);

  const organization = await ctx.db.get(organizationId);
  if (!organization || organization.ownerTokenIdentifier !== identity.tokenIdentifier) {
    throw new Error("Unauthorized");
  }
  return organization;
}
