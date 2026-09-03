import { isCorrelationId } from "@repo/observability";
import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

import { internalMutation } from "../_generated/server";
import { revalidateGasApiKeyScope } from "./authorization";
import { GAS_FEE_OVERHEAD_STROOPS, GAS_LIFECYCLE_STATES } from "./types";
import {
  addStroopValues,
  assertValidGasPolicyState,
  assertValidStroopValue,
  normalizeContractId,
  normalizeGasRequestId,
  normalizeTransactionHash,
  normalizeWalletAddress,
} from "./validation";

export type GasSubmitResult =
  | { status: "unauthorized" }
  | { status: "invalid_internal_input" }
  | { status: "dependency_unavailable" }
  | { status: "resource_not_found" }
  | { status: "invalid_lifecycle" }
  | { status: "reservation_expired" }
  | { status: "handoff_unavailable" };

export const gasSubmitMutationResultValidator = v.union(
  v.object({ status: v.literal("unauthorized") }),
  v.object({ status: v.literal("invalid_internal_input") }),
  v.object({ status: v.literal("dependency_unavailable") }),
  v.object({ status: v.literal("resource_not_found") }),
  v.object({ status: v.literal("invalid_lifecycle") }),
  v.object({ status: v.literal("reservation_expired") }),
  v.object({ status: v.literal("handoff_unavailable") }),
);

function utcDayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function isValidTimestamp(value: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    value >= 0 &&
    Number.isFinite(value) &&
    Number.isFinite(new Date(value).getTime())
  );
}

function validateReservation(log: Doc<"gasLogs">): bigint | null {
  if (
    log.decisionCode !== "reserved" ||
    log.lifecycle !== GAS_LIFECYCLE_STATES.reserved ||
    log.rejectionCode !== undefined ||
    log.transactionHash === undefined ||
    log.reservedStroops === undefined ||
    log.innerMaxFeeStroops === undefined ||
    log.expiresAt === undefined ||
    !isValidTimestamp(log.expiresAt) ||
    !isValidTimestamp(log.createdAt) ||
    !isValidTimestamp(log.updatedAt) ||
    log.updatedAt < log.createdAt ||
    log.actualFeeStroops !== undefined
  ) {
    return null;
  }

  try {
    if (
      !isCorrelationId(log.requestId) ||
      normalizeGasRequestId(log.requestId) !== log.requestId ||
      normalizeTransactionHash(log.transactionHash) !== log.transactionHash ||
      log.sourceWallet === undefined ||
      normalizeWalletAddress(log.sourceWallet) !== log.sourceWallet ||
      log.targetContractIds === undefined ||
      log.targetContractIds.length !== 1 ||
      normalizeContractId(log.targetContractIds[0]!) !== log.targetContractIds[0]
    ) {
      return null;
    }

    const innerMaxFeeStroops = assertValidStroopValue(log.innerMaxFeeStroops);
    const reservedStroops = assertValidStroopValue(log.reservedStroops);
    if (reservedStroops <= 0n) return null;
    if (addStroopValues(innerMaxFeeStroops, GAS_FEE_OVERHEAD_STROOPS) !== reservedStroops) {
      return null;
    }
    return reservedStroops;
  } catch {
    return null;
  }
}

