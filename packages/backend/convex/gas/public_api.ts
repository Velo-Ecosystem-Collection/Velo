"use node";

import {
  TestnetTransactionEnvelopeError,
  type TestnetTransactionEnvelopeErrorCode,
} from "@repo/stellar/transaction-envelope";
import { v } from "convex/values";

import type { ActionCtx } from "../_generated/server";
import type { GasAdmissionResult } from "./admission";
import type { GasSubmitResult as GasSubmitMutationResult } from "./submit";

import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import { deriveGasTransactionFacts } from "./envelope";
import { gasLogProjectionValidator, type GasLogProjection } from "./projections";
import { gasRejectionCodeValidator } from "./schema";
import { normalizeGasRequestId, normalizeTransactionHash } from "./validation";

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
  | { status: "internal_error" };

export type GasSubmitResult =
  | { status: "handoff_unavailable" }
  | { status: "reservation_expired" }
  | { status: "invalid_lifecycle" }
  | { status: "resource_not_found" }
  | { status: "unauthorized" }
  | { status: "invalid_request" }
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
  v.object({ status: v.literal("internal_error") }),
);

export const gasSubmitResultValidator = v.union(
  v.object({ status: v.literal("handoff_unavailable") }),
  v.object({ status: v.literal("reservation_expired") }),
  v.object({ status: v.literal("invalid_lifecycle") }),
  v.object({ status: v.literal("resource_not_found") }),
  v.object({ status: v.literal("unauthorized") }),
  v.object({ status: v.literal("invalid_request") }),
  v.object({ status: v.literal("internal_error") }),
);

function normalizeRequiredValue(value: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error("Required Gas sponsor input is empty");
  return normalized;
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
    case "idempotency_key_conflict":
      return { status: "idempotency_key_conflict" };
    case "duplicate_transaction":
      return { status: "duplicate_transaction" };
    case "decision":
      if (result.log.decisionCode === "reserved") {
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

function mapSubmitResult(result: GasSubmitMutationResult): GasSubmitResult {
  switch (result.status) {
    case "unauthorized":
      return { status: "unauthorized" };
    case "invalid_internal_input":
      return { status: "internal_error" };
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
      return { status: "internal_error" };
    }

    if (!scope.authorized) return { status: "unauthorized" };

    let idempotencyKey: string;
    let transactionXdr: string;
    try {
      idempotencyKey = normalizeRequiredValue(args.idempotencyKey);
      transactionXdr = normalizeRequiredValue(args.transactionXdr);
    } catch {
      return { status: "invalid_request" };
    }

    let idempotencyKeyHash: string;
    let requestFingerprint: string;
    try {
      [idempotencyKeyHash, requestFingerprint] = await Promise.all([
        sha256(idempotencyKey),
        sha256(transactionXdr),
      ]);
    } catch {
      return { status: "internal_error" };
    }

    let facts;
    try {
      facts = deriveGasTransactionFacts(transactionXdr);
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
      return { status: "internal_error" };
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
      return { status: "internal_error" };
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
      return { status: "internal_error" };
    }

    return mapSubmitResult(result);
  },
});
