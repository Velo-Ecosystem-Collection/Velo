import { fetchRecentContractEvents } from "@repo/stellar/event-monitor";
import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import type { PollTarget } from "./contract_events/types";

import { internal } from "./_generated/api";
import { action, internalAction } from "./_generated/server";
import { MAX_SCHEDULED_CONTRACTS, MAX_SCHEDULED_PROJECTS } from "./contract_events/helpers";
import { requireIdentity } from "./projects/helpers";

const DEFAULT_TESTNET_RPC_URL = "https://soroban-testnet.stellar.org";
const POLL_ERROR_RETRY_DELAY_MS = 5 * 60 * 1_000;
const MAX_SCHEDULED_CONTRACTS_PER_PROJECT = 20;

type OwnerPollTarget = Omit<PollTarget, "projectId">;

type PollResult = {
  eventCount: number;
  contractCount: number;
};

export function classifyPollError(error: unknown) {
  const details = error && typeof error === "object" ? (error as Record<string, unknown>) : null;
  const name = typeof details?.name === "string" ? details.name : "";
  const message = typeof details?.message === "string" ? details.message : String(error);
  const code = typeof details?.code === "number" ? details.code : undefined;
  if (name === "AbortError" || /timeout|timed out|ETIMEDOUT/i.test(message)) {
    return "timeout";
  }
  if (/\b429\b|rate.?limit/i.test(message)) return "rate_limited";
  if (code === -32603 || /\b5\d\d\b|server error/i.test(message)) return "rpc_server_error";
  if (
    code === -32600 ||
    code === -32601 ||
    code === -32602 ||
    /\b4\d\d\b|invalid request/i.test(message)
  )
    return "rpc_request_error";
  if (/fetch failed|network|ECONN|ENOTFOUND|EAI_AGAIN/i.test(message)) {
    return "transport_error";
  }
  return code !== undefined && code <= -32000 && code >= -32768 ? "rpc_error" : "unknown";
}

function rpcUrl() {
  return (
    process.env.STELLAR_RPC_URL ??
    process.env.NEXT_PUBLIC_STELLAR_RPC_URL ??
    DEFAULT_TESTNET_RPC_URL
  );
}

async function pollTarget(
  ctx: ActionCtx,
  target: PollTarget,
  options: { scheduled?: boolean } = {},
): Promise<PollResult> {
  if (target.contractIds.length === 0) {
    await ctx.runMutation(internal.contract_events.mutation.storePollResult, {
      projectId: target.projectId,
      latestLedger: target.lastLedger,
      cursor: target.cursor,
      events: [],
    });
    return { eventCount: 0, contractCount: 0 };
  }

  if (!options.scheduled) {
    await ctx.runMutation(internal.poller_state.mutation.markPolling, {
      projectId: target.projectId,
    });
  }

  let phase: "fetch_events" | "store_events" = "fetch_events";
  try {
    let currentCursor = target.cursor;
    let currentLedger = target.lastLedger;
    let totalEvents = 0;
    const url = rpcUrl();

    // Bounded continuous pagination up to 10 pages in one poll run
    for (let page = 0; page < 10; page++) {
      phase = "fetch_events";
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

      phase = "store_events";
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
    const errorCategory = classifyPollError(error);
    console.warn("contract_event_poll_failed", {
      projectId: target.projectId,
      errorCategory,
      phase,
      contractCount: target.contractIds.length,
    });
    if (!options.scheduled) {
      await ctx.runMutation(internal.poller_state.mutation.markError, {
        projectId: target.projectId,
        message: errorCategory,
      });
    }
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

async function selectScheduledTargets(ctx: ActionCtx): Promise<PollTarget[]> {
  const contractIdsByProject = new Map<Id<"projects">, string[]>();
  let remaining = MAX_SCHEDULED_CONTRACTS;
  let cursor: string | null = null;
  do {
    const page: {
      contracts: { projectId: Id<"projects">; contractId: string }[];
      cursor: string;
      isDone: boolean;
    } = await ctx.runQuery(internal.contract_events.query.listScheduledContractPage, { cursor });
    const contracts = page.contracts.slice(0, remaining);
    for (const { projectId, contractId } of contracts) {
      const contractIds = contractIdsByProject.get(projectId) ?? [];
      if (contractIds.length < MAX_SCHEDULED_CONTRACTS_PER_PROJECT) {
        contractIds.push(contractId);
        contractIdsByProject.set(projectId, contractIds);
      }
    }
    remaining -= contracts.length;
    cursor = page.isDone ? null : page.cursor;
  } while (cursor !== null && remaining > 0);

  const candidates = [...contractIdsByProject].slice(0, MAX_SCHEDULED_PROJECTS);
  if (candidates.length === 0) return [];

  const checkpoints = await ctx.runQuery(internal.poller_state.query.getScheduledCheckpoints, {
    projectIds: candidates.map(([projectId]) => projectId),
  });
  const now = Date.now();
  return candidates.flatMap(([projectId, contractIds], index) => {
    const poller = checkpoints[index];
    if (
      poller?.status === "error" &&
      poller.lastRunAt !== undefined &&
      now - poller.lastRunAt < POLL_ERROR_RETRY_DELAY_MS
    ) {
      return [];
    }
    return [{ projectId, contractIds, lastLedger: poller?.lastLedger, cursor: poller?.cursor }];
  });
}

export const pollScheduled = internalAction({
  args: {},
  handler: async (ctx): Promise<{ projectCount: number; eventCount: number }> => {
    let targets: PollTarget[];
    try {
      targets = await selectScheduledTargets(ctx);
    } catch (error) {
      console.warn("scheduled_contract_event_poll_failed", {
        errorCategory: classifyPollError(error),
      });
      return { projectCount: 0, eventCount: 0 };
    }
    let eventCount = 0;
    const failures: { projectId: PollTarget["projectId"]; failedAt: number }[] = [];
    const limit = 5; // Bounded worker concurrency

    for (let i = 0; i < targets.length; i += limit) {
      const chunk = targets.slice(i, i + limit);
      const results = await Promise.all(
        chunk.map(async (target) => {
          try {
            return await pollTarget(ctx, target, { scheduled: true });
          } catch {
            failures.push({ projectId: target.projectId, failedAt: Date.now() });
            return null;
          }
        }),
      );

      for (const res of results) {
        if (res) eventCount += res.eventCount;
      }
    }

    if (failures.length > 0) {
      await ctx.runMutation(internal.poller_state.mutation.markScheduledErrors, { failures });
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
