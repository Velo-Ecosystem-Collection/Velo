import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { TestnetFeeBumpQuote } from "@repo/stellar/fee-bump";

import { internalMutation, internalQuery } from "../_generated/server";
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
import {
  gasNetworkValidator,
  gasSendClassificationInputValidator,
  gasSequenceDiagnosisInputValidator,
} from "./schema";
import { expireGasUnsentExecutionAttempt } from "./settlement";
import {
  GAS_FEE_OVERHEAD_STROOPS,
  GAS_MAX_SEND_COUNT,
  GAS_LIFECYCLE_STATES,
  GAS_NETWORK,
  GAS_SUPPORTED_OPERATION,
  GAS_SEQUENCE_DIAGNOSIS_DISPOSITIONS,
  type GasSequenceDiagnosisDisposition,
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

type GasExecutionReadContext = Pick<QueryCtx, "db">;
type GasExecutionIdentity = {
  projectId: Doc<"projects">["_id"];
  value: string;
};

const LEASE_MS = 30 * 1_000;
const RECONCILIATION_WINDOW_MS = 24 * 60 * 60 * 1_000;
const SHA256_HASH_PATTERN = /^[a-f0-9]{64}$/;
const RESULT_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const recoverAbandonedRef = makeFunctionReference<"mutation">("gas/execution:recoverAbandoned");

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
      relayerPublicKey: string;
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
    relayerPublicKey: v.string(),
    execution: gasSubmitResultProjectionValidator,
  }),
);

export type GasSendAuthorizationResult =
  | {
      status: "authorized";
      outerTransactionHash: string;
      outerFeeStroops: bigint;
      sendCount: number;
      firstPossibleSendAt: number;
      reconciliationDeadlineAt: number;
    }
  | { status: "not_due"; nextSendAt: number }
  | { status: "unauthorized" }
  | { status: "invalid_internal_input" }
  | { status: "resource_not_found" }
  | { status: "invalid_lifecycle" }
  | { status: "reservation_expired" }
  | { status: "policy_denied" }
  | { status: "relayer_unavailable" };

export const gasSendAuthorizationResultValidator = v.union(
  v.object({
    status: v.literal("authorized"),
    outerTransactionHash: v.string(),
    outerFeeStroops: v.int64(),
    sendCount: v.number(),
    firstPossibleSendAt: v.number(),
    reconciliationDeadlineAt: v.number(),
  }),
  v.object({ status: v.literal("not_due"), nextSendAt: v.number() }),
  v.object({ status: v.literal("unauthorized") }),
  v.object({ status: v.literal("invalid_internal_input") }),
  v.object({ status: v.literal("resource_not_found") }),
  v.object({ status: v.literal("invalid_lifecycle") }),
  v.object({ status: v.literal("reservation_expired") }),
  v.object({ status: v.literal("policy_denied") }),
  v.object({ status: v.literal("relayer_unavailable") }),
);

export type GasSendOutcomeResult =
  | {
      status: "recorded";
      lifecycle: "submission_unknown" | "submitted";
      sendCount: number;
      idempotent: boolean;
      execution: GasSubmitResultProjection;
    }
  | { status: "invalid_internal_input" }
  | { status: "resource_not_found" }
  | { status: "invalid_lifecycle" };

export const gasSendOutcomeResultValidator = v.union(
  v.object({
    status: v.literal("recorded"),
    lifecycle: v.union(v.literal("submission_unknown"), v.literal("submitted")),
    sendCount: v.number(),
    idempotent: v.boolean(),
    execution: gasSubmitResultProjectionValidator,
  }),
  v.object({ status: v.literal("invalid_internal_input") }),
  v.object({ status: v.literal("resource_not_found") }),
  v.object({ status: v.literal("invalid_lifecycle") }),
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
    relayerPublicKey: attempt.relayerPublicKey,
    execution,
  };
}

const gasClaimReplayResultValidator = v.union(
  v.object({ status: v.literal("none") }),
  gasClaimResultValidator,
);

/** Return an existing safe attempt before readiness/custody checks on replay. */
export const findClaimReplay = internalQuery({
  args: {
    projectId: v.id("projects"),
    requestId: v.string(),
    requestFingerprint: v.string(),
    innerTransactionHash: v.string(),
  },
  returns: gasClaimReplayResultValidator,
  handler: async (ctx, args): Promise<GasClaimResult | { status: "none" }> => {
    if (!isSha256Hash(args.requestFingerprint) || !isSha256Hash(args.innerTransactionHash)) {
      return { status: "invalid_internal_input" };
    }

    const requestAttempt = await findByRequestId(ctx, {
      projectId: args.projectId,
      value: args.requestId,
    });
    const innerAttempt = await findByInnerTransactionHash(ctx, {
      projectId: args.projectId,
      value: args.innerTransactionHash,
    });
    if (requestAttempt === "ambiguous" || innerAttempt === "ambiguous") {
      return { status: "invalid_internal_input" };
    }

    const attempts = [requestAttempt, innerAttempt].filter(
      (attempt): attempt is Doc<"gasExecutionAttempts"> => attempt !== null,
    );
    if (attempts.length === 0) return { status: "none" };
    const existing = attempts[0]!;
    if (attempts.some((attempt) => attempt._id !== existing._id)) {
      return { status: "invalid_internal_input" };
    }
    if (
      existing.requestId !== args.requestId ||
      existing.requestFingerprint !== args.requestFingerprint ||
      existing.innerTransactionHash !== args.innerTransactionHash
    ) {
      return { status: "invalid_lifecycle" };
    }

    try {
      if (existing.lifecycle === GAS_LIFECYCLE_STATES.expired) {
        return { status: "reservation_expired" };
      }
      return claimResult(existing, true, false);
    } catch {
      return { status: "invalid_internal_input" };
    }
  },
});

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
    (attempt.lifecycle === GAS_LIFECYCLE_STATES.claimed ||
      attempt.lifecycle === GAS_LIFECYCLE_STATES.submissionUnknown) &&
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

const gasRecoveryClaimResultValidator = v.union(
  gasClaimResultValidator,
  v.object({ status: v.literal("relayer_preflight_required") }),
);

type GasRecoveryClaimResult = GasClaimResult | { status: "relayer_preflight_required" };

/**
 * Reclaim one abandoned execution without creating a new reservation or
 * execution identity. The first call may request relayer preflight; only the
 * second call, with the verified pinned public key, grants a new lease.
 */
