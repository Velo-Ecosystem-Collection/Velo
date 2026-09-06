import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

import { addStroopValues, assertValidGasPolicyState, assertValidStroopValue } from "./validation";

const MAX_LEGACY_ACCOUNTING_ROWS = 256;
const ACCOUNTING_SCAN_LIMIT = MAX_LEGACY_ACCOUNTING_ROWS + 1;
const RESERVATION_TTL_MS = 15 * 60 * 1_000;

export const GAS_ACCOUNTING_STATE = {
  initialized: "initialized",
  overflow: "overflow",
} as const;

type GasAccountingContext = Pick<MutationCtx, "db">;
type GasPolicy = Doc<"gasPolicies">;

export type GasAccountingSnapshot = Readonly<{
  policy: GasPolicy;
  currentDayKey: string;
  effectiveUsageStroops: bigint;
  outstandingHoldsStroops: bigint;
  dailyConfirmedSpendStroops: bigint;
}>;

export type GasAccountingResult =
  | { ok: true; snapshot: GasAccountingSnapshot }
  | { ok: false; reason: "invalid" | "overflow" };

function utcDayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
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
    // The overflow marker is a deliberate fail-closed state transition even
    // for non-migrating callers; otherwise every request would repeat the costly
    // bounded scan without recording why accounting cannot proceed.
    await ctx.db.patch(policy._id, {
      accountingState: GAS_ACCOUNTING_STATE.overflow,
      updatedAt: now,
    });
    return { ok: false, reason: "overflow" };
  }

  let outstandingHoldsStroops = 0n;
  let currentDayLegacyReservations = 0n;
  let currentDayConfirmedSpendStroops = 0n;

  try {
    for (const log of rows) {
      if (!Number.isSafeInteger(log.createdAt) || log.createdAt < 0) {
        return { ok: false, reason: "invalid" };
      }

      if (isOutstandingLifecycle(log.lifecycle)) {
        const amount = validateReservationAmount(log);
        outstandingHoldsStroops = addStroopValues(outstandingHoldsStroops, amount);
        if (log.lifecycle === "reserved" && isCurrentDay(log.createdAt, currentDayKey)) {
          currentDayLegacyReservations = addStroopValues(currentDayLegacyReservations, amount);
        }
      } else if (isExecutionOwnedLifecycle(log.lifecycle)) {
        // Execution-owned rows are accounted by their durable attempt. A legacy
        // row with no attempt cannot safely be used to invent an exposure amount.
        if (log.lifecycle === "succeeded" || log.lifecycle === "failed") {
          const actualFee = log.actualFeeStroops;
          if (actualFee !== undefined && isCurrentDay(log.createdAt, currentDayKey)) {
            currentDayConfirmedSpendStroops = addStroopValues(
              currentDayConfirmedSpendStroops,
              assertValidStroopValue(actualFee),
            );
          }
        }
      } else if (log.lifecycle === "expired" && log.reservedStroops !== undefined) {
        // Expired rows may retain their immutable admission amount, but never
        // contribute to outstanding exposure.
        validateReservationAmount(log);
      }
    }

    const legacyCounter = assertValidStroopValue(policy.dailyReservedStroops);
    if (policy.dailyWindowKey === currentDayKey && currentDayLegacyReservations !== 0n) {
      if (legacyCounter !== currentDayLegacyReservations) return { ok: false, reason: "invalid" };
    }

    // A pre-D2 policy's counter is the only authority available when old rows
    // have already been removed from the audit log. Preserve it for the current
    // UTC day; all carry-over exposure is rebuilt from verified active rows.
    if (policy.dailyWindowKey === currentDayKey && outstandingHoldsStroops === 0n) {
      outstandingHoldsStroops = legacyCounter;
    }
  } catch {
    return { ok: false, reason: "invalid" };
  }

  let effectiveUsageStroops: bigint;
  try {
    effectiveUsageStroops = addStroopValues(
      currentDayConfirmedSpendStroops,
      outstandingHoldsStroops,
    );
    if (effectiveUsageStroops > policy.dailyCapStroops) return { ok: false, reason: "invalid" };
  } catch {
    return { ok: false, reason: "invalid" };
  }

  const nextPolicy = {
    ...policy,
    dailyReservedStroops: effectiveUsageStroops,
    dailyWindowKey: currentDayKey,
    outstandingHoldsStroops,
    dailyConfirmedSpendStroops: currentDayConfirmedSpendStroops,
    accountingState: GAS_ACCOUNTING_STATE.initialized,
  };
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

/**
 * Load the additive D2 counters, lazily migrating bounded D1 audit state.
 * Overflow and inconsistent legacy state are explicit fail-closed results.
 */
export async function ensureGasAccounting(
  ctx: GasAccountingContext,
  policy: GasPolicy,
  now: number,
  options: { persist?: boolean } = {},
): Promise<GasAccountingResult> {
  const currentDayKey = utcDayKey(now);
  const persist = options.persist ?? true;
  try {
    assertValidGasPolicyState(policy);
    if (policy.accountingState === GAS_ACCOUNTING_STATE.overflow) {
      return { ok: false, reason: "overflow" };
    }

    if (
      policy.accountingState === GAS_ACCOUNTING_STATE.initialized &&
      policy.outstandingHoldsStroops !== undefined &&
      policy.dailyConfirmedSpendStroops !== undefined
    ) {
      const outstandingHoldsStroops = assertValidStroopValue(policy.outstandingHoldsStroops);
      const dailyConfirmedSpendStroops = assertValidStroopValue(policy.dailyConfirmedSpendStroops);
      const effectiveUsageStroops = addStroopValues(
        dailyConfirmedSpendStroops,
        outstandingHoldsStroops,
      );
      if (
        policy.dailyWindowKey === currentDayKey &&
        policy.dailyReservedStroops !== effectiveUsageStroops
      ) {
        if (
          policy.outstandingHoldsStroops === 0n &&
          policy.dailyConfirmedSpendStroops === 0n &&
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
        return { ok: false, reason: "invalid" };
      }
      if (effectiveUsageStroops > policy.dailyCapStroops) {
        return { ok: false, reason: "invalid" };
      }
      if (policy.dailyWindowKey !== currentDayKey) {
        const rolledPolicy = {
          ...policy,
          dailyWindowKey: currentDayKey,
          dailyReservedStroops: outstandingHoldsStroops,
          dailyConfirmedSpendStroops: 0n,
        };
        if (persist) {
          await ctx.db.patch(policy._id, {
            dailyWindowKey: currentDayKey,
            dailyReservedStroops: outstandingHoldsStroops,
            dailyConfirmedSpendStroops: 0n,
            updatedAt: now,
          });
        }
        return {
          ok: true,
          snapshot: {
            policy: rolledPolicy,
            currentDayKey,
            effectiveUsageStroops: outstandingHoldsStroops,
            outstandingHoldsStroops,
            dailyConfirmedSpendStroops: 0n,
          },
        };
      }
      return {
        ok: true,
        snapshot: {
          policy,
          currentDayKey,
          effectiveUsageStroops,
          outstandingHoldsStroops,
          dailyConfirmedSpendStroops,
        },
      };
    }
  } catch {
    return { ok: false, reason: "invalid" };
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
    if (release > snapshot.outstandingHoldsStroops) return null;
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
    return null;
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
