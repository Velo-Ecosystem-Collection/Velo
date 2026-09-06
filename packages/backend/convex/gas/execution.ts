import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { TestnetFeeBumpQuote } from "@repo/stellar/fee-bump";

import { internalMutation } from "../_generated/server";
import {
  ensureGasAccounting,
  increaseGasOutstandingHold,
  reservationExpiryForClaim,
} from "./accounting";
import { revalidateGasApiKeyScope } from "./authorization";
import {
  gasSubmitResultProjectionValidator,
  projectGasExecutionAttempt,
  type GasSubmitResultProjection,
} from "./projections";
import { gasNetworkValidator } from "./schema";
import {
  GAS_FEE_OVERHEAD_STROOPS,
  GAS_LIFECYCLE_STATES,
  GAS_NETWORK,
  GAS_SUPPORTED_OPERATION,
} from "./types";
import {
  addStroopValues,
  assertValidGasPolicyState,
  assertValidInnerMaxTime,
  assertValidStroopValue,
  normalizeContractId,
  normalizeGasRequestId,
  normalizeRelayerPublicKey,
  normalizeTransactionHash,
  normalizeWalletAddress,
} from "./validation";

export type GasExecutionAttemptLookup = Doc<"gasExecutionAttempts"> | null | "ambiguous";

type GasExecutionReadContext = Pick<MutationCtx, "db">;
type GasExecutionIdentity = {
  projectId: Doc<"projects">["_id"];
  value: string;
};

const LEASE_MS = 30 * 1_000;
const SHA256_HASH_PATTERN = /^[a-f0-9]{64}$/;

export type GasClaimResult =
  | { status: "unauthorized" }
  | { status: "invalid_internal_input" }
  | { status: "invalid_request" }
  | { status: "invalid_signature" }
  | { status: "wrong_network" }
  | { status: "unsupported_transaction" }
  | { status: "payload_too_large" }
  | { status: "dependency_unavailable" }
  | { status: "resource_not_found" }
  | { status: "reservation_expired" }
  | { status: "invalid_lifecycle" }
  | { status: "policy_denied" }
  | { status: "relayer_unavailable" }
  | {
      status: "claimed";
      replayed: boolean;
      executionAttemptId: Doc<"gasExecutionAttempts">["_id"];
      innerTransactionHash: string;
      approvedHoldStroops: bigint;
      outerTransactionHash: string | null;
      leaseToken: string | null;
      leaseGeneration: number;
      leaseExpiresAt: number | null;
      sendCount: number;
      execution: GasSubmitResultProjection;
    };

const gasClaimResultValidator = v.union(
  v.object({ status: v.literal("unauthorized") }),
  v.object({ status: v.literal("invalid_internal_input") }),
  v.object({ status: v.literal("invalid_request") }),
  v.object({ status: v.literal("invalid_signature") }),
  v.object({ status: v.literal("wrong_network") }),
  v.object({ status: v.literal("unsupported_transaction") }),
  v.object({ status: v.literal("payload_too_large") }),
  v.object({ status: v.literal("dependency_unavailable") }),
  v.object({ status: v.literal("resource_not_found") }),
  v.object({ status: v.literal("reservation_expired") }),
  v.object({ status: v.literal("invalid_lifecycle") }),
  v.object({ status: v.literal("policy_denied") }),
  v.object({ status: v.literal("relayer_unavailable") }),
  v.object({
    status: v.literal("claimed"),
    replayed: v.boolean(),
    executionAttemptId: v.id("gasExecutionAttempts"),
    innerTransactionHash: v.string(),
    approvedHoldStroops: v.int64(),
    outerTransactionHash: v.union(v.string(), v.null()),
    leaseToken: v.union(v.string(), v.null()),
    leaseGeneration: v.number(),
    leaseExpiresAt: v.union(v.number(), v.null()),
    sendCount: v.number(),
    execution: gasSubmitResultProjectionValidator,
  }),
);

