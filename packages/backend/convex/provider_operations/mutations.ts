import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";

import { internalMutation, mutation } from "../_generated/server";

const LEASE_MS = 8_500;
const UNRESOLVED_MS = 30 * 60 * 1_000;
const PROVIDER_PENDING_MS = 24 * 60 * 60 * 1_000;
const MAX_RECOVERY_ATTEMPTS = 5;

const operationValidator = v.union(v.literal("trade"), v.literal("fiat_withdrawal"));
const stateValidator = v.union(
  v.literal("prepared"),
  v.literal("submitting"),
  v.literal("provider_pending"),
  v.literal("reconciling"),
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("dead_letter"),
);

const watchdogRef = makeFunctionReference<"mutation">(
  "provider_operations/mutations:recoverExpiredLease",
);

export const reserve = internalMutation({
  args: {
    projectId: v.id("projects"),
    provider: v.literal("pdax"),
    operation: operationValidator,
    clientKey: v.string(),
    requestFingerprint: v.string(),
    requestJson: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("providerOperations")
      .withIndex("by_project_provider_operation_and_client_key", (q) =>
        q
          .eq("projectId", args.projectId)
          .eq("provider", args.provider)
          .eq("operation", args.operation)
          .eq("clientKey", args.clientKey),
      )
      .unique();
    if (existing) {
      if (existing.requestFingerprint !== args.requestFingerprint) {
        throw new ConvexError("Idempotency key conflicts with a different settlement request");
      }
      return {
        operationId: existing._id,
        state: existing.state,
        replay: true,
        providerKey: existing.providerKey,
        resultJson: existing.resultJson,
      };
    }

    const project = await ctx.db.get(args.projectId);
    if (!project || project.retiredAt !== undefined) {
      throw new ConvexError("Project is retired or unavailable");
    }

    const now = Date.now();
    const operationId = await ctx.db.insert("providerOperations", {
      ...args,
      providerKey: crypto.randomUUID(),
      state: "prepared",
      attemptCount: 0,
      reconciliationCount: 0,
      nextAttemptAt: now,
      leaseGeneration: 0,
      unresolvedExpiresAt: now + UNRESOLVED_MS,
      ...(args.operation === "fiat_withdrawal"
        ? { providerPendingExpiresAt: now + PROVIDER_PENDING_MS }
        : {}),
      createdAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(LEASE_MS, watchdogRef, { operationId });
    const created = await ctx.db.get(operationId);
    return {
      operationId,
      state: "prepared" as const,
      replay: false,
      providerKey: created!.providerKey,
    };
  },
});

export const claim = internalMutation({
  args: { operationId: v.id("providerOperations"), leaseToken: v.string() },
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(args.operationId);
    if (!operation) throw new ConvexError("Provider operation not found");
    if (!["prepared", "reconciling"].includes(operation.state)) {
      return { claimed: false as const, state: operation.state };
    }
    // PDAX has no safe lookup-by-trade-idempotency contract. Ambiguous trades
    // are reconciliation-only and must never be resubmitted.
    if (operation.operation === "trade" && operation.state === "reconciling") {
      return { claimed: false as const, state: operation.state };
    }
    const now = Date.now();
    if (operation.nextAttemptAt > now) {
      return { claimed: false as const, state: operation.state };
    }
    const leaseGeneration = operation.leaseGeneration + 1;
    await ctx.db.patch(operation._id, {
      state: "submitting",
      leaseToken: args.leaseToken,
      leaseGeneration,
      leaseExpiresAt: now + LEASE_MS,
      attemptCount: operation.attemptCount + 1,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(LEASE_MS, watchdogRef, { operationId: operation._id });
    return { claimed: true as const, leaseGeneration, operation };
  },
});

export const complete = internalMutation({
  args: {
    operationId: v.id("providerOperations"),
    expectedState: stateValidator,
    leaseToken: v.string(),
    leaseGeneration: v.number(),
    nextState: stateValidator,
    providerReference: v.optional(v.string()),
    resultJson: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    nextAttemptAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(args.operationId);
    if (!operation) throw new ConvexError("Provider operation not found");
    if (
      operation.state !== args.expectedState ||
      operation.leaseToken !== args.leaseToken ||
      operation.leaseGeneration !== args.leaseGeneration
    ) {
      return { applied: false as const, state: operation.state };
    }
    if (["succeeded", "failed", "dead_letter"].includes(operation.state)) {
      return { applied: false as const, state: operation.state };
    }
    const now = Date.now();
    const nextState =
      args.nextState === "reconciling" &&
      (operation.reconciliationCount + 1 >= MAX_RECOVERY_ATTEMPTS ||
        now >= operation.unresolvedExpiresAt)
        ? "dead_letter"
        : args.nextState;
    await ctx.db.patch(operation._id, {
      state: nextState,
      ...(args.providerReference !== undefined
        ? { providerReference: args.providerReference }
        : {}),
      ...(["succeeded", "failed", "dead_letter"].includes(nextState)
        ? {
            responseSummary: {
              status: nextState,
              ...(args.providerReference ? { providerReference: args.providerReference } : {}),
            },
            resultJson: undefined,
            errorMessage: undefined,
          }
        : {}),
      ...(args.errorMessage !== undefined ? { errorCode: "dependency_unavailable" } : {}),
      ...(args.nextAttemptAt !== undefined ? { nextAttemptAt: args.nextAttemptAt } : {}),
      ...(args.nextState === "reconciling"
        ? { reconciliationCount: operation.reconciliationCount + 1 }
        : {}),
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      updatedAt: now,
    });
    return { applied: true as const, state: nextState };
  },
});

export const recoverExpiredLease = internalMutation({
  args: { operationId: v.id("providerOperations") },
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(args.operationId);
    if (
      !operation ||
      operation.state !== "submitting" ||
      !operation.leaseExpiresAt ||
      operation.leaseExpiresAt > Date.now()
    ) {
      return false;
    }
    const now = Date.now();
    const dead =
      operation.reconciliationCount + 1 >= MAX_RECOVERY_ATTEMPTS ||
      now >= operation.unresolvedExpiresAt;
    await ctx.db.patch(operation._id, {
      state: dead ? "dead_letter" : "reconciling",
      reconciliationCount: operation.reconciliationCount + 1,
      nextAttemptAt: now,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      errorMessage: "Worker lease expired before provider acknowledgement",
      updatedAt: now,
    });
    return true;
  },
});

export const claimDueReconciliation = internalMutation({
  args: { leaseToken: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const limit = Math.min(args.limit ?? 100, 100);
    const reconciling = await ctx.db
      .query("providerOperations")
      .withIndex("by_state_and_next_attempt_at", (q) =>
        q.eq("state", "reconciling").lte("nextAttemptAt", now),
      )
      .take(limit);
    const providerPending =
      reconciling.length < limit
        ? await ctx.db
            .query("providerOperations")
            .withIndex("by_state_and_next_attempt_at", (q) =>
              q.eq("state", "provider_pending").lte("nextAttemptAt", now),
            )
            .take(limit - reconciling.length)
        : [];
    const claimed = [];
    for (const operation of [...reconciling, ...providerPending]) {
      const expiresAt =
        operation.state === "provider_pending"
          ? (operation.providerPendingExpiresAt ?? operation.unresolvedExpiresAt)
          : operation.unresolvedExpiresAt;
      const expired =
        now >= expiresAt ||
        (operation.state === "reconciling" &&
          operation.reconciliationCount >= MAX_RECOVERY_ATTEMPTS);
      if (expired) {
        await ctx.db.patch(operation._id, {
          state: "dead_letter",
          errorMessage: "Provider reconciliation budget exhausted",
          updatedAt: now,
        });
        continue;
      }
      if (operation.leaseExpiresAt !== undefined && operation.leaseExpiresAt > now) continue;
      const leaseGeneration = operation.leaseGeneration + 1;
      await ctx.db.patch(operation._id, {
        leaseToken: args.leaseToken,
        leaseGeneration,
        leaseExpiresAt: now + LEASE_MS,
        updatedAt: now,
      });
      claimed.push({ ...operation, leaseGeneration });
    }
    return claimed;
  },
});

export const finishReconciliation = internalMutation({
  args: {
    operationId: v.id("providerOperations"),
    leaseToken: v.string(),
    leaseGeneration: v.number(),
    observation: v.union(
      v.literal("pending"),
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("not_found"),
    ),
    providerReference: v.optional(v.string()),
    resultJson: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(args.operationId);
    if (
      !operation ||
      !["reconciling", "provider_pending"].includes(operation.state) ||
      operation.leaseToken !== args.leaseToken ||
      operation.leaseGeneration !== args.leaseGeneration
    ) {
      return { applied: false as const };
    }
    const now = Date.now();
    const reconciliationCount =
      args.observation === "pending" ? 0 : operation.reconciliationCount + 1;
    const expiresAt =
      operation.state === "provider_pending"
        ? (operation.providerPendingExpiresAt ?? operation.unresolvedExpiresAt)
        : operation.unresolvedExpiresAt;
    const exhausted =
      now >= expiresAt ||
      (args.observation === "not_found" && reconciliationCount >= MAX_RECOVERY_ATTEMPTS);
    const state =
      args.observation === "succeeded"
        ? "succeeded"
        : args.observation === "failed"
          ? "failed"
          : exhausted
            ? "dead_letter"
            : args.observation === "pending"
              ? "provider_pending"
              : "reconciling";
    await ctx.db.patch(operation._id, {
      state,
      reconciliationCount,
      nextAttemptAt: now + (state === "provider_pending" ? 2 * 60_000 : 30_000),
      ...(args.providerReference !== undefined
        ? { providerReference: args.providerReference }
        : {}),
      ...(["succeeded", "failed", "dead_letter"].includes(state)
        ? {
            responseSummary: {
              status: state,
              ...(args.providerReference ? { providerReference: args.providerReference } : {}),
            },
            resultJson: undefined,
            errorMessage: undefined,
          }
        : {}),
      ...(args.errorMessage !== undefined ? { errorCode: "dependency_unavailable" } : {}),
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      updatedAt: now,
    });
    return { applied: true as const, state };
  },
});

export const resolveFromWebhook = internalMutation({
  args: {
    provider: v.literal("pdax"),
    providerKey: v.string(),
    observation: v.union(v.literal("succeeded"), v.literal("failed")),
    resultJson: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const operation = await ctx.db
      .query("providerOperations")
      .withIndex("by_provider_and_provider_key", (q) =>
        q.eq("provider", args.provider).eq("providerKey", args.providerKey),
      )
      .unique();
    if (!operation) return { updated: false };

    if (["succeeded", "failed", "dead_letter"].includes(operation.state)) {
      return { updated: false, state: operation.state };
    }

    const now = Date.now();
    await ctx.db.patch(operation._id, {
      state: args.observation,
      responseSummary: { status: args.observation },
      resultJson: undefined,
      errorMessage: undefined,
      ...(args.errorMessage !== undefined ? { errorCode: "dependency_unavailable" } : {}),
      updatedAt: now,
    });
    return { updated: true, state: args.observation };
  },
});

export const redrive = mutation({
  args: { operationId: v.id("providerOperations") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Authentication required");
    const operation = await ctx.db.get(args.operationId);
    if (!operation) throw new ConvexError("Provider operation not found");
    const project = await ctx.db.get(operation.projectId);
    if (
      !project ||
      project.retiredAt !== undefined ||
      (project.ownerTokenIdentifier !== identity.tokenIdentifier &&
        project.ownerAddress !== identity.subject)
    ) {
      throw new ConvexError("Not authorized");
    }
    if (operation.state !== "dead_letter" && operation.state !== "failed") {
      throw new ConvexError("Only terminal recovery operations may be redriven");
    }
    const now = Date.now();
    await ctx.db.patch(operation._id, {
      state: "reconciling",
      reconciliationCount: 0,
      nextAttemptAt: now,
      unresolvedExpiresAt: now + UNRESOLVED_MS,
      ...(operation.operation === "fiat_withdrawal"
        ? { providerPendingExpiresAt: now + PROVIDER_PENDING_MS }
        : {}),
      errorMessage: undefined,
      updatedAt: now,
    });
    return { operationId: operation._id, state: "reconciling" as const };
  },
});
