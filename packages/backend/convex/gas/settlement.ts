import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

import { internalMutation } from "../_generated/server";
import {
  blockGasAccounting,
  ensureGasAccounting,
  releaseGasOutstandingHold,
  settleGasAccounting,
  utcDayKey,
} from "./accounting";
import { gasAccountingBlockReasonValidator } from "./schema";
import {
  GAS_ACCOUNTING_BLOCK_REASONS,
  GAS_LIFECYCLE_STATES,
  GAS_NETWORK,
  type GasAccountingBlockReason,
} from "./types";
import {
  assertValidStroopValue,
  normalizeRelayerPublicKey,
  normalizeTransactionHash,
} from "./validation";

const SHA256_HASH_PATTERN = /^[a-f0-9]{64}$/;
const RESULT_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const PARKED_NEXT_CHECK_AT = 8_640_000_000_000_000;
const CATCH_UP_BATCH_LIMIT = 25;

type SettlementContext = Pick<MutationCtx, "db">;
type Attempt = Doc<"gasExecutionAttempts">;
type Policy = Doc<"gasPolicies">;

export type GasSettlementResult =
  | {
      status: "settled";
      lifecycle: "succeeded" | "failed";
      actualFeeStroops: bigint;
      idempotent: boolean;
    }
  | { status: "cancelled"; idempotent: boolean }
  | { status: "expired"; idempotent: boolean }
  | { status: "blocked"; reason: GasAccountingBlockReason }
  | { status: "not_ready" }
  | { status: "resource_not_found" }
  | { status: "invalid_internal_input" }
  | { status: "invalid_lifecycle" };

export const gasSettlementResultValidator = v.union(
  v.object({
    status: v.literal("settled"),
    lifecycle: v.union(v.literal("succeeded"), v.literal("failed")),
    actualFeeStroops: v.int64(),
    idempotent: v.boolean(),
  }),
  v.object({ status: v.literal("cancelled"), idempotent: v.boolean() }),
  v.object({ status: v.literal("expired"), idempotent: v.boolean() }),
  v.object({
    status: v.literal("blocked"),
    reason: gasAccountingBlockReasonValidator,
  }),
  v.object({ status: v.literal("not_ready") }),
  v.object({ status: v.literal("resource_not_found") }),
  v.object({ status: v.literal("invalid_internal_input") }),
  v.object({ status: v.literal("invalid_lifecycle") }),
);

export type GasCancellationResult = GasSettlementResult;

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

function validEvidence(attempt: Attempt): boolean {
  const evidence = attempt.verifiedLedgerEvidence;
  if (evidence === undefined) return false;

  try {
    return (
      isSha256Hash(evidence.outerTransactionHash) &&
      normalizeTransactionHash(evidence.outerTransactionHash) === attempt.outerTransactionHash &&
      normalizeTransactionHash(evidence.innerTransactionHash) === attempt.innerTransactionHash &&
      normalizeRelayerPublicKey(evidence.feeSource) === attempt.relayerPublicKey &&
      Number.isSafeInteger(evidence.ledger) &&
      evidence.ledger > 0 &&
      isValidTimestamp(evidence.observedAt) &&
      consistentResultCodes(evidence.resultCode, evidence.innerResultCode) &&
      assertValidStroopValue(evidence.chargedStroops) >= 0n
    );
  } catch {
    return false;
  }
}

function validSettlementAttempt(attempt: Attempt): boolean {
  if (
    attempt.network !== GAS_NETWORK ||
    !Number.isSafeInteger(attempt.sendCount) ||
    attempt.sendCount < 1 ||
    attempt.outerTransactionHash === undefined ||
    attempt.outerFeeStroops === undefined
  ) {
    return false;
  }

  try {
    const originalReservationStroops = assertValidStroopValue(attempt.originalReservationStroops);
    const approvedHoldStroops = assertValidStroopValue(attempt.approvedHoldStroops);
    const feeCeilingStroops = assertValidStroopValue(attempt.feeCeilingStroops);
    const outerFeeStroops = assertValidStroopValue(attempt.outerFeeStroops);
    return (
      isSha256Hash(attempt.outerTransactionHash) &&
      approvedHoldStroops === feeCeilingStroops &&
      approvedHoldStroops >= originalReservationStroops &&
      outerFeeStroops > 0n &&
      outerFeeStroops <= approvedHoldStroops
    );
  } catch {
    return false;
  }
}

