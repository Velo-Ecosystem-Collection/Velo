import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

import { internalQuery } from "../_generated/server";
import { GAS_NETWORK } from "./types";

const phaseValidator = v.union(
  v.literal("preflight"),
  v.literal("after-settlement"),
  v.literal("before-replay"),
  v.literal("after-replay"),
  v.literal("before-denial"),
  v.literal("after-denial"),
);

export const operatorSnapshotArgsValidator = {
  projectId: v.id("projects"),
  phase: phaseValidator,
  requestId: v.optional(v.string()),
  transactionHash: v.optional(v.string()),
  idempotencyKeyHash: v.optional(v.string()),
};

type GasLog = Doc<"gasLogs">;
type GasExecutionAttempt = Doc<"gasExecutionAttempts">;

function utcDayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function decimal(value: bigint | undefined): string | null {
  return value === undefined ? null : value.toString();
}

function isExecutionLifecycle(
  lifecycle: GasExecutionAttempt["lifecycle"],
): lifecycle is
  | "claimed"
  | "submission_unknown"
  | "submitted"
  | "succeeded"
  | "failed"
  | "cancelled" {
  return (
    lifecycle === "claimed" ||
    lifecycle === "submission_unknown" ||
    lifecycle === "submitted" ||
    lifecycle === "succeeded" ||
    lifecycle === "failed" ||
    lifecycle === "cancelled"
  );
}

function hasLiveExposure(lifecycle: GasExecutionAttempt["lifecycle"]): boolean {
  return lifecycle === "claimed" || lifecycle === "submission_unknown" || lifecycle === "submitted";
}

async function uniqueGasLog(
  ctx: QueryCtx,
  projectId: Doc<"projects">["_id"],
  args: {
    requestId?: string;
    transactionHash?: string;
    idempotencyKeyHash?: string;
  },
): Promise<GasLog | null> {
  const matches = args.idempotencyKeyHash
    ? await ctx.db
        .query("gasLogs")
        .withIndex("by_project_id_and_idempotency_key_hash", (q) =>
          q.eq("projectId", projectId).eq("idempotencyKeyHash", args.idempotencyKeyHash!),
        )
        .take(2)
    : args.transactionHash
      ? await ctx.db
          .query("gasLogs")
          .withIndex("by_project_id_and_transaction_hash", (q) =>
            q.eq("projectId", projectId).eq("transactionHash", args.transactionHash!),
          )
          .take(2)
      : args.requestId
        ? await ctx.db
            .query("gasLogs")
            .withIndex("by_project_id_and_request_id", (q) =>
              q.eq("projectId", projectId).eq("requestId", args.requestId!),
            )
            .take(2)
        : [];

  if (matches.length > 1) throw new Error("Ambiguous Gas evidence identity");
  return matches[0] ?? null;
}

async function uniqueExecutionAttempt(
  ctx: QueryCtx,
  projectId: Doc<"projects">["_id"],
  requestId?: string,
): Promise<GasExecutionAttempt | null> {
  if (!requestId) return null;

  const matches = await ctx.db
    .query("gasExecutionAttempts")
    .withIndex("by_project_id_and_request_id", (q) =>
      q.eq("projectId", projectId).eq("requestId", requestId),
    )
    .take(2);
  if (matches.length > 1) throw new Error("Ambiguous Gas execution identity");
  return matches[0] ?? null;
}