export const recoverClaim = internalMutation({
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
    expectedRelayerPublicKey: v.optional(v.string()),
  },
  returns: gasRecoveryClaimResultValidator,
  handler: async (ctx, args): Promise<GasRecoveryClaimResult> => {
    if (!(await revalidateGasApiKeyScope(ctx, args))) return { status: "unauthorized" };

    let normalized: {
      requestId: string;
      requestFingerprint: string;
      innerTransactionHash: string;
      sourceWallet: string;
      targetContractIds: string[];
      innerMaxFeeStroops: bigint;
      innerMaxTime?: number;
      expectedRelayerPublicKey?: string;
    };
    try {
      if (
        args.network !== GAS_NETWORK ||
        args.operation !== GAS_SUPPORTED_OPERATION ||
        !isSha256Hash(args.apiKeyHash) ||
        !isSha256Hash(args.requestFingerprint) ||
        !isSha256Hash(args.innerTransactionHash) ||
        (args.idempotencyKeyHash !== undefined && !isSha256Hash(args.idempotencyKeyHash))
      ) {
        return { status: "invalid_internal_input" };
      }
      normalized = {
        requestId: normalizeGasRequestId(args.requestId),
        requestFingerprint: args.requestFingerprint,
        innerTransactionHash: normalizeTransactionHash(args.innerTransactionHash),
        sourceWallet: normalizeWalletAddress(args.sourceWallet),
        targetContractIds: args.targetContractIds.map(normalizeContractId),
        innerMaxFeeStroops: assertValidStroopValue(args.innerMaxFeeStroops),
        ...(args.innerMaxTime === undefined
          ? {}
          : { innerMaxTime: assertValidInnerMaxTime(args.innerMaxTime) }),
        ...(args.expectedRelayerPublicKey === undefined
          ? {}
          : { expectedRelayerPublicKey: normalizeRelayerPublicKey(args.expectedRelayerPublicKey) }),
      };
      if (
        normalized.targetContractIds.length !== 1 ||
        !validateQuote(args.quote) ||
        args.quote.innerTransactionHash !== normalized.innerTransactionHash ||
        args.quote.innerMaxFeeStroops !== normalized.innerMaxFeeStroops
      ) {
        return { status: "invalid_internal_input" };
      }
    } catch {
      return { status: "invalid_internal_input" };
    }

    const attempt = await findExecutionAttemptByRequestId(
      ctx,
      args.projectId,
      normalized.requestId,
    );
    const innerAttempt = await findExecutionAttemptByInnerTransactionHash(
      ctx,
      args.projectId,
      normalized.innerTransactionHash,
    );
    if (attempt === "ambiguous" || innerAttempt === "ambiguous") {
      return { status: "invalid_internal_input" };
    }
    const existing = attempt ?? innerAttempt;
    if (existing === null) return { status: "resource_not_found" };
    if (
      (attempt !== null && innerAttempt !== null && attempt._id !== innerAttempt._id) ||
      !attemptMatchesClaim(existing, {
        requestId: normalized.requestId,
        idempotencyKeyHash: existing.idempotencyKeyHash,
        requestFingerprint: normalized.requestFingerprint,
        innerTransactionHash: normalized.innerTransactionHash,
      }) ||
      existing.requestFingerprint !== normalized.requestFingerprint ||
      existing.sourceWallet !== normalized.sourceWallet ||
      existing.targetContractIds.length !== normalized.targetContractIds.length ||
      existing.targetContractIds.some(
        (target, index) => target !== normalized.targetContractIds[index],
      ) ||
      existing.innerMaxFeeStroops !== normalized.innerMaxFeeStroops ||
      existing.approvedHoldStroops !== args.quote.outerMaxFeeStroops ||
      existing.feeCeilingStroops !== args.quote.outerMaxFeeStroops
    ) {
      return { status: "invalid_lifecycle" };
    }

    const now = Date.now();
    if (!validateExecutionAttempt(existing)) return { status: "invalid_internal_input" };
    if (existing.lifecycle === GAS_LIFECYCLE_STATES.expired) {
      return { status: "reservation_expired" };
    }
    if (existing.reservationExpiresAt <= now && isRecoverableAttempt(existing, now)) {
      return { status: "reservation_expired" };
    }
    if (!isRecoverableAttempt(existing, now)) {
      return claimResult(existing, true, false);
    }
    if (existing.nextSendAt !== undefined && existing.nextSendAt > now) {
      return claimResult(existing, true, false);
    }
    if (normalized.expectedRelayerPublicKey === undefined) {
      return { status: "relayer_preflight_required" };
    }

    const policy = await findPolicy(ctx, args.projectId);
    if (policy === null || policy === "ambiguous") return { status: "invalid_internal_input" };
    const accounting = await ensureGasAccounting(ctx, policy, now, { persist: false });
    if (!accounting.ok) return { status: "invalid_internal_input" };
    try {
      assertValidGasPolicyState(accounting.snapshot.policy);
      if (
        !accounting.snapshot.policy.enabled ||
        accounting.snapshot.policy.network !== GAS_NETWORK ||
        !accounting.snapshot.policy.allowedContractIds.includes(existing.targetContractIds[0]!) ||
        accounting.snapshot.effectiveUsageStroops > accounting.snapshot.policy.dailyCapStroops ||
        existing.approvedHoldStroops > accounting.snapshot.policy.dailyCapStroops ||
        accounting.snapshot.effectiveUsageStroops < existing.approvedHoldStroops
      ) {
        return { status: "policy_denied" };
      }
    } catch {
      return { status: "invalid_internal_input" };
    }

    const relayer = await findRelayer(ctx, args.projectId);
    if (
      relayer === null ||
      relayer === "ambiguous" ||
      relayer.status !== "active" ||
      relayer.network !== GAS_NETWORK ||
      relayer.publicKey !== existing.relayerPublicKey ||
      relayer.publicKey !== normalized.expectedRelayerPublicKey
    ) {
      return { status: "relayer_unavailable" };
    }

    const leaseToken = crypto.randomUUID();
    const leaseExpiresAt = Math.min(now + LEASE_MS, existing.reservationExpiresAt);
    if (!isValidTimestamp(leaseExpiresAt) || leaseExpiresAt <= now) {
      return { status: "reservation_expired" };
    }
    const nextLifecycle =
      existing.outerTransactionHash === undefined
        ? GAS_LIFECYCLE_STATES.claimed
        : GAS_LIFECYCLE_STATES.submissionUnknown;
    const nextGeneration = existing.leaseGeneration + 1;
    if (!Number.isSafeInteger(nextGeneration)) return { status: "invalid_internal_input" };

    const audit = await findClaimAuditLog(ctx, args.projectId, existing.requestId);
    if (audit === "ambiguous") return { status: "invalid_internal_input" };
    if (audit !== null && !validateClaimAuditLog(audit, existing)) {
      return { status: "invalid_lifecycle" };
    }

    await ctx.db.patch(existing._id, {
      lifecycle: nextLifecycle,
      leaseToken,
      leaseGeneration: nextGeneration,
      leaseExpiresAt,
      nextSendAt: undefined,
      updatedAt: now,
    });
    if (audit !== null) {
      await ctx.db.patch(audit._id, { lifecycle: nextLifecycle, updatedAt: now });
    }

    const recovered = await ctx.db.get("gasExecutionAttempts", existing._id);
    if (!recovered) return { status: "resource_not_found" };
    return claimResult(recovered, false, true);
  },
});