function terminalLifecycle(
  attempt: Attempt,
): "succeeded" | "failed" | "cancelled" | "expired" | null {
  if (
    attempt.lifecycle === GAS_LIFECYCLE_STATES.succeeded ||
    attempt.lifecycle === GAS_LIFECYCLE_STATES.failed ||
    attempt.lifecycle === GAS_LIFECYCLE_STATES.cancelled ||
    attempt.lifecycle === GAS_LIFECYCLE_STATES.expired
  ) {
    return attempt.lifecycle;
  }
  return null;
}

function trustedLifecycle(attempt: Attempt): "succeeded" | "failed" | null {
  const evidence = attempt.verifiedLedgerEvidence;
  if (evidence === undefined) return null;
  if (evidence.resultCode === "txFeeBumpInnerSuccess" && evidence.innerResultCode === "txSuccess") {
    return "succeeded";
  }
  if (
    evidence.resultCode === "txFeeBumpInnerFailed" &&
    evidence.innerResultCode !== undefined &&
    evidence.innerResultCode !== "txSuccess"
  ) {
    return "failed";
  }
  return null;
}

async function findPolicy(
  ctx: SettlementContext,
  projectId: Id<"projects">,
): Promise<Policy | null | "ambiguous"> {
  const matches = await ctx.db
    .query("gasPolicies")
    .withIndex("by_project_id", (q) => q.eq("projectId", projectId))
    .take(2);
  if (matches.length > 1) return "ambiguous";
  return matches[0] ?? null;
}

