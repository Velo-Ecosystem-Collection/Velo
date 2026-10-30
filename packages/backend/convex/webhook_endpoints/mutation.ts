import { v } from "convex/values";

import { mutation } from "../_generated/server";
import { requireOwnerProject, validateEventTypes, validateWebhookUrl } from "./helpers";

export const saveSettings = mutation({
  args: {
    projectId: v.id("projects"),
    url: v.string(),
    enabled: v.boolean(),
    eventTypes: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await requireOwnerProject(ctx, args.projectId);
    const normalizedUrl = validateWebhookUrl(args.url);
    const existing = await ctx.db
      .query("webhookEndpoints")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .unique();
    const eventTypes = validateEventTypes(args.eventTypes, existing?.eventTypes ?? []);
    const now = Date.now();
    const value = {
      projectId: args.projectId,
      ...normalizedUrl,
      enabled: args.enabled,
      eventTypes,
      updatedAt: now,
    };

    if (existing) {
      const patchValue: Record<string, unknown> = { ...value };
      if (!existing.signingSecret) {
        const randomBytes = new Uint8Array(16);
        crypto.getRandomValues(randomBytes);
        const secretToken = Array.from(randomBytes)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        patchValue.signingSecret = `whsec_${secretToken}`;
      }
      await ctx.db.patch(existing._id, patchValue);
      return existing._id;
    }

    const randomBytes = new Uint8Array(16);
    crypto.getRandomValues(randomBytes);
    const secretToken = Array.from(randomBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const signingSecret = `whsec_${secretToken}`;

    return await ctx.db.insert("webhookEndpoints", {
      ...value,
      signingSecret,
      createdAt: now,
    });
  },
});

export const rotateSecret = mutation({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    await requireOwnerProject(ctx, args.projectId);
    const existing = await ctx.db
      .query("webhookEndpoints")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .unique();
    if (!existing) {
      throw new Error("Webhook endpoint not found");
    }

    const randomBytes = new Uint8Array(16);
    crypto.getRandomValues(randomBytes);
    const secretToken = Array.from(randomBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const signingSecret = `whsec_${secretToken}`;

    await ctx.db.patch(existing._id, {
      signingSecret,
      updatedAt: Date.now(),
    });
    return existing._id;
  },
});