function isValidTimestamp(value: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    value > 0 &&
    Number.isFinite(value) &&
    Number.isFinite(new Date(value).getTime())
  );
}

function findClaimAuditLog(
  ctx: MutationCtx,
  projectId: Doc<"projects">["_id"],
  requestId: string,
): Promise<Doc<"gasLogs"> | null | "ambiguous"> {
  return findReservation(ctx, projectId, requestId);
}

function validateClaimAuditLog(log: Doc<"gasLogs">, attempt: Doc<"gasExecutionAttempts">): boolean {
  return (
    log.projectId === attempt.projectId &&
    log.requestId === attempt.requestId &&
    log.idempotencyKeyHash === attempt.idempotencyKeyHash &&
    log.requestFingerprint === attempt.requestFingerprint &&
    log.transactionHash === attempt.innerTransactionHash &&
    log.sourceWallet === attempt.sourceWallet &&
    log.targetContractIds?.length === attempt.targetContractIds.length &&
    log.targetContractIds?.every((target, index) => target === attempt.targetContractIds[index]) ===
      true &&
    log.innerMaxFeeStroops === attempt.innerMaxFeeStroops &&
    log.reservedStroops === attempt.originalReservationStroops &&
    log.decisionCode === "reserved" &&
    log.rejectionCode === undefined &&
    log.lifecycle === attempt.lifecycle &&
    log.expiresAt === attempt.reservationExpiresAt &&
    log.actualFeeStroops === undefined
  );
}

function validateExecutionAttempt(attempt: Doc<"gasExecutionAttempts">): boolean {
  const terminal =
    attempt.lifecycle === GAS_LIFECYCLE_STATES.succeeded ||
    attempt.lifecycle === GAS_LIFECYCLE_STATES.failed ||
    attempt.lifecycle === GAS_LIFECYCLE_STATES.cancelled ||
    attempt.lifecycle === GAS_LIFECYCLE_STATES.expired;
  if (
    attempt.network !== GAS_NETWORK ||
    !isSha256Hash(attempt.idempotencyKeyHash) ||
    !isSha256Hash(attempt.requestFingerprint) ||
    !isSha256Hash(attempt.innerTransactionHash) ||
    attempt.targetContractIds.length !== 1 ||
    attempt.leaseGeneration < 1 ||
    !Number.isSafeInteger(attempt.leaseGeneration) ||
    !Number.isSafeInteger(attempt.sendCount) ||
    attempt.sendCount < 0 ||
    attempt.sendCount > GAS_MAX_SEND_COUNT ||
    !isValidTimestamp(attempt.reservationCreatedAt) ||
    !isValidTimestamp(attempt.reservationExpiresAt) ||
    attempt.reservationExpiresAt <= attempt.reservationCreatedAt ||
    attempt.accountingDayKey !== utcDayKey(attempt.reservationCreatedAt) ||
    !isValidTimestamp(attempt.nextCheckAt) ||
    (attempt.nextSendAt !== undefined && !isValidTimestamp(attempt.nextSendAt)) ||
    (attempt.actualFeeStroops !== undefined) !== (attempt.settledAt !== undefined) ||
    (attempt.settledAt !== undefined && (!terminal || !isValidTimestamp(attempt.settledAt)))
  ) {
    return false;
  }

  try {
    const innerMaxFeeStroops = assertValidStroopValue(attempt.innerMaxFeeStroops);
    const originalReservationStroops = assertValidStroopValue(attempt.originalReservationStroops);
    const approvedHoldStroops = assertValidStroopValue(attempt.approvedHoldStroops);
    const feeCeilingStroops = assertValidStroopValue(attempt.feeCeilingStroops);
    if (
      normalizeGasRequestId(attempt.requestId) !== attempt.requestId ||
      normalizeWalletAddress(attempt.sourceWallet) !== attempt.sourceWallet ||
      normalizeContractId(attempt.targetContractIds[0]!) !== attempt.targetContractIds[0] ||
      normalizeRelayerPublicKey(attempt.relayerPublicKey) !== attempt.relayerPublicKey ||
      addStroopValues(innerMaxFeeStroops, GAS_FEE_OVERHEAD_STROOPS) !==
        originalReservationStroops ||
      approvedHoldStroops !== feeCeilingStroops ||
      approvedHoldStroops < originalReservationStroops
    ) {
      return false;
    }

    if (attempt.sendCount === 0) {
      if (attempt.settledAt !== undefined) {
        return (
          (attempt.lifecycle === GAS_LIFECYCLE_STATES.cancelled ||
            attempt.lifecycle === GAS_LIFECYCLE_STATES.expired) &&
          attempt.outerTransactionHash === undefined &&
          attempt.outerFeeStroops === undefined &&
          attempt.firstPossibleSendAt === undefined &&
          attempt.reconciliationDeadlineAt === undefined &&
          attempt.latestSendClassification === undefined &&
          attempt.nextSendAt === undefined &&
          attempt.reconciliationLeaseToken === undefined &&
          attempt.reconciliationLeaseExpiresAt === undefined &&
          attempt.reconciliationLastOutcome === undefined &&
          attempt.actualFeeStroops === 0n &&
          !attempt.reconciliationRequired
        );
      }
      return (
        attempt.lifecycle === GAS_LIFECYCLE_STATES.claimed &&
        attempt.outerTransactionHash === undefined &&
        attempt.outerFeeStroops === undefined &&
        attempt.firstPossibleSendAt === undefined &&
        attempt.reconciliationDeadlineAt === undefined &&
        attempt.latestSendClassification === undefined &&
        attempt.nextSendAt === undefined &&
        attempt.reconciliationLeaseToken === undefined &&
        attempt.reconciliationLeaseExpiresAt === undefined &&
        attempt.reconciliationLastOutcome === undefined &&
        !attempt.reconciliationRequired
      );
    }

    if (
      attempt.lifecycle !== GAS_LIFECYCLE_STATES.submissionUnknown &&
      attempt.lifecycle !== GAS_LIFECYCLE_STATES.submitted &&
      attempt.lifecycle !== GAS_LIFECYCLE_STATES.succeeded &&
      attempt.lifecycle !== GAS_LIFECYCLE_STATES.failed &&
      attempt.lifecycle !== GAS_LIFECYCLE_STATES.cancelled
    ) {
      return false;
    }
    if (
      attempt.outerTransactionHash === undefined ||
      attempt.outerFeeStroops === undefined ||
      !isSha256Hash(attempt.outerTransactionHash) ||
      attempt.outerFeeStroops < 1n ||
      attempt.outerFeeStroops > feeCeilingStroops ||
      attempt.firstPossibleSendAt === undefined ||
      !isValidTimestamp(attempt.firstPossibleSendAt) ||
      attempt.reconciliationDeadlineAt === undefined ||
      !isValidTimestamp(attempt.reconciliationDeadlineAt) ||
      attempt.reconciliationDeadlineAt < attempt.firstPossibleSendAt
    ) {
      return false;
    }
    if (attempt.settledAt !== undefined) {
      if (
        attempt.lifecycle !== GAS_LIFECYCLE_STATES.succeeded &&
        attempt.lifecycle !== GAS_LIFECYCLE_STATES.failed
      ) {
        return false;
      }
      if (attempt.verifiedLedgerEvidence === undefined) return false;
    }
    return true;
  } catch {
    return false;
  }
}

