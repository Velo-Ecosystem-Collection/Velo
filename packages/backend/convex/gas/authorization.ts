import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { ProjectRole } from "../playground_projects/helpers";

import { requireProjectRole } from "../playground_projects/helpers";

/** Capabilities available to authenticated Gas console callers. */
export type GasConsoleCapability = "read" | "updatePolicy" | "updateRelayer";

const minimumRoleByCapability: Record<GasConsoleCapability, ProjectRole> = {
  read: "viewer",
  updatePolicy: "editor",
  updateRelayer: "owner",
};

const GAS_API_KEY_HASH_PATTERN = /^[a-f0-9]{64}$/;

export type GasApiKeyAuthorizationResult =
  | {
      authorized: true;
      apiKeyId: Id<"apiKeys">;
      projectId: Id<"projects">;
    }
  | { authorized: false };

export const gasApiKeyAuthorizationResultValidator = v.union(
  v.object({
    authorized: v.literal(true),
    apiKeyId: v.id("apiKeys"),
    projectId: v.id("projects"),
  }),
  v.object({ authorized: v.literal(false) }),
);

/**
 * Requires the authenticated caller's minimum role for a Gas console capability.
 * Identity and membership are always resolved by the shared project-role helper.
 */
export async function requireGasConsoleAccess(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
  capability: GasConsoleCapability,
) {
  if (!Object.prototype.hasOwnProperty.call(minimumRoleByCapability, capability)) {
    throw new Error("Invalid Gas console capability");
  }

  const minimumRole = minimumRoleByCapability[capability];

  return await requireProjectRole(ctx, projectId, minimumRole);
}

/**
 * Resolves a Gas API key to its stored project scope without exposing credentials
 * or the stored key document. The server boundary is expected to provide the
 * lowercase SHA-256 digest of the raw API key.
 */
export async function verifyApiKeyForGas(
  ctx: QueryCtx | MutationCtx,
  apiKeyHash?: unknown,
): Promise<GasApiKeyAuthorizationResult> {
  if (typeof apiKeyHash !== "string" || !GAS_API_KEY_HASH_PATTERN.test(apiKeyHash)) {
    return { authorized: false };
  }

  let apiKey;
  try {
    apiKey = await ctx.db
      .query("apiKeys")
      .withIndex("by_key_hash", (q) => q.eq("keyHash", apiKeyHash))
      .unique();
  } catch {
    // `.unique()` throws for an ambiguous hash; all key failures are uniform.
    return { authorized: false };
  }

  if (!apiKey || apiKey.revoked) return { authorized: false };

  const project = await ctx.db.get(apiKey.projectId);
  if (!project) return { authorized: false };

  return {
    authorized: true,
    apiKeyId: apiKey._id,
    projectId: apiKey.projectId,
  };
}
