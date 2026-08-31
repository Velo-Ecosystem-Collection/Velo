import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

import { internalQuery, query } from "../_generated/server";
import { requireProjectRole } from "../playground_projects/helpers";
import { activeContractsForProject } from "../project_contracts/helpers";
import {
  METADATA_HASH_PATTERN,
  normalizeAddress,
  requireIdentity,
  requireOwnerProject,
  safeWebsite,
} from "./helpers";

async function ownerProjects(ctx: QueryCtx, limit = 50) {
  const identity = await requireIdentity(ctx);
  const walletAddress = normalizeAddress(identity.subject);
  const tokenProjects = await ctx.db
    .query("projects")
    .withIndex("by_owner_token_identifier", (q) =>
      q.eq("ownerTokenIdentifier", identity.tokenIdentifier),
    )
    .order("desc")
    .take(limit);

  const legacyProjects = await ctx.db
    .query("projects")
    .withIndex("by_owner", (q) => q.eq("ownerAddress", walletAddress))
    .order("desc")
    .take(limit);

  const tokenProjectIds = new Set(tokenProjects.map((project) => project._id));
  const memberships = await ctx.db
    .query("projectMemberships")
    .withIndex("by_wallet_address", (q) => q.eq("walletAddress", walletAddress))
    .order("desc")
    .take(limit);
  const memberProjects = (
    await Promise.all(memberships.map((membership) => ctx.db.get(membership.projectId)))
  ).filter((project): project is Doc<"projects"> => project !== null);
  const knownProjectIds = new Set([
    ...tokenProjects.map((project) => project._id),
    ...legacyProjects.map((project) => project._id),
  ]);
  return [
    ...tokenProjects,
    ...legacyProjects.filter(
      (project) => !project.ownerTokenIdentifier && !tokenProjectIds.has(project._id),
    ),
    ...memberProjects.filter((project) => !knownProjectIds.has(project._id)),
  ].slice(0, limit);
}

async function projectWithLogoUrl(ctx: QueryCtx, project: Doc<"projects">) {
  const logoUrl = project.logoStorageId
    ? ((await ctx.storage.getUrl(project.logoStorageId)) ?? undefined)
    : undefined;

  return {
    ...project,
    logoUrl,
  };
}

export const listByOwner = query({
  args: {},
  handler: async (ctx) => {
    const projects = await ownerProjects(ctx);

    return await Promise.all(projects.map((project) => projectWithLogoUrl(ctx, project)));
  },
});

export const getDashboardSummary = query({
  args: {},
  handler: async (ctx) => {
    const projects = await ownerProjects(ctx);
    const summary = {
      projects: {
        total: projects.length,
        registered: 0,
        pending: 0,
        errors: 0,
        draft: 0,
      },
      contracts: {
        total: 0,
        active: 0,
      },
      events: {
        recent: 0,
        lastObservedAt: undefined as number | undefined,
      },
      webhooks: {
        configured: 0,
        enabled: 0,
        recentDeliveries: 0,
        successfulDeliveries: 0,
        failedDeliveries: 0,
        lastDeliveryAt: undefined as number | undefined,
      },
      payments: {
        recent: 0,
        paid: 0,
        pending: 0,
        failed: 0,
        created: 0,
      },
      recentProjects: projects.slice(0, 5).map((project) => ({
        _id: project._id,
        name: project.name,
        slug: project.slug,
        status: project.status,
        updatedAt: project.updatedAt,
        paymentAccessActive: project.paymentAccessActive ?? false,
      })),
    };

    for (const project of projects) {
      if (project.status === "registered") summary.projects.registered++;
      if (project.status === "pending_registration" || project.status === "stale") {
        summary.projects.pending++;
      }
      if (project.status === "registration_error") summary.projects.errors++;
      if (project.status === "draft") summary.projects.draft++;

      const contracts = await ctx.db
        .query("projectContracts")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .take(100);
      summary.contracts.total += contracts.length;
      summary.contracts.active += contracts.filter(
        (contract) => contract.status === "active",
      ).length;

      const events = await ctx.db
        .query("contractEvents")
        .withIndex("by_project_ledger", (q) => q.eq("projectId", project._id))
        .order("desc")
        .take(20);
      summary.events.recent += events.length;
      const latestEvent = events[0];
      if (
        latestEvent &&
        (summary.events.lastObservedAt === undefined ||
          latestEvent.observedAt > summary.events.lastObservedAt)
      ) {
        summary.events.lastObservedAt = latestEvent.observedAt;
      }

      const endpoint = await ctx.db
        .query("webhookEndpoints")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .unique();
      if (endpoint) summary.webhooks.configured++;
      if (endpoint?.enabled) summary.webhooks.enabled++;

      const deliveries = await ctx.db
        .query("webhookDeliveries")
        .withIndex("by_project_created_at", (q) => q.eq("projectId", project._id))
        .order("desc")
        .take(20);
      summary.webhooks.recentDeliveries += deliveries.length;
      summary.webhooks.successfulDeliveries += deliveries.filter(
        (delivery) => delivery.status === "success",
      ).length;
      summary.webhooks.failedDeliveries += deliveries.filter(
        (delivery) => delivery.status === "failed",
      ).length;
      const latestDelivery = deliveries[0];
      if (
        latestDelivery &&
        (summary.webhooks.lastDeliveryAt === undefined ||
          latestDelivery.lastAttemptAt > summary.webhooks.lastDeliveryAt)
      ) {
        summary.webhooks.lastDeliveryAt = latestDelivery.lastAttemptAt;
      }

      const payments = await ctx.db
        .query("paymentIntents")
        .withIndex("by_project_created_at", (q) => q.eq("projectId", project._id))
        .order("desc")
        .take(50);
      summary.payments.recent += payments.length;
      summary.payments.paid += payments.filter((payment) => payment.status === "paid").length;
      summary.payments.pending += payments.filter((payment) => payment.status === "pending").length;
      summary.payments.failed += payments.filter((payment) => payment.status === "failed").length;
      summary.payments.created += payments.filter((payment) => payment.status === "created").length;
    }

    return summary;
  },
});

