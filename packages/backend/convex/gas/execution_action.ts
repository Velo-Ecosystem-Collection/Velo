"use node";

import { quoteTestnetFeeBump } from "@repo/stellar/fee-bump";
import { TestnetTransactionEnvelopeError } from "@repo/stellar/transaction-envelope";
import { v } from "convex/values";

import type { ActionCtx } from "../_generated/server";
import type { GasApiKeyAuthorizationResult } from "./authorization";
import type { GasClaimResult } from "./execution";

import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { deriveGasTransactionFacts } from "./envelope";
import { gasSubmitResultProjectionValidator } from "./projections";
import {
  GAS_MAX_TRANSACTION_XDR_BYTES,
  normalizeGasRequestId,
  normalizeTransactionHash,
} from "./validation";

export const gasClaimArgsValidator = {
  apiKeyHash: v.string(),
  requestId: v.string(),
  transactionXdr: v.string(),
  transactionHash: v.optional(v.string()),
};

export type GasClaimActionArgs = {
  apiKeyHash: string;
  requestId: string;
  transactionXdr: string;
  transactionHash?: string;
};

const claimResultValidator = v.union(
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

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeXdr(
  value: string,
): { ok: true; value: string } | { ok: false; status: "invalid_request" | "payload_too_large" } {
  const normalized = value.trim();
  if (normalized.length === 0) return { ok: false, status: "invalid_request" };
  if (new TextEncoder().encode(normalized).byteLength > GAS_MAX_TRANSACTION_XDR_BYTES) {
    return { ok: false, status: "payload_too_large" };
  }
  return { ok: true, value: normalized };
}

function mapQuoteError(): "invalid_request" {
  return "invalid_request";
}

export async function claimGasExecution(
  ctx: ActionCtx,
  args: GasClaimActionArgs,
  authorizedScope?: Extract<GasApiKeyAuthorizationResult, { authorized: true }>,
): Promise<GasClaimResult> {
  let scope = authorizedScope;
  if (scope === undefined) {
    try {
      // Authorization is deliberately the first database operation.
      const authorization = await ctx.runQuery(internal.gas.public_api_internal.authorize, {
        apiKeyHash: args.apiKeyHash,
      });
      if (!authorization.authorized) return { status: "unauthorized" };
      scope = authorization;
    } catch {
      return { status: "dependency_unavailable" };
    }
  }

  const normalizedXdr = normalizeXdr(args.transactionXdr);
  if (!normalizedXdr.ok) return { status: normalizedXdr.status };

  let requestId: string;
  let facts;
  let requestFingerprint: string;
  try {
    requestId = normalizeGasRequestId(args.requestId);
    requestFingerprint = await sha256(normalizedXdr.value);
    facts = deriveGasTransactionFacts(normalizedXdr.value);
    if (
      args.transactionHash !== undefined &&
      normalizeTransactionHash(args.transactionHash) !== facts.transactionHash
    ) {
      return { status: "invalid_lifecycle" };
    }
  } catch (error) {
    if (error instanceof TestnetTransactionEnvelopeError) {
      return { status: error.code };
    }
    return { status: "invalid_request" };
  }

  const quote = (() => {
    try {
      // The default base fee is intentionally derived from the immutable inner
      // envelope; callers cannot choose a fee source or ceiling.
      return quoteTestnetFeeBump(normalizedXdr.value);
    } catch {
      return mapQuoteError();
    }
  })();
  if (quote === "invalid_request") return { status: quote };

  let relayerPublicKey: string;
  try {
    const readiness = await ctx.runAction(internal.gas.relayer.readiness, {
      projectId: scope.projectId,
    });
    if (
      readiness.status !== "ready" ||
      readiness.network !== facts.network ||
      readiness.publicKey === null
    ) {
      return { status: "relayer_unavailable" };
    }
    relayerPublicKey = readiness.publicKey;
  } catch {
    return { status: "dependency_unavailable" };
  }

  try {
    return await ctx.runMutation(internal.gas.execution.claim, {
      apiKeyId: scope.apiKeyId,
      projectId: scope.projectId,
      apiKeyHash: args.apiKeyHash,
      network: facts.network,
      operation: facts.operation,
      requestId,
      requestFingerprint,
      innerTransactionHash: facts.transactionHash,
      sourceWallet: facts.sourceWallet,
      targetContractIds: [...facts.targetContractIds],
      innerMaxFeeStroops: facts.innerMaxFeeStroops,
      ...(facts.innerMaxTime === undefined ? {} : { innerMaxTime: facts.innerMaxTime }),
      quote,
      expectedRelayerPublicKey: relayerPublicKey,
    });
  } catch {
    return { status: "dependency_unavailable" };
  }
}

async function claimHandler(ctx: ActionCtx, args: GasClaimActionArgs): Promise<GasClaimResult> {
  return await claimGasExecution(ctx, args);
}

/** Private Node orchestration boundary for transient XDR claim requests. */
export const claim = internalAction({
  args: gasClaimArgsValidator,
  returns: claimResultValidator,
  handler: claimHandler,
});

/** Explicit alias for callers that want the transient-XDR name at the boundary. */
export const claimWithXdr = internalAction({
  args: gasClaimArgsValidator,
  returns: claimResultValidator,
  handler: claimHandler,
});
