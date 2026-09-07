import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

import { internalMutation } from "../_generated/server";
import { gasSubmitResultProjectionValidator, projectGasExecutionAttempt } from "./projections";
import { gasReconciliationOutcomeInputValidator } from "./schema";
import {
  GAS_RECONCILIATION_BATCH_LIMIT,
  GAS_RECONCILIATION_INITIAL_DELAY_MS,
  GAS_RECONCILIATION_LEASE_MS,
  GAS_RECONCILIATION_LOOKUP_CLASSIFICATIONS,
  GAS_RECONCILIATION_MAX_DELAY_MS,
  GAS_LIFECYCLE_STATES,
  GAS_NETWORK,
} from "./types";
import {
  assertValidStroopValue,
  normalizeContractId,
  normalizeGasRequestId,
  normalizeRelayerPublicKey,
  normalizeTransactionHash,
} from "./validation";

const SHA256_HASH_PATTERN = /^[a-f0-9]{64}$/;
const RESULT_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const RECONCILIATION_PARKED_NEXT_CHECK_AT = 8_640_000_000_000_000;

type ReconciliationAttempt = Doc<"gasExecutionAttempts">;
type ReconciliationContext = Pick<MutationCtx, "db">;

type ReconciliationClaim = {
  executionAttemptId: Id<"gasExecutionAttempts">;
  projectId: Id<"projects">;
  outerTransactionHash: string;
  reconciliationLeaseToken: string;
  reconciliationLeaseGeneration: number;
  pollCount: number;
};

export type GasReconciliationOperatorClaimResult =
  | { status: "claimed"; claim: ReconciliationClaim }
  | {
      status:
        | "resource_not_found"
        | "invalid_internal_input"
        | "invalid_lifecycle"
        | "not_exhausted"
        | "already_verified"
        | "already_claimed";
    };

const reconciliationClaimValidator = v.object({
  executionAttemptId: v.id("gasExecutionAttempts"),
  projectId: v.id("projects"),
  outerTransactionHash: v.string(),
  reconciliationLeaseToken: v.string(),
  reconciliationLeaseGeneration: v.number(),
  pollCount: v.number(),
});

const reconciliationOperatorClaimResultValidator = v.union(
  v.object({ status: v.literal("claimed"), claim: reconciliationClaimValidator }),
  v.object({ status: v.literal("resource_not_found") }),
  v.object({ status: v.literal("invalid_internal_input") }),
  v.object({ status: v.literal("invalid_lifecycle") }),
  v.object({ status: v.literal("not_exhausted") }),
  v.object({ status: v.literal("already_verified") }),
  v.object({ status: v.literal("already_claimed") }),
);

export type GasReconciliationClaim = ReconciliationClaim;

export type GasReconciliationOutcomeResult =
  | {
      status: "recorded";
      idempotent: boolean;
      verified: boolean;
      exhausted: boolean;
      execution: ReturnType<typeof projectGasExecutionAttempt>;
    }
  | { status: "invalid_internal_input" }
  | { status: "resource_not_found" }
  | { status: "invalid_lifecycle" };

export const gasReconciliationOutcomeResultValidator = v.union(
  v.object({
    status: v.literal("recorded"),
    idempotent: v.boolean(),
    verified: v.boolean(),
    exhausted: v.boolean(),
    execution: gasSubmitResultProjectionValidator,
  }),
  v.object({ status: v.literal("invalid_internal_input") }),
  v.object({ status: v.literal("resource_not_found") }),
  v.object({ status: v.literal("invalid_lifecycle") }),
);

function isValidTimestamp(value: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    value > 0 &&
    Number.isFinite(value) &&
    Number.isFinite(new Date(value).getTime())
  );
}

function isSha256Hash(value: string): boolean {
  return SHA256_HASH_PATTERN.test(value);
}

function normalizeLimit(value: number | undefined): number {
  if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
    throw new Error("Gas reconciliation batch size must be a positive safe integer");
  }
  return Math.min(value ?? GAS_RECONCILIATION_BATCH_LIMIT, GAS_RECONCILIATION_BATCH_LIMIT);
}

function isReconciliationLifecycle(lifecycle: ReconciliationAttempt["lifecycle"]): boolean {
  return (
    lifecycle === GAS_LIFECYCLE_STATES.submitted ||
    lifecycle === GAS_LIFECYCLE_STATES.submissionUnknown
  );
}

