import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

import { GAS_ACCOUNTING_BLOCK_REASONS, type GasAccountingBlockReason } from "./types";
import { addStroopValues, assertValidGasPolicyState, assertValidStroopValue } from "./validation";

const MAX_LEGACY_ACCOUNTING_ROWS = 256;
const ACCOUNTING_SCAN_LIMIT = MAX_LEGACY_ACCOUNTING_ROWS + 1;
const RESERVATION_TTL_MS = 15 * 60 * 1_000;
const UTC_DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const GAS_ACCOUNTING_STATE = {
  initialized: "initialized",
  overflow: "overflow",
} as const;

type GasAccountingContext = Pick<MutationCtx, "db">;
type GasPolicy = Doc<"gasPolicies">;
type GasDailyAccounting = Doc<"gasDailyAccounting">;

export type GasAccountingSnapshot = Readonly<{
  policy: GasPolicy;
  currentDayKey: string;
  effectiveUsageStroops: bigint;
  outstandingHoldsStroops: bigint;
  dailyConfirmedSpendStroops: bigint;
}>;

export type GasAccountingResult =
  | { ok: true; snapshot: GasAccountingSnapshot }
  | { ok: false; reason: "invalid" | "overflow" | "blocked" };

export type GasSettlementAccountingResult =
  | { ok: true; snapshot: GasAccountingSnapshot }
  | { ok: false; reason: GasAccountingBlockReason };

