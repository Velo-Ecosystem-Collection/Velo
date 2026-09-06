"use node";

import {
  buildTestnetFeeBumpTransaction,
  quoteTestnetFeeBump,
  TestnetFeeBumpError,
} from "@repo/stellar/fee-bump";
import {
  createTestnetFeeBumpRpcAdapter,
  type TestnetFeeBumpRpcAdapter,
  type TestnetFeeBumpRpcAuthorizationHook,
  type TestnetFeeBumpRpcPreflightErrorCode,
  type TestnetFeeBumpSendOutcome,
  type TestnetFeeBumpRpcTransport,
} from "@repo/stellar/fee-bump-rpc";
import { TestnetTransactionEnvelopeError } from "@repo/stellar/transaction-envelope";
import { v } from "convex/values";

import type { ActionCtx } from "../_generated/server";
import type { GasApiKeyAuthorizationResult } from "./authorization";
import type { GasClaimResult, GasSendAuthorizationResult, GasSendOutcomeResult } from "./execution";

import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { deriveGasTransactionFacts } from "./envelope";
import { gasSubmitResultProjectionValidator } from "./projections";
import { RelayerCustodyError, withTestnetRelayerSigner } from "./relayer";
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
    relayerPublicKey: v.string(),
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

  try {
    const replay = await ctx.runQuery(internal.gas.execution.findClaimReplay, {
      projectId: scope.projectId,
      requestId,
      requestFingerprint,
      innerTransactionHash: facts.transactionHash,
    });
    if (replay.status !== "none") return replay;
  } catch {
    return { status: "dependency_unavailable" };
  }

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

export type GasExecutionDependencies = Readonly<{
  /** Injected transport used by deterministic backend tests. */
  rpcTransport?: TestnetFeeBumpRpcTransport;
  /** Optional adapter factory used by deterministic integration harnesses. */
  rpcAdapterFactory?: (
    authorizeSend: TestnetFeeBumpRpcAuthorizationHook,
  ) => TestnetFeeBumpRpcAdapter;
}>;

type GasClaimFailure = Exclude<GasClaimResult, { status: "claimed" }>;

function mapFeeBumpError(error: TestnetFeeBumpError): GasClaimFailure {
  switch (error.code) {
    case "invalid_request":
      return { status: "invalid_request" };
    case "invalid_signature":
      return { status: "invalid_signature" };
    case "wrong_network":
      return { status: "wrong_network" };
    case "unsupported_transaction":
      return { status: "unsupported_transaction" };
    case "signer_failure":
      return { status: "relayer_unavailable" };
    case "invalid_fee":
    case "fee_overflow":
    case "insufficient_base_fee":
    case "fee_ceiling_exceeded":
    case "invalid_signer":
      return { status: "invalid_internal_input" };
  }
}

function mapRpcPreflightError(code: TestnetFeeBumpRpcPreflightErrorCode): GasClaimFailure {
  switch (code) {
    case "invalid_request":
      return { status: "invalid_request" };
    case "invalid_signature":
      return { status: "invalid_signature" };
    case "wrong_network":
      return { status: "wrong_network" };
    case "unsupported_transaction":
      return { status: "unsupported_transaction" };
    case "network_timeout":
    case "network_unavailable":
    case "network_response_malformed":
    case "send_authorization_unavailable":
      return { status: "dependency_unavailable" };
    case "send_authorization_denied":
      return { status: "dependency_unavailable" };
    case "invalid_outer_hash":
    case "invalid_inner_hash":
    case "invalid_fee_source":
    case "invalid_fee_ceiling":
    case "outer_hash_mismatch":
    case "inner_hash_mismatch":
    case "fee_source_mismatch":
    case "fee_ceiling_exceeded":
      return { status: "invalid_internal_input" };
  }
}

function mapAuthorizationFailure(result: GasSendAuthorizationResult): GasClaimFailure {
  if (result.status === "authorized") return { status: "invalid_internal_input" };
  return result;
}