type GasRetryableClassification = { status: string; reason?: string } | undefined;

function isRetryableSendClassification(classification: GasRetryableClassification): boolean {
  return (
    classification?.status === "retry_later" ||
    (classification?.status === "unknown" &&
      (classification.reason === "timeout" || classification.reason === "transport_failure"))
  );
}

function isRecoverableAttempt(attempt: Doc<"gasExecutionAttempts">, now: number): boolean {
  if (attempt.verifiedLedgerEvidence !== undefined) return false;
  if (attempt.leaseExpiresAt !== undefined && attempt.leaseExpiresAt > now) return false;
  if (attempt.sendCount === 0) {
    return (
      attempt.lifecycle === GAS_LIFECYCLE_STATES.claimed &&
      attempt.outerTransactionHash === undefined
    );
  }
  return (
    attempt.lifecycle === GAS_LIFECYCLE_STATES.submissionUnknown &&
    attempt.outerTransactionHash !== undefined &&
    attempt.outerFeeStroops !== undefined &&
    attempt.sendCount < GAS_MAX_SEND_COUNT &&
    (attempt.latestSendClassification === undefined ||
      isRetryableSendClassification(attempt.latestSendClassification))
  );
}

type GasSendClassificationInput =
  | { status: "pending"; outerTransactionHash: string; sendCount: number }
  | { status: "duplicate"; outerTransactionHash: string; sendCount: number }
  | { status: "retry_later"; outerTransactionHash: string; sendCount: number }
  | {
      status: "rejected";
      outerTransactionHash: string;
      sendCount: number;
      resultCode?: string;
      innerResultCode?: string;
    }
  | {
      status: "unknown";
      outerTransactionHash: string;
      sendCount: number;
      reason: "timeout" | "transport_failure" | "malformed_response" | "hash_mismatch";
    };

function normalizedSendClassification(
  classification: GasSendClassificationInput,
): GasSendClassificationInput | null {
  if (
    !Number.isSafeInteger(classification.sendCount) ||
    classification.sendCount < 1 ||
    !isSha256Hash(classification.outerTransactionHash)
  ) {
    return null;
  }

  try {
    const outerTransactionHash = normalizeTransactionHash(classification.outerTransactionHash);
    if (classification.status === "rejected") {
      if (
        classification.resultCode !== undefined &&
        (!RESULT_CODE_PATTERN.test(classification.resultCode) ||
          new TextEncoder().encode(classification.resultCode).byteLength > 64)
      ) {
        return null;
      }
      if (
        classification.innerResultCode !== undefined &&
        (!RESULT_CODE_PATTERN.test(classification.innerResultCode) ||
          new TextEncoder().encode(classification.innerResultCode).byteLength > 64)
      ) {
        return null;
      }
      return {
        status: classification.status,
        outerTransactionHash,
        sendCount: classification.sendCount,
        ...(classification.resultCode === undefined
          ? {}
          : { resultCode: classification.resultCode }),
        ...(classification.innerResultCode === undefined
          ? {}
          : { innerResultCode: classification.innerResultCode }),
      };
    }
    if (classification.status === "unknown") {
      if (classification.reason === undefined) return null;
      return {
        status: classification.status,
        outerTransactionHash,
        sendCount: classification.sendCount,
        reason: classification.reason,
      };
    }
    return {
      status: classification.status,
      outerTransactionHash,
      sendCount: classification.sendCount,
    };
  } catch {
    return null;
  }
}

function storedSendClassification(
  classification: NonNullable<ReturnType<typeof normalizedSendClassification>>,
  recordedAt: number,
) {
  return {
    ...classification,
    recordedAt,
  };
}

function sameSendClassification(
  stored: NonNullable<Doc<"gasExecutionAttempts">["latestSendClassification"]>,
  next: NonNullable<ReturnType<typeof normalizedSendClassification>>,
): boolean {
  if (
    stored.status !== next.status ||
    stored.outerTransactionHash !== next.outerTransactionHash ||
    stored.sendCount !== next.sendCount
  ) {
    return false;
  }
  if (stored.status === "rejected" && next.status === "rejected") {
    return stored.resultCode === next.resultCode && stored.innerResultCode === next.innerResultCode;
  }
  return (
    stored.status !== "unknown" || (next.status === "unknown" && stored.reason === next.reason)
  );
}

type GasSequenceDiagnosisEvidence = {
  outerTransactionHash: string;
  innerTransactionHash: string;
  feeSource: string;
  feeStroops: bigint;
  ledger: number;
  resultCode: string;
  innerResultCode?: string;
};

type GasSequenceDiagnosisInput = {
  lookupClassification:
    | "found"
    | "not_found"
    | "unavailable"
    | "malformed_response"
    | "wrong_network";
  evidence?: GasSequenceDiagnosisEvidence;
};

type NormalizedGasSequenceDiagnosis = {
  disposition: GasSequenceDiagnosisDisposition;
  lookupClassification: GasSequenceDiagnosisInput["lookupClassification"];
  evidence?: GasSequenceDiagnosisEvidence;
};

export type GasSequenceDiagnosisResult =
  | {
      status: "recorded";
      disposition: GasSequenceDiagnosisDisposition;
      idempotent: boolean;
    }
  | { status: "invalid_internal_input" }
  | { status: "resource_not_found" }
  | { status: "invalid_lifecycle" };

export const gasSequenceDiagnosisResultValidator = v.union(
  v.object({
    status: v.literal("recorded"),
    disposition: v.union(
      v.literal(GAS_SEQUENCE_DIAGNOSIS_DISPOSITIONS.unresolved),
      v.literal(GAS_SEQUENCE_DIAGNOSIS_DISPOSITIONS.ledgerObserved),
      v.literal(GAS_SEQUENCE_DIAGNOSIS_DISPOSITIONS.clientRebuildRequired),
    ),
    idempotent: v.boolean(),
  }),
  v.object({ status: v.literal("invalid_internal_input") }),
  v.object({ status: v.literal("resource_not_found") }),
  v.object({ status: v.literal("invalid_lifecycle") }),
);

