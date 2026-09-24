import { v } from "convex/values";

import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";
import type { ProjectId } from "./types";
import type { UserIdentity } from "convex/server";

import { ensureOrganizationForIdentity } from "../organizations/helpers";

const TRANSACTION_HASH_PATTERN = /^[0-9a-f]{64}$/i;
export const METADATA_HASH_PATTERN = /^[0-9a-f]{64}$/i;

export const draftProjectArgs = {
  name: v.string(),
  slug: v.string(),
  description: v.string(),
  website: v.optional(v.string()),
  metadataJson: v.string(),
  metadataHash: v.string(),
  ownerAddress: v.string(),
  defaultPaymentAnchor: v.optional(v.union(v.literal("inhouse"), v.literal("pdax"))),
};

export function normalizeAddress(address: string) {
  return address.trim().toUpperCase();
}

export function normalizeProjectName(name: string) {
  return name.trim().toLowerCase();
}

export async function requireIdentity(ctx: QueryCtx | MutationCtx | ActionCtx) {
  const identity = await ctx.auth.getUserIdentity();

  if (!identity) {
    throw new Error("Not authenticated");
  }

  return identity;
}

function identityOwnerAddress(identity: UserIdentity) {
  if (typeof identity.subject !== "string") {
    return null;
  }

  try {
    return normalizeAddress(identity.subject);
  } catch {
    return null;
  }
}

export function normalizeTransactionHash(hash: string) {
  const normalized = hash.trim().toLowerCase();

  if (!TRANSACTION_HASH_PATTERN.test(normalized)) {
    throw new Error("Invalid transaction hash");
  }

  return normalized;
}

export function safeWebsite(website?: string) {
  if (!website) {
    return undefined;
  }

  try {
    const url = new URL(website);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function validateProjectSlug(slug: string) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 64) {
    throw new Error("Project slug must use lowercase letters, numbers, and single hyphens");
  }
}

export async function requireUniqueSlug(ctx: MutationCtx, slug: string) {
  validateProjectSlug(slug);
  const existing = await ctx.db
    .query("projects")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .first();

  if (existing) {
    throw new Error("Project slug is already in use");
  }
}

export async function allocateProjectSlug(ctx: MutationCtx, preferredSlug: string) {
  const base = preferredSlug.trim().toLowerCase();
  validateProjectSlug(base);

  const occupied = await ctx.db
    .query("projects")
    .withIndex("by_slug", (q) => q.eq("slug", base))
    .first();
  if (!occupied) return base;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const suffix = Array.from(crypto.getRandomValues(new Uint8Array(3)))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const slug = `${base.slice(0, 57).replace(/-+$/, "")}-${suffix}`;
    validateProjectSlug(slug);
    const collision = await ctx.db
      .query("projects")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!collision) return slug;
  }

  throw new Error("A unique project slug could not be allocated");
}

export async function requireUniqueActiveProjectName(
  ctx: MutationCtx,
  args: {
    name: string;
    ownerAddress: string;
    ownerTokenIdentifier: string;
    excludeProjectId?: ProjectId;
  },
) {
  const normalizedName = normalizeProjectName(args.name);
  if (!normalizedName) throw new Error("Project name is required");

  const [tokenProjects, addressProjects] = await Promise.all([
    ctx.db
      .query("projects")
      .withIndex("by_owner_token_identifier", (q) =>
        q.eq("ownerTokenIdentifier", args.ownerTokenIdentifier),
      )
      .collect(),
    ctx.db
      .query("projects")
      .withIndex("by_owner", (q) => q.eq("ownerAddress", args.ownerAddress))
      .collect(),
  ]);

  // Until the normalized-name migration has reached every project in this
  // owner scope, rely on the legacy-compatible owner scans below. Once the
  // backfill is complete, also consult the targeted indexes for name matches.
  const normalizedNamesBackfilled = [...tokenProjects, ...addressProjects].every(
    (project) => project.normalizedName !== undefined,
  );
  const [tokenNameMatches, addressNameMatches] = normalizedNamesBackfilled
    ? await Promise.all([
        ctx.db
          .query("projects")
          .withIndex("by_owner_token_identifier_and_normalized_name", (q) =>
            q
              .eq("ownerTokenIdentifier", args.ownerTokenIdentifier)
              .eq("normalizedName", normalizedName),
          )
          .collect(),
        ctx.db
          .query("projects")
          .withIndex("by_owner_address_and_normalized_name", (q) =>
            q.eq("ownerAddress", args.ownerAddress).eq("normalizedName", normalizedName),
          )
          .collect(),
      ])
    : [[], []];

  const candidates = new Map(
    [...tokenNameMatches, ...addressNameMatches, ...tokenProjects, ...addressProjects].map(
      (project) => [project._id, project],
    ),
  );
  const conflict = [...candidates.values()].some((project) => {
    if (
      project._id === args.excludeProjectId ||
      project.retiredAt !== undefined ||
      (project.ownerTokenIdentifier !== args.ownerTokenIdentifier &&
        (project.ownerTokenIdentifier !== undefined || project.ownerAddress !== args.ownerAddress))
    ) {
      return false;
    }
    return normalizeProjectName(project.normalizedName ?? project.name) === normalizedName;
  });

  if (conflict) {
    throw new Error("An active project with this name already exists for this owner");
  }
}