function sendClassification(
  outcome: Exclude<TestnetFeeBumpSendOutcome, { status: "preflight_failed" }>,
) {
  switch (outcome.status) {
    case "pending":
    case "duplicate":
    case "retry_later":
      return {
        status: outcome.status,
        outerTransactionHash: outcome.outerTransactionHash,
        sendCount: 1,
      } as const;
    case "rejected":
      return {
        status: outcome.status,
        outerTransactionHash: outcome.outerTransactionHash,
        sendCount: 1,
        ...(outcome.resultCode === undefined ? {} : { resultCode: outcome.resultCode }),
      } as const;
    case "unknown":
      return {
        status: outcome.status,
        outerTransactionHash: outcome.outerTransactionHash,
        sendCount: 1,
        reason: outcome.reason,
      } as const;
  }
}

async function authorizedScope(
  ctx: ActionCtx,
  apiKeyHash: string,
  provided?: Extract<GasApiKeyAuthorizationResult, { authorized: true }>,
): Promise<
  | Extract<GasApiKeyAuthorizationResult, { authorized: true }>
  | { status: "unauthorized" | "dependency_unavailable" }
> {
  if (provided !== undefined) return provided;
  try {
    const result = await ctx.runQuery(internal.gas.public_api_internal.authorize, { apiKeyHash });
    return result.authorized ? result : { status: "unauthorized" };
  } catch {
    return { status: "dependency_unavailable" };
  }
}

function rpcUrl(): string | undefined {
  return process.env.STELLAR_RPC_URL ?? process.env.NEXT_PUBLIC_STELLAR_RPC_URL;
}

/**
 * Claim and execute one newly granted attempt. Replays stop at the current
 * safe projection and never re-enter custody, signing, or transport.
 */
