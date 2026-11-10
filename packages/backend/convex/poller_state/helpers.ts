import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { ProjectId } from "../projects/types";
import type { PollerState, PublicPollStatus } from "./types";

const STALE_AFTER_MS = 2 * 60 * 1_000;

export function projectScope(projectId: ProjectId) {
  return `project:${projectId}`;
}

export async function setProjectPolling(
  ctx: MutationCtx,
  projectId: ProjectId,
  knownPoller?: Doc<"pollerState"> | null,
) {
  const scope = projectScope(projectId);
  const existing =
    knownPoller === undefined
      ? await ctx.db
          .query("pollerState")
          .withIndex("by_scope", (q) => q.eq("scope", scope))
          .unique()
      : knownPoller;
  const value = {
    scope,
    projectId,
    status: "polling" as const,
    errorMessage: undefined,
    updatedAt: Date.now(),
  };

  if (existing) {
    await ctx.db.patch(existing._id, value);
  } else {
    await ctx.db.insert("pollerState", value);
  }
}

export function publicPollStatus(poller: PollerState | null, eventCount: number): PublicPollStatus {
  if (!poller) {
    return eventCount > 0 ? "stale" : "empty";
  }

  if (poller.status === "polling" || poller.status === "error") {
    return poller.status;
  }

  if (!poller.lastRunAt || Date.now() - poller.lastRunAt > STALE_AFTER_MS) {
    return "stale";
  }

  return eventCount > 0 ? "live" : "empty";
}

export async function storePollSuccess(
  ctx: MutationCtx,
  projectId: ProjectId,
  latestLedger: number | undefined,
  cursor: string | undefined,
  observedAt: number,
  ledgerLag?: number,
  timeLagMs?: number,
) {
  const scope = projectScope(projectId);
  const poller = await ctx.db
    .query("pollerState")
    .withIndex("by_scope", (q) => q.eq("scope", scope))
    .unique();
  const state = {
    scope,
    projectId,
    status: "idle" as const,
    lastLedger: latestLedger,
    cursor,
    lastRunAt: observedAt,
    errorMessage: undefined,
    ledgerLag,
    timeLagMs,
    updatedAt: observedAt,
  };

  if (poller) {
    await ctx.db.patch(poller._id, state);
  } else {
    await ctx.db.insert("pollerState", state);
  }
}
