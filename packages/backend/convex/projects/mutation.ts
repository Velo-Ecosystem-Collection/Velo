import { v } from "convex/values";

import { internal } from "../_generated/api";
import { internalMutation, mutation } from "../_generated/server";
import { queueInitialGasRelayerProvisioning } from "../gas/custody_internal";
import { ensureOrganizationForIdentity } from "../organizations/helpers";
import {
  draftProjectArgs,
  allocateProjectSlug,
  buildProjectMetadata,
  normalizeAddress,
  normalizeProjectName,
  normalizeTransactionHash,
  requireUniqueActiveProjectName,
  requireIdentity,
  requireProjectOwner,
  requireUniqueSlug,
} from "./helpers";

export const createDraft = mutation({
  args: draftProjectArgs,
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const now = Date.now();
    const ownerAddress = normalizeAddress(args.ownerAddress);
    const name = args.name.trim();
    const description = args.description.trim();
    const slug = await allocateProjectSlug(ctx, args.slug);
    await requireUniqueActiveProjectName(ctx, {
      name,
      ownerAddress,
      ownerTokenIdentifier: identity.tokenIdentifier,
    });
    const metadata = await buildProjectMetadata(
      name,
      slug,
      description,
      args.website,
      ownerAddress,
    );
    const organization = await ensureOrganizationForIdentity(
      ctx,
      identity,
      ownerAddress,
      args.name,
    );

    const projectId = await ctx.db.insert("projects", {
      organizationId: organization._id,
      name,
      normalizedName: normalizeProjectName(name),
      slug,
      description,
      website: args.website?.trim() || undefined,
      metadataJson: metadata.metadataJson,
      metadataHash: metadata.metadataHash,
      ownerAddress,
      ownerTokenIdentifier: identity.tokenIdentifier,
      status: "draft",
      defaultPaymentAnchor: args.defaultPaymentAnchor ?? "inhouse",
      rateLimitBackend: "convex",
      lastSyncAt: undefined,
      createdAt: now,
      updatedAt: now,
    });
    await queueInitialGasRelayerProvisioning(ctx, projectId, now);
    return projectId;
  },
});

export const markRegistrationPending = mutation({
  args: {
    id: v.id("projects"),
    registrationTxHash: v.string(),
  },
  handler: async (ctx, args) => {
    const project = await requireProjectOwner(ctx, args.id);

    if (
      project.status !== "draft" &&
      project.status !== "registration_error" &&
      project.status !== "stale"
    ) {
      throw new Error("Only draft, failed, or stale projects can start registration");
    }

    const now = Date.now();
    await ctx.db.patch(args.id, {
      status: "pending_registration",
      registrationTxHash: normalizeTransactionHash(args.registrationTxHash),
      registrationError: undefined,
      lastSyncAt: now,
      updatedAt: now,
    });
  },
});