async function findAudit(
  ctx: SettlementContext,
  projectId: Id<"projects">,
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

function validSettlementAudit(audit: Doc<"gasLogs">, attempt: Attempt): boolean {
  return (
    audit.projectId === attempt.projectId &&
    audit.requestId === attempt.requestId &&
    audit.idempotencyKeyHash === attempt.idempotencyKeyHash &&
    audit.requestFingerprint === attempt.requestFingerprint &&
    audit.transactionHash === attempt.innerTransactionHash &&
    audit.sourceWallet === attempt.sourceWallet &&
    audit.targetContractIds?.length === attempt.targetContractIds.length &&
    audit.targetContractIds?.every(
      (target, index) => target === attempt.targetContractIds[index],
    ) === true &&
    audit.innerMaxFeeStroops === attempt.innerMaxFeeStroops &&
    audit.reservedStroops === attempt.originalReservationStroops &&
    audit.decisionCode === "reserved" &&
    audit.rejectionCode === undefined &&
    (audit.lifecycle === GAS_LIFECYCLE_STATES.claimed ||
      audit.lifecycle === GAS_LIFECYCLE_STATES.submissionUnknown ||
      audit.lifecycle === GAS_LIFECYCLE_STATES.submitted ||
      audit.lifecycle === GAS_LIFECYCLE_STATES.succeeded ||
      audit.lifecycle === GAS_LIFECYCLE_STATES.failed ||
      audit.lifecycle === GAS_LIFECYCLE_STATES.cancelled ||
      audit.lifecycle === GAS_LIFECYCLE_STATES.expired) &&
    audit.expiresAt === attempt.reservationExpiresAt
  );
}

function validUnsentAttempt(attempt: Attempt, now: number, requireLiveLease: boolean): boolean {
  if (
    attempt.network === GAS_NETWORK &&
    attempt.lifecycle === GAS_LIFECYCLE_STATES.claimed &&
    attempt.sendCount === 0 &&
    attempt.outerTransactionHash === undefined &&
    attempt.outerFeeStroops === undefined &&
    attempt.firstPossibleSendAt === undefined &&
    attempt.reconciliationDeadlineAt === undefined &&
    attempt.latestSendClassification === undefined &&
    attempt.verifiedLedgerEvidence === undefined &&
    attempt.nextSendAt === undefined &&
    attempt.reconciliationLeaseToken === undefined &&
    attempt.reconciliationLeaseExpiresAt === undefined &&
    attempt.reconciliationLastOutcome === undefined &&
    !attempt.reconciliationRequired &&
    (requireLiveLease
      ? attempt.leaseToken !== undefined &&
        attempt.leaseExpiresAt !== undefined &&
        attempt.leaseExpiresAt > now
      : attempt.leaseToken === undefined ||
        (attempt.leaseExpiresAt !== undefined && attempt.leaseExpiresAt <= now))
  ) {
    try {
      const originalReservationStroops = assertValidStroopValue(attempt.originalReservationStroops);
      const approvedHoldStroops = assertValidStroopValue(attempt.approvedHoldStroops);
      return (
        Number.isSafeInteger(attempt.leaseGeneration) &&
        attempt.leaseGeneration >= 1 &&
        isValidTimestamp(attempt.reservationCreatedAt) &&
        isValidTimestamp(attempt.reservationExpiresAt) &&
        attempt.reservationExpiresAt > attempt.reservationCreatedAt &&
        attempt.accountingDayKey === utcDayKey(attempt.reservationCreatedAt) &&
        approvedHoldStroops === assertValidStroopValue(attempt.feeCeilingStroops) &&
        approvedHoldStroops >= originalReservationStroops
      );
    } catch {
      return false;
    }
  }
  return false;
}

function settledResult(attempt: Attempt, idempotent: boolean): GasSettlementResult {
  if (attempt.settledAt === undefined || !isValidTimestamp(attempt.settledAt)) {
    return { status: "invalid_lifecycle" };
  }
  const lifecycle = terminalLifecycle(attempt);
  if (lifecycle === "succeeded" || lifecycle === "failed") {
    if (attempt.actualFeeStroops === undefined) return { status: "invalid_lifecycle" };
    try {
      if (assertValidStroopValue(attempt.actualFeeStroops) < 0n) {
        return { status: "invalid_lifecycle" };
      }
    } catch {
      return { status: "invalid_lifecycle" };
    }
    return {
      status: "settled",
      lifecycle,
      actualFeeStroops: attempt.actualFeeStroops,
      idempotent,
    };
  }
  if ((lifecycle === "cancelled" || lifecycle === "expired") && attempt.actualFeeStroops === 0n) {
    return lifecycle === "cancelled"
      ? { status: "cancelled", idempotent }
      : { status: "expired", idempotent };
  }
  return { status: "invalid_lifecycle" };
}

async function blockForAmbiguousPolicy(
  ctx: SettlementContext,
  policies: readonly Policy[],
  now: number,
): Promise<GasSettlementResult> {
  for (const policy of policies) {
    await blockGasAccounting(
      ctx,
      policy,
      GAS_ACCOUNTING_BLOCK_REASONS.ambiguousAccountingIdentity,
      now,
    );
  }
  return {
    status: "blocked",
    reason: GAS_ACCOUNTING_BLOCK_REASONS.ambiguousAccountingIdentity,
  };
}

/** Settle from stored, validated ledger evidence; the caller cannot provide fee or status. */
export async function settleGasExecutionAttempt(
  ctx: SettlementContext,
  executionAttemptId: Id<"gasExecutionAttempts">,
  projectId: Id<"projects">,
): Promise<GasSettlementResult> {
  const attempt = await ctx.db.get("gasExecutionAttempts", executionAttemptId);
  if (!attempt) return { status: "resource_not_found" };
  if (attempt.projectId !== projectId) return { status: "invalid_lifecycle" };

  if (attempt.settledAt !== undefined) {
    return terminalLifecycle(attempt) === null
      ? { status: "invalid_lifecycle" }
      : settledResult(attempt, true);
  }
  if (attempt.verifiedLedgerEvidence === undefined) return { status: "not_ready" };
  if (
    (attempt.lifecycle !== GAS_LIFECYCLE_STATES.submitted &&
      attempt.lifecycle !== GAS_LIFECYCLE_STATES.submissionUnknown) ||
    !validSettlementAttempt(attempt)
  ) {
    return { status: "invalid_lifecycle" };
  }
  if (!validEvidence(attempt)) return { status: "invalid_lifecycle" };

  const lifecycle = trustedLifecycle(attempt);
  if (lifecycle === null) {
    const policies = await ctx.db
      .query("gasPolicies")
      .withIndex("by_project_id", (q) => q.eq("projectId", projectId))
      .take(2);
    if (policies.length === 0) return { status: "resource_not_found" };
    if (policies.length > 1) return await blockForAmbiguousPolicy(ctx, policies, Date.now());
    await blockGasAccounting(
      ctx,
      policies[0]!,
      GAS_ACCOUNTING_BLOCK_REASONS.ambiguousAccountingIdentity,
      Date.now(),
    );
    return {
      status: "blocked",
      reason: GAS_ACCOUNTING_BLOCK_REASONS.ambiguousAccountingIdentity,
    };
  }

  const now = Date.now();
  const policy = await findPolicy(ctx, projectId);
  if (policy === null) return { status: "resource_not_found" };
  if (policy === "ambiguous") {
    const policies = await ctx.db
      .query("gasPolicies")
      .withIndex("by_project_id", (q) => q.eq("projectId", projectId))
      .take(2);
    return await blockForAmbiguousPolicy(ctx, policies, now);
  }

  const audit = await findAudit(ctx, projectId, attempt.requestId);
  if (audit === "ambiguous") {
    await blockGasAccounting(
      ctx,
      policy,
      GAS_ACCOUNTING_BLOCK_REASONS.ambiguousAccountingIdentity,
      now,
    );
    return {
      status: "blocked",
      reason: GAS_ACCOUNTING_BLOCK_REASONS.ambiguousAccountingIdentity,
    };
  }
  if (audit !== null && !validSettlementAudit(audit, attempt)) {
    await blockGasAccounting(
      ctx,
      policy,
      GAS_ACCOUNTING_BLOCK_REASONS.ambiguousAccountingIdentity,
      now,
    );
    return {
      status: "blocked",
      reason: GAS_ACCOUNTING_BLOCK_REASONS.ambiguousAccountingIdentity,
    };
  }

  const actualFeeStroops = attempt.verifiedLedgerEvidence.chargedStroops;
  const accounting = await settleGasAccounting(ctx, {
    policy,
    accountingDayKey: attempt.accountingDayKey,
    approvedHoldStroops: attempt.approvedHoldStroops,
    actualFeeStroops,
    now,
  });
  if (!accounting.ok) return { status: "blocked", reason: accounting.reason };

  const nextAttempt = {
    lifecycle,
    actualFeeStroops,
    settledAt: now,
    leaseToken: undefined,
    leaseExpiresAt: undefined,
    nextSendAt: undefined,
    reconciliationLeaseToken: undefined,
    reconciliationLeaseExpiresAt: undefined,
    nextCheckAt: PARKED_NEXT_CHECK_AT,
    reconciliationRequired: false,
    updatedAt: now,
  };
  await ctx.db.patch(attempt._id, nextAttempt);
  if (audit !== null) {
    await ctx.db.patch(audit._id, {
      lifecycle,
      actualFeeStroops,
      updatedAt: now,
    });
  }

  return { status: "settled", lifecycle, actualFeeStroops, idempotent: false };
}

/** Internal identity-only settlement entry point for retained evidence. */
export const settle = internalMutation({
  args: {
    executionAttemptId: v.id("gasExecutionAttempts"),
    projectId: v.id("projects"),
  },
  returns: gasSettlementResultValidator,
  handler: async (ctx, args) =>
    await settleGasExecutionAttempt(ctx, args.executionAttemptId, args.projectId),
});

/** Fenced cancellation for a currently active claim that has never been send-authorized. */
export const cancel = internalMutation({
  args: {
    executionAttemptId: v.id("gasExecutionAttempts"),
    projectId: v.id("projects"),
    leaseToken: v.string(),
    leaseGeneration: v.number(),
  },
  returns: gasSettlementResultValidator,
  handler: async (ctx, args): Promise<GasSettlementResult> => {
    const attempt = await ctx.db.get("gasExecutionAttempts", args.executionAttemptId);
    if (!attempt) return { status: "resource_not_found" };
    if (attempt.projectId !== args.projectId) return { status: "invalid_lifecycle" };
    if (attempt.settledAt !== undefined) {
      return terminalLifecycle(attempt) === null
        ? { status: "invalid_lifecycle" }
        : settledResult(attempt, true);
    }
    const now = Date.now();
    if (
      !validUnsentAttempt(attempt, now, true) ||
      attempt.leaseToken !== args.leaseToken ||
      attempt.leaseGeneration !== args.leaseGeneration
    ) {
      return { status: "invalid_lifecycle" };
    }

    const policy = await findPolicy(ctx, args.projectId);
    if (policy === null) return { status: "resource_not_found" };
    if (policy === "ambiguous") {
      const policies = await ctx.db
        .query("gasPolicies")
        .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
        .take(2);
      return await blockForAmbiguousPolicy(ctx, policies, now);
    }
    const audit = await findAudit(ctx, args.projectId, attempt.requestId);
    if (audit === "ambiguous") {
      await blockGasAccounting(
        ctx,
        policy,
        GAS_ACCOUNTING_BLOCK_REASONS.ambiguousAccountingIdentity,
        now,
      );
      return {
        status: "blocked",
        reason: GAS_ACCOUNTING_BLOCK_REASONS.ambiguousAccountingIdentity,
      };
    }
    if (audit !== null && !validSettlementAudit(audit, attempt)) {
      await blockGasAccounting(
        ctx,
        policy,
        GAS_ACCOUNTING_BLOCK_REASONS.ambiguousAccountingIdentity,
        now,
      );
      return {
        status: "blocked",
        reason: GAS_ACCOUNTING_BLOCK_REASONS.ambiguousAccountingIdentity,
      };
    }

    const accounting = await ensureGasAccounting(ctx, policy, now, { persist: true });
    if (!accounting.ok) {
      return {
        status: "blocked",
        reason:
          policy.accountingBlockReason ??
          (accounting.reason === "overflow"
            ? GAS_ACCOUNTING_BLOCK_REASONS.overflow
            : GAS_ACCOUNTING_BLOCK_REASONS.inconsistentCounters),
      };
    }
    if (
      !(await releaseGasOutstandingHold(ctx, accounting.snapshot, attempt.approvedHoldStroops, now))
    ) {
      return {
        status: "blocked",
        reason: GAS_ACCOUNTING_BLOCK_REASONS.inconsistentCounters,
      };
    }

    const nextGeneration = attempt.leaseGeneration + 1;
    if (!Number.isSafeInteger(nextGeneration)) {
      await blockGasAccounting(ctx, policy, GAS_ACCOUNTING_BLOCK_REASONS.overflow, now);
      return { status: "blocked", reason: GAS_ACCOUNTING_BLOCK_REASONS.overflow };
    }
    await ctx.db.patch(attempt._id, {
      lifecycle: GAS_LIFECYCLE_STATES.cancelled,
      actualFeeStroops: 0n,
      settledAt: now,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      leaseGeneration: nextGeneration,
      nextSendAt: undefined,
      reconciliationLeaseToken: undefined,
      reconciliationLeaseExpiresAt: undefined,
      nextCheckAt: PARKED_NEXT_CHECK_AT,
      reconciliationRequired: false,
      updatedAt: now,
    });
    if (audit !== null) {
      await ctx.db.patch(audit._id, {
        lifecycle: GAS_LIFECYCLE_STATES.cancelled,
        actualFeeStroops: 0n,
        updatedAt: now,
      });
    }
    return { status: "cancelled", idempotent: false };
  },
});

/** Expire one unsent attempt after durable state proves that no send was possible. */
export async function expireGasUnsentExecutionAttempt(
  ctx: SettlementContext,
  executionAttemptId: Id<"gasExecutionAttempts">,
  now: number,
): Promise<GasSettlementResult> {
  const attempt = await ctx.db.get("gasExecutionAttempts", executionAttemptId);
  if (!attempt) return { status: "resource_not_found" };
  if (attempt.settledAt !== undefined) {
    return terminalLifecycle(attempt) === null
      ? { status: "invalid_lifecycle" }
      : settledResult(attempt, true);
  }
  if (attempt.reservationExpiresAt > now || !validUnsentAttempt(attempt, now, false)) {
    return { status: "invalid_lifecycle" };
  }

  const policy = await findPolicy(ctx, attempt.projectId);
  if (policy === null) return { status: "resource_not_found" };
  if (policy === "ambiguous") {
    const policies = await ctx.db
      .query("gasPolicies")
      .withIndex("by_project_id", (q) => q.eq("projectId", attempt.projectId))
      .take(2);
    return await blockForAmbiguousPolicy(ctx, policies, now);
  }
  const audit = await findAudit(ctx, attempt.projectId, attempt.requestId);
  if (audit === "ambiguous") {
    await blockGasAccounting(
      ctx,
      policy,
      GAS_ACCOUNTING_BLOCK_REASONS.ambiguousAccountingIdentity,
      now,
    );
    return {
      status: "blocked",
      reason: GAS_ACCOUNTING_BLOCK_REASONS.ambiguousAccountingIdentity,
    };
  }
  if (audit !== null && !validSettlementAudit(audit, attempt)) {
    await blockGasAccounting(
      ctx,
      policy,
      GAS_ACCOUNTING_BLOCK_REASONS.ambiguousAccountingIdentity,
      now,
    );
    return {
      status: "blocked",
      reason: GAS_ACCOUNTING_BLOCK_REASONS.ambiguousAccountingIdentity,
    };
  }
  const accounting = await ensureGasAccounting(ctx, policy, now, { persist: true });
  if (!accounting.ok) {
    return {
      status: "blocked",
      reason:
        policy.accountingBlockReason ??
        (accounting.reason === "overflow"
          ? GAS_ACCOUNTING_BLOCK_REASONS.overflow
          : GAS_ACCOUNTING_BLOCK_REASONS.inconsistentCounters),
    };
  }
  if (
    !(await releaseGasOutstandingHold(ctx, accounting.snapshot, attempt.approvedHoldStroops, now))
  ) {
    return {
      status: "blocked",
      reason: GAS_ACCOUNTING_BLOCK_REASONS.inconsistentCounters,
    };
  }
  const nextGeneration = attempt.leaseGeneration + 1;
  if (!Number.isSafeInteger(nextGeneration)) {
    await blockGasAccounting(ctx, policy, GAS_ACCOUNTING_BLOCK_REASONS.overflow, now);
    return { status: "blocked", reason: GAS_ACCOUNTING_BLOCK_REASONS.overflow };
  }
  await ctx.db.patch(attempt._id, {
    lifecycle: GAS_LIFECYCLE_STATES.expired,
    actualFeeStroops: 0n,
    settledAt: now,
    leaseToken: undefined,
    leaseExpiresAt: undefined,
    leaseGeneration: nextGeneration,
    nextSendAt: undefined,
    reconciliationLeaseToken: undefined,
    reconciliationLeaseExpiresAt: undefined,
    nextCheckAt: PARKED_NEXT_CHECK_AT,
    reconciliationRequired: false,
    updatedAt: now,
  });
  if (audit !== null) {
    await ctx.db.patch(audit._id, {
      lifecycle: GAS_LIFECYCLE_STATES.expired,
      actualFeeStroops: 0n,
      updatedAt: now,
    });
  }
  return { status: "expired", idempotent: false };
}

const catchUpResultValidator = v.object({
  processed: v.number(),
  settled: v.number(),
  blocked: v.number(),
  invalid: v.number(),
  continueCursor: v.string(),
  isDone: v.boolean(),
});

/** Bounded cursor-based settlement for evidence retained before 4.3. */
export const catchUp = internalMutation({
  args: { paginationOpts: paginationOptsValidator },
  returns: catchUpResultValidator,
  handler: async (ctx, args) => {
    if (
      !Number.isSafeInteger(args.paginationOpts.numItems) ||
      args.paginationOpts.numItems <= 0 ||
      args.paginationOpts.numItems > CATCH_UP_BATCH_LIMIT
    ) {
      throw new Error("Gas settlement catch-up page is out of bounds");
    }
    const page = await ctx.db
      .query("gasExecutionAttempts")
      .filter((q) =>
        q.and(
          q.or(
            q.eq(q.field("lifecycle"), GAS_LIFECYCLE_STATES.submitted),
            q.eq(q.field("lifecycle"), GAS_LIFECYCLE_STATES.submissionUnknown),
          ),
          q.neq(q.field("verifiedLedgerEvidence"), undefined),
          q.eq(q.field("settledAt"), undefined),
        ),
      )
      .paginate(args.paginationOpts);

    let settled = 0;
    let blocked = 0;
    let invalid = 0;
    for (const attempt of page.page) {
      const result = await settleGasExecutionAttempt(ctx, attempt._id, attempt.projectId);
      if (result.status === "settled") settled += 1;
      else if (result.status === "blocked") blocked += 1;
      else invalid += 1;
    }
    return {
      processed: page.page.length,
      settled,
      blocked,
      invalid,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});
