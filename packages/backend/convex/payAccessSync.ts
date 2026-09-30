import { resolveBackendPayAccessContractId } from "@repo/stellar/contract-config";
import { fetchRecentContractEvents } from "@repo/stellar/event-monitor";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";

const DEFAULT_TESTNET_RPC_URL = "https://soroban-testnet.stellar.org";
type PayAccessEventResult = Awaited<ReturnType<typeof fetchRecentContractEvents>>;

function rpcUrl() {
  return (
    process.env.STELLAR_RPC_URL ??
    process.env.NEXT_PUBLIC_STELLAR_RPC_URL ??
    DEFAULT_TESTNET_RPC_URL
  );
}

export function payAccessContractIdFromEnv(env: Record<string, string | undefined>) {
  return resolveBackendPayAccessContractId({
    payAccessContractId: env.VELO_PAY_ACCESS_CONTRACT_ID,
    publicPayAccessContractId: env.NEXT_PUBLIC_VELO_PAY_ACCESS_CONTRACT_ID,
  });
}

export const syncPayAccessEvents = internalAction({
  args: {},
  handler: async (ctx) => {
    // 1. Get the current poller state for 'global:pay_access'
    const pollerState = await ctx.runQuery(internal.payAccessSync.getPollerState);
    const lastLedger = pollerState?.lastLedger;
    const contractId = payAccessContractIdFromEnv(process.env);

    // 2. Fetch events from the VeloPayAccess contract. A provider outage should
    // leave the cursor untouched so the next cron run retries, without making
    // the scheduled action itself fail noisily.
    let result: PayAccessEventResult;
    try {
      result = await fetchRecentContractEvents({
        rpcUrl: rpcUrl(),
        contractIds: [contractId],
        afterLedger: lastLedger,
      });
    } catch (error) {
      console.warn("pay_access_event_poll_failed", error instanceof Error ? error.message : error);
      return { eventCount: 0, processedCount: 0, retryable: true };
    }

    if (result.events.length === 0) {
      if (result.latestLedger !== undefined) {
        await ctx.runMutation(internal.payAccessSync.updatePollerState, {
          latestLedger: result.latestLedger,
        });
      }
      return { eventCount: 0, processedCount: 0 };
    }

    // 3. Process each event and trigger mutations
    let processedCount = 0;
    for (const event of result.events) {
      // The topics are ["pay", "activate" | "deactivate" | "consume"]
      if (event.topics && event.topics.length >= 2 && event.topics[0] === "pay") {
        const actionType = event.topics[1]; // "activate", "deactivate", "consume"
        const decoded = event.decoded as {
          project_id?: string;
          credits?: string;
          remaining?: string;
        } | null;

        if (decoded && decoded.project_id) {
          const registryProjectId = Number(decoded.project_id);
          let updateArgs:
            | {
                registryProjectId: number;
                paymentAccessActive?: boolean;
                checkoutCredits?: number;
              }
            | undefined;

          if (actionType === "activate") {
            const credits = decoded.credits ? Number(decoded.credits) : 100;
            updateArgs = {
              registryProjectId,
              paymentAccessActive: true,
              checkoutCredits: credits,
            };
          } else if (actionType === "deactivate") {
            updateArgs = {
              registryProjectId,
              paymentAccessActive: false,
            };
          } else if (actionType === "consume") {
            const remaining = decoded.remaining ? Number(decoded.remaining) : 0;
            updateArgs = {
              registryProjectId,
              checkoutCredits: remaining,
            };
          }

          if (updateArgs) {
            const updateResult: "updated" | "not_found" | "ambiguous" = await ctx.runMutation(
              internal.payAccessSync.updateProjectAccess,
              updateArgs,
            );
            if (updateResult === "ambiguous") {
              // Do not advance the cursor past an event whose project mapping
              // is ambiguous. Once the duplicate data is repaired, the event
              // will be retried and applied to its single matching project.
              console.warn("pay_access_event_project_mapping_ambiguous");
              return {
                eventCount: result.events.length,
                processedCount,
                retryable: true,
                blockedReason: "ambiguous_project_mapping" as const,
              };
            }
            processedCount++;
          }
        }
      }
    }

    // 4. Update the poller state with the new latestLedger
    if (result.latestLedger !== undefined) {
      await ctx.runMutation(internal.payAccessSync.updatePollerState, {
        latestLedger: result.latestLedger,
      });
    }

    return { eventCount: result.events.length, processedCount };
  },
});

export const getPollerState = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("pollerState")
      .withIndex("by_scope", (q) => q.eq("scope", "global:pay_access"))
      .unique();
  },
});

export const updatePollerState = internalMutation({
  args: {
    latestLedger: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("pollerState")
      .withIndex("by_scope", (q) => q.eq("scope", "global:pay_access"))
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        lastLedger: args.latestLedger,
        lastRunAt: now,
        status: "idle",
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("pollerState", {
        scope: "global:pay_access",
        lastLedger: args.latestLedger,
        lastRunAt: now,
        status: "idle",
        updatedAt: now,
      });
    }
  },
});

export const updateProjectAccess = internalMutation({
  args: {
    registryProjectId: v.number(),
    paymentAccessActive: v.optional(v.boolean()),
    checkoutCredits: v.optional(v.number()),
  },
  returns: v.union(v.literal("updated"), v.literal("not_found"), v.literal("ambiguous")),
  handler: async (ctx, args) => {
    const matches = await ctx.db
      .query("projects")
      .withIndex("by_registry_project_id", (q) => q.eq("registryProjectId", args.registryProjectId))
      .take(2);

    if (matches.length > 1) {
      return "ambiguous" as const;
    }

    const project = matches[0] ?? null;
    if (!project) {
      return "not_found" as const;
    }

    const updates: {
      paymentAccessLastSyncAt: number;
      updatedAt: number;
      paymentAccessActive?: boolean;
      checkoutCredits?: number;
    } = {
      paymentAccessLastSyncAt: Date.now(),
      updatedAt: Date.now(),
    };

    if (args.paymentAccessActive !== undefined) {
      updates.paymentAccessActive = args.paymentAccessActive;
    }
    if (args.checkoutCredits !== undefined) {
      updates.checkoutCredits = args.checkoutCredits;
    }

    const wasActive = project.paymentAccessActive;
    await ctx.db.patch(project._id, updates);

    if (args.paymentAccessActive === true && !wasActive) {
      await ctx.scheduler.runAfter(0, internal.webhookDelivery.trigger, {
        projectId: project._id,
        eventType: "payment_access.activated",
      });
    }

    return "updated" as const;
  },
});