function validatePolicy(policy: Doc<"gasPolicies">): boolean {
  try {
    assertValidGasPolicyState(policy);
    if (
      policy.dailyWindowKey === utcDayKey(Date.now()) &&
      policy.dailyReservedStroops > policy.dailyCapStroops
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function findReservation(
  ctx: MutationCtx,
  projectId: Doc<"projects">["_id"],
  requestId: string,
): Promise<Doc<"gasLogs"> | null | "ambiguous"> {
  const matches = await ctx.db
    .query("gasLogs")
    .withIndex("by_project_id_and_request_id", (q) =>
      q.eq("projectId", projectId).eq("requestId", requestId),
    )
    .take(2);
  if (matches.length > 1) return "ambiguous";
  return matches[0] ?? null;
}

async function findPolicy(
  ctx: MutationCtx,
  projectId: Doc<"projects">["_id"],
): Promise<Doc<"gasPolicies"> | null | "ambiguous"> {
  const matches = await ctx.db
    .query("gasPolicies")
    .withIndex("by_project_id", (q) => q.eq("projectId", projectId))
    .take(2);
  if (matches.length > 1) return "ambiguous";
  return matches[0] ?? null;
}

/**
 * Validates the D1 relayer handoff boundary and expires an overdue reservation.
 * No relayer, network, or wallet-quota work is performed here.
 */
export const submit = internalMutation({
  args: {
    apiKeyId: v.id("apiKeys"),
    projectId: v.id("projects"),
    apiKeyHash: v.string(),
    requestId: v.string(),
    transactionHash: v.string(),
  },
  returns: gasSubmitMutationResultValidator,
  handler: async (ctx, args): Promise<GasSubmitResult> => {
    if (!(await revalidateGasApiKeyScope(ctx, args))) {
      return { status: "unauthorized" };
    }

    let requestId: string;
    let transactionHash: string;
    try {
      requestId = normalizeGasRequestId(args.requestId);
      transactionHash = normalizeTransactionHash(args.transactionHash);
    } catch {
      return { status: "invalid_internal_input" };
    }

    const reservation = await findReservation(ctx, args.projectId, requestId);
    if (reservation === null) return { status: "resource_not_found" };
    if (reservation === "ambiguous") return { status: "invalid_internal_input" };

    if (reservation.lifecycle === GAS_LIFECYCLE_STATES.rejected) {
      return { status: "invalid_lifecycle" };
    }
    if (reservation.lifecycle === GAS_LIFECYCLE_STATES.expired) {
      if (reservation.transactionHash === undefined) return { status: "invalid_internal_input" };
      try {
        if (normalizeTransactionHash(reservation.transactionHash) !== transactionHash) {
          return { status: "invalid_lifecycle" };
        }
      } catch {
        return { status: "invalid_internal_input" };
      }
      return { status: "reservation_expired" };
    }
    if (reservation.lifecycle !== GAS_LIFECYCLE_STATES.reserved) {
      return { status: "invalid_internal_input" };
    }

    if (reservation.transactionHash === undefined) return { status: "invalid_internal_input" };
    try {
      if (normalizeTransactionHash(reservation.transactionHash) !== transactionHash) {
        return { status: "invalid_lifecycle" };
      }
    } catch {
      return { status: "invalid_internal_input" };
    }

    const reservedStroops = validateReservation(reservation);
    if (reservedStroops === null) return { status: "invalid_internal_input" };

    const now = Date.now();
    if (reservation.expiresAt !== undefined && reservation.expiresAt > now) {
      return { status: "handoff_unavailable" };
    }

    const policy = await findPolicy(ctx, args.projectId);
    if (policy === null || policy === "ambiguous" || !validatePolicy(policy)) {
      return { status: "invalid_internal_input" };
    }

    const currentDayKey = utcDayKey(now);
    let nextDailyReservedStroops: bigint | null = null;
    const reservationBelongsToCurrentDay = utcDayKey(reservation.createdAt) === currentDayKey;
    if (policy.dailyWindowKey === currentDayKey && reservationBelongsToCurrentDay) {
      if (policy.dailyReservedStroops < reservedStroops) {
        return { status: "invalid_internal_input" };
      }
      nextDailyReservedStroops = policy.dailyReservedStroops - reservedStroops;
    }

    // All reservation and accounting checks finish before either patch is issued.
    if (nextDailyReservedStroops !== null) {
      await ctx.db.patch(policy._id, {
        dailyReservedStroops: nextDailyReservedStroops,
        updatedAt: now,
      });
    }
    await ctx.db.patch(reservation._id, {
      lifecycle: GAS_LIFECYCLE_STATES.expired,
      updatedAt: now,
    });

    return { status: "reservation_expired" };
  },
});
