import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { ProjectId } from "../projects/types";

import { requireProjectRole, requireProjectRoleByToken } from "../playground_projects/helpers";
import { WEBHOOK_EVENT_TYPES, type WebhookEventType } from "./types";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function normalizeOwnerAddress(address: string) {
  return address.trim().toUpperCase();
}

export function validateEventTypes(eventTypes: string[]): WebhookEventType[] {
  const unique = Array.from(new Set(eventTypes));

  if (unique.length === 0) {
    throw new Error("Select at least one webhook event type");
  }

  for (const eventType of unique) {
    if (!WEBHOOK_EVENT_TYPES.includes(eventType as WebhookEventType)) {
      throw new Error(`Unsupported webhook event type: ${eventType}`);
    }
  }

  return unique as WebhookEventType[];
}

export function validateWebhookUrl(value: string) {
  let url: URL;

  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a valid webhook URL");
  }

  if (LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(
      "Webhook delivery runs from hosted Convex and cannot reach localhost. Use a deployed HTTPS endpoint or an HTTPS tunnel.",
    );
  }

  if (url.protocol !== "https:") {
    throw new Error("Webhook URL must use HTTPS");
  }

  if (url.username || url.password) {
    throw new Error("Webhook URL cannot include embedded credentials");
  }

  return {
    url: url.toString(),
    destinationHost: url.host,
  };
}

export async function requireOwnerProject(ctx: QueryCtx | MutationCtx, projectId: ProjectId) {
  return (await requireProjectRole(ctx, projectId, "editor")).project;
}

export async function requireOwnerProjectByToken(
  ctx: QueryCtx | MutationCtx,
  projectId: ProjectId,
  ownerTokenIdentifier: string,
  ownerSubject: string,
) {
  return (
    await requireProjectRoleByToken(ctx, projectId, ownerTokenIdentifier, ownerSubject, "editor")
  ).project;
}

export async function ownerProjectOrNull(ctx: QueryCtx | MutationCtx, projectId: ProjectId) {
  try {
    return (await requireProjectRole(ctx, projectId, "viewer")).project;
  } catch {
    return null;
  }
}

export async function editorProjectOrNull(ctx: QueryCtx | MutationCtx, projectId: ProjectId) {
  try {
    return (await requireProjectRole(ctx, projectId, "editor")).project;
  } catch {
    return null;
  }
}

export async function hasEnabledWebhookForEvent(
  ctx: QueryCtx | MutationCtx,
  projectId: ProjectId,
  eventType: string,
) {
  const endpoint = await ctx.db
    .query("webhookEndpoints")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .unique();
  return endpoint?.enabled === true && endpoint.eventTypes.includes(eventType);
}
