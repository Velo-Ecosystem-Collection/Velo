"use node";

import { createTestnetFeeBumpRpcAdapter } from "@repo/stellar/fee-bump-rpc";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import type { ActionCtx } from "../_generated/server";
import type {
  TestnetFeeBumpLedgerEvidence,
  TestnetFeeBumpLookupOutcome,
  TestnetFeeBumpRpcAdapter,
  TestnetFeeBumpRpcTransport,
} from "@repo/stellar/fee-bump-rpc";

import { internalAction } from "../_generated/server";
import { type GasReconciliationClaim, type GasReconciliationOutcomeResult } from "./reconciliation";
import { getGasRuntimeEnv } from "./runtime_env";
import { GAS_RECONCILIATION_LOOKUP_CONCURRENCY } from "./types";

const claimDueRef = makeFunctionReference<"mutation">("gas/reconciliation:claimDue");
const claimOperatorRef = makeFunctionReference<"mutation">("gas/reconciliation:claimOperator");
const recordOutcomeRef = makeFunctionReference<"mutation">("gas/reconciliation:recordOutcome");
const reconcileDueRef = makeFunctionReference<"action">("gas/reconciliation_action:reconcileDue");

const batchResultValidator = v.object({
  claimed: v.number(),
  recorded: v.number(),
  verified: v.number(),
  exhausted: v.number(),
});

const operatorResultValidator = v.union(
  v.object({
    status: v.literal("recorded"),
    idempotent: v.boolean(),
    verified: v.boolean(),
    exhausted: v.boolean(),
  }),
  v.object({ status: v.literal("resource_not_found") }),
  v.object({ status: v.literal("invalid_internal_input") }),
  v.object({ status: v.literal("invalid_lifecycle") }),
  v.object({ status: v.literal("not_exhausted") }),
  v.object({ status: v.literal("already_verified") }),
  v.object({ status: v.literal("already_claimed") }),
);

export type GasReconciliationDependencies = Readonly<{
  /** Injected primary transport for deterministic reconciliation tests. */
  rpcTransport?: TestnetFeeBumpRpcTransport;
  /** Injected fallback transport for deterministic failover tests. */
  fallbackRpcTransport?: TestnetFeeBumpRpcTransport;
  /** Optional adapter factory for deterministic lookup orchestration tests. */
  rpcAdapterFactory?: (
    rpcUrl: string | undefined,
    transport?: TestnetFeeBumpRpcTransport,
  ) => TestnetFeeBumpRpcAdapter;
}>;

type ReconciliationLookupInput =
  | {
      status: "found";
      evidence: {
        outerTransactionHash: string;
        innerTransactionHash: string;
        feeSource: string;
        ledger: number;
        resultCode: string;
        innerResultCode?: string;
        chargedStroops: bigint;
      };
    }
  | { status: "not_found" }
  | { status: "unavailable" }
  | { status: "malformed_response" }
  | { status: "wrong_network" };

function primaryRpcUrl(): string | undefined {
  return process.env.STELLAR_RPC_URL ?? process.env.NEXT_PUBLIC_STELLAR_RPC_URL;
}

function fallbackRpcUrl(): string | undefined {
  const configured = getGasRuntimeEnv().VELO_GAS_TESTNET_FALLBACK_RPC_URL?.trim();
  return configured === "" ? undefined : configured;
}

function adapterFor(
  dependencies: GasReconciliationDependencies,
  rpcUrl: string | undefined,
  transport: TestnetFeeBumpRpcTransport | undefined,
): TestnetFeeBumpRpcAdapter {
  if (dependencies.rpcAdapterFactory !== undefined) {
    return dependencies.rpcAdapterFactory(rpcUrl, transport);
  }
  return createAdapter(rpcUrl, transport);
}

function createAdapter(
  rpcUrl: string | undefined,
  transport: TestnetFeeBumpRpcTransport | undefined,
): TestnetFeeBumpRpcAdapter {
  return createTestnetFeeBumpRpcAdapter({
    ...(rpcUrl === undefined ? {} : { rpcUrl }),
    ...(transport === undefined ? {} : { transport }),
  });
}

function isTransportUnavailable(outcome: TestnetFeeBumpLookupOutcome): boolean {
  return (
    outcome.status === "unavailable" ||
    (outcome.status === "preflight_failed" &&
      (outcome.code === "network_timeout" || outcome.code === "network_unavailable"))
  );
}

function lookupInput(outcome: TestnetFeeBumpLookupOutcome): ReconciliationLookupInput {
  if (outcome.status === "found") {
    const evidence: TestnetFeeBumpLedgerEvidence = outcome;
    return {
      status: "found",
      evidence: {
        outerTransactionHash: evidence.outerTransactionHash,
        innerTransactionHash: evidence.innerTransactionHash,
        feeSource: evidence.feeSource,
        ledger: evidence.ledger,
        resultCode: evidence.resultCode,
        ...(evidence.innerResultCode === undefined
          ? {}
          : { innerResultCode: evidence.innerResultCode }),
        chargedStroops: evidence.feeStroops,
      },
    };
  }
  if (outcome.status === "not_found") return { status: "not_found" };
  if (outcome.status === "unavailable") return { status: "unavailable" };
  if (outcome.status === "malformed_response") return { status: "malformed_response" };
  if (outcome.code === "wrong_network") return { status: "wrong_network" };
  if (outcome.code === "network_timeout" || outcome.code === "network_unavailable") {
    return { status: "unavailable" };
  }
  return { status: "malformed_response" };
}

