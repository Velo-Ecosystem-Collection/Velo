import { fetchRecentContractEvents } from "@repo/stellar/event-monitor";
import { v } from "convex/values";

import type { ActionCtx } from "./_generated/server";
import type { PollTarget } from "./contract_events/types";

import { internal } from "./_generated/api";
import { action, internalAction } from "./_generated/server";
import { requireIdentity } from "./projects/helpers";

const DEFAULT_TESTNET_RPC_URL = "https://soroban-testnet.stellar.org";

type OwnerPollTarget = Omit<PollTarget, "projectId">;

type PollResult = {
  eventCount: number;
  contractCount: number;
};

function rpcUrl() {
  return (
    process.env.STELLAR_RPC_URL ??
    process.env.NEXT_PUBLIC_STELLAR_RPC_URL ??
    DEFAULT_TESTNET_RPC_URL
  );
}

async function pollTarget(ctx: ActionCtx, target: PollTarget): Promise<PollResult> {
  if (target.contractIds.length === 0) {
    await ctx.runMutation(internal.contract_events.mutation.storePollResult, {
      projectId: target.projectId,
      latestLedger: target.lastLedger,
      cursor: target.cursor,
      events: [],
    });
    return { eventCount: 0, contractCount: 0 };
  }

  await ctx.runMutation(internal.poller_state.mutation.markPolling, {
    projectId: target.projectId,
  });

  try {
    let currentCursor = target.cursor;
    let currentLedger = target.lastLedger;
    let totalEvents = 0;
    const url = rpcUrl();

    // Bounded continuous pagination up to 10 pages in one poll run
    for (let page = 0; page < 10; page++) {
      const result = await fetchRecentContractEvents({
        rpcUrl: url,
        contractIds: target.contractIds,
        cursor: currentCursor,
        afterLedger: currentCursor ? undefined : currentLedger, // Omit startLedger if cursor is present
      });
      if (result.historyGap) {
        console.warn("contract_event_history_gap_recovered", {
          projectId: target.projectId,
          ...result.historyGap,
        });
      }

      if (result.events.length === 0) {
        // Idempotent checkpointing of the latest cursor/ledger
        await ctx.runMutation(internal.contract_events.mutation.storePollResult, {
          projectId: target.projectId,
          latestLedger: result.latestLedger ?? currentLedger,
          cursor: result.cursor ?? currentCursor,
          events: [],
        });
        break;
      }

      await ctx.runMutation(internal.contract_events.mutation.storePollResult, {
        projectId: target.projectId,
        latestLedger: result.latestLedger,
        cursor: result.cursor,
        events: result.events,
      });

      totalEvents += result.events.length;
      currentCursor = result.cursor;
      currentLedger = result.latestLedger;

      // Stop if page returned less than standard limit
      if (result.events.length < 100) {
        break;
      }
    }

    return { eventCount: totalEvents, contractCount: target.contractIds.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stellar event polling failed";
    await ctx.runMutation(internal.poller_state.mutation.markError, {
      projectId: target.projectId,
      message,
    });
    throw new Error(message);
  }
}

export const pollProject = action({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args): Promise<PollResult> => {
    const identity = await requireIdentity(ctx);
    const target: OwnerPollTarget = await ctx.runQuery(
      internal.contract_events.query.getPollTarget,
      {
        projectId: args.projectId,
        ownerTokenIdentifier: identity.tokenIdentifier,
        ownerSubject: identity.subject,
      },
    );
    return await pollTarget(ctx, { ...target, projectId: args.projectId });
  },
});

export const pollScheduled = internalAction({
  args: {},
  handler: async (ctx): Promise<{ projectCount: number; eventCount: number }> => {
    let targets: PollTarget[];
    try {
      targets = await ctx.runQuery(internal.contract_events.query.listScheduledTargets, {});
    } catch (error) {
      console.warn(
        "scheduled_contract_event_poll_failed",
        error instanceof Error ? error.message : error,
      );
      return { projectCount: 0, eventCount: 0 };
    }
    let eventCount = 0;
    const limit = 5; // Bounded worker concurrency

    for (let i = 0; i < targets.length; i += limit) {
      const chunk = targets.slice(i, i + limit);
      const results = await Promise.allSettled(chunk.map((target) => pollTarget(ctx, target)));

      for (const res of results) {
        if (res.status === "fulfilled") {
          eventCount += res.value.eventCount;
        }
      }
    }

    return { projectCount: targets.length, eventCount };
  },
});

export const pollProjectInternal = internalAction({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args): Promise<PollResult> => {
    const target = await ctx.runQuery(internal.contract_events.query.getPollTargetInternal, {
      projectId: args.projectId,
    });
    return await pollTarget(ctx, { ...target, projectId: args.projectId });
  },
});
