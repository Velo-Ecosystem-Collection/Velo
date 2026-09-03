"use node";

import { isCorrelationId } from "@repo/observability";
import {
  TestnetTransactionEnvelopeError,
  type TestnetTransactionEnvelopeErrorCode,
} from "@repo/stellar/transaction-envelope";
import {
  assertValidContractId,
  assertValidPublicKey,
  assertValidTransactionHash,
} from "@repo/stellar/validation";
import { v } from "convex/values";

import type { ActionCtx } from "../_generated/server";
import type { GasAdmissionResult } from "./admission";
import type { GasSubmitResult as GasSubmitMutationResult } from "./submit";

import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import { deriveGasTransactionFacts } from "./envelope";
import { gasLogProjectionValidator, type GasLogProjection } from "./projections";
import { gasRejectionCodeValidator } from "./schema";
import {
  GAS_MAX_IDEMPOTENCY_KEY_BYTES,
  GAS_MAX_TRANSACTION_XDR_BYTES,
  normalizeGasRequestId,
  normalizeTransactionHash,
} from "./validation";

export type GasSponsorResult =
  | {
      status: "success";
      replayed: boolean;
      reservation: GasLogProjection;
    }
  | {
      status: "rejected";
      replayed: boolean;
      rejectionCode: Exclude<GasLogProjection["rejectionCode"], null>;
      decision: GasLogProjection;
    }
  | { status: "unauthorized" }
  | { status: TestnetTransactionEnvelopeErrorCode }
  | { status: "idempotency_key_conflict" }
  | { status: "duplicate_transaction" }
  | { status: "payload_too_large" }
  | { status: "dependency_unavailable" }
  | { status: "internal_error" };

export type GasSubmitResult =
  | { status: "handoff_unavailable" }
  | { status: "reservation_expired" }
  | { status: "invalid_lifecycle" }
  | { status: "resource_not_found" }
  | { status: "unauthorized" }
  | { status: "invalid_request" }
  | { status: "dependency_unavailable" }
  | { status: "internal_error" };

const gasSponsorSuccessValidator = v.object({
  status: v.literal("success"),
  replayed: v.boolean(),
  reservation: gasLogProjectionValidator,
});

const gasSponsorRejectedValidator = v.object({
  status: v.literal("rejected"),
  replayed: v.boolean(),
  rejectionCode: gasRejectionCodeValidator,
  decision: gasLogProjectionValidator,
});

export const gasSponsorResultValidator = v.union(
  gasSponsorSuccessValidator,
  gasSponsorRejectedValidator,
  v.object({ status: v.literal("unauthorized") }),
  v.object({ status: v.literal("invalid_request") }),
  v.object({ status: v.literal("invalid_signature") }),
  v.object({ status: v.literal("wrong_network") }),
  v.object({ status: v.literal("unsupported_transaction") }),
  v.object({ status: v.literal("idempotency_key_conflict") }),
  v.object({ status: v.literal("duplicate_transaction") }),
  v.object({ status: v.literal("payload_too_large") }),
  v.object({ status: v.literal("dependency_unavailable") }),
  v.object({ status: v.literal("internal_error") }),
);

export const gasSubmitResultValidator = v.union(
  v.object({ status: v.literal("handoff_unavailable") }),
  v.object({ status: v.literal("reservation_expired") }),
  v.object({ status: v.literal("invalid_lifecycle") }),
  v.object({ status: v.literal("resource_not_found") }),
  v.object({ status: v.literal("unauthorized") }),
  v.object({ status: v.literal("invalid_request") }),
  v.object({ status: v.literal("dependency_unavailable") }),
  v.object({ status: v.literal("internal_error") }),
);

type NormalizedRequiredValue =
  | { ok: true; value: string }
  | { ok: false; status: "invalid_request" | "payload_too_large" };