export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("projects")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
  },
});

export const getById = query({
  args: {
    id: v.id("projects"),
  },
  handler: async (ctx, args) => {
    try {
      const { project } = await requireProjectRole(ctx, args.id, "viewer");
      return await projectWithLogoUrl(ctx, project);
    } catch {
      return null;
    }
  },
});

export const getPublicVerification = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug.trim().toLowerCase()))
      .unique();

    if (!project) {
      return null;
    }

    const activeContracts = await activeContractsForProject(ctx, project._id);
    const hasMismatch =
      project.status !== "registered" ||
      project.registryProjectId === undefined ||
      !METADATA_HASH_PATTERN.test(project.metadataHash.trim()) ||
      activeContracts.some((contract) => contract.registryProjectId !== project.registryProjectId);

    return {
      name: project.name,
      slug: project.slug,
      description: project.description,
      website: safeWebsite(project.website),
      ownerAddress: project.ownerAddress,
      status: project.status,
      active: project.status === "registered" && !hasMismatch,
      registryProjectId: project.registryProjectId,
      metadataHash: project.metadataHash,
      officialContractIds: hasMismatch
        ? []
        : activeContracts.map((contract) => contract.contractId),
      createdLedger: project.createdLedger,
      lastSyncAt: project.lastSyncAt,
      mismatch: hasMismatch,
    };
  },
});

export const verifyApiKeyAndGetEvents = query({
  args: {
    apiKeyHash: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const apiKey = await ctx.db
      .query("apiKeys")
      .withIndex("by_key_hash", (q) => q.eq("keyHash", args.apiKeyHash))
      .unique();

    if (!apiKey || apiKey.revoked) {
      return { authorized: false };
    }

    const project = await ctx.db.get(apiKey.projectId);
    if (!project) {
      return { authorized: false };
    }

    const limit = Math.min(100, Math.max(1, args.limit ?? 20));
    const events = await ctx.db
      .query("contractEvents")
      .withIndex("by_project_ledger", (q) => q.eq("projectId", project._id))
      .order("desc")
      .take(limit);

    return {
      authorized: true,
      project: {
        id: project._id,
        name: project.name,
        slug: project.slug,
      },
      events,
    };
  },
});

export const verifyApiKeyAndGetTransaction = query({
  args: {
    apiKeyHash: v.string(),
    hash: v.string(),
  },
  handler: async (ctx, args) => {
    const apiKey = await ctx.db
      .query("apiKeys")
      .withIndex("by_key_hash", (q) => q.eq("keyHash", args.apiKeyHash))
      .unique();

    if (!apiKey || apiKey.revoked) {
      return { authorized: false };
    }

    const project = await ctx.db.get(apiKey.projectId);
    if (!project) {
      return { authorized: false };
    }

    const transaction = await ctx.db
      .query("transactions")
      .withIndex("by_hash", (q) => q.eq("hash", args.hash.trim().toLowerCase()))
      .unique();

    return {
      authorized: true,
      projectId: project._id,
      transaction,
    };
  },
});

export const verifyApiKeyAndGetWebhookDeliveries = query({
  args: {
    apiKeyHash: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const apiKey = await ctx.db
      .query("apiKeys")
      .withIndex("by_key_hash", (q) => q.eq("keyHash", args.apiKeyHash))
      .unique();

    if (!apiKey || apiKey.revoked) {
      return { authorized: false };
    }

    const project = await ctx.db.get(apiKey.projectId);
    if (!project) {
      return { authorized: false };
    }

    const limit = Math.min(100, Math.max(1, args.limit ?? 20));
    const deliveries = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_project_created_at", (q) => q.eq("projectId", project._id))
      .order("desc")
      .take(limit);

    return {
      authorized: true,
      projectId: project._id,
      deliveries,
    };
  },
});

export const listApiKeys = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    await requireOwnerProject(ctx, args.projectId);

    return await ctx.db
      .query("apiKeys")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .collect();
  },
});

/**
 * Verifies an API key and returns the project data needed for payment intent creation.
 * Used by the POST /api/v1/payment-intents API route.
 */
export const verifyApiKeyAndGetProject = query({
  args: {
    apiKeyHash: v.string(),
  },
  handler: async (ctx, args) => {
    const apiKey = await ctx.db
      .query("apiKeys")
      .withIndex("by_key_hash", (q) => q.eq("keyHash", args.apiKeyHash))
      .unique();

    if (!apiKey || apiKey.revoked) {
      return { authorized: false };
    }

    const project = await ctx.db.get(apiKey.projectId);
    if (!project) {
      return { authorized: false };
    }

    if (!project.paymentAccessActive) {
      return { authorized: false, reason: "payment_access_inactive" };
    }

    return {
      authorized: true,
      project: {
        _id: project._id,
        name: project.name,
        slug: project.slug,
        ownerAddress: project.ownerAddress,
        paymentAccessActive: project.paymentAccessActive,
      },
    };
  },
});

export const listAll = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("projects").collect();
  },
});