function normalizedSequenceDiagnosis(
  diagnosis: GasSequenceDiagnosisInput,
  attempt: Doc<"gasExecutionAttempts">,
): NormalizedGasSequenceDiagnosis | null {
  if (diagnosis.lookupClassification !== "found") {
    return {
      disposition: GAS_SEQUENCE_DIAGNOSIS_DISPOSITIONS.unresolved,
      lookupClassification: diagnosis.lookupClassification,
    };
  }

  if (diagnosis.evidence === undefined) {
    return {
      disposition: GAS_SEQUENCE_DIAGNOSIS_DISPOSITIONS.unresolved,
      lookupClassification: diagnosis.lookupClassification,
    };
  }

  try {
    const evidence = diagnosis.evidence;
    if (
      !Number.isSafeInteger(evidence.ledger) ||
      evidence.ledger <= 0 ||
      !RESULT_CODE_PATTERN.test(evidence.resultCode) ||
      (evidence.innerResultCode !== undefined &&
        !RESULT_CODE_PATTERN.test(evidence.innerResultCode)) ||
      new TextEncoder().encode(evidence.resultCode).byteLength > 64 ||
      (evidence.innerResultCode !== undefined &&
        new TextEncoder().encode(evidence.innerResultCode).byteLength > 64)
    ) {
      return {
        disposition: GAS_SEQUENCE_DIAGNOSIS_DISPOSITIONS.unresolved,
        lookupClassification: diagnosis.lookupClassification,
      };
    }

    const outerTransactionHash = normalizeTransactionHash(evidence.outerTransactionHash);
    const innerTransactionHash = normalizeTransactionHash(evidence.innerTransactionHash);
    const feeSource = normalizeRelayerPublicKey(evidence.feeSource);
    const feeStroops = assertValidStroopValue(evidence.feeStroops);
    if (
      outerTransactionHash !== attempt.outerTransactionHash ||
      innerTransactionHash !== attempt.innerTransactionHash ||
      feeSource !== attempt.relayerPublicKey ||
      feeStroops > attempt.feeCeilingStroops
    ) {
      return {
        disposition: GAS_SEQUENCE_DIAGNOSIS_DISPOSITIONS.unresolved,
        lookupClassification: diagnosis.lookupClassification,
      };
    }

    const normalizedEvidence: GasSequenceDiagnosisEvidence = {
      outerTransactionHash,
      innerTransactionHash,
      feeSource,
      feeStroops,
      ledger: evidence.ledger,
      resultCode: evidence.resultCode,
      ...(evidence.innerResultCode === undefined
        ? {}
        : { innerResultCode: evidence.innerResultCode }),
    };
    return {
      disposition:
        evidence.innerResultCode === "txBadSeq"
          ? GAS_SEQUENCE_DIAGNOSIS_DISPOSITIONS.clientRebuildRequired
          : GAS_SEQUENCE_DIAGNOSIS_DISPOSITIONS.ledgerObserved,
      lookupClassification: diagnosis.lookupClassification,
      evidence: normalizedEvidence,
    };
  } catch {
    return {
      disposition: GAS_SEQUENCE_DIAGNOSIS_DISPOSITIONS.unresolved,
      lookupClassification: diagnosis.lookupClassification,
    };
  }
}

function sameSequenceDiagnosis(
  stored: NonNullable<Doc<"gasExecutionAttempts">["sequenceDiagnosis"]>,
  next: NormalizedGasSequenceDiagnosis,
): boolean {
  if (
    stored.disposition !== next.disposition ||
    stored.lookupClassification !== next.lookupClassification
  ) {
    return false;
  }
  const storedEvidence = stored.evidence;
  const nextEvidence = next.evidence;
  if (storedEvidence === undefined || nextEvidence === undefined) {
    return storedEvidence === undefined && nextEvidence === undefined;
  }
  return (
    storedEvidence.outerTransactionHash === nextEvidence.outerTransactionHash &&
    storedEvidence.innerTransactionHash === nextEvidence.innerTransactionHash &&
    storedEvidence.feeSource === nextEvidence.feeSource &&
    storedEvidence.feeStroops === nextEvidence.feeStroops &&
    storedEvidence.ledger === nextEvidence.ledger &&
    storedEvidence.resultCode === nextEvidence.resultCode &&
    storedEvidence.innerResultCode === nextEvidence.innerResultCode
  );
}

/** Persist one fenced, sanitized diagnosis of an inner bad-sequence rejection. */
export const recordSequenceDiagnosis = internalMutation({
  args: {
    executionAttemptId: v.id("gasExecutionAttempts"),
    projectId: v.id("projects"),
    outerTransactionHash: v.string(),
    sendCount: v.number(),
    leaseToken: v.string(),
    leaseGeneration: v.number(),
    diagnosis: gasSequenceDiagnosisInputValidator,
  },
  returns: gasSequenceDiagnosisResultValidator,
  handler: async (ctx, args): Promise<GasSequenceDiagnosisResult> => {
    const attempt = await ctx.db.get("gasExecutionAttempts", args.executionAttemptId);
    if (!attempt) return { status: "resource_not_found" };

    let outerTransactionHash: string;
    try {
      outerTransactionHash = normalizeTransactionHash(args.outerTransactionHash);
    } catch {
      return { status: "invalid_internal_input" };
    }

    if (
      attempt.projectId !== args.projectId ||
      attempt.lifecycle !== GAS_LIFECYCLE_STATES.submissionUnknown ||
      attempt.outerTransactionHash !== outerTransactionHash ||
      attempt.sendCount !== args.sendCount ||
      attempt.leaseToken !== args.leaseToken ||
      attempt.leaseGeneration !== args.leaseGeneration ||
      attempt.latestSendClassification?.status !== "rejected" ||
      attempt.latestSendClassification.innerResultCode !== "txBadSeq"
    ) {
      return { status: "invalid_lifecycle" };
    }

    const normalized = normalizedSequenceDiagnosis(args.diagnosis, attempt);
    if (normalized === null) return { status: "invalid_internal_input" };

    if (attempt.sequenceDiagnosis !== undefined) {
      return sameSequenceDiagnosis(attempt.sequenceDiagnosis, normalized)
        ? {
            status: "recorded",
            disposition: attempt.sequenceDiagnosis.disposition,
            idempotent: true,
          }
        : { status: "invalid_lifecycle" };
    }

    const recordedAt = Date.now();
    if (!isValidTimestamp(recordedAt)) return { status: "invalid_internal_input" };
    await ctx.db.patch(attempt._id, {
      sequenceDiagnosis: {
        ...normalized,
        recordedAt,
      },
      updatedAt: recordedAt,
    });

    return {
      status: "recorded",
      disposition: normalized.disposition,
      idempotent: false,
    };
  },
});

