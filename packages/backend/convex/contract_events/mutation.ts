import { v } from "convex/values";

import type { ProjectId } from "../projects/types";

import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { projectScope, setProjectPolling, storePollSuccess } from "../poller_state/helpers";
import { MAX_SCHEDULED_CONTRACTS, MAX_SCHEDULED_PROJECTS } from "./helpers";

export const selectScheduledTargets = internalMutation({
  args: {},
  handler: async (ctx) => {
    const selectedContracts = [];
    const projectEligibility = new Map<ProjectId, boolean>();
    let cursor: string | null = null;
    let isDone = false;

    while (!isDone && selectedContracts.length < MAX_SCHEDULED_CONTRACTS) {
      const page = await ctx.db
        .query("projectContracts")
        .withIndex("by_status", (q) => q.eq("status", "active"))
        .paginate({ numItems: MAX_SCHEDULED_CONTRACTS, cursor });
      const missingProjectIds = [
        ...new Set(
          page.page
            .map((contract) => contract.projectId)
            .filter((projectId) => !projectEligibility.has(projectId)),
        ),
      ];
      const projects = await Promise.all(
        missingProjectIds.map((projectId) => ctx.db.get(projectId)),
      );
      for (const [index, projectId] of missingProjectIds.entries()) {
        const project = projects[index];
        projectEligibility.set(
          projectId,
          project != null && project.retiredAt === undefined && project.status === "registered",
        );
      }

      for (const contract of page.page) {
        if (projectEligibility.get(contract.projectId)) {
          selectedContracts.push(contract);
          if (selectedContracts.length === MAX_SCHEDULED_CONTRACTS) break;
        }
      }
      cursor = page.continueCursor;
      isDone = page.isDone;
    }

    const contractIdsByProject = new Map<ProjectId, string[]>();
    for (const contract of selectedContracts) {
      const contractIds = contractIdsByProject.get(contract.projectId) ?? [];
      if (contractIds.length < 20) {
        contractIds.push(contract.contractId);
        contractIdsByProject.set(contract.projectId, contractIds);
      }
    }

    const targets = await Promise.all(
      Array.from(contractIdsByProject)
        .slice(0, MAX_SCHEDULED_PROJECTS)
        .map(async ([projectId, contractIds]) => {
          const poller = await ctx.db
            .query("pollerState")
            .withIndex("by_scope", (q) => q.eq("scope", projectScope(projectId)))
            .unique();
          await setProjectPolling(ctx, projectId, poller);
          return {
            projectId,
            contractIds,
            lastLedger: poller?.lastLedger,
            cursor: poller?.cursor,
          };
        }),
    );

    return targets;
  },
});

export const storePollResult = internalMutation({
  args: {
    projectId: v.id("projects"),
    latestLedger: v.optional(v.number()),
    cursor: v.optional(v.string()),
    events: v.array(
      v.object({
        eventId: v.string(),
        contractId: v.string(),
        transactionHash: v.string(),
        ledger: v.number(),
        timestamp: v.optional(v.number()),
        topic: v.string(),
        topics: v.array(v.any()),
        type: v.string(),
        raw: v.any(),
        decoded: v.optional(v.any()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project || project.retiredAt !== undefined) return null;
    const observedAt = Date.now();

    for (const event of args.events) {
      const execution = await ctx.db
        .query("playgroundExecutions")
        .withIndex("by_project_and_transaction_hash", (q) =>
          q.eq("projectId", args.projectId).eq("transactionHash", event.transactionHash),
        )
        .first();
      const eventKey = `${args.projectId}:${event.eventId}`;
      const existing = await ctx.db
        .query("contractEvents")
        .withIndex("by_event_key", (q) => q.eq("eventKey", eventKey))
        .unique();
      const value = {
        ...event,
        eventKey,
        projectId: args.projectId,
        network: "testnet" as const,
        ...(execution ? { journeyCorrelationId: execution.journeyCorrelationId } : {}),
        observedAt,
      };

      if (existing) {
        await ctx.db.patch(existing._id, value);
      } else {
        const contractEventId = await ctx.db.insert("contractEvents", value);
        await ctx.scheduler.runAfter(0, internal.webhookDelivery.trigger, {
          projectId: args.projectId,
          eventType: "contract.event",
          contractEventId,
          ...(execution ? { correlationId: execution.journeyCorrelationId } : {}),
        });
      }
    }

    let ledgerLag: number | undefined;
    let timeLagMs: number | undefined;

    if (args.latestLedger !== undefined) {
      const lastEvent = args.events[args.events.length - 1];
      const lastPolledLedger = lastEvent ? lastEvent.ledger : args.latestLedger;
      ledgerLag = Math.max(0, args.latestLedger - lastPolledLedger);
    }

    const latestEventWithTimestamp = args.events
      .slice()
      .reverse()
      .find((e) => e.timestamp !== undefined);
    if (latestEventWithTimestamp?.timestamp !== undefined) {
      timeLagMs = Math.max(0, observedAt - latestEventWithTimestamp.timestamp);
    }

    await storePollSuccess(
      ctx,
      args.projectId,
      args.latestLedger,
      args.cursor,
      observedAt,
      ledgerLag,
      timeLagMs,
    );
  },
});