export const markRegistrationSynced = mutation({
  args: {
    id: v.id("projects"),
    registryProjectId: v.optional(v.number()),
    createdLedger: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const project = await requireProjectOwner(ctx, args.id, { allowRetired: true });

    if (!project.registrationTxHash) {
      throw new Error("Project has no registration transaction to sync");
    }

    const registryProjectId = args.registryProjectId;
    if (registryProjectId !== undefined) {
      const registryMatches = await ctx.db
        .query("projects")
        .withIndex("by_registry_project_id", (q) => q.eq("registryProjectId", registryProjectId))
        .take(2);
      if (registryMatches.some((match) => match._id !== project._id)) {
        throw new Error("Registry project ID is already assigned to another Velo project");
      }
    }

    const now = Date.now();
    await ctx.db.patch(args.id, {
      status: "registered",
      registryProjectId: args.registryProjectId,
      createdLedger: args.createdLedger,
      registrationError: undefined,
      lastSyncAt: now,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.webhookDelivery.trigger, {
      projectId: args.id,
      eventType: "project.registered",
    });

    await ctx.scheduler.runAfter(0, internal.webhookDelivery.trigger, {
      projectId: args.id,
      eventType: "transaction.succeeded",
    });
  },
});

export const markRegistrationStale = mutation({
  args: {
    id: v.id("projects"),
  },
  handler: async (ctx, args) => {
    await requireProjectOwner(ctx, args.id, { allowRetired: true });

    const now = Date.now();
    await ctx.db.patch(args.id, {
      status: "stale",
      lastSyncAt: now,
      updatedAt: now,
    });
  },
});

export const markRegistrationError = mutation({
  args: {
    id: v.id("projects"),
    registrationError: v.string(),
  },
  handler: async (ctx, args) => {
    await requireProjectOwner(ctx, args.id, { allowRetired: true });

    const now = Date.now();
    await ctx.db.patch(args.id, {
      status: "registration_error",
      registrationError: args.registrationError.slice(0, 500),
      lastSyncAt: now,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.webhookDelivery.trigger, {
      projectId: args.id,
      eventType: "transaction.failed",
    });
  },
});

export const updateDraft = mutation({
  args: {
    id: v.id("projects"),
    ...draftProjectArgs,
  },
  handler: async (ctx, args) => {
    const project = await requireProjectOwner(ctx, args.id);

    if (project.status !== "draft") {
      throw new Error("Only draft projects can be updated in Sprint 2");
    }

    const ownerAddress = normalizeAddress(args.ownerAddress);
    const name = args.name.trim();
    const description = args.description.trim();
    const normalizedName = normalizeProjectName(name);

    const slug = args.slug.trim().toLowerCase();
    if (slug !== project.slug) {
      await requireUniqueSlug(ctx, slug);
    }

    if (normalizedName !== normalizeProjectName(project.normalizedName ?? project.name)) {
      await requireUniqueActiveProjectName(ctx, {
        name,
        ownerAddress: project.ownerAddress,
        ownerTokenIdentifier: project.ownerTokenIdentifier!,
        excludeProjectId: project._id,
      });
    }
    const metadata = await buildProjectMetadata(
      name,
      slug,
      description,
      args.website,
      ownerAddress,
    );

    await ctx.db.patch(args.id, {
      name,
      normalizedName,
      slug,
      description,
      website: args.website?.trim() || undefined,
      metadataJson: metadata.metadataJson,
      metadataHash: metadata.metadataHash,
      ownerAddress,
      ownerTokenIdentifier: project.ownerTokenIdentifier,
      defaultPaymentAnchor: args.defaultPaymentAnchor,
      updatedAt: Date.now(),
    });

    await ctx.scheduler.runAfter(0, internal.webhookDelivery.trigger, {
      projectId: args.id,
      eventType: "project.updated",
    });
  },
});

export const updateSettings = mutation({
  args: {
    id: v.id("projects"),
    name: v.string(),
    description: v.string(),
    defaultPaymentAnchor: v.optional(v.union(v.literal("inhouse"), v.literal("pdax"))),
  },
  handler: async (ctx, args) => {
    const project = await requireProjectOwner(ctx, args.id);

    const name = args.name.trim();
    const description = args.description.trim();
    const normalizedName = normalizeProjectName(name);

    if (!name) {
      throw new Error("Project name is required");
    }

    if (!description) {
      throw new Error("Project description is required");
    }

    if (normalizedName !== normalizeProjectName(project.normalizedName ?? project.name)) {
      await requireUniqueActiveProjectName(ctx, {
        name,
        ownerAddress: project.ownerAddress,
        ownerTokenIdentifier: project.ownerTokenIdentifier!,
        excludeProjectId: project._id,
      });
    }

    await ctx.db.patch(args.id, {
      name,
      normalizedName,
      description,
      ...(args.defaultPaymentAnchor !== undefined
        ? { defaultPaymentAnchor: args.defaultPaymentAnchor }
        : {}),
      updatedAt: Date.now(),
    });

    await ctx.scheduler.runAfter(0, internal.webhookDelivery.trigger, {
      projectId: args.id,
      eventType: "project.updated",
    });
  },
});

export const retire = mutation({
  args: {
    id: v.id("projects"),
    confirmationName: v.string(),
  },
  handler: async (ctx, args) => {
    const project = await requireProjectOwner(ctx, args.id, { allowRetired: true });
    if (args.confirmationName !== project.name) {
      throw new Error("Project name confirmation does not match");
    }

    if (project.retiredAt === undefined) {
      const identity = await requireIdentity(ctx);
      const retiredAt = Date.now();
      await ctx.db.patch(args.id, {
        retiredAt,
        retiredByTokenIdentifier: identity.tokenIdentifier,
        updatedAt: retiredAt,
      });
    }

    return null;
  },
});

export const generateLogoUploadUrl = mutation({
  args: {
    id: v.id("projects"),
  },
  handler: async (ctx, args) => {
    await requireProjectOwner(ctx, args.id);

    return await ctx.storage.generateUploadUrl();
  },
});

export const setLogo = mutation({
  args: {
    id: v.id("projects"),
    logoStorageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const project = await requireProjectOwner(ctx, args.id);
    const previousLogoStorageId = project.logoStorageId;

    await ctx.db.patch(args.id, {
      logoStorageId: args.logoStorageId,
      updatedAt: Date.now(),
    });

    if (previousLogoStorageId && previousLogoStorageId !== args.logoStorageId) {
      await ctx.storage.delete(previousLogoStorageId);
    }
  },
});

export const removeLogo = mutation({
  args: {
    id: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const project = await requireProjectOwner(ctx, args.id);

    await ctx.db.patch(args.id, {
      logoStorageId: undefined,
      updatedAt: Date.now(),
    });

    if (project.logoStorageId) {
      await ctx.storage.delete(project.logoStorageId);
    }
  },
});

export const generateApiKey = mutation({
  args: {
    id: v.id("projects"),
    label: v.string(),
    paymentAnchor: v.optional(v.union(v.literal("inhouse"), v.literal("pdax"))),
    purpose: v.optional(v.union(v.literal("general"), v.literal("gas"))),
  },
  handler: async (ctx, args) => {
    await requireProjectOwner(ctx, args.id);

    const purpose = args.purpose ?? "general";
    const keyPrefix = purpose === "gas" ? "tg_test_" : "tk_live_";
    const randomBytes = new Uint8Array(16);
    crypto.getRandomValues(randomBytes);
    const token = Array.from(randomBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const rawKey = `${keyPrefix}${token}`;

    // Hash the rawKey using SHA-256
    const encoder = new TextEncoder();
    const data = encoder.encode(rawKey);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const apiKeyHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    const now = Date.now();
    await ctx.db.insert("apiKeys", {
      projectId: args.id,
      keyHash: apiKeyHash,
      prefix: `${keyPrefix}${token.slice(0, 4)}...${token.slice(-4)}`,
      label: args.label.trim() || "Default Key",
      ...(purpose === "general" && args.paymentAnchor !== undefined
        ? { paymentAnchor: args.paymentAnchor }
        : {}),
      purpose,
      createdAt: now,
      requestCount: 0,
      revoked: false,
    });

    await ctx.db.patch(args.id, {
      updatedAt: now,
    });

    return { rawKey };
  },
});

export const generateApiKeyInternal = internalMutation({
  args: {
    id: v.id("projects"),
    label: v.string(),
    paymentAnchor: v.optional(v.union(v.literal("inhouse"), v.literal("pdax"))),
    purpose: v.optional(v.union(v.literal("general"), v.literal("gas"))),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.id);
    if (!project || project.retiredAt !== undefined) {
      throw new Error("Project is retired or unavailable");
    }

    const purpose = args.purpose ?? "general";
    const keyPrefix = purpose === "gas" ? "tg_test_" : "tk_live_";
    const randomBytes = new Uint8Array(16);
    crypto.getRandomValues(randomBytes);
    const token = Array.from(randomBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const rawKey = `${keyPrefix}${token}`;

    const encoder = new TextEncoder();
    const data = encoder.encode(rawKey);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const apiKeyHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    const now = Date.now();
    await ctx.db.insert("apiKeys", {
      projectId: args.id,
      keyHash: apiKeyHash,
      prefix: `${keyPrefix}${token.slice(0, 4)}...${token.slice(-4)}`,
      label: args.label.trim() || "Default Key",
      ...(purpose === "general" && args.paymentAnchor !== undefined
        ? { paymentAnchor: args.paymentAnchor }
        : {}),
      purpose,
      createdAt: now,
      requestCount: 0,
      revoked: false,
    });

    await ctx.db.patch(args.id, {
      updatedAt: now,
    });

    return { rawKey };
  },
});

export const revokeApiKey = mutation({
  args: {
    keyId: v.id("apiKeys"),
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    await requireProjectOwner(ctx, args.projectId);

    const now = Date.now();
    const key = await ctx.db.get(args.keyId);
    if (!key || key.projectId !== args.projectId) {
      throw new Error("API Key not found for this project");
    }

    await ctx.db.patch(args.keyId, {
      revoked: true,
    });

    await ctx.db.patch(args.projectId, {
      updatedAt: now,
    });
  },
});

export const recordKeyUsage = internalMutation({
  args: {
    keyHash: v.string(),
  },
  handler: async (ctx, args) => {
    const key = await ctx.db
      .query("apiKeys")
      .withIndex("by_key_hash", (q) => q.eq("keyHash", args.keyHash))
      .unique();

    if (key) {
      await ctx.db.patch(key._id, {
        lastUsedAt: Date.now(),
        requestCount: key.requestCount + 1,
      });
    }
  },
});

export const markPaymentAccessActive = mutation({
  args: {
    id: v.id("projects"),
    checkoutCredits: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireProjectOwner(ctx, args.id);

    const now = Date.now();
    await ctx.db.patch(args.id, {
      paymentAccessActive: true,
      checkoutCredits: args.checkoutCredits ?? 100,
      paymentAccessLastSyncAt: now,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.webhookDelivery.trigger, {
      projectId: args.id,
      eventType: "payment_access.activated",
    });
  },
});

export const markPaymentAccessInactive = mutation({
  args: {
    id: v.id("projects"),
  },
  handler: async (ctx, args) => {
    await requireProjectOwner(ctx, args.id);

    const now = Date.now();
    await ctx.db.patch(args.id, {
      paymentAccessActive: false,
      paymentAccessLastSyncAt: now,
      updatedAt: now,
    });
  },
});