/**
 * Atomically authorizes exactly one send for a live claimed attempt. The
 * authorization record is the durable send boundary: transport is not called
 * unless this mutation commits successfully.
 */
export const authorizeSend = internalMutation({
  args: {
    apiKeyId: v.id("apiKeys"),
    projectId: v.id("projects"),
    apiKeyHash: v.string(),
    executionAttemptId: v.id("gasExecutionAttempts"),
    network: gasNetworkValidator,
    operation: v.string(),
    requestId: v.string(),
    requestFingerprint: v.string(),
    innerTransactionHash: v.string(),
    sourceWallet: v.string(),
    targetContractIds: v.array(v.string()),
    innerMaxFeeStroops: v.int64(),
    innerMaxTime: v.optional(v.number()),
    outerTransactionHash: v.string(),
    outerFeeStroops: v.int64(),
    feeSource: v.string(),
    leaseToken: v.string(),
    leaseGeneration: v.number(),
    expectedSendCount: v.number(),
  },
  returns: gasSendAuthorizationResultValidator,
  handler: async (ctx, args): Promise<GasSendAuthorizationResult> => {
    if (!(await revalidateGasApiKeyScope(ctx, args))) return { status: "unauthorized" };

    let normalized: {
      requestId: string;
      requestFingerprint: string;
      innerTransactionHash: string;
      sourceWallet: string;
      targetContractIds: string[];
      innerMaxFeeStroops: bigint;
      innerMaxTime?: number;
      outerTransactionHash: string;
      outerFeeStroops: bigint;
      feeSource: string;
    };
    try {
      if (
        args.network !== GAS_NETWORK ||
        args.operation !== GAS_SUPPORTED_OPERATION ||
        !isSha256Hash(args.apiKeyHash) ||
        !isSha256Hash(args.requestFingerprint) ||
        !isSha256Hash(args.innerTransactionHash) ||
        !isSha256Hash(args.outerTransactionHash)
      ) {
        return { status: "invalid_internal_input" };
      }
      normalized = {
        requestId: normalizeGasRequestId(args.requestId),
        requestFingerprint: args.requestFingerprint,
        innerTransactionHash: normalizeTransactionHash(args.innerTransactionHash),
        sourceWallet: normalizeWalletAddress(args.sourceWallet),
        targetContractIds: args.targetContractIds.map(normalizeContractId),
        innerMaxFeeStroops: assertValidStroopValue(args.innerMaxFeeStroops),
        ...(args.innerMaxTime === undefined
          ? {}
          : { innerMaxTime: assertValidInnerMaxTime(args.innerMaxTime) }),
        outerTransactionHash: normalizeTransactionHash(args.outerTransactionHash),
        outerFeeStroops: assertValidStroopValue(args.outerFeeStroops),
        feeSource: normalizeRelayerPublicKey(args.feeSource),
      };
      if (normalized.targetContractIds.length !== 1) {
        return { status: "invalid_internal_input" };
      }
    } catch {
      return { status: "invalid_internal_input" };
    }

    const attempt = await ctx.db.get("gasExecutionAttempts", args.executionAttemptId);
    if (!attempt) return { status: "resource_not_found" };
    if (attempt.projectId !== args.projectId) return { status: "invalid_lifecycle" };

    const now = Date.now();
    if (!validateExecutionAttempt(attempt)) return { status: "invalid_internal_input" };
    if (attempt.verifiedLedgerEvidence !== undefined) return { status: "invalid_lifecycle" };
    if (attempt.reservationExpiresAt <= now) return { status: "reservation_expired" };
    if (
      !Number.isSafeInteger(args.expectedSendCount) ||
      args.expectedSendCount < 0 ||
      args.expectedSendCount >= GAS_MAX_SEND_COUNT ||
      attempt.sendCount !== args.expectedSendCount
    ) {
      return { status: "invalid_lifecycle" };
    }
    if (
      attempt.requestId !== normalized.requestId ||
      attempt.requestFingerprint !== normalized.requestFingerprint ||
      attempt.innerTransactionHash !== normalized.innerTransactionHash ||
      attempt.sourceWallet !== normalized.sourceWallet ||
      attempt.targetContractIds.length !== normalized.targetContractIds.length ||
      attempt.targetContractIds.some(
        (target, index) => target !== normalized.targetContractIds[index],
      ) ||
      attempt.innerMaxFeeStroops !== normalized.innerMaxFeeStroops ||
      normalized.feeSource !== attempt.relayerPublicKey
    ) {
      return { status: "invalid_lifecycle" };
    }
    if (
      !hasLiveGasExecutionFence(
        attempt,
        { leaseToken: args.leaseToken, leaseGeneration: args.leaseGeneration },
        now,
      )
    ) {
      return { status: "invalid_lifecycle" };
    }

    if (
      args.expectedSendCount === 0
        ? attempt.lifecycle !== GAS_LIFECYCLE_STATES.claimed ||
          attempt.outerTransactionHash !== undefined ||
          attempt.outerFeeStroops !== undefined
        : attempt.lifecycle !== GAS_LIFECYCLE_STATES.submissionUnknown ||
          attempt.outerTransactionHash !== normalized.outerTransactionHash ||
          attempt.outerFeeStroops !== normalized.outerFeeStroops ||
          (attempt.latestSendClassification !== undefined &&
            !isRetryableSendClassification(attempt.latestSendClassification))
    ) {
      return { status: "invalid_lifecycle" };
    }
    if (attempt.nextSendAt !== undefined && attempt.nextSendAt > now) {
      return { status: "not_due", nextSendAt: attempt.nextSendAt };
    }

    try {
      if (
        reservationExpiryForClaim(attempt.reservationCreatedAt, normalized.innerMaxTime) !==
        attempt.reservationExpiresAt
      ) {
        return { status: "invalid_lifecycle" };
      }
      if (normalized.outerFeeStroops <= 0n) return { status: "invalid_internal_input" };
      if (normalized.outerFeeStroops > attempt.feeCeilingStroops) {
        return { status: "policy_denied" };
      }
    } catch {
      return { status: "invalid_internal_input" };
    }

    const audit = await findClaimAuditLog(ctx, args.projectId, normalized.requestId);
    if (audit === "ambiguous") return { status: "invalid_internal_input" };
    if (audit !== null && !validateClaimAuditLog(audit, attempt)) {
      return { status: "invalid_lifecycle" };
    }

    const policy = await findPolicy(ctx, args.projectId);
    if (policy === null || policy === "ambiguous") return { status: "invalid_internal_input" };
    const accounting = await ensureGasAccounting(ctx, policy, now, { persist: false });
    if (!accounting.ok) return { status: "invalid_internal_input" };
    try {
      assertValidGasPolicyState(accounting.snapshot.policy);
      const approvedHoldStroops = assertValidStroopValue(attempt.approvedHoldStroops);
      if (
        !accounting.snapshot.policy.enabled ||
        accounting.snapshot.policy.network !== GAS_NETWORK ||
        !accounting.snapshot.policy.allowedContractIds.includes(normalized.targetContractIds[0]!) ||
        accounting.snapshot.effectiveUsageStroops > accounting.snapshot.policy.dailyCapStroops ||
        approvedHoldStroops > accounting.snapshot.policy.dailyCapStroops ||
        accounting.snapshot.effectiveUsageStroops < approvedHoldStroops
      ) {
        return { status: "policy_denied" };
      }
    } catch {
      return { status: "invalid_internal_input" };
    }

    const relayer = await findRelayer(ctx, args.projectId);
    if (
      relayer === null ||
      relayer === "ambiguous" ||
      relayer.status !== "active" ||
      relayer.network !== GAS_NETWORK ||
      relayer.publicKey !== attempt.relayerPublicKey
    ) {
      return { status: "relayer_unavailable" };
    }

    // Persist a possible external send only after every trusted fact has
    // passed. Persisting the lazy accounting rollover here keeps the policy
    // counter and the send-boundary record in the same Convex transaction.
    const persistedAccounting = await ensureGasAccounting(ctx, policy, now, { persist: true });
    if (!persistedAccounting.ok) return { status: "invalid_internal_input" };
    const firstPossibleSendAt = attempt.firstPossibleSendAt ?? now;
    const reconciliationDeadlineAt =
      attempt.reconciliationDeadlineAt ?? now + RECONCILIATION_WINDOW_MS;
    if (!Number.isSafeInteger(reconciliationDeadlineAt)) {
      return { status: "invalid_internal_input" };
    }
    if (!isValidTimestamp(firstPossibleSendAt) || reconciliationDeadlineAt < firstPossibleSendAt) {
      return { status: "invalid_internal_input" };
    }

    await ctx.db.patch(attempt._id, {
      ...(attempt.outerTransactionHash === undefined
        ? {
            outerTransactionHash: normalized.outerTransactionHash,
            outerFeeStroops: normalized.outerFeeStroops,
          }
        : {}),
      lifecycle: GAS_LIFECYCLE_STATES.submissionUnknown,
      sendCount: args.expectedSendCount + 1,
      nextCheckAt: attempt.nextCheckAt,
      nextSendAt: undefined,
      firstPossibleSendAt,
      reconciliationDeadlineAt,
      updatedAt: now,
    });
    if (audit !== null) {
      await ctx.db.patch(audit._id, {
        lifecycle: GAS_LIFECYCLE_STATES.submissionUnknown,
        updatedAt: now,
      });
    }

    return {
      status: "authorized",
      outerTransactionHash: normalized.outerTransactionHash,
      outerFeeStroops: normalized.outerFeeStroops,
      sendCount: args.expectedSendCount + 1,
      firstPossibleSendAt,
      reconciliationDeadlineAt,
    };
  },
});