const gasFeeBumpQuoteValidator = v.object({
  innerTransactionHash: v.string(),
  innerMaxFeeStroops: v.int64(),
  innerInclusionFeeStroops: v.int64(),
  resourceFeeStroops: v.int64(),
  baseFeeStroops: v.int64(),
  outerMaxFeeStroops: v.int64(),
});

function isSha256Hash(value: string): boolean {
  return SHA256_HASH_PATTERN.test(value);
}

function utcDayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

async function findByRequestId(
  ctx: GasExecutionReadContext,
  identity: GasExecutionIdentity,
): Promise<GasExecutionAttemptLookup> {
  const matches = await ctx.db
    .query("gasExecutionAttempts")
    .withIndex("by_project_id_and_request_id", (q) =>
      q.eq("projectId", identity.projectId).eq("requestId", identity.value),
    )
    .take(2);
  if (matches.length > 1) return "ambiguous";
  return matches[0] ?? null;
}

async function findByIdempotencyKeyHash(
  ctx: GasExecutionReadContext,
  identity: GasExecutionIdentity,
): Promise<GasExecutionAttemptLookup> {
  const matches = await ctx.db
    .query("gasExecutionAttempts")
    .withIndex("by_project_id_and_idempotency_key_hash", (q) =>
      q.eq("projectId", identity.projectId).eq("idempotencyKeyHash", identity.value),
    )
    .take(2);
  if (matches.length > 1) return "ambiguous";
  return matches[0] ?? null;
}

async function findByInnerTransactionHash(
  ctx: GasExecutionReadContext,
  identity: GasExecutionIdentity,
): Promise<GasExecutionAttemptLookup> {
  const matches = await ctx.db
    .query("gasExecutionAttempts")
    .withIndex("by_project_id_and_inner_transaction_hash", (q) =>
      q.eq("projectId", identity.projectId).eq("innerTransactionHash", identity.value),
    )
    .take(2);
  if (matches.length > 1) return "ambiguous";
  return matches[0] ?? null;
}

/** Read one execution attempt by its project-scoped request identity. */
export async function findExecutionAttemptByRequestId(
  ctx: GasExecutionReadContext,
  projectId: Doc<"projects">["_id"],
  requestId: string,
): Promise<GasExecutionAttemptLookup> {
  return await findByRequestId(ctx, { projectId, value: requestId });
}

/** Read one execution attempt by its project-scoped idempotency hash. */
export async function findExecutionAttemptByIdempotencyKeyHash(
  ctx: GasExecutionReadContext,
  projectId: Doc<"projects">["_id"],
  idempotencyKeyHash: string,
): Promise<GasExecutionAttemptLookup> {
  return await findByIdempotencyKeyHash(ctx, { projectId, value: idempotencyKeyHash });
}

