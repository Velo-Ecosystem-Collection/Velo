import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

import { internalMutation } from "../_generated/server";
import { evaluateGasPolicy } from "./policy";
import { gasLogProjectionValidator, projectGasLog, type GasLogProjection } from "./projections";
import {
  GAS_DECISION_CODES,
  GAS_FEE_OVERHEAD_STROOPS,
  GAS_LIFECYCLE_STATES,
  GAS_MAX_ALLOWED_CONTRACT_IDS,
} from "./types";
import {
  addStroopValues,
  assertValidStroopValue,
  normalizeContractId,
  normalizeTransactionHash,
  normalizeWalletAddress,
} from "./validation";

const SHA256_HASH_PATTERN = /^[a-f0-9]{64}$/;
const RESERVATION_TTL_MS = 15 * 60 * 1_000;
const RETENTION_PERIOD_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_TIME_SECONDS = Math.floor(Number.MAX_SAFE_INTEGER / 1_000);

type GasAdmissionResult =
  | { status: "unauthorized" }
  | { status: "invalid_internal_input" }
  | { status: "idempotency_key_conflict" }
  | { status: "duplicate_transaction" }
  | { status: "decision"; replayed: boolean; log: GasLogProjection };

/** Explicit result contract for the private admission boundary. */
export const gasAdmissionResultValidator = v.union(
  v.object({ status: v.literal("unauthorized") }),
  v.object({ status: v.literal("invalid_internal_input") }),
  v.object({ status: v.literal("idempotency_key_conflict") }),
  v.object({ status: v.literal("duplicate_transaction") }),
  v.object({
    status: v.literal("decision"),
    replayed: v.boolean(),
    log: gasLogProjectionValidator,
  }),
);

type NormalizedAdmissionInput = Readonly<{
  apiKeyHash: string;
  idempotencyKeyHash: string;
  requestFingerprint: string;
  network: string;
  operation: string;
  sourceWallet: string;
  targetContractIds: string[];
  transactionHash: string;
  innerMaxFeeStroops: bigint;
  innerMaxTimeMs: number | null;
}>;

function isSha256Hash(value: string): boolean {
  return SHA256_HASH_PATTERN.test(value);
}

function utcDayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function utcHourKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 13);
}

function gasWalletBucketScopeKey(projectId: Doc<"projects">["_id"], sourceWallet: string): string {
  return `gas:${projectId}:wallet:${sourceWallet}`;
}

async function revalidateApiKey(
  ctx: MutationCtx,
  args: { apiKeyId: Doc<"apiKeys">["_id"]; apiKeyHash: string; projectId: Doc<"projects">["_id"] },
): Promise<boolean> {
  if (!isSha256Hash(args.apiKeyHash)) return false;

  let keyedApiKey: Doc<"apiKeys"> | null;
  try {
    keyedApiKey = await ctx.db
      .query("apiKeys")
      .withIndex("by_key_hash", (q) => q.eq("keyHash", args.apiKeyHash))
      .unique();
  } catch {
    return false;
  }

  const apiKey = await ctx.db.get(args.apiKeyId);
  const project = await ctx.db.get(args.projectId);

  return Boolean(
    keyedApiKey &&
    apiKey &&
    project &&
    keyedApiKey._id === apiKey._id &&
    apiKey.keyHash === args.apiKeyHash &&
    apiKey.projectId === args.projectId &&
    !apiKey.revoked,
  );
}

function normalizeMaxTime(maxTime: number | undefined): number | null {
  if (maxTime === undefined) return null;
  if (!Number.isSafeInteger(maxTime) || maxTime <= 0 || maxTime > MAX_TIME_SECONDS) {
    throw new Error("Invalid inner max time");
  }

  return maxTime * 1_000;
}

function normalizeAdmissionInput(args: {
  apiKeyHash: string;
  idempotencyKeyHash: string;
  requestFingerprint: string;
  network: string;
  operation: string;
  sourceWallet: string;
  targetContractIds: string[];
  transactionHash: string;
  innerMaxFeeStroops: bigint;
  innerMaxTime?: number;
}): NormalizedAdmissionInput {
  if (!isSha256Hash(args.apiKeyHash)) throw new Error("Invalid API-key hash");
  if (!isSha256Hash(args.idempotencyKeyHash)) {
    throw new Error("Invalid idempotency-key hash");
  }
  if (!isSha256Hash(args.requestFingerprint)) throw new Error("Invalid request fingerprint");
  if (args.network.length === 0 || args.network.length > 32) {
    throw new Error("Invalid Gas network");
  }
  if (args.operation.length === 0 || args.operation.length > 64) {
    throw new Error("Invalid Gas operation");
  }
  if (
    args.targetContractIds.length > GAS_MAX_ALLOWED_CONTRACT_IDS ||
    args.targetContractIds.some((contractId) => contractId.length > 128)
  ) {
    throw new Error("Invalid Gas contract targets");
  }

  const innerMaxFeeStroops = assertValidStroopValue(args.innerMaxFeeStroops);
  // Validate the derived reservation arithmetic before any indexed reads can lead to a write.
  addStroopValues(innerMaxFeeStroops, GAS_FEE_OVERHEAD_STROOPS);

  return {
    apiKeyHash: args.apiKeyHash,
    idempotencyKeyHash: args.idempotencyKeyHash,
    requestFingerprint: args.requestFingerprint,
    network: args.network,
    operation: args.operation,
    sourceWallet: normalizeWalletAddress(args.sourceWallet),
    targetContractIds: args.targetContractIds.map(normalizeContractId),
    transactionHash: normalizeTransactionHash(args.transactionHash),
    innerMaxFeeStroops,
    innerMaxTimeMs: normalizeMaxTime(args.innerMaxTime),
  };
}