export function utcDayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function isValidUtcDayKey(value: string): boolean {
  if (!UTC_DAY_KEY_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isValidAccountingTimestamp(value: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    value > 0 &&
    Number.isFinite(value) &&
    Number.isFinite(new Date(value).getTime())
  );
}

function isExecutionOwnedLifecycle(lifecycle: Doc<"gasLogs">["lifecycle"]): boolean {
  return (
    lifecycle === "claimed" ||
    lifecycle === "submission_unknown" ||
    lifecycle === "submitted" ||
    lifecycle === "succeeded" ||
    lifecycle === "failed" ||
    lifecycle === "cancelled"
  );
}

function isOutstandingLifecycle(lifecycle: Doc<"gasLogs">["lifecycle"]): boolean {
  return (
    lifecycle === "reserved" ||
    lifecycle === "claimed" ||
    lifecycle === "submission_unknown" ||
    lifecycle === "submitted"
  );
}

function isCurrentDay(timestamp: number, dayKey: string): boolean {
  return utcDayKey(timestamp) === dayKey;
}

function validateReservationAmount(log: Doc<"gasLogs">): bigint {
  if (log.decisionCode !== "reserved" || log.reservedStroops === undefined) {
    throw new Error("Invalid legacy Gas reservation amount");
  }
  return assertValidStroopValue(log.reservedStroops);
}

function validDailyAccounting(
  record: GasDailyAccounting,
  projectId: GasPolicy["projectId"],
  accountingDayKey: string,
): boolean {
  if (
    record.projectId !== projectId ||
    record.accountingDayKey !== accountingDayKey ||
    !isValidUtcDayKey(record.accountingDayKey) ||
    !isValidAccountingTimestamp(record.createdAt) ||
    !isValidAccountingTimestamp(record.updatedAt) ||
    record.updatedAt < record.createdAt
  ) {
    return false;
  }

  try {
    assertValidStroopValue(record.confirmedSpendStroops);
    return true;
  } catch {
    return false;
  }
}

async function findDailyAccounting(
  ctx: GasAccountingContext,
  projectId: GasPolicy["projectId"],
  accountingDayKey: string,
): Promise<GasDailyAccounting | null | "ambiguous"> {
  const matches = await ctx.db
    .query("gasDailyAccounting")
    .withIndex("by_project_id_and_accounting_day_key", (q) =>
      q.eq("projectId", projectId).eq("accountingDayKey", accountingDayKey),
    )
    .take(2);
  if (matches.length > 1) return "ambiguous";
  return matches[0] ?? null;
}

/** Persist the first accounting fault and never clear or replace it implicitly. */
export async function blockGasAccounting(
  ctx: GasAccountingContext,
  policy: GasPolicy,
  reason: GasAccountingBlockReason,
  now: number,
): Promise<void> {
  if (policy.accountingBlockReason !== undefined) return;
  await ctx.db.patch(policy._id, {
    accountingBlockReason: reason,
    accountingBlockedAt: now,
    updatedAt: now,
  });
}

async function blockedAccounting(
  ctx: GasAccountingContext,
  policy: GasPolicy,
  reason: GasAccountingBlockReason,
  now: number,
): Promise<GasAccountingResult> {
  await blockGasAccounting(ctx, policy, reason, now);
  return {
    ok: false,
    reason: reason === GAS_ACCOUNTING_BLOCK_REASONS.overflow ? "overflow" : "blocked",
  };
}

async function scanLegacyAccounting(
  ctx: GasAccountingContext,
  policy: GasPolicy,
  currentDayKey: string,
  now: number,
  persist: boolean,
): Promise<GasAccountingResult> {
  const rows = await ctx.db
    .query("gasLogs")
    .withIndex("by_project_id_and_created_at", (q) => q.eq("projectId", policy.projectId))
    .take(ACCOUNTING_SCAN_LIMIT);
  if (rows.length > MAX_LEGACY_ACCOUNTING_ROWS) {
    await ctx.db.patch(policy._id, {
      accountingState: GAS_ACCOUNTING_STATE.overflow,
      accountingBlockReason: policy.accountingBlockReason ?? GAS_ACCOUNTING_BLOCK_REASONS.overflow,
      accountingBlockedAt: policy.accountingBlockedAt ?? now,
      updatedAt: now,
    });
    return { ok: false, reason: "overflow" };
  }

  const currentDaily = await findDailyAccounting(ctx, policy.projectId, currentDayKey);
  if (currentDaily === "ambiguous") {
    return await blockedAccounting(
      ctx,
      policy,
      GAS_ACCOUNTING_BLOCK_REASONS.ambiguousAccountingIdentity,
      now,
    );
  }
  if (
    currentDaily !== null &&
    !validDailyAccounting(currentDaily, policy.projectId, currentDayKey)
  ) {
    return await blockedAccounting(
      ctx,
      policy,
      GAS_ACCOUNTING_BLOCK_REASONS.inconsistentCounters,
      now,
    );
  }

  let outstandingHoldsStroops = 0n;
  let currentDayLegacyReservations = 0n;
  const currentDayConfirmedSpendStroops = currentDaily?.confirmedSpendStroops ?? 0n;

  try {
    for (const log of rows) {
      if (!isValidAccountingTimestamp(log.createdAt)) {
        return await blockedAccounting(
          ctx,
          policy,
          GAS_ACCOUNTING_BLOCK_REASONS.inconsistentCounters,
          now,
        );
      }

      if (isOutstandingLifecycle(log.lifecycle)) {
        const amount = validateReservationAmount(log);
        outstandingHoldsStroops = addStroopValues(outstandingHoldsStroops, amount);
        if (log.lifecycle === "reserved" && isCurrentDay(log.createdAt, currentDayKey)) {
          currentDayLegacyReservations = addStroopValues(currentDayLegacyReservations, amount);
        }
      } else if (isExecutionOwnedLifecycle(log.lifecycle)) {
        // Execution-owned rows are accounted by their durable attempt and
        // daily record. A missing daily record never infers history from an
        // audit row that may later be deleted.
      } else if (log.lifecycle === "expired" && log.reservedStroops !== undefined) {
        validateReservationAmount(log);
      }
    }

    const legacyCounter = assertValidStroopValue(policy.dailyReservedStroops);
    if (policy.dailyWindowKey === currentDayKey && currentDayLegacyReservations !== 0n) {
      if (legacyCounter !== currentDayLegacyReservations) {
        return await blockedAccounting(
          ctx,
          policy,
          GAS_ACCOUNTING_BLOCK_REASONS.inconsistentCounters,
          now,
        );
      }
    }

    // A pre-D2 policy's counter is the only authority available when old rows
    // have already been removed from the audit log. Preserve it for the
    // current UTC day; carry-over exposure is rebuilt from active rows.
    if (policy.dailyWindowKey === currentDayKey && outstandingHoldsStroops === 0n) {
      outstandingHoldsStroops = legacyCounter;
    }
  } catch {
    return await blockedAccounting(
      ctx,
      policy,
      GAS_ACCOUNTING_BLOCK_REASONS.inconsistentCounters,
      now,
    );
  }

  let effectiveUsageStroops: bigint;
  try {
    effectiveUsageStroops = addStroopValues(
      currentDayConfirmedSpendStroops,
      outstandingHoldsStroops,
    );
    if (effectiveUsageStroops > policy.dailyCapStroops) {
      return await blockedAccounting(
        ctx,
        policy,
        GAS_ACCOUNTING_BLOCK_REASONS.inconsistentCounters,
        now,
      );
    }
  } catch {
    return await blockedAccounting(ctx, policy, GAS_ACCOUNTING_BLOCK_REASONS.overflow, now);
  }

  const nextPolicy = {
    ...policy,
    dailyReservedStroops: effectiveUsageStroops,
    dailyWindowKey: currentDayKey,
    outstandingHoldsStroops,
    dailyConfirmedSpendStroops: currentDayConfirmedSpendStroops,
    accountingState: GAS_ACCOUNTING_STATE.initialized,
  };
  // Daily rows are initialized independently of the policy patch. This keeps
  // pinned spend history available even when a caller defers its policy write.
  if (currentDaily === null) {
    await ctx.db.insert("gasDailyAccounting", {
      projectId: policy.projectId,
      accountingDayKey: currentDayKey,
      confirmedSpendStroops: currentDayConfirmedSpendStroops,
      createdAt: now,
      updatedAt: now,
    });
  }
  if (persist) {
    await ctx.db.patch(policy._id, {
      dailyReservedStroops: nextPolicy.dailyReservedStroops,
      dailyWindowKey: nextPolicy.dailyWindowKey,
      outstandingHoldsStroops: nextPolicy.outstandingHoldsStroops,
      dailyConfirmedSpendStroops: nextPolicy.dailyConfirmedSpendStroops,
      accountingState: nextPolicy.accountingState,
    });
  }

  return {
    ok: true,
    snapshot: {
      policy: nextPolicy,
      currentDayKey,
      effectiveUsageStroops,
      outstandingHoldsStroops,
      dailyConfirmedSpendStroops: currentDayConfirmedSpendStroops,
    },
  };
}

async function initializedAccounting(
  ctx: GasAccountingContext,
  policy: GasPolicy,
  currentDayKey: string,
  now: number,
  persist: boolean,
): Promise<GasAccountingResult> {
  let outstandingHoldsStroops: bigint;
  let previousConfirmedSpendStroops: bigint;
  try {
    outstandingHoldsStroops = assertValidStroopValue(policy.outstandingHoldsStroops!);
    previousConfirmedSpendStroops = assertValidStroopValue(policy.dailyConfirmedSpendStroops!);
    assertValidStroopValue(policy.dailyReservedStroops);
  } catch {
    return await blockedAccounting(
      ctx,
      policy,
      GAS_ACCOUNTING_BLOCK_REASONS.inconsistentCounters,
      now,
    );
  }

  const currentDaily = await findDailyAccounting(ctx, policy.projectId, currentDayKey);
  if (currentDaily === "ambiguous") {
    return await blockedAccounting(
      ctx,
      policy,
      GAS_ACCOUNTING_BLOCK_REASONS.ambiguousAccountingIdentity,
      now,
    );
  }
  if (
    currentDaily !== null &&
    !validDailyAccounting(currentDaily, policy.projectId, currentDayKey)
  ) {
    return await blockedAccounting(
      ctx,
      policy,
      GAS_ACCOUNTING_BLOCK_REASONS.inconsistentCounters,
      now,
    );
  }

  // A policy written by the D1 console may already carry the additive zero
  // fields while its historical daily counter is still the only known
  // authority. Re-run the bounded legacy migration for that shape instead of
  // treating the counter as a new silent inconsistency.
  if (
    policy.dailyWindowKey === currentDayKey &&
    currentDaily === null &&
    outstandingHoldsStroops === 0n &&
    previousConfirmedSpendStroops === 0n &&
    policy.dailyReservedStroops > 0n
  ) {
    return await scanLegacyAccounting(
      ctx,
      { ...policy, accountingState: undefined },
      currentDayKey,
      now,
      persist,
    );
  }

  let currentConfirmedSpendStroops: bigint;
  if (policy.dailyWindowKey === currentDayKey) {
    currentConfirmedSpendStroops =
      currentDaily?.confirmedSpendStroops ?? previousConfirmedSpendStroops;
    if (
      currentDaily !== null &&
      currentDaily.confirmedSpendStroops !== previousConfirmedSpendStroops
    ) {
      return await blockedAccounting(
        ctx,
        policy,
        GAS_ACCOUNTING_BLOCK_REASONS.inconsistentCounters,
        now,
      );
    }
  } else {
    const previousDaily = await findDailyAccounting(ctx, policy.projectId, policy.dailyWindowKey);
    if (previousDaily === "ambiguous") {
      return await blockedAccounting(
        ctx,
        policy,
        GAS_ACCOUNTING_BLOCK_REASONS.ambiguousAccountingIdentity,
        now,
      );
    }
    if (
      previousDaily !== null &&
      !validDailyAccounting(previousDaily, policy.projectId, policy.dailyWindowKey)
    ) {
      return await blockedAccounting(
        ctx,
        policy,
        GAS_ACCOUNTING_BLOCK_REASONS.inconsistentCounters,
        now,
      );
    }
    if (
      previousDaily !== null &&
      previousDaily.confirmedSpendStroops !== previousConfirmedSpendStroops
    ) {
      return await blockedAccounting(
        ctx,
        policy,
        GAS_ACCOUNTING_BLOCK_REASONS.inconsistentCounters,
        now,
      );
    }
    if (previousDaily === null) {
      await ctx.db.insert("gasDailyAccounting", {
        projectId: policy.projectId,
        accountingDayKey: policy.dailyWindowKey,
        confirmedSpendStroops: previousConfirmedSpendStroops,
        createdAt: now,
        updatedAt: now,
      });
    }
    currentConfirmedSpendStroops = currentDaily?.confirmedSpendStroops ?? 0n;
  }

  try {
    const effectiveUsageStroops = addStroopValues(
      currentConfirmedSpendStroops,
      outstandingHoldsStroops,
    );
    if (
      policy.dailyWindowKey === currentDayKey &&
      policy.dailyReservedStroops !== effectiveUsageStroops
    ) {
      return await blockedAccounting(
        ctx,
        policy,
        GAS_ACCOUNTING_BLOCK_REASONS.inconsistentCounters,
        now,
      );
    }
    if (effectiveUsageStroops > policy.dailyCapStroops) {
      return await blockedAccounting(
        ctx,
        policy,
        GAS_ACCOUNTING_BLOCK_REASONS.inconsistentCounters,
        now,
      );
    }

    const nextPolicy = {
      ...policy,
      dailyWindowKey: currentDayKey,
      dailyReservedStroops: effectiveUsageStroops,
      dailyConfirmedSpendStroops: currentConfirmedSpendStroops,
      accountingState: GAS_ACCOUNTING_STATE.initialized,
    };
    if (currentDaily === null) {
      await ctx.db.insert("gasDailyAccounting", {
        projectId: policy.projectId,
        accountingDayKey: currentDayKey,
        confirmedSpendStroops: currentConfirmedSpendStroops,
        createdAt: now,
        updatedAt: now,
      });
    }
    if (persist && policy.dailyWindowKey !== currentDayKey) {
      await ctx.db.patch(policy._id, {
        dailyWindowKey: currentDayKey,
        dailyReservedStroops: effectiveUsageStroops,
        dailyConfirmedSpendStroops: currentConfirmedSpendStroops,
        updatedAt: now,
      });
    }
    return {
      ok: true,
      snapshot: {
        policy: nextPolicy,
        currentDayKey,
        effectiveUsageStroops,
        outstandingHoldsStroops,
        dailyConfirmedSpendStroops: currentConfirmedSpendStroops,
      },
    };
  } catch {
    return await blockedAccounting(ctx, policy, GAS_ACCOUNTING_BLOCK_REASONS.overflow, now);
  }
}

/** Load additive D2 counters, lazily migrating bounded D1 state and daily rows. */
export async function ensureGasAccounting(
  ctx: GasAccountingContext,
  policy: GasPolicy,
  now: number,
  options: { persist?: boolean } = {},
): Promise<GasAccountingResult> {
  const currentDayKey = utcDayKey(now);
  const persist = options.persist ?? true;
  if (policy.accountingBlockReason !== undefined) return { ok: false, reason: "blocked" };
  if (policy.accountingState === GAS_ACCOUNTING_STATE.overflow) {
    return await blockedAccounting(ctx, policy, GAS_ACCOUNTING_BLOCK_REASONS.overflow, now);
  }

  try {
    assertValidGasPolicyState(policy);
  } catch {
    return await blockedAccounting(
      ctx,
      policy,
      GAS_ACCOUNTING_BLOCK_REASONS.inconsistentCounters,
      now,
    );
  }

  if (
    policy.accountingState === GAS_ACCOUNTING_STATE.initialized &&
    policy.outstandingHoldsStroops !== undefined &&
    policy.dailyConfirmedSpendStroops !== undefined
  ) {
    return await initializedAccounting(ctx, policy, currentDayKey, now, persist);
  }

  return await scanLegacyAccounting(ctx, policy, currentDayKey, now, persist);
}

/** Increase outstanding exposure and keep the effective policy counter exact. */
export async function increaseGasOutstandingHold(
  ctx: GasAccountingContext,
  snapshot: GasAccountingSnapshot,
  increaseStroops: bigint,
  now: number,
): Promise<GasAccountingSnapshot | null> {
  try {
    const increase = assertValidStroopValue(increaseStroops);
    const outstandingHoldsStroops = addStroopValues(snapshot.outstandingHoldsStroops, increase);
    const effectiveUsageStroops = addStroopValues(
      snapshot.dailyConfirmedSpendStroops,
      outstandingHoldsStroops,
    );
    if (effectiveUsageStroops > snapshot.policy.dailyCapStroops) return null;

    const nextPolicy = {
      ...snapshot.policy,
      dailyReservedStroops: effectiveUsageStroops,
      dailyWindowKey: snapshot.currentDayKey,
      outstandingHoldsStroops,
      accountingState: GAS_ACCOUNTING_STATE.initialized,
    };
    await ctx.db.patch(snapshot.policy._id, {
      dailyReservedStroops: effectiveUsageStroops,
      dailyWindowKey: snapshot.currentDayKey,
      outstandingHoldsStroops,
      dailyConfirmedSpendStroops: snapshot.dailyConfirmedSpendStroops,
      accountingState: nextPolicy.accountingState,
      updatedAt: now,
    });
    return {
      ...snapshot,
      policy: nextPolicy,
      effectiveUsageStroops,
      outstandingHoldsStroops,
    };
  } catch {
    await blockGasAccounting(ctx, snapshot.policy, GAS_ACCOUNTING_BLOCK_REASONS.overflow, now);
    return null;
  }
}

/** Release one proven-unsent reservation hold exactly once. */
export async function releaseGasOutstandingHold(
  ctx: GasAccountingContext,
  snapshot: GasAccountingSnapshot,
  releaseStroops: bigint,
  now: number,
): Promise<GasAccountingSnapshot | null> {
  try {
    const release = assertValidStroopValue(releaseStroops);
    if (release > snapshot.outstandingHoldsStroops) {
      await blockGasAccounting(
        ctx,
        snapshot.policy,
        GAS_ACCOUNTING_BLOCK_REASONS.inconsistentCounters,
        now,
      );
      return null;
    }
    const outstandingHoldsStroops = snapshot.outstandingHoldsStroops - release;
    const effectiveUsageStroops = addStroopValues(
      snapshot.dailyConfirmedSpendStroops,
      outstandingHoldsStroops,
    );
    const nextPolicy = {
      ...snapshot.policy,
      dailyReservedStroops: effectiveUsageStroops,
      dailyWindowKey: snapshot.currentDayKey,
      outstandingHoldsStroops,
      accountingState: GAS_ACCOUNTING_STATE.initialized,
    };
    await ctx.db.patch(snapshot.policy._id, {
      dailyReservedStroops: effectiveUsageStroops,
      dailyWindowKey: snapshot.currentDayKey,
      outstandingHoldsStroops,
      dailyConfirmedSpendStroops: snapshot.dailyConfirmedSpendStroops,
      accountingState: nextPolicy.accountingState,
      updatedAt: now,
    });
    return {
      ...snapshot,
      policy: nextPolicy,
      effectiveUsageStroops,
      outstandingHoldsStroops,
    };
  } catch {
    await blockGasAccounting(ctx, snapshot.policy, GAS_ACCOUNTING_BLOCK_REASONS.overflow, now);
    return null;
  }
}

/** Replace one approved execution hold with trusted actual spend. */
export async function settleGasAccounting(
  ctx: GasAccountingContext,
  params: {
    policy: GasPolicy;
    accountingDayKey: string;
    approvedHoldStroops: bigint;
    actualFeeStroops: bigint;
    now: number;
  },
): Promise<GasSettlementAccountingResult> {
  const { policy, accountingDayKey, approvedHoldStroops, actualFeeStroops, now } = params;
  if (policy.accountingBlockReason !== undefined) {
    return { ok: false, reason: policy.accountingBlockReason };
  }
  let approvedHold: bigint;
  let actualFee: bigint;
  try {
    approvedHold = assertValidStroopValue(approvedHoldStroops);
    actualFee = assertValidStroopValue(actualFeeStroops);
    if (actualFee > approvedHold) {
      await blockGasAccounting(
        ctx,
        policy,
        GAS_ACCOUNTING_BLOCK_REASONS.feeExceedsApprovedExposure,
        now,
      );
      return { ok: false, reason: GAS_ACCOUNTING_BLOCK_REASONS.feeExceedsApprovedExposure };
    }
    if (!isValidUtcDayKey(accountingDayKey)) throw new Error("Invalid accounting day");
  } catch {
    await blockGasAccounting(ctx, policy, GAS_ACCOUNTING_BLOCK_REASONS.inconsistentCounters, now);
    return { ok: false, reason: GAS_ACCOUNTING_BLOCK_REASONS.inconsistentCounters };
  }

  const accounting = await ensureGasAccounting(ctx, policy, now, { persist: true });
  if (!accounting.ok) {
    return {
      ok: false,
      reason:
        policy.accountingBlockReason ??
        (accounting.reason === "overflow"
          ? GAS_ACCOUNTING_BLOCK_REASONS.overflow
          : GAS_ACCOUNTING_BLOCK_REASONS.inconsistentCounters),
    };
  }
  if (approvedHold > accounting.snapshot.outstandingHoldsStroops) {
    await blockGasAccounting(ctx, policy, GAS_ACCOUNTING_BLOCK_REASONS.inconsistentCounters, now);
    return { ok: false, reason: GAS_ACCOUNTING_BLOCK_REASONS.inconsistentCounters };
  }

  const daily = await findDailyAccounting(ctx, policy.projectId, accountingDayKey);
  if (daily === "ambiguous") {
    await blockGasAccounting(
      ctx,
      policy,
      GAS_ACCOUNTING_BLOCK_REASONS.ambiguousAccountingIdentity,
      now,
    );
    return { ok: false, reason: GAS_ACCOUNTING_BLOCK_REASONS.ambiguousAccountingIdentity };
  }
  if (daily !== null && !validDailyAccounting(daily, policy.projectId, accountingDayKey)) {
    await blockGasAccounting(ctx, policy, GAS_ACCOUNTING_BLOCK_REASONS.inconsistentCounters, now);
    return { ok: false, reason: GAS_ACCOUNTING_BLOCK_REASONS.inconsistentCounters };
  }

  try {
    const previousSpend = daily?.confirmedSpendStroops ?? 0n;
    const nextConfirmedSpendStroops = addStroopValues(previousSpend, actualFee);
    const outstandingHoldsStroops = accounting.snapshot.outstandingHoldsStroops - approvedHold;
    const currentSpend =
      accountingDayKey === accounting.snapshot.currentDayKey
        ? nextConfirmedSpendStroops
        : accounting.snapshot.dailyConfirmedSpendStroops;
    const nextEffectiveUsage = addStroopValues(currentSpend, outstandingHoldsStroops);
    if (nextEffectiveUsage > policy.dailyCapStroops) {
      await blockGasAccounting(ctx, policy, GAS_ACCOUNTING_BLOCK_REASONS.inconsistentCounters, now);
      return { ok: false, reason: GAS_ACCOUNTING_BLOCK_REASONS.inconsistentCounters };
    }

    const nextPolicy = {
      ...accounting.snapshot.policy,
      dailyReservedStroops: nextEffectiveUsage,
      outstandingHoldsStroops,
      dailyConfirmedSpendStroops: currentSpend,
      dailyWindowKey: accounting.snapshot.currentDayKey,
      accountingState: GAS_ACCOUNTING_STATE.initialized,
    };
    if (daily === null) {
      await ctx.db.insert("gasDailyAccounting", {
        projectId: policy.projectId,
        accountingDayKey,
        confirmedSpendStroops: nextConfirmedSpendStroops,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(daily._id, {
        confirmedSpendStroops: nextConfirmedSpendStroops,
        updatedAt: now,
      });
    }
    await ctx.db.patch(policy._id, {
      dailyReservedStroops: nextPolicy.dailyReservedStroops,
      outstandingHoldsStroops: nextPolicy.outstandingHoldsStroops,
      dailyConfirmedSpendStroops: nextPolicy.dailyConfirmedSpendStroops,
      dailyWindowKey: nextPolicy.dailyWindowKey,
      accountingState: nextPolicy.accountingState,
      updatedAt: now,
    });
    return {
      ok: true,
      snapshot: {
        policy: nextPolicy,
        currentDayKey: accounting.snapshot.currentDayKey,
        effectiveUsageStroops: nextEffectiveUsage,
        outstandingHoldsStroops,
        dailyConfirmedSpendStroops: currentSpend,
      },
    };
  } catch {
    await blockGasAccounting(ctx, policy, GAS_ACCOUNTING_BLOCK_REASONS.overflow, now);
    return { ok: false, reason: GAS_ACCOUNTING_BLOCK_REASONS.overflow };
  }
}

export function reservationExpiryForClaim(
  createdAt: number,
  innerMaxTime: number | undefined,
): number {
  const ttlExpiry = createdAt + RESERVATION_TTL_MS;
  const maxTimeExpiry = innerMaxTime === undefined ? ttlExpiry : innerMaxTime * 1_000;
  return Math.min(ttlExpiry, maxTimeExpiry);
}