/** Read one execution attempt by its project-scoped immutable inner hash. */
export async function findExecutionAttemptByInnerTransactionHash(
  ctx: GasExecutionReadContext,
  projectId: Doc<"projects">["_id"],
  innerTransactionHash: string,
): Promise<GasExecutionAttemptLookup> {
  return await findByInnerTransactionHash(ctx, { projectId, value: innerTransactionHash });
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

async function findRelayer(
  ctx: MutationCtx,
  projectId: Doc<"projects">["_id"],
): Promise<Doc<"relayerAccounts"> | null | "ambiguous"> {
  const matches = await ctx.db
    .query("relayerAccounts")
    .withIndex("by_project_id_and_network", (q) =>
      q.eq("projectId", projectId).eq("network", GAS_NETWORK),
    )
    .take(2);
  if (matches.length > 1) return "ambiguous";
  return matches[0] ?? null;
}

function validateStoredReservation(reservation: Doc<"gasLogs">): boolean {
  if (
    reservation.decisionCode !== "reserved" ||
    reservation.lifecycle !== GAS_LIFECYCLE_STATES.reserved ||
    reservation.rejectionCode !== undefined ||
    reservation.transactionHash === undefined ||
    reservation.sourceWallet === undefined ||
    reservation.targetContractIds === undefined ||
    reservation.targetContractIds.length !== 1 ||
    reservation.innerMaxFeeStroops === undefined ||
    reservation.reservedStroops === undefined ||
    reservation.expiresAt === undefined ||
    !Number.isSafeInteger(reservation.createdAt) ||
    !Number.isSafeInteger(reservation.updatedAt) ||
    !Number.isSafeInteger(reservation.expiresAt) ||
    reservation.updatedAt < reservation.createdAt ||
    reservation.expiresAt <= reservation.createdAt ||
    reservation.actualFeeStroops !== undefined ||
    !isSha256Hash(reservation.idempotencyKeyHash) ||
    !isSha256Hash(reservation.requestFingerprint)
  ) {
    return false;
  }

  try {
    const innerMaxFeeStroops = assertValidStroopValue(reservation.innerMaxFeeStroops);
    const reservedStroops = assertValidStroopValue(reservation.reservedStroops);
    if (
      reservedStroops <= 0n ||
      addStroopValues(innerMaxFeeStroops, GAS_FEE_OVERHEAD_STROOPS) !== reservedStroops ||
      normalizeGasRequestId(reservation.requestId) !== reservation.requestId ||
      normalizeTransactionHash(reservation.transactionHash) !== reservation.transactionHash ||
      normalizeWalletAddress(reservation.sourceWallet) !== reservation.sourceWallet ||
      reservation.targetContractIds.some((target) => normalizeContractId(target) !== target)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function matchesReservation(
  reservation: Doc<"gasLogs">,
  args: {
    requestId: string;
    requestFingerprint: string;
    innerTransactionHash: string;
    sourceWallet: string;
    targetContractIds: readonly string[];
    innerMaxFeeStroops: bigint;
    innerMaxTime?: number;
  },
): boolean {
  if (
    reservation.requestId !== args.requestId ||
    reservation.requestFingerprint !== args.requestFingerprint ||
    reservation.transactionHash !== args.innerTransactionHash ||
    reservation.sourceWallet !== args.sourceWallet ||
    reservation.targetContractIds?.length !== args.targetContractIds.length ||
    reservation.targetContractIds?.some(
      (target, index) => target !== args.targetContractIds[index],
    ) ||
    reservation.innerMaxFeeStroops !== args.innerMaxFeeStroops ||
    reservation.decisionCode !== "reserved" ||
    reservation.rejectionCode !== undefined ||
    reservation.actualFeeStroops !== undefined
  ) {
    return false;
  }

  try {
    const originalReservation = assertValidStroopValue(reservation.reservedStroops ?? -1n);
    if (
      addStroopValues(args.innerMaxFeeStroops, GAS_FEE_OVERHEAD_STROOPS) !== originalReservation ||
      reservation.expiresAt !== reservationExpiryForClaim(reservation.createdAt, args.innerMaxTime)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function validateQuote(quote: TestnetFeeBumpQuote): boolean {
  try {
    const innerMaxFeeStroops = assertValidStroopValue(quote.innerMaxFeeStroops);
    const innerInclusionFeeStroops = assertValidStroopValue(quote.innerInclusionFeeStroops);
    const resourceFeeStroops = assertValidStroopValue(quote.resourceFeeStroops);
    const baseFeeStroops = assertValidStroopValue(quote.baseFeeStroops);
    const outerMaxFeeStroops = assertValidStroopValue(quote.outerMaxFeeStroops);
    if (
      !isSha256Hash(quote.innerTransactionHash) ||
      addStroopValues(innerInclusionFeeStroops, resourceFeeStroops) !== innerMaxFeeStroops ||
      baseFeeStroops < 100n ||
      baseFeeStroops < innerInclusionFeeStroops ||
      addStroopValues(addStroopValues(baseFeeStroops, baseFeeStroops), resourceFeeStroops) !==
        outerMaxFeeStroops
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function attemptMatchesClaim(
  attempt: Doc<"gasExecutionAttempts">,
  args: {
    requestId: string;
    idempotencyKeyHash: string;
    requestFingerprint: string;
    innerTransactionHash: string;
  },
): boolean {
  return (
    attempt.requestId === args.requestId &&
    attempt.idempotencyKeyHash === args.idempotencyKeyHash &&
    attempt.requestFingerprint === args.requestFingerprint &&
    attempt.innerTransactionHash === args.innerTransactionHash
  );
}

function claimResult(
  attempt: Doc<"gasExecutionAttempts">,
  replayed: boolean,
  includeLease: boolean,
): GasClaimResult {
  const execution = projectGasExecutionAttempt(attempt);
  return {
    status: "claimed",
    replayed,
    executionAttemptId: attempt._id,
    innerTransactionHash: attempt.innerTransactionHash,
    approvedHoldStroops: attempt.approvedHoldStroops,
    outerTransactionHash: attempt.outerTransactionHash ?? null,
    leaseToken: includeLease ? (attempt.leaseToken ?? null) : null,
    leaseGeneration: attempt.leaseGeneration,
    leaseExpiresAt: includeLease ? (attempt.leaseExpiresAt ?? null) : null,
    sendCount: attempt.sendCount,
    execution,
  };
}

/** A claimed worker may proceed only while its token and generation are live. */
export function hasLiveGasExecutionFence(
  attempt: Pick<
    Doc<"gasExecutionAttempts">,
    "lifecycle" | "leaseToken" | "leaseGeneration" | "leaseExpiresAt"
  >,
  fence: { leaseToken: string; leaseGeneration: number },
  now: number,
): boolean {
  return (
    attempt.lifecycle === GAS_LIFECYCLE_STATES.claimed &&
    attempt.leaseToken === fence.leaseToken &&
    attempt.leaseGeneration === fence.leaseGeneration &&
    attempt.leaseExpiresAt !== undefined &&
    Number.isSafeInteger(attempt.leaseExpiresAt) &&
    attempt.leaseExpiresAt > now
  );
}

/** Internal claim boundary. All values are revalidated before any accounting write. */
export const claim = internalMutation({
  args: {
    apiKeyId: v.id("apiKeys"),
    projectId: v.id("projects"),
    apiKeyHash: v.string(),
    network: gasNetworkValidator,
    operation: v.string(),
    requestId: v.string(),
    idempotencyKeyHash: v.optional(v.string()),
    requestFingerprint: v.string(),
    innerTransactionHash: v.string(),
    sourceWallet: v.string(),
    targetContractIds: v.array(v.string()),
    innerMaxFeeStroops: v.int64(),
    innerMaxTime: v.optional(v.number()),
    quote: gasFeeBumpQuoteValidator,
    expectedRelayerPublicKey: v.string(),
  },
  returns: gasClaimResultValidator,
  handler: async (ctx, args): Promise<GasClaimResult> => {
    if (!(await revalidateGasApiKeyScope(ctx, args))) return { status: "unauthorized" };

    let normalized: {
      requestId: string;
      idempotencyKeyHash: string;
      requestFingerprint: string;
      innerTransactionHash: string;
      sourceWallet: string;
      targetContractIds: string[];
      innerMaxFeeStroops: bigint;
      innerMaxTime?: number;
      expectedRelayerPublicKey: string;
    };
    try {
      if (
        args.network !== GAS_NETWORK ||
        args.operation !== GAS_SUPPORTED_OPERATION ||
        !isSha256Hash(args.apiKeyHash) ||
        (args.idempotencyKeyHash !== undefined && !isSha256Hash(args.idempotencyKeyHash)) ||
        !isSha256Hash(args.requestFingerprint) ||
        !isSha256Hash(args.innerTransactionHash)
      ) {
        return { status: "invalid_internal_input" };
      }
      normalized = {
        requestId: normalizeGasRequestId(args.requestId),
        idempotencyKeyHash: args.idempotencyKeyHash ?? "",
        requestFingerprint: args.requestFingerprint,
        innerTransactionHash: normalizeTransactionHash(args.innerTransactionHash),
        sourceWallet: normalizeWalletAddress(args.sourceWallet),
        targetContractIds: args.targetContractIds.map(normalizeContractId),
        innerMaxFeeStroops: assertValidStroopValue(args.innerMaxFeeStroops),
        ...(args.innerMaxTime === undefined
          ? {}
          : { innerMaxTime: assertValidInnerMaxTime(args.innerMaxTime) }),
        expectedRelayerPublicKey: normalizeRelayerPublicKey(args.expectedRelayerPublicKey),
      };
      if (normalized.targetContractIds.length !== 1 || !validateQuote(args.quote)) {
        return { status: "invalid_internal_input" };
      }
    } catch {
      return { status: "invalid_internal_input" };
    }

    const requestAttempt = await findExecutionAttemptByRequestId(
      ctx,
      args.projectId,
      normalized.requestId,
    );
    const reservationForIdentity =
      requestAttempt === null || requestAttempt === "ambiguous"
        ? await findReservation(ctx, args.projectId, normalized.requestId)
        : null;
    if (requestAttempt === "ambiguous" || reservationForIdentity === "ambiguous") {
      return { status: "invalid_internal_input" };
    }
    const idempotencyKeyHash =
      normalized.idempotencyKeyHash ||
      requestAttempt?.idempotencyKeyHash ||
      reservationForIdentity?.idempotencyKeyHash ||
      null;
    if (idempotencyKeyHash === null) {
      return { status: "resource_not_found" };
    }
    const [idempotencyAttempt, innerAttempt] = await Promise.all([
      findExecutionAttemptByIdempotencyKeyHash(ctx, args.projectId, idempotencyKeyHash),
      findExecutionAttemptByInnerTransactionHash(
        ctx,
        args.projectId,
        normalized.innerTransactionHash,
      ),
    ]);
    normalized = { ...normalized, idempotencyKeyHash };
    const requestAttemptForIdentity = requestAttempt;
    const existingAttempts = [requestAttemptForIdentity, idempotencyAttempt, innerAttempt];
    if (existingAttempts.some((attempt) => attempt === "ambiguous")) {
      return { status: "invalid_internal_input" };
    }
    const uniqueAttempts = existingAttempts.filter(
      (attempt): attempt is Doc<"gasExecutionAttempts"> =>
        attempt !== null && attempt !== "ambiguous",
    );
    const existing = uniqueAttempts[0];
    if (existing) {
      if (uniqueAttempts.some((attempt) => attempt._id !== existing._id)) {
        return { status: "invalid_internal_input" };
      }
      if (!attemptMatchesClaim(existing, normalized)) {
        return { status: "invalid_lifecycle" };
      }
      try {
        return claimResult(existing, true, false);
      } catch {
        return { status: "invalid_internal_input" };
      }
    }

    const reservation = await findReservation(ctx, args.projectId, normalized.requestId);
    if (reservation === null || reservation === "ambiguous") {
      return reservation === null
        ? { status: "resource_not_found" }
        : { status: "invalid_internal_input" };
    }
    const now = Date.now();
    if (!validateStoredReservation(reservation)) return { status: "invalid_internal_input" };
    if (!matchesReservation(reservation, normalized)) return { status: "invalid_lifecycle" };
    if (reservation.expiresAt === undefined || reservation.expiresAt <= now) {
      return { status: "reservation_expired" };
    }

    const policy = await findPolicy(ctx, args.projectId);
    if (policy === null || policy === "ambiguous") return { status: "invalid_internal_input" };
    // Read and validate legacy/rollover accounting without persisting a lazy
    // migration until every claim fact and the relayer identity have passed.
    const accounting = await ensureGasAccounting(ctx, policy, now, { persist: false });
    if (!accounting.ok) return { status: "invalid_internal_input" };
    try {
      assertValidGasPolicyState(accounting.snapshot.policy);
      if (
        args.quote.innerTransactionHash !== normalized.innerTransactionHash ||
        args.quote.innerMaxFeeStroops !== normalized.innerMaxFeeStroops
      ) {
        return { status: "invalid_internal_input" };
      }
      if (
        !accounting.snapshot.policy.enabled ||
        accounting.snapshot.policy.network !== GAS_NETWORK ||
        !accounting.snapshot.policy.allowedContractIds.includes(normalized.targetContractIds[0]!)
      ) {
        return { status: "policy_denied" };
      }
      const relayer = await findRelayer(ctx, args.projectId);
      if (
        relayer === null ||
        relayer === "ambiguous" ||
        relayer.status !== "active" ||
        relayer.network !== GAS_NETWORK ||
        relayer.publicKey !== normalized.expectedRelayerPublicKey
      ) {
        return { status: "relayer_unavailable" };
      }

      const originalReservationStroops = assertValidStroopValue(reservation.reservedStroops ?? -1n);
      if (accounting.snapshot.effectiveUsageStroops < originalReservationStroops) {
        return { status: "invalid_internal_input" };
      }
      const approvedHoldStroops = assertValidStroopValue(args.quote.outerMaxFeeStroops);
      const additionalHoldStroops = approvedHoldStroops - originalReservationStroops;
      if (additionalHoldStroops < 0n) return { status: "invalid_internal_input" };
      if (
        addStroopValues(accounting.snapshot.effectiveUsageStroops, additionalHoldStroops) >
        accounting.snapshot.policy.dailyCapStroops
      ) {
        return { status: "policy_denied" };
      }

      const nextAccounting = await increaseGasOutstandingHold(
        ctx,
        accounting.snapshot,
        additionalHoldStroops,
        now,
      );
      if (!nextAccounting) return { status: "policy_denied" };

      const leaseToken = crypto.randomUUID();
      const leaseExpiresAt = Math.min(now + LEASE_MS, reservation.expiresAt);
      if (!Number.isSafeInteger(leaseExpiresAt) || leaseExpiresAt <= now) {
        return { status: "reservation_expired" };
      }

      await ctx.db.patch(reservation._id, {
        lifecycle: GAS_LIFECYCLE_STATES.claimed,
        updatedAt: now,
      });
      const attemptId = await ctx.db.insert("gasExecutionAttempts", {
        projectId: args.projectId,
        network: GAS_NETWORK,
        requestId: normalized.requestId,
        idempotencyKeyHash: normalized.idempotencyKeyHash,
        requestFingerprint: normalized.requestFingerprint,
        innerTransactionHash: normalized.innerTransactionHash,
        sourceWallet: normalized.sourceWallet,
        targetContractIds: normalized.targetContractIds,
        innerMaxFeeStroops: normalized.innerMaxFeeStroops,
        originalReservationStroops,
        reservationCreatedAt: reservation.createdAt,
        reservationExpiresAt: reservation.expiresAt,
        accountingDayKey: utcDayKey(reservation.createdAt),
        lifecycle: GAS_LIFECYCLE_STATES.claimed,
        approvedHoldStroops,
        feeCeilingStroops: approvedHoldStroops,
        relayerPublicKey: relayer.publicKey,
        leaseToken,
        leaseGeneration: 1,
        leaseExpiresAt,
        sendCount: 0,
        nextCheckAt: now,
        reconciliationRequired: false,
        createdAt: now,
        updatedAt: now,
      });
      const attempt = await ctx.db.get("gasExecutionAttempts", attemptId);
      if (!attempt) return { status: "invalid_internal_input" };
      return claimResult(attempt, false, true);
    } catch {
      return { status: "invalid_internal_input" };
    }
  },
});