function decisionResult(log: Doc<"gasLogs">, replayed: boolean): GasAdmissionResult {
  return { status: "decision", replayed, log: projectGasLog(log) };
}

async function findIdempotencyLog(
  ctx: MutationCtx,
  projectId: Doc<"projects">["_id"],
  idempotencyKeyHash: string,
): Promise<Doc<"gasLogs"> | null | "ambiguous"> {
  try {
    return await ctx.db
      .query("gasLogs")
      .withIndex("by_project_id_and_idempotency_key_hash", (q) =>
        q.eq("projectId", projectId).eq("idempotencyKeyHash", idempotencyKeyHash),
      )
      .unique();
  } catch {
    return "ambiguous";
  }
}

async function findTransactionLog(
  ctx: MutationCtx,
  projectId: Doc<"projects">["_id"],
  transactionHash: string,
): Promise<Doc<"gasLogs"> | null | "ambiguous"> {
  try {
    return await ctx.db
      .query("gasLogs")
      .withIndex("by_project_id_and_transaction_hash", (q) =>
        q.eq("projectId", projectId).eq("transactionHash", transactionHash),
      )
      .unique();
  } catch {
    return "ambiguous";
  }
}

function walletUsageForHour(
  bucket: { tokens: number; updatedAt: number } | null,
  now: number,
): number {
  if (!bucket) return 0;
  if (!Number.isSafeInteger(bucket.tokens) || bucket.tokens < 0) {
    throw new Error("Invalid Gas wallet bucket tokens");
  }
  if (!Number.isSafeInteger(bucket.updatedAt) || bucket.updatedAt < 0) {
    throw new Error("Invalid Gas wallet bucket timestamp");
  }

  return utcHourKey(bucket.updatedAt) === utcHourKey(now) ? bucket.tokens : 0;
}

/**
 * Atomically admits one server-derived Testnet Gas request.
 *
 * This is intentionally internal: the orchestration layer must derive the facts and
 * API-key scope before calling it, while this mutation revalidates both at the write boundary.
 */