function normalizeRequiredValue(value: string, maxBytes: number): NormalizedRequiredValue {
  const normalized = value.trim();
  if (normalized === "") return { ok: false, status: "invalid_request" };
  if (new TextEncoder().encode(normalized).byteLength > maxBytes) {
    return { ok: false, status: "payload_too_large" };
  }
  return { ok: true, value: normalized };
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function mapEnvelopeError(error: unknown): GasSponsorResult | null {
  if (!(error instanceof TestnetTransactionEnvelopeError)) return null;
  return { status: error.code };
}

function mapAdmissionResult(result: GasAdmissionResult): GasSponsorResult {
  switch (result.status) {
    case "unauthorized":
      return { status: "unauthorized" };
    case "invalid_internal_input":
      return { status: "internal_error" };
    case "dependency_unavailable":
      return { status: "dependency_unavailable" };
    case "idempotency_key_conflict":
      return { status: "idempotency_key_conflict" };
    case "duplicate_transaction":
      return { status: "duplicate_transaction" };
    case "decision":
      if (!isValidGasLogProjection(result.log)) return { status: "internal_error" };
      if (result.log.decisionCode === "reserved") {
        if (!isValidReservationProjection(result.log)) return { status: "internal_error" };
        return {
          status: "success",
          replayed: result.replayed,
          reservation: result.log,
        };
      }

      if (result.log.rejectionCode === null) return { status: "internal_error" };
      return {
        status: "rejected",
        replayed: result.replayed,
        rejectionCode: result.log.rejectionCode,
        decision: result.log,
      };
  }
}

function isValidReservationProjection(value: GasLogProjection): boolean {
  if (
    !isCorrelationId(value.requestId) ||
    normalizeGasRequestId(value.requestId) !== value.requestId ||
    !isCanonicalPublicKey(value.sourceWallet) ||
    !isCanonicalTransactionHash(value.transactionHash) ||
    !Array.isArray(value.targetContractIds) ||
    value.targetContractIds.length !== 1 ||
    !isCanonicalContractId(value.targetContractIds[0]) ||
    !isCanonicalStroop(value.innerMaxFeeStroops) ||
    !isCanonicalStroop(value.reservedStroops) ||
    value.decisionCode !== "reserved" ||
    value.rejectionCode !== null ||
    value.lifecycle !== "reserved" ||
    !isValidTimestamp(value.expiresAt) ||
    !isValidTimestamp(value.createdAt) ||
    !isValidTimestamp(value.updatedAt) ||
    value.expiresAt <= value.createdAt ||
    value.updatedAt < value.createdAt ||
    value.actualFeeStroops !== null
  ) {
    return false;
  }

  try {
    return BigInt(value.reservedStroops) === BigInt(value.innerMaxFeeStroops) + 100n;
  } catch {
    return false;
  }
}

function isValidGasLogProjection(value: GasLogProjection): boolean {
  if (
    !isCorrelationId(value.requestId) ||
    !isValidTimestamp(value.createdAt) ||
    !isValidTimestamp(value.updatedAt) ||
    value.updatedAt < value.createdAt ||
    (value.transactionHash !== null && !isCanonicalTransactionHash(value.transactionHash)) ||
    (value.sourceWallet !== null && !isCanonicalPublicKey(value.sourceWallet)) ||
    (value.targetContractIds !== null &&
      (value.targetContractIds.length !== 1 ||
        !isCanonicalContractId(value.targetContractIds[0]))) ||
    (value.innerMaxFeeStroops !== null && !isCanonicalStroop(value.innerMaxFeeStroops)) ||
    (value.reservedStroops !== null && !isCanonicalStroop(value.reservedStroops)) ||
    (value.actualFeeStroops !== null && !isCanonicalStroop(value.actualFeeStroops)) ||
    (value.expiresAt !== null && !isValidTimestamp(value.expiresAt))
  ) {
    return false;
  }

  if (value.decisionCode === "reserved") {
    return value.rejectionCode === null && value.lifecycle === "reserved";
  }

  return (
    value.decisionCode === "rejected" &&
    value.rejectionCode !== null &&
    value.lifecycle === "rejected"
  );
}

function isCanonicalPublicKey(value: string | null): value is string {
  if (typeof value !== "string") return false;
  try {
    return assertValidPublicKey(value) === value;
  } catch {
    return false;
  }
}

function isCanonicalContractId(value: string | undefined): value is string {
  if (typeof value !== "string") return false;
  try {
    return assertValidContractId(value) === value;
  } catch {
    return false;
  }
}

function isCanonicalTransactionHash(value: string | null): value is string {
  if (typeof value !== "string") return false;
  try {
    return assertValidTransactionHash(value) === value;
  } catch {
    return false;
  }
}

function isCanonicalStroop(value: string | null): value is string {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) return false;
  if (value.length > 19) return false;
  try {
    const amount = BigInt(value);
    return amount >= 0n && amount <= 2n ** 63n - 1n;
  } catch {
    return false;
  }
}

function isValidTimestamp(value: number | null): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    Number.isFinite(new Date(value).getTime())
  );
}

