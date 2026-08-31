import { v } from "convex/values";

import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { storePollSuccess } from "../poller_state/helpers";

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