function hasActiveReconciliationLease(attempt: ReconciliationAttempt, now: number): boolean {
  return (
    attempt.reconciliationLeaseToken !== undefined &&
    attempt.reconciliationLeaseExpiresAt !== undefined &&
    attempt.reconciliationLeaseExpiresAt > now
  );
}

function validReconciliationAttempt(attempt: ReconciliationAttempt): boolean {
  if (
    attempt.network !== GAS_NETWORK ||
    !isReconciliationLifecycle(attempt.lifecycle) ||
    attempt.sendCount < 1 ||
    !Number.isSafeInteger(attempt.sendCount) ||
    attempt.outerTransactionHash === undefined ||
    attempt.outerFeeStroops === undefined ||
    attempt.firstPossibleSendAt === undefined ||
    attempt.reconciliationDeadlineAt === undefined ||
    !isValidTimestamp(attempt.firstPossibleSendAt) ||
    !isValidTimestamp(attempt.reconciliationDeadlineAt) ||
    attempt.reconciliationDeadlineAt < attempt.firstPossibleSendAt ||
    !isValidTimestamp(attempt.nextCheckAt) ||
    (attempt.reconciliationPollCount !== undefined &&
      (!Number.isSafeInteger(attempt.reconciliationPollCount) ||
        attempt.reconciliationPollCount < 0)) ||
    (attempt.reconciliationLeaseGeneration !== undefined &&
      (!Number.isSafeInteger(attempt.reconciliationLeaseGeneration) ||
        attempt.reconciliationLeaseGeneration < 0))
  ) {
    return false;
  }

  try {
    if (!isSha256Hash(attempt.outerTransactionHash)) return false;
    if (assertValidStroopValue(attempt.outerFeeStroops) <= 0n) return false;
    normalizeTransactionHash(attempt.innerTransactionHash);
    normalizeRelayerPublicKey(attempt.relayerPublicKey);
    if (attempt.targetContractIds.length !== 1) return false;
    normalizeContractId(attempt.targetContractIds[0]!);
    if (
      attempt.reconciliationLeaseToken === undefined &&
      attempt.reconciliationLeaseExpiresAt !== undefined
    ) {
      return false;
    }
    if (
      attempt.reconciliationLeaseToken !== undefined &&
      (attempt.reconciliationLeaseExpiresAt === undefined ||
        !isValidTimestamp(attempt.reconciliationLeaseExpiresAt))
    ) {
      return false;
    }
    if (
      attempt.reconciliationLeaseToken !== undefined &&
      attempt.reconciliationLeaseGeneration === undefined
    ) {
      return false;
    }
    if (
      attempt.reconciliationLastOutcome !== undefined &&
      (!isReconciliationOutcomeStatus(attempt.reconciliationLastOutcome.status) ||
        !isValidTimestamp(attempt.reconciliationLastOutcome.observedAt))
    ) {
      return false;
    }
    if (
      attempt.verifiedLedgerEvidence !== undefined &&
      !validStoredEvidence(attempt.verifiedLedgerEvidence, attempt)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function dueCandidates(
  ctx: ReconciliationContext,
  lifecycle: ReconciliationAttempt["lifecycle"],
  now: number,
  limit: number,
) {
  const base = () =>
    ctx.db
      .query("gasExecutionAttempts")
      .withIndex("by_lifecycle_and_next_check_at", (q) =>
        q.eq("lifecycle", lifecycle).lte("nextCheckAt", now),
      );

  return Promise.all([
    base()
      .filter((q) => q.eq(q.field("reconciliationLeaseToken"), undefined))
      .take(limit),
    base()
      .filter((q) => q.neq(q.field("reconciliationLeaseToken"), undefined))
      .filter((q) => q.lte(q.field("reconciliationLeaseExpiresAt"), now))
      .take(limit),
  ]).then(([unleased, expired]) => [...unleased, ...expired]);
}

function claimFromAttempt(
  attempt: ReconciliationAttempt,
  now: number,
  allowExhausted = false,
): ReconciliationClaim | null {
  if (
    !validReconciliationAttempt(attempt) ||
    attempt.outerTransactionHash === undefined ||
    attempt.firstPossibleSendAt === undefined ||
    attempt.reconciliationDeadlineAt === undefined ||
    (!allowExhausted && attempt.reconciliationDeadlineAt <= now) ||
    attempt.verifiedLedgerEvidence !== undefined ||
    hasActiveReconciliationLease(attempt, now)
  ) {
    return null;
  }

  const previousGeneration = attempt.reconciliationLeaseGeneration ?? 0;
  const reconciliationLeaseGeneration = previousGeneration + 1;
  const reconciliationLeaseExpiresAt = now + GAS_RECONCILIATION_LEASE_MS;
  const pollCount = (attempt.reconciliationPollCount ?? 0) + 1;
  if (
    !Number.isSafeInteger(reconciliationLeaseGeneration) ||
    !Number.isSafeInteger(pollCount) ||
    !isValidTimestamp(reconciliationLeaseExpiresAt)
  ) {
    return null;
  }

  return {
    executionAttemptId: attempt._id,
    projectId: attempt.projectId,
    outerTransactionHash: attempt.outerTransactionHash,
    reconciliationLeaseToken: crypto.randomUUID(),
    reconciliationLeaseGeneration,
    pollCount,
  };
}

/** Claim a bounded page of due, pinned attempts for independent reconciliation. */
export const claimDue = internalMutation({
  args: { limit: v.optional(v.number()) },
  returns: v.array(reconciliationClaimValidator),
  handler: async (ctx, args): Promise<ReconciliationClaim[]> => {
    const limit = normalizeLimit(args.limit);
    const now = Date.now();
    const submitted = await dueCandidates(ctx, GAS_LIFECYCLE_STATES.submitted, now, limit);
    const remaining = limit - submitted.length;
    const unknown =
      remaining > 0
        ? await dueCandidates(ctx, GAS_LIFECYCLE_STATES.submissionUnknown, now, remaining)
        : [];

    const claims: ReconciliationClaim[] = [];
    for (const attempt of [...submitted, ...unknown]) {
      if (claims.length >= limit) break;
      if (
        validReconciliationAttempt(attempt) &&
        attempt.reconciliationDeadlineAt !== undefined &&
        attempt.reconciliationDeadlineAt <= now &&
        attempt.verifiedLedgerEvidence === undefined &&
        !hasActiveReconciliationLease(attempt, now)
      ) {
        await ctx.db.patch(attempt._id, {
          reconciliationRequired: true,
          nextCheckAt: RECONCILIATION_PARKED_NEXT_CHECK_AT,
          updatedAt: now,
        });
        continue;
      }
      const claim = claimFromAttempt(attempt, now);
      if (claim === null) continue;

      await ctx.db.patch(attempt._id, {
        reconciliationLeaseToken: claim.reconciliationLeaseToken,
        reconciliationLeaseGeneration: claim.reconciliationLeaseGeneration,
        reconciliationLeaseExpiresAt: now + GAS_RECONCILIATION_LEASE_MS,
        reconciliationPollCount: claim.pollCount,
        reconciliationRequired: true,
        // A claimed row is hidden from the due queue until the independent
        // lease expires, making a crash recoverable without a scheduler arg.
        nextCheckAt: now + GAS_RECONCILIATION_LEASE_MS,
        updatedAt: now,
      });
      claims.push(claim);
    }
    return claims;
  },
});

async function findRequestAttempt(
  ctx: ReconciliationContext,
  projectId: Id<"projects">,
  requestId: string,
): Promise<ReconciliationAttempt | null | "ambiguous"> {
  const matches = await ctx.db
    .query("gasExecutionAttempts")
    .withIndex("by_project_id_and_request_id", (q) =>
      q.eq("projectId", projectId).eq("requestId", requestId),
    )
    .take(2);
  if (matches.length > 1) return "ambiguous";
  return matches[0] ?? null;
}

/** Claim exactly one exhausted attempt for an internal operator lookup. */
export const claimOperator = internalMutation({
  args: { projectId: v.id("projects"), requestId: v.string() },
  returns: reconciliationOperatorClaimResultValidator,
  handler: async (ctx, args): Promise<GasReconciliationOperatorClaimResult> => {
    let requestId: string;
    try {
      requestId = normalizeGasRequestId(args.requestId);
    } catch {
      return { status: "invalid_internal_input" } as const;
    }

    const attempt = await findRequestAttempt(ctx, args.projectId, requestId);
    if (attempt === "ambiguous") return { status: "invalid_internal_input" };
    if (attempt === null) return { status: "resource_not_found" };
    if (!validReconciliationAttempt(attempt)) return { status: "invalid_lifecycle" };
    if (attempt.verifiedLedgerEvidence !== undefined) return { status: "already_verified" };

    const now = Date.now();
    if (attempt.reconciliationDeadlineAt === undefined || attempt.reconciliationDeadlineAt > now) {
      return { status: "not_exhausted" };
    }
    if (hasActiveReconciliationLease(attempt, now)) return { status: "already_claimed" };

    const claim = claimFromAttempt(attempt, now, true);
    if (claim === null) return { status: "invalid_lifecycle" };
    await ctx.db.patch(attempt._id, {
      reconciliationLeaseToken: claim.reconciliationLeaseToken,
      reconciliationLeaseGeneration: claim.reconciliationLeaseGeneration,
      reconciliationLeaseExpiresAt: now + GAS_RECONCILIATION_LEASE_MS,
      reconciliationPollCount: claim.pollCount,
      reconciliationRequired: true,
      nextCheckAt: now + GAS_RECONCILIATION_LEASE_MS,
      updatedAt: now,
    });
    return { status: "claimed", claim };
  },
});

type ReconciliationEvidenceInput = {
  outerTransactionHash: string;
  innerTransactionHash: string;
  feeSource: string;
  ledger: number;
  resultCode: string;
  innerResultCode?: string;
  chargedStroops: bigint;
};

type NormalizedEvidence = ReconciliationEvidenceInput;

function consistentResultCodes(resultCode: string, innerResultCode?: string): boolean {
  if (
    !RESULT_CODE_PATTERN.test(resultCode) ||
    (innerResultCode !== undefined && !RESULT_CODE_PATTERN.test(innerResultCode))
  ) {
    return false;
  }
  if (resultCode === "txFeeBumpInnerSuccess") return innerResultCode === "txSuccess";
  if (resultCode === "txFeeBumpInnerFailed") {
    return innerResultCode !== undefined && innerResultCode !== "txSuccess";
  }
  return innerResultCode === undefined;
}

function isPositiveLedger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function validStoredEvidence(
  evidence: NonNullable<ReconciliationAttempt["verifiedLedgerEvidence"]>,
  attempt: ReconciliationAttempt,
): boolean {
  try {
    return (
      normalizeTransactionHash(evidence.outerTransactionHash) === attempt.outerTransactionHash &&
      normalizeTransactionHash(evidence.innerTransactionHash) === attempt.innerTransactionHash &&
      normalizeRelayerPublicKey(evidence.feeSource) === attempt.relayerPublicKey &&
      isPositiveLedger(evidence.ledger) &&
      isValidTimestamp(evidence.observedAt) &&
      consistentResultCodes(evidence.resultCode, evidence.innerResultCode) &&
      attempt.outerFeeStroops !== undefined &&
      assertValidStroopValue(evidence.chargedStroops) <= attempt.outerFeeStroops
    );
  } catch {
    return false;
  }
}

function normalizeEvidence(
  evidence: ReconciliationEvidenceInput | undefined,
  attempt: ReconciliationAttempt,
): NormalizedEvidence | null {
  if (evidence === undefined) return null;
  try {
    const outerTransactionHash = normalizeTransactionHash(evidence.outerTransactionHash);
    const innerTransactionHash = normalizeTransactionHash(evidence.innerTransactionHash);
    const feeSource = normalizeRelayerPublicKey(evidence.feeSource);
    const chargedStroops = assertValidStroopValue(evidence.chargedStroops);
    if (
      !isPositiveLedger(evidence.ledger) ||
      !consistentResultCodes(evidence.resultCode, evidence.innerResultCode) ||
      outerTransactionHash !== attempt.outerTransactionHash ||
      innerTransactionHash !== attempt.innerTransactionHash ||
      feeSource !== attempt.relayerPublicKey ||
      attempt.outerFeeStroops === undefined ||
      chargedStroops > attempt.outerFeeStroops
    ) {
      return null;
    }
    return {
      outerTransactionHash,
      innerTransactionHash,
      feeSource,
      ledger: evidence.ledger,
      resultCode: evidence.resultCode,
      ...(evidence.innerResultCode === undefined
        ? {}
        : { innerResultCode: evidence.innerResultCode }),
      chargedStroops,
    };
  } catch {
    return null;
  }
}

function sameEvidence(
  stored: ReconciliationAttempt["verifiedLedgerEvidence"],
  next: NormalizedEvidence,
): boolean {
  return (
    stored !== undefined &&
    stored.outerTransactionHash === next.outerTransactionHash &&
    stored.innerTransactionHash === next.innerTransactionHash &&
    stored.feeSource === next.feeSource &&
    stored.ledger === next.ledger &&
    stored.resultCode === next.resultCode &&
    stored.innerResultCode === next.innerResultCode &&
    stored.chargedStroops === next.chargedStroops
  );
}

function reconciliationExecution(attempt: ReconciliationAttempt) {
  return projectGasExecutionAttempt({
    requestId: attempt.requestId,
    innerTransactionHash: attempt.innerTransactionHash,
    outerTransactionHash: attempt.outerTransactionHash,
    lifecycle: attempt.lifecycle,
    approvedHoldStroops: attempt.approvedHoldStroops,
    actualFeeStroops: attempt.actualFeeStroops,
    reservationExpiresAt: attempt.reservationExpiresAt,
    reconciliationRequired: attempt.reconciliationRequired,
  });
}

function unresolvedDelayMs(pollCount: number): number {
  let delay = GAS_RECONCILIATION_INITIAL_DELAY_MS;
  for (let index = 1; index < pollCount && delay < GAS_RECONCILIATION_MAX_DELAY_MS; index += 1) {
    delay = Math.min(delay * 2, GAS_RECONCILIATION_MAX_DELAY_MS);
  }
  return delay;
}

function isReconciliationOutcomeStatus(
  value: string,
): value is "found" | "not_found" | "unavailable" | "malformed_response" | "wrong_network" {
  return (
    value === GAS_RECONCILIATION_LOOKUP_CLASSIFICATIONS.found ||
    value === GAS_RECONCILIATION_LOOKUP_CLASSIFICATIONS.notFound ||
    value === GAS_RECONCILIATION_LOOKUP_CLASSIFICATIONS.unavailable ||
    value === GAS_RECONCILIATION_LOOKUP_CLASSIFICATIONS.malformedResponse ||
    value === GAS_RECONCILIATION_LOOKUP_CLASSIFICATIONS.wrongNetwork
  );
}

/** Record one fenced lookup and retain only normalized, trusted evidence. */
export const recordOutcome = internalMutation({
  args: {
    executionAttemptId: v.id("gasExecutionAttempts"),
    projectId: v.id("projects"),
    outerTransactionHash: v.string(),
    reconciliationLeaseToken: v.string(),
    reconciliationLeaseGeneration: v.number(),
    outcome: gasReconciliationOutcomeInputValidator,
  },
  returns: gasReconciliationOutcomeResultValidator,
  handler: async (ctx, args): Promise<GasReconciliationOutcomeResult> => {
    const attempt = await ctx.db.get("gasExecutionAttempts", args.executionAttemptId);
    if (!attempt) return { status: "resource_not_found" };

    let outerTransactionHash: string;
    try {
      outerTransactionHash = normalizeTransactionHash(args.outerTransactionHash);
    } catch {
      return { status: "invalid_internal_input" };
    }
    if (!validReconciliationAttempt(attempt) || attempt.projectId !== args.projectId) {
      return { status: "invalid_lifecycle" };
    }
    if (attempt.outerTransactionHash !== outerTransactionHash) {
      return { status: "invalid_lifecycle" };
    }

    const normalizedEvidence =
      args.outcome.status === GAS_RECONCILIATION_LOOKUP_CLASSIFICATIONS.found
        ? normalizeEvidence(args.outcome.evidence, attempt)
        : null;

    // Once trusted evidence exists, only an identical replay is harmless. A
    // different receipt or a non-found result cannot overwrite it.
    if (attempt.verifiedLedgerEvidence !== undefined) {
      if (
        normalizedEvidence === null ||
        !sameEvidence(attempt.verifiedLedgerEvidence, normalizedEvidence) ||
        attempt.reconciliationLeaseGeneration !== args.reconciliationLeaseGeneration
      ) {
        return { status: "invalid_lifecycle" };
      }
      return {
        status: "recorded",
        idempotent: true,
        verified: true,
        exhausted: false,
        execution: reconciliationExecution(attempt),
      };
    }

    const now = Date.now();
    if (
      attempt.reconciliationLeaseToken !== args.reconciliationLeaseToken ||
      attempt.reconciliationLeaseGeneration !== args.reconciliationLeaseGeneration ||
      attempt.reconciliationLeaseExpiresAt === undefined ||
      attempt.reconciliationLeaseExpiresAt <= now
    ) {
      return { status: "invalid_lifecycle" };
    }

    const foundAndValid =
      args.outcome.status === GAS_RECONCILIATION_LOOKUP_CLASSIFICATIONS.found &&
      normalizedEvidence !== null;
    const outcomeStatus = foundAndValid
      ? GAS_RECONCILIATION_LOOKUP_CLASSIFICATIONS.found
      : args.outcome.status === GAS_RECONCILIATION_LOOKUP_CLASSIFICATIONS.found
        ? GAS_RECONCILIATION_LOOKUP_CLASSIFICATIONS.malformedResponse
        : args.outcome.status;
    if (!isReconciliationOutcomeStatus(outcomeStatus)) {
      return { status: "invalid_internal_input" };
    }

    const lastOutcome = { status: outcomeStatus, observedAt: now } as const;
    const deadline = attempt.reconciliationDeadlineAt!;
    if (foundAndValid) {
      const nextExecutionLeaseGeneration = attempt.leaseGeneration + 1;
      if (!Number.isSafeInteger(nextExecutionLeaseGeneration)) {
        return { status: "invalid_internal_input" };
      }
      const patchedAttempt = {
        ...attempt,
        verifiedLedgerEvidence: {
          ...normalizedEvidence,
          observedAt: now,
        },
        reconciliationLastOutcome: lastOutcome,
        reconciliationLeaseToken: undefined,
        reconciliationLeaseExpiresAt: undefined,
        reconciliationLeaseGeneration: args.reconciliationLeaseGeneration,
        nextCheckAt: RECONCILIATION_PARKED_NEXT_CHECK_AT,
        nextSendAt: undefined,
        reconciliationRequired: true,
        // Invalidate any in-flight send worker. Settlement is deliberately not
        // performed here; 4.3 remains the authority for actualFee/holds.
        leaseToken: undefined,
        leaseExpiresAt: undefined,
        leaseGeneration: nextExecutionLeaseGeneration,
        updatedAt: now,
      };
      await ctx.db.patch(attempt._id, {
        verifiedLedgerEvidence: patchedAttempt.verifiedLedgerEvidence,
        reconciliationLastOutcome: patchedAttempt.reconciliationLastOutcome,
        reconciliationLeaseToken: undefined,
        reconciliationLeaseExpiresAt: undefined,
        reconciliationLeaseGeneration: patchedAttempt.reconciliationLeaseGeneration,
        nextCheckAt: patchedAttempt.nextCheckAt,
        nextSendAt: undefined,
        reconciliationRequired: true,
        leaseToken: undefined,
        leaseExpiresAt: undefined,
        leaseGeneration: patchedAttempt.leaseGeneration,
        updatedAt: now,
      });
      return {
        status: "recorded",
        idempotent: false,
        verified: true,
        exhausted: false,
        execution: reconciliationExecution(patchedAttempt),
      };
    }

    const pollCount = attempt.reconciliationPollCount ?? 1;
    const exhausted = now >= deadline;
    const nextCheckAt = exhausted
      ? RECONCILIATION_PARKED_NEXT_CHECK_AT
      : Math.min(deadline, now + unresolvedDelayMs(pollCount));
    const patchedAttempt = {
      ...attempt,
      reconciliationLastOutcome: lastOutcome,
      reconciliationLeaseToken: undefined,
      reconciliationLeaseExpiresAt: undefined,
      nextCheckAt,
      reconciliationRequired: true,
      updatedAt: now,
    };
    await ctx.db.patch(attempt._id, {
      reconciliationLastOutcome: lastOutcome,
      reconciliationLeaseToken: undefined,
      reconciliationLeaseExpiresAt: undefined,
      nextCheckAt,
      reconciliationRequired: true,
      updatedAt: now,
    });
    return {
      status: "recorded",
      idempotent: false,
      verified: false,
      exhausted,
      execution: reconciliationExecution(patchedAttempt),
    };
  },
});