async function lookupOnce(
  claim: GasReconciliationClaim,
  dependencies: GasReconciliationDependencies,
): Promise<ReconciliationLookupInput> {
  let outcome: TestnetFeeBumpLookupOutcome;
  try {
    outcome = await adapterFor(dependencies, primaryRpcUrl(), dependencies.rpcTransport).lookup(
      claim.outerTransactionHash,
    );
  } catch {
    outcome = { status: "unavailable" };
  }

  const configuredFallback = fallbackRpcUrl();
  const primary = primaryRpcUrl();
  const canUseFallback = configuredFallback !== undefined && configuredFallback !== primary;
  if (canUseFallback && isTransportUnavailable(outcome)) {
    try {
      outcome = await adapterFor(
        dependencies,
        configuredFallback,
        dependencies.fallbackRpcTransport,
      ).lookup(claim.outerTransactionHash);
    } catch {
      outcome = { status: "unavailable" };
    }
  }
  return lookupInput(outcome);
}

async function recordLookup(
  ctx: ActionCtx,
  claim: GasReconciliationClaim,
  outcome: ReconciliationLookupInput,
): Promise<GasReconciliationOutcomeResult> {
  return (await ctx.runMutation(recordOutcomeRef, {
    executionAttemptId: claim.executionAttemptId,
    projectId: claim.projectId,
    outerTransactionHash: claim.outerTransactionHash,
    reconciliationLeaseToken: claim.reconciliationLeaseToken,
    reconciliationLeaseGeneration: claim.reconciliationLeaseGeneration,
    outcome,
  })) as GasReconciliationOutcomeResult;
}

async function reconcileClaims(
  ctx: ActionCtx,
  claims: GasReconciliationClaim[],
  dependencies: GasReconciliationDependencies,
): Promise<{ recorded: number; verified: number; exhausted: number }> {
  let recorded = 0;
  let verified = 0;
  let exhausted = 0;
  for (let offset = 0; offset < claims.length; offset += GAS_RECONCILIATION_LOOKUP_CONCURRENCY) {
    const results = await Promise.all(
      claims.slice(offset, offset + GAS_RECONCILIATION_LOOKUP_CONCURRENCY).map(async (claim) => {
        try {
          const result = await recordLookup(ctx, claim, await lookupOnce(claim, dependencies));
          if (result.status !== "recorded") return result;
          return result;
        } catch {
          return { status: "invalid_lifecycle" } as const;
        }
      }),
    );
    for (const result of results) {
      if (result.status !== "recorded") continue;
      recorded += 1;
      if (result.verified) verified += 1;
      if (result.exhausted) exhausted += 1;
    }
  }
  return { recorded, verified, exhausted };
}

export async function reconcileGasExecutionBatch(
  ctx: ActionCtx,
  limit: number | undefined,
  dependencies: GasReconciliationDependencies = {},
) {
  const claims = (await ctx.runMutation(claimDueRef, {
    ...(limit === undefined ? {} : { limit }),
  })) as GasReconciliationClaim[];
  const result = await reconcileClaims(ctx, claims, dependencies);
  const normalizedLimit = Math.min(limit ?? 25, 25);
  if (claims.length === normalizedLimit) {
    await ctx.scheduler.runAfter(0, reconcileDueRef, { limit: normalizedLimit });
  }
  return { claimed: claims.length, ...result };
}

export async function reconcileGasExecutionOperator(
  ctx: ActionCtx,
  projectId: string,
  requestId: string,
  dependencies: GasReconciliationDependencies = {},
): Promise<
  | {
      status: "recorded";
      idempotent: boolean;
      verified: boolean;
      exhausted: boolean;
    }
  | {
      status:
        | "resource_not_found"
        | "invalid_internal_input"
        | "invalid_lifecycle"
        | "not_exhausted"
        | "already_verified"
        | "already_claimed";
    }
> {
  const claimed = (await ctx.runMutation(claimOperatorRef, { projectId, requestId })) as
    | { status: "claimed"; claim: GasReconciliationClaim }
    | {
        status:
          | "resource_not_found"
          | "invalid_internal_input"
          | "invalid_lifecycle"
          | "not_exhausted"
          | "already_verified"
          | "already_claimed";
      };
  if (claimed.status !== "claimed") return claimed;
  const result = await recordLookup(
    ctx,
    claimed.claim,
    await lookupOnce(claimed.claim, dependencies),
  );
  if (result.status !== "recorded") return result;
  return {
    status: "recorded" as const,
    idempotent: result.idempotent,
    verified: result.verified,
    exhausted: result.exhausted,
  };
}

export const reconcileDue = internalAction({
  args: { limit: v.optional(v.number()) },
  returns: batchResultValidator,
  handler: async (ctx, args) => await reconcileGasExecutionBatch(ctx, args.limit),
});

/** Internal operator recovery: one project/request-scoped fenced lookup. */
export const operatorReconcile = internalAction({
  args: { projectId: v.id("projects"), requestId: v.string() },
  returns: operatorResultValidator,
  handler: async (ctx, args) =>
    await reconcileGasExecutionOperator(ctx, args.projectId, args.requestId),
});