/** Read the bounded, non-secret facts needed by the D2 operator snapshot. */
export const getOperatorSnapshotData = internalQuery({
  args: operatorSnapshotArgsValidator,
  returns: v.any(),
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) return null;

    const policyMatches = await ctx.db
      .query("gasPolicies")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .take(2);
    if (policyMatches.length > 1) throw new Error("Ambiguous Gas policy");
    const policy = policyMatches[0] ?? null;

    const relayerMatches = await ctx.db
      .query("relayerAccounts")
      .withIndex("by_project_id_and_network", (q) =>
        q.eq("projectId", args.projectId).eq("network", GAS_NETWORK),
      )
      .take(2);
    if (relayerMatches.length > 1) throw new Error("Ambiguous Gas relayer");
    const relayer = relayerMatches[0] ?? null;

    const log = await uniqueGasLog(ctx, args.projectId, args);
    const attempt = await uniqueExecutionAttempt(
      ctx,
      args.projectId,
      args.requestId ?? log?.requestId,
    );

    if (log) {
      if (args.requestId && log.requestId !== args.requestId) {
        throw new Error("Gas evidence request scope mismatch");
      }
      const isRedactedRejection =
        log.decisionCode === "rejected" && log.transactionHash === undefined;
      if (
        args.transactionHash &&
        log.transactionHash !== args.transactionHash &&
        !isRedactedRejection
      ) {
        throw new Error("Gas evidence transaction scope mismatch");
      }
      if (args.idempotencyKeyHash && log.idempotencyKeyHash !== args.idempotencyKeyHash) {
        throw new Error("Gas evidence idempotency scope mismatch");
      }
    }

    const execution =
      attempt && isExecutionLifecycle(attempt.lifecycle)
        ? {
            requestId: attempt.requestId,
            innerTransactionHash: attempt.innerTransactionHash,
            outerTransactionHash: attempt.outerTransactionHash ?? null,
            status: attempt.lifecycle,
            sendCount: attempt.sendCount,
            reservedStroops: attempt.approvedHoldStroops.toString(),
            actualFeeStroops: decimal(attempt.actualFeeStroops),
            reconciliationRequired: attempt.reconciliationRequired,
            feeSource: attempt.relayerPublicKey,
            ledgerEvidence: attempt.verifiedLedgerEvidence
              ? {
                  outerTransactionHash: attempt.verifiedLedgerEvidence.outerTransactionHash,
                  innerTransactionHash: attempt.verifiedLedgerEvidence.innerTransactionHash,
                  feeSource: attempt.verifiedLedgerEvidence.feeSource,
                  ledger: attempt.verifiedLedgerEvidence.ledger,
                  resultCode: attempt.verifiedLedgerEvidence.resultCode,
                  ...(attempt.verifiedLedgerEvidence.innerResultCode === undefined
                    ? {}
                    : { innerResultCode: attempt.verifiedLedgerEvidence.innerResultCode }),
                  chargedStroops: attempt.verifiedLedgerEvidence.chargedStroops.toString(),
                }
              : null,
          }
        : null;

    const decision = log
      ? {
          decisionCode: log.decisionCode,
          rejectionCode: log.rejectionCode ?? null,
          reservedExposureStroops:
            log.decisionCode === "reserved" ? (log.reservedStroops?.toString() ?? "0") : "0",
        }
      : null;

    const reservedExposureStroops = attempt
      ? attempt.reconciliationRequired || hasLiveExposure(attempt.lifecycle)
        ? attempt.approvedHoldStroops.toString()
        : "0"
      : (decision?.reservedExposureStroops ?? "0");

    return {
      phase: args.phase,
      userPublicKey: project.ownerAddress,
      relayer: relayer
        ? {
            publicKey: relayer.publicKey,
            network: relayer.network,
            status: relayer.status,
          }
        : null,
      policy: {
        enabled: policy?.enabled ?? false,
        network: policy?.network ?? GAS_NETWORK,
        allowedContractIds: policy ? [...policy.allowedContractIds] : [],
      },
      accounting: {
        accountingDayKey: policy?.dailyWindowKey ?? utcDayKey(Date.now()),
        outstandingHoldsStroops: policy?.outstandingHoldsStroops?.toString() ?? "0",
        dailyConfirmedSpendStroops: policy?.dailyConfirmedSpendStroops?.toString() ?? "0",
      },
      execution,
      decision,
      reservedExposureStroops,
    };
  },
});