/** Record one sanitized adapter classification under the pinned send fence. */
export const recordSendOutcome = internalMutation({
  args: {
    executionAttemptId: v.id("gasExecutionAttempts"),
    projectId: v.id("projects"),
    outerTransactionHash: v.string(),
    sendCount: v.number(),
    leaseToken: v.string(),
    leaseGeneration: v.number(),
    nextSendAt: v.optional(v.number()),
    classification: gasSendClassificationInputValidator,
  },
  returns: gasSendOutcomeResultValidator,
  handler: async (ctx, args): Promise<GasSendOutcomeResult> => {
    const classification = normalizedSendClassification(args.classification);
    if (classification === null) return { status: "invalid_internal_input" };

    let outerTransactionHash: string;
    try {
      outerTransactionHash = normalizeTransactionHash(args.outerTransactionHash);
    } catch {
      return { status: "invalid_internal_input" };
    }

    const attempt = await ctx.db.get("gasExecutionAttempts", args.executionAttemptId);
    if (!attempt) return { status: "resource_not_found" };
    const now = Date.now();
    if (!validateExecutionAttempt(attempt)) return { status: "invalid_internal_input" };
    if (attempt.verifiedLedgerEvidence !== undefined) return { status: "invalid_lifecycle" };
    if (
      attempt.projectId !== args.projectId ||
      attempt.outerTransactionHash !== outerTransactionHash ||
      attempt.sendCount !== args.sendCount ||
      attempt.leaseToken !== args.leaseToken ||
      attempt.leaseGeneration !== args.leaseGeneration ||
      classification.outerTransactionHash !== outerTransactionHash ||
      classification.sendCount !== args.sendCount ||
      attempt.outerFeeStroops === undefined ||
      attempt.firstPossibleSendAt === undefined ||
      attempt.reconciliationDeadlineAt === undefined
    ) {
      return { status: "invalid_lifecycle" };
    }

    if (
      attempt.latestSendClassification !== undefined &&
      sameSendClassification(attempt.latestSendClassification, classification)
    ) {
      return {
        status: "recorded",
        lifecycle:
          attempt.lifecycle === GAS_LIFECYCLE_STATES.submitted
            ? GAS_LIFECYCLE_STATES.submitted
            : GAS_LIFECYCLE_STATES.submissionUnknown,
        sendCount: attempt.sendCount,
        idempotent: true,
        execution: projectGasExecutionAttempt({
          requestId: attempt.requestId,
          innerTransactionHash: attempt.innerTransactionHash,
          outerTransactionHash: attempt.outerTransactionHash,
          lifecycle: attempt.lifecycle,
          approvedHoldStroops: attempt.approvedHoldStroops,
          actualFeeStroops: attempt.actualFeeStroops,
          reservationExpiresAt: attempt.reservationExpiresAt,
          reconciliationRequired: attempt.reconciliationRequired,
        }),
      };
    }

    if (
      attempt.latestSendClassification !== undefined &&
      attempt.latestSendClassification.sendCount === args.sendCount
    ) {
      return { status: "invalid_lifecycle" };
    }

    if (
      attempt.lifecycle !== GAS_LIFECYCLE_STATES.submissionUnknown ||
      !hasLiveGasExecutionFence(
        attempt,
        { leaseToken: args.leaseToken, leaseGeneration: args.leaseGeneration },
        now,
      )
    ) {
      return { status: "invalid_lifecycle" };
    }

    const becomesSubmitted =
      classification.status === "pending" || classification.status === "duplicate";
    const retryable = isRetryableSendClassification(classification);
    const shouldRetry = retryable && args.sendCount < GAS_MAX_SEND_COUNT;
    if (shouldRetry) {
      if (
        args.nextSendAt === undefined ||
        !isValidTimestamp(args.nextSendAt) ||
        args.nextSendAt <= now
      ) {
        return { status: "invalid_internal_input" };
      }
    } else if (args.nextSendAt !== undefined) {
      return { status: "invalid_internal_input" };
    }

    const nextLifecycle = becomesSubmitted
      ? GAS_LIFECYCLE_STATES.submitted
      : GAS_LIFECYCLE_STATES.submissionUnknown;
    const nextClassification = storedSendClassification(classification, now);
    const reconciliationRequired =
      attempt.reconciliationRequired ||
      classification.status === "unknown" ||
      (retryable && !shouldRetry);
    const nextCheckAt = classification.status === "unknown" ? now : (args.nextSendAt ?? now);
    const audit = await findClaimAuditLog(ctx, args.projectId, attempt.requestId);
    if (audit === "ambiguous") return { status: "invalid_internal_input" };
    if (
      audit !== null &&
      audit.lifecycle !== GAS_LIFECYCLE_STATES.submissionUnknown &&
      audit.lifecycle !== GAS_LIFECYCLE_STATES.submitted
    ) {
      return { status: "invalid_lifecycle" };
    }

    await ctx.db.patch(attempt._id, {
      lifecycle: nextLifecycle,
      latestSendClassification: nextClassification,
      nextSendAt: shouldRetry ? args.nextSendAt : undefined,
      nextCheckAt,
      reconciliationRequired,
      updatedAt: now,
    });
    if (audit !== null) {
      await ctx.db.patch(audit._id, { lifecycle: nextLifecycle, updatedAt: now });
    }

    return {
      status: "recorded",
      lifecycle: nextLifecycle,
      sendCount: attempt.sendCount,
      idempotent: false,
      execution: projectGasExecutionAttempt({
        requestId: attempt.requestId,
        innerTransactionHash: attempt.innerTransactionHash,
        outerTransactionHash: attempt.outerTransactionHash,
        lifecycle: nextLifecycle,
        approvedHoldStroops: attempt.approvedHoldStroops,
        actualFeeStroops: attempt.actualFeeStroops,
        reservationExpiresAt: attempt.reservationExpiresAt,
        reconciliationRequired,
      }),
    };
  },
});