export const reserve = internalMutation({
  args: {
    apiKeyId: v.id("apiKeys"),
    projectId: v.id("projects"),
    apiKeyHash: v.string(),
    idempotencyKeyHash: v.string(),
    requestFingerprint: v.string(),
    network: v.string(),
    operation: v.string(),
    sourceWallet: v.string(),
    targetContractIds: v.array(v.string()),
    transactionHash: v.string(),
    innerMaxFeeStroops: v.int64(),
    innerMaxTime: v.optional(v.number()),
  },
  returns: gasAdmissionResultValidator,
  handler: async (ctx, args): Promise<GasAdmissionResult> => {
    if (
      !(await revalidateApiKey(ctx, {
        apiKeyId: args.apiKeyId,
        apiKeyHash: args.apiKeyHash,
        projectId: args.projectId,
      }))
    ) {
      return { status: "unauthorized" };
    }

    let input: NormalizedAdmissionInput;
    try {
      input = normalizeAdmissionInput(args);
    } catch {
      return { status: "invalid_internal_input" };
    }

    const existingIdempotencyLog = await findIdempotencyLog(
      ctx,
      args.projectId,
      input.idempotencyKeyHash,
    );
    if (existingIdempotencyLog === "ambiguous") {
      return { status: "invalid_internal_input" };
    }
    if (existingIdempotencyLog) {
      return existingIdempotencyLog.requestFingerprint === input.requestFingerprint
        ? decisionResult(existingIdempotencyLog, true)
        : { status: "idempotency_key_conflict" };
    }

    const existingTransactionLog = await findTransactionLog(
      ctx,
      args.projectId,
      input.transactionHash,
    );
    if (existingTransactionLog === "ambiguous") {
      return { status: "duplicate_transaction" };
    }
    if (
      existingTransactionLog &&
      existingTransactionLog.decisionCode === GAS_DECISION_CODES.reserved
    ) {
      return { status: "duplicate_transaction" };
    }

    const now = Date.now();
    let reservationExpiresAt = now + RESERVATION_TTL_MS;
    if (input.innerMaxTimeMs !== null) {
      reservationExpiresAt = Math.min(reservationExpiresAt, input.innerMaxTimeMs);
    }
    if (!Number.isSafeInteger(reservationExpiresAt) || reservationExpiresAt <= now) {
      return { status: "invalid_internal_input" };
    }

    let policy: Doc<"gasPolicies"> | null;
    try {
      policy = await ctx.db
        .query("gasPolicies")
        .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
        .unique();
    } catch {
      return { status: "invalid_internal_input" };
    }

    const currentDayKey = utcDayKey(now);
    const policyForEvaluation = policy
      ? {
          ...policy,
          dailyReservedStroops:
            policy.dailyWindowKey === currentDayKey ? policy.dailyReservedStroops : 0n,
        }
      : null;

    let walletBucket;
    try {
      walletBucket = await ctx.db
        .query("rateLimitBuckets")
        .withIndex("by_scope_key", (q) =>
          q.eq("scopeKey", gasWalletBucketScopeKey(args.projectId, input.sourceWallet)),
        )
        .unique();
    } catch {
      return { status: "invalid_internal_input" };
    }

    let walletHourlyUsage: number;
    try {
      walletHourlyUsage = walletUsageForHour(walletBucket, now);
    } catch {
      return { status: "invalid_internal_input" };
    }

    let decision;
    try {
      decision = evaluateGasPolicy({
        policy: policyForEvaluation,
        network: input.network,
        operation: input.operation,
        targetContractIds: input.targetContractIds,
        innerMaxFeeStroops: input.innerMaxFeeStroops,
        walletHourlyUsage,
        requestedQuotaUnits: 1,
      });
    } catch {
      return { status: "invalid_internal_input" };
    }

    const requestId = crypto.randomUUID();
    const retentionExpiresAt = now + RETENTION_PERIOD_MS;

    if (decision.decisionCode === GAS_DECISION_CODES.rejected) {
      if (policy && policy.dailyWindowKey !== currentDayKey) {
        await ctx.db.patch(policy._id, {
          dailyReservedStroops: 0n,
          dailyWindowKey: currentDayKey,
          updatedAt: now,
        });
      }

      const logId = await ctx.db.insert("gasLogs", {
        projectId: args.projectId,
        requestId,
        idempotencyKeyHash: input.idempotencyKeyHash,
        requestFingerprint: input.requestFingerprint,
        sourceWallet: input.sourceWallet,
        targetContractIds: input.targetContractIds,
        innerMaxFeeStroops: input.innerMaxFeeStroops,
        decisionCode: GAS_DECISION_CODES.rejected,
        rejectionCode: decision.rejectionCode,
        lifecycle: GAS_LIFECYCLE_STATES.rejected,
        retentionExpiresAt,
        createdAt: now,
        updatedAt: now,
      });
      const log = await ctx.db.get("gasLogs", logId);
      if (!log) return { status: "invalid_internal_input" };
      return decisionResult(log, false);
    }

    if (!policy) return { status: "invalid_internal_input" };

    await ctx.db.patch(policy._id, {
      dailyReservedStroops: decision.reason.nextDailyReservedStroops,
      dailyWindowKey: currentDayKey,
      updatedAt: now,
    });

    const walletScopeKey = gasWalletBucketScopeKey(args.projectId, input.sourceWallet);
    if (walletBucket) {
      await ctx.db.patch(walletBucket._id, { tokens: walletHourlyUsage + 1, updatedAt: now });
    } else {
      await ctx.db.insert("rateLimitBuckets", {
        scopeKey: walletScopeKey,
        tokens: 1,
        updatedAt: now,
      });
    }

    const logId = await ctx.db.insert("gasLogs", {
      projectId: args.projectId,
      requestId,
      idempotencyKeyHash: input.idempotencyKeyHash,
      requestFingerprint: input.requestFingerprint,
      transactionHash: input.transactionHash,
      sourceWallet: input.sourceWallet,
      targetContractIds: input.targetContractIds,
      innerMaxFeeStroops: input.innerMaxFeeStroops,
      reservedStroops: decision.requiredReservationStroops,
      decisionCode: GAS_DECISION_CODES.reserved,
      lifecycle: GAS_LIFECYCLE_STATES.reserved,
      expiresAt: reservationExpiresAt,
      retentionExpiresAt,
      createdAt: now,
      updatedAt: now,
    });
    const log = await ctx.db.get("gasLogs", logId);
    if (!log) return { status: "invalid_internal_input" };
    return decisionResult(log, false);
  },
});