function mapSubmitResult(result: GasSubmitMutationResult): GasSubmitResult {
  switch (result.status) {
    case "unauthorized":
      return { status: "unauthorized" };
    case "invalid_internal_input":
      return { status: "internal_error" };
    case "dependency_unavailable":
      return { status: "dependency_unavailable" };
    case "resource_not_found":
      return { status: "resource_not_found" };
    case "invalid_lifecycle":
      return { status: "invalid_lifecycle" };
    case "reservation_expired":
      return { status: "reservation_expired" };
    case "handoff_unavailable":
      return { status: "handoff_unavailable" };
  }
}

async function authorize(ctx: ActionCtx, apiKeyHash: string) {
  return await ctx.runQuery(internal.gas.public_api_internal.authorize, { apiKeyHash });
}

/** Public Convex orchestration seam for Testnet Gas sponsorship admission. */
export const sponsor = action({
  args: {
    apiKeyHash: v.string(),
    idempotencyKey: v.string(),
    transactionXdr: v.string(),
  },
  returns: gasSponsorResultValidator,
  handler: async (ctx, args): Promise<GasSponsorResult> => {
    let scope;
    try {
      // API-key authorization intentionally precedes any input parsing or normalization.
      scope = await authorize(ctx, args.apiKeyHash);
    } catch {
      return { status: "dependency_unavailable" };
    }

    if (!scope.authorized) return { status: "unauthorized" };

    const idempotencyKey = normalizeRequiredValue(
      args.idempotencyKey,
      GAS_MAX_IDEMPOTENCY_KEY_BYTES,
    );
    if (!idempotencyKey.ok) return { status: idempotencyKey.status };
    const transactionXdr = normalizeRequiredValue(
      args.transactionXdr,
      GAS_MAX_TRANSACTION_XDR_BYTES,
    );
    if (!transactionXdr.ok) return { status: transactionXdr.status };

    let idempotencyKeyHash: string;
    let requestFingerprint: string;
    try {
      [idempotencyKeyHash, requestFingerprint] = await Promise.all([
        sha256(idempotencyKey.value),
        sha256(transactionXdr.value),
      ]);
    } catch {
      return { status: "internal_error" };
    }

    let facts;
    try {
      facts = deriveGasTransactionFacts(transactionXdr.value);
    } catch (error) {
      return mapEnvelopeError(error) ?? { status: "internal_error" };
    }

    let admission: GasAdmissionResult;
    try {
      admission = await ctx.runMutation(internal.gas.admission.reserve, {
        apiKeyId: scope.apiKeyId,
        projectId: scope.projectId,
        apiKeyHash: args.apiKeyHash,
        idempotencyKeyHash,
        requestFingerprint,
        network: facts.network,
        operation: facts.operation,
        sourceWallet: facts.sourceWallet,
        targetContractIds: [...facts.targetContractIds],
        transactionHash: facts.transactionHash,
        innerMaxFeeStroops: facts.innerMaxFeeStroops,
        ...(facts.innerMaxTime === undefined ? {} : { innerMaxTime: facts.innerMaxTime }),
      });
    } catch {
      return { status: "dependency_unavailable" };
    }

    return mapAdmissionResult(admission);
  },
});

/** Public Convex orchestration seam for the D1 Gas relayer handoff boundary. */
export const submit = action({
  args: {
    apiKeyHash: v.string(),
    requestId: v.string(),
    transactionHash: v.string(),
  },
  returns: gasSubmitResultValidator,
  handler: async (ctx, args): Promise<GasSubmitResult> => {
    let scope;
    try {
      // Keep submit authorization in the same order and scope as sponsor admission.
      scope = await authorize(ctx, args.apiKeyHash);
    } catch {
      return { status: "dependency_unavailable" };
    }

    if (!scope.authorized) return { status: "unauthorized" };

    let requestId: string;
    let transactionHash: string;
    try {
      requestId = normalizeGasRequestId(args.requestId);
      transactionHash = normalizeTransactionHash(args.transactionHash);
    } catch {
      return { status: "invalid_request" };
    }

    let result: GasSubmitMutationResult;
    try {
      result = await ctx.runMutation(internal.gas.submit.submit, {
        apiKeyId: scope.apiKeyId,
        projectId: scope.projectId,
        apiKeyHash: args.apiKeyHash,
        requestId,
        transactionHash,
      });
    } catch {
      return { status: "dependency_unavailable" };
    }

    return mapSubmitResult(result);
  },
});