const MAX_RECOVERY_BATCH = 25;

function normalizeRecoveryLimit(value: number | undefined): number {
  if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
    throw new Error("Gas recovery batch size must be a positive safe integer");
  }
  return Math.min(value ?? MAX_RECOVERY_BATCH, MAX_RECOVERY_BATCH);
}

/**
 * Recover expired execution leases in bounded pages. A zero-send attempt can
 * expire only when its durable record proves no send was possible; pinned or
 * otherwise uncertain attempts retain their exposure for reconciliation.
 */
export const recoverAbandoned = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = normalizeRecoveryLimit(args.limit);
    const now = Date.now();
    const claimed = await ctx.db
      .query("gasExecutionAttempts")
      .withIndex("by_lifecycle_and_lease_expires_at", (q) =>
        q.eq("lifecycle", GAS_LIFECYCLE_STATES.claimed).lte("leaseExpiresAt", now),
      )
      .filter((q) => q.neq(q.field("leaseExpiresAt"), undefined))
      .take(limit);
    const remaining = limit - claimed.length;
    const unresolved =
      remaining === 0
        ? []
        : await ctx.db
            .query("gasExecutionAttempts")
            .withIndex("by_lifecycle_and_lease_expires_at", (q) =>
              q.eq("lifecycle", GAS_LIFECYCLE_STATES.submissionUnknown).lte("leaseExpiresAt", now),
            )
            .filter((q) => q.neq(q.field("leaseExpiresAt"), undefined))
            .take(remaining);
    const expiredUnsent =
      limit - claimed.length - unresolved.length <= 0
        ? []
        : await ctx.db
            .query("gasExecutionAttempts")
            .withIndex("by_lifecycle_and_reservation_expires_at", (q) =>
              q.eq("lifecycle", GAS_LIFECYCLE_STATES.claimed).lte("reservationExpiresAt", now),
            )
            .take(limit - claimed.length - unresolved.length);
    const rows = Array.from(
      new Map(
        [...claimed, ...unresolved, ...expiredUnsent].map((attempt) => [attempt._id, attempt]),
      ).values(),
    ).slice(0, limit);

    for (const attempt of rows) {
      if (
        attempt.lifecycle === GAS_LIFECYCLE_STATES.claimed &&
        attempt.reservationExpiresAt <= now &&
        attempt.sendCount === 0 &&
        attempt.outerTransactionHash === undefined &&
        attempt.outerFeeStroops === undefined &&
        attempt.firstPossibleSendAt === undefined &&
        attempt.reconciliationDeadlineAt === undefined &&
        attempt.latestSendClassification === undefined &&
        attempt.nextSendAt === undefined &&
        attempt.reconciliationLeaseToken === undefined &&
        attempt.reconciliationLeaseExpiresAt === undefined &&
        attempt.reconciliationLastOutcome === undefined &&
        attempt.verifiedLedgerEvidence === undefined &&
        (attempt.leaseToken === undefined ||
          (attempt.leaseExpiresAt !== undefined && attempt.leaseExpiresAt <= now))
      ) {
        await expireGasUnsentExecutionAttempt(ctx, attempt._id, now);
        continue;
      }
      if (
        attempt.leaseExpiresAt === undefined ||
        attempt.leaseExpiresAt > now ||
        attempt.verifiedLedgerEvidence !== undefined ||
        !validateExecutionAttempt(attempt)
      ) {
        continue;
      }

      const pinned = attempt.outerTransactionHash !== undefined;
      const nextGeneration = attempt.leaseGeneration + 1;
      if (!Number.isSafeInteger(nextGeneration)) continue;

      const nextLifecycle = pinned
        ? GAS_LIFECYCLE_STATES.submissionUnknown
        : GAS_LIFECYCLE_STATES.claimed;
      await ctx.db.patch(attempt._id, {
        lifecycle: nextLifecycle,
        leaseToken: undefined,
        leaseExpiresAt: undefined,
        leaseGeneration: nextGeneration,
        ...(pinned
          ? {
              nextCheckAt: now,
              reconciliationRequired: true,
            }
          : {}),
        updatedAt: now,
      });

      const audit = await findClaimAuditLog(ctx, attempt.projectId, attempt.requestId);
      if (audit !== null && audit !== "ambiguous" && validateClaimAuditLog(audit, attempt)) {
        await ctx.db.patch(audit._id, { lifecycle: nextLifecycle, updatedAt: now });
      }
    }

    if (rows.length === limit) {
      await ctx.scheduler.runAfter(0, recoverAbandonedRef, { limit });
    }
    return rows.length;
  },
});
