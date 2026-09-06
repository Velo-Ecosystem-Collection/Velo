"use node";

import { quoteTestnetFeeBump } from "@repo/stellar/fee-bump";
import { TestnetTransactionEnvelopeError } from "@repo/stellar/transaction-envelope";
import { v } from "convex/values";

import type { ActionCtx } from "../_generated/server";
import type { GasClaimResult } from "./execution";

import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { deriveGasTransactionFacts } from "./envelope";
import {
  GAS_MAX_TRANSACTION_XDR_BYTES,
  normalizeGasRequestId,
  normalizeTransactionHash,
} from "./validation";

const claimArgs = {
  apiKeyHash: v.string(),
  requestId: v.string(),
  transactionXdr: v.string(),
  transactionHash: v.optional(v.string()),
};

const claimResultValidator = v.union(
  v.object({ status: v.literal("unauthorized") }),
  v.object({ status: v.literal("invalid_internal_input") }),
  v.object({ status: v.literal("resource_not_found") }),
  v.object({ status: v.literal("reservation_expired") }),
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
  }),
);

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isBoundedXdr(value: string): boolean {
  return (
    value.trim().length > 0 &&
    new TextEncoder().encode(value.trim()).byteLength <= GAS_MAX_TRANSACTION_XDR_BYTES
  );
}

async function claimHandler(
  ctx: ActionCtx,
  args: {
    apiKeyHash: string;
    requestId: string;
    transactionXdr: string;
    transactionHash?: string;
  },
): Promise<GasClaimResult> {
  let scope;
  try {
    // Authorization is deliberately the first database operation.
    scope = await ctx.runQuery(internal.gas.public_api_internal.authorize, {
      apiKeyHash: args.apiKeyHash,
    });
  } catch {
    return { status: "invalid_internal_input" };
  }
  if (!scope.authorized) return { status: "unauthorized" };

  if (!isBoundedXdr(args.transactionXdr)) return { status: "invalid_internal_input" };

  let requestId: string;
  let facts;
  let requestFingerprint: string;
  try {
    requestId = normalizeGasRequestId(args.requestId);
    const transactionXdr = args.transactionXdr.trim();
    requestFingerprint = await sha256(transactionXdr);
    facts = deriveGasTransactionFacts(transactionXdr);
    if (
      args.transactionHash !== undefined &&
      normalizeTransactionHash(args.transactionHash) !== facts.transactionHash
    ) {
      return { status: "invalid_internal_input" };
    }
  } catch (error) {
    if (error instanceof TestnetTransactionEnvelopeError) {
      return { status: "invalid_internal_input" };
    }
    return { status: "invalid_internal_input" };
  }

  const quote = (() => {
    try {
      // The default base fee is intentionally derived from the immutable inner
      // envelope; callers cannot choose a fee source or ceiling.
      return quoteTestnetFeeBump(args.transactionXdr.trim());
    } catch {
      return null;
    }
  })();
  if (!quote) return { status: "invalid_internal_input" };

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
    return { status: "invalid_internal_input" };
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
    return { status: "invalid_internal_input" };
  }
}

/** Private Node orchestration boundary for transient XDR claim requests. */
export const claim = internalAction({
  args: claimArgs,
  returns: claimResultValidator,
  handler: claimHandler,
});

/** Explicit alias for callers that want the transient-XDR name at the boundary. */
export const claimWithXdr = internalAction({
  args: claimArgs,
  returns: claimResultValidator,
  handler: claimHandler,
});