export async function executeGasExecution(
  ctx: ActionCtx,
  args: GasClaimActionArgs,
  providedScope?: Extract<GasApiKeyAuthorizationResult, { authorized: true }>,
  dependencies: GasExecutionDependencies = {},
): Promise<GasClaimResult> {
  const scope = await authorizedScope(ctx, args.apiKeyHash, providedScope);
  if ("status" in scope) return scope;

  const claim = await claimGasExecution(ctx, args, scope);
  if (claim.status !== "claimed") return claim;
  if (claim.replayed) return claim;
  if (claim.leaseToken === null || claim.relayerPublicKey === "") {
    return { status: "invalid_internal_input" };
  }

  let requestId: string;
  let requestFingerprint: string;
  let facts: ReturnType<typeof deriveGasTransactionFacts>;
  let quote: ReturnType<typeof quoteTestnetFeeBump>;
  try {
    const normalizedXdr = normalizeXdr(args.transactionXdr);
    if (!normalizedXdr.ok) return { status: normalizedXdr.status };
    requestId = normalizeGasRequestId(args.requestId);
    requestFingerprint = await sha256(normalizedXdr.value);
    facts = deriveGasTransactionFacts(normalizedXdr.value);
    quote = quoteTestnetFeeBump(normalizedXdr.value);
  } catch (error) {
    if (error instanceof TestnetTransactionEnvelopeError) return { status: error.code };
    if (error instanceof TestnetFeeBumpError) return mapFeeBumpError(error);
    return { status: "invalid_internal_input" };
  }

  if (
    quote.innerTransactionHash !== claim.innerTransactionHash ||
    quote.outerMaxFeeStroops !== claim.approvedHoldStroops ||
    facts.network !== "testnet" ||
    facts.operation !== "invokeHostFunction"
  ) {
    return { status: "invalid_internal_input" };
  }

  let continuation:
    | { status: "recorded"; outcome: Extract<GasSendOutcomeResult, { status: "recorded" }> }
    | GasClaimFailure;
  try {
    continuation = await withTestnetRelayerSigner(ctx, scope.projectId, async (signer) => {
      if (signer.publicKey !== claim.relayerPublicKey) {
        return { status: "relayer_unavailable" };
      }

      let built;
      try {
        built = buildTestnetFeeBumpTransaction(
          args.transactionXdr,
          quote.baseFeeStroops,
          claim.approvedHoldStroops,
          signer,
        );
      } catch (error) {
        return error instanceof TestnetFeeBumpError
          ? mapFeeBumpError(error)
          : ({ status: "invalid_internal_input" } as const);
      }

      if (built.innerTransactionHash !== quote.innerTransactionHash) {
        return { status: "invalid_internal_input" };
      }
      if (
        built.outerMaxFeeStroops > claim.approvedHoldStroops ||
        built.feeSource !== claim.relayerPublicKey
      ) {
        return { status: "invalid_internal_input" };
      }

      let authorization: GasSendAuthorizationResult | null = null;
      const authorize: TestnetFeeBumpRpcAuthorizationHook = async () => {
        try {
          authorization = await ctx.runMutation(internal.gas.execution.authorizeSend, {
            apiKeyId: scope.apiKeyId,
            projectId: scope.projectId,
            apiKeyHash: args.apiKeyHash,
            executionAttemptId: claim.executionAttemptId,
            network: facts.network,
            operation: facts.operation,
            requestId,
            requestFingerprint,
            innerTransactionHash: facts.transactionHash,
            sourceWallet: facts.sourceWallet,
            targetContractIds: [...facts.targetContractIds],
            innerMaxFeeStroops: facts.innerMaxFeeStroops,
            ...(facts.innerMaxTime === undefined ? {} : { innerMaxTime: facts.innerMaxTime }),
            outerTransactionHash: built.outerTransactionHash,
            outerFeeStroops: built.outerMaxFeeStroops,
            feeSource: built.feeSource,
            leaseToken: claim.leaseToken!,
            leaseGeneration: claim.leaseGeneration,
          });
        } catch {
          authorization = null;
          throw new Error("send authorization unavailable");
        }
        return authorization.status === "authorized";
      };

      let adapter: TestnetFeeBumpRpcAdapter;
      try {
        adapter =
          dependencies.rpcAdapterFactory?.(authorize) ??
          createTestnetFeeBumpRpcAdapter({
            ...(rpcUrl() === undefined ? {} : { rpcUrl: rpcUrl() }),
            ...(dependencies.rpcTransport === undefined
              ? {}
              : { transport: dependencies.rpcTransport }),
            authorizeSend: authorize,
          });
      } catch {
        return { status: "dependency_unavailable" };
      }

      const outcome = await adapter.send({
        signedOuterXdr: built.signedOuterXdr,
        expectedOuterHash: built.outerTransactionHash,
        expectedInnerHash: built.innerTransactionHash,
        feeSource: built.feeSource,
        approvedFeeCeilingStroops: claim.approvedHoldStroops,
      });
      if (outcome.status === "preflight_failed") {
        if (outcome.code === "send_authorization_denied" && authorization !== null) {
          return mapAuthorizationFailure(authorization);
        }
        return mapRpcPreflightError(outcome.code);
      }

      let recorded: GasSendOutcomeResult;
      try {
        recorded = await ctx.runMutation(internal.gas.execution.recordSendOutcome, {
          executionAttemptId: claim.executionAttemptId,
          projectId: scope.projectId,
          outerTransactionHash: built.outerTransactionHash,
          sendCount: 1,
          leaseToken: claim.leaseToken!,
          leaseGeneration: claim.leaseGeneration,
          classification: sendClassification(outcome),
        });
      } catch {
        return { status: "dependency_unavailable" };
      }
      if (recorded.status !== "recorded") return recorded;
      return { status: "recorded", outcome: recorded };
    });
  } catch (error) {
    if (error instanceof RelayerCustodyError) return { status: "relayer_unavailable" };
    return { status: "dependency_unavailable" };
  }

  if (continuation.status !== "recorded") return continuation;
  return {
    ...claim,
    outerTransactionHash: continuation.outcome.execution.outerTransactionHash,
    sendCount: continuation.outcome.sendCount,
    execution: continuation.outcome.execution,
  };
}

async function claimHandler(ctx: ActionCtx, args: GasClaimActionArgs): Promise<GasClaimResult> {
  return await claimGasExecution(ctx, args);
}

async function executeHandler(ctx: ActionCtx, args: GasClaimActionArgs): Promise<GasClaimResult> {
  return await executeGasExecution(ctx, args);
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
  handler: executeHandler,
});