export function stableProjectMetadataJson(value: Record<string, unknown>) {
  function sortValue(nested: unknown): unknown {
    if (Array.isArray(nested)) return nested.map(sortValue);
    if (nested && typeof nested === "object") {
      return Object.fromEntries(
        Object.entries(nested as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, sortValue(child)]),
      );
    }
    return nested;
  }

  return JSON.stringify(sortValue(value), null, 2);
}

export async function buildProjectMetadata(
  name: string,
  slug: string,
  description: string,
  website: string | undefined,
  ownerAddress: string,
) {
  const metadataJson = stableProjectMetadataJson({
    name: name.trim(),
    slug: slug.trim().toLowerCase(),
    description: description.trim(),
    website: website?.trim() || null,
    ownerAddress: normalizeAddress(ownerAddress),
    network: "testnet",
    schema: "velo.project.v1",
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(metadataJson));
  const metadataHash = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return { metadataJson, metadataHash };
}

export async function requireProjectOwnerByToken(
  ctx: QueryCtx | MutationCtx,
  id: ProjectId,
  ownerTokenIdentifier: string,
  ownerSubject: string,
) {
  const project = await ctx.db.get(id);

  if (!project) {
    throw new Error("Project not found");
  }

  if (project.ownerTokenIdentifier === ownerTokenIdentifier) {
    if (project.retiredAt !== undefined) throw new Error("Project is retired");
    return project;
  }

  if (project.ownerTokenIdentifier) {
    throw new Error("Unauthorized");
  }

  if (project.ownerAddress !== normalizeAddress(ownerSubject)) {
    throw new Error("Unauthorized");
  }

  if (project.retiredAt !== undefined) throw new Error("Project is retired");

  if ("patch" in ctx.db) {
    const mutationCtx = ctx as MutationCtx;
    const organization = await ensureOrganizationForIdentity(
      mutationCtx,
      { tokenIdentifier: ownerTokenIdentifier },
      ownerSubject,
      project.name,
    );
    await mutationCtx.db.patch(id, {
      ownerTokenIdentifier,
      organizationId: organization._id,
    });
  }

  return { ...project, ownerTokenIdentifier };
}

export async function requireProjectOwner(
  ctx: QueryCtx | MutationCtx,
  id: ProjectId,
  options: { allowRetired?: boolean } = {},
) {
  const identity = await requireIdentity(ctx);
  const project = await ctx.db.get(id);

  if (!project) {
    throw new Error("Project not found");
  }

  if (project.ownerTokenIdentifier === identity.tokenIdentifier) {
    if (project.retiredAt !== undefined && !options.allowRetired) {
      throw new Error("Project is retired");
    }
    return project;
  }

  if (project.ownerTokenIdentifier) {
    throw new Error("Unauthorized");
  }

  if (project.ownerAddress !== identityOwnerAddress(identity)) {
    throw new Error("Unauthorized");
  }

  if (project.retiredAt !== undefined && !options.allowRetired) {
    throw new Error("Project is retired");
  }

  if ("patch" in ctx.db) {
    const mutationCtx = ctx as MutationCtx;
    const organization = await ensureOrganizationForIdentity(
      mutationCtx,
      identity,
      project.ownerAddress,
      project.name,
    );
    await mutationCtx.db.patch(id, {
      ownerTokenIdentifier: identity.tokenIdentifier,
      organizationId: organization._id,
    });
  }

  return { ...project, ownerTokenIdentifier: identity.tokenIdentifier };
}

export async function projectOwnerOrNull(ctx: QueryCtx | MutationCtx, id: ProjectId) {
  const identity = await requireIdentity(ctx);
  const project = await ctx.db.get(id);

  if (!project) {
    return null;
  }

  if (project.retiredAt !== undefined) return null;

  if (project.ownerTokenIdentifier === identity.tokenIdentifier) {
    return project;
  }

  if (project.ownerTokenIdentifier) {
    return null;
  }

  if (project.ownerAddress !== identityOwnerAddress(identity)) {
    return null;
  }

  if ("patch" in ctx.db) {
    const mutationCtx = ctx as MutationCtx;
    const organization = await ensureOrganizationForIdentity(
      mutationCtx,
      identity,
      project.ownerAddress,
      project.name,
    );
    await mutationCtx.db.patch(id, {
      ownerTokenIdentifier: identity.tokenIdentifier,
      organizationId: organization._id,
    });
  }

  return { ...project, ownerTokenIdentifier: identity.tokenIdentifier };
}

export async function requireOwnerProject(ctx: QueryCtx | MutationCtx, id: ProjectId) {
  const project = await requireProjectOwner(ctx, id);

  return project;
}

export async function ownerProjectOrNull(ctx: QueryCtx | MutationCtx, id: ProjectId) {
  return await projectOwnerOrNull(ctx, id);
}
