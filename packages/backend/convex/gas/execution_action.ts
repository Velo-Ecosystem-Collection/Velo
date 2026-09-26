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
  type TestnetFeeBumpLedgerEvidence,
  type TestnetFeeBumpLookupOutcome,
  type TestnetFeeBumpSendOutcome,
  type TestnetFeeBumpRpcTransport,
} from "@repo/stellar/fee-bump-rpc";
import { TestnetTransactionEnvelopeError } from "@repo/stellar/transaction-envelope";
import { v } from "convex/values";

import type { ActionCtx } from "../_generated/server";
import type { GasApiKeyAuthorizationResult } from "./authorization";
import type {
  GasClaimResult,
  GasSendAuthorizationResult,
  GasSendOutcomeResult,
  GasSequenceDiagnosisResult,
} from "./execution";

import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { deriveGasTransactionFacts } from "./envelope";
import { gasSubmitResultProjectionValidator } from "./projections";
import { RelayerCustodyError, withTestnetRelayerSigner } from "./relayer";
import { getGasRuntimeEnv } from "./runtime_env";
import { GAS_MAX_SEND_COUNT } from "./types";
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
    rpcUrl?: string,
  ) => TestnetFeeBumpRpcAdapter;
  /** Injected transport for deterministic fallback-endpoint tests. */
  fallbackRpcTransport?: TestnetFeeBumpRpcTransport;
  /** Injected action clock, sleep, and jitter source. */
  clock?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
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
  if (result.status === "not_due") return { status: "dependency_unavailable" };
  return result;
}

function sendClassification(
  outcome: Exclude<TestnetFeeBumpSendOutcome, { status: "preflight_failed" }>,
  sendCount: number,
) {
  switch (outcome.status) {
    case "pending":
    case "duplicate":
    case "retry_later":
      return {
        status: outcome.status,
        outerTransactionHash: outcome.outerTransactionHash,
        sendCount,
      } as const;
    case "rejected":
      return {
        status: outcome.status,
        outerTransactionHash: outcome.outerTransactionHash,
        sendCount,
        ...(outcome.resultCode === undefined ? {} : { resultCode: outcome.resultCode }),
        ...(outcome.innerResultCode === undefined
          ? {}
          : { innerResultCode: outcome.innerResultCode }),
      } as const;
    case "unknown":
      return {
        status: outcome.status,
        outerTransactionHash: outcome.outerTransactionHash,
        sendCount,
        reason: outcome.reason,
      } as const;
  }
}

type GasSequenceDiagnosisInput = {
  lookupClassification:
    | "found"
    | "not_found"
    | "unavailable"
    | "malformed_response"
    | "wrong_network";
  evidence?: {
    outerTransactionHash: string;
    innerTransactionHash: string;
    feeSource: string;
    feeStroops: bigint;
    ledger: number;
    resultCode: string;
    innerResultCode?: string;
  };
};

function sequenceLookupClassification(
  outcome: TestnetFeeBumpLookupOutcome,
): GasSequenceDiagnosisInput["lookupClassification"] {
  if (outcome.status === "found") return "found";
  if (outcome.status === "not_found") return "not_found";
  if (outcome.status === "unavailable") return "unavailable";
  if (outcome.status === "malformed_response") return "malformed_response";
  return outcome.code === "wrong_network" ? "wrong_network" : "unavailable";
}

function sequenceDiagnosisInput(outcome: TestnetFeeBumpLookupOutcome): GasSequenceDiagnosisInput {
  const lookupClassification = sequenceLookupClassification(outcome);
  if (outcome.status !== "found") return { lookupClassification };

  const evidence: TestnetFeeBumpLedgerEvidence = outcome;
  return {
    lookupClassification,
    evidence: {
      outerTransactionHash: evidence.outerTransactionHash,
      innerTransactionHash: evidence.innerTransactionHash,
      feeSource: evidence.feeSource,
      feeStroops: evidence.feeStroops,
      ledger: evidence.ledger,
      resultCode: evidence.resultCode,
      ...(evidence.innerResultCode === undefined
        ? {}
        : { innerResultCode: evidence.innerResultCode }),
    },
  };
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

function fallbackRpcUrl(): string | undefined {
  const configured = getGasRuntimeEnv().VELO_GAS_TESTNET_FALLBACK_RPC_URL?.trim();
  return configured === "" ? undefined : configured;
}

function isFallbackEligible(
  outcome: TestnetFeeBumpSendOutcome,
): outcome is Extract<TestnetFeeBumpSendOutcome, { status: "preflight_failed" }> {
  return (
    outcome.status === "preflight_failed" &&
    (outcome.code === "network_timeout" || outcome.code === "network_unavailable")
  );
}

function isRetryableOutcome(
  outcome: Exclude<TestnetFeeBumpSendOutcome, { status: "preflight_failed" }>,
): boolean {
  return (
    outcome.status === "retry_later" ||
    (outcome.status === "unknown" &&
      (outcome.reason === "timeout" || outcome.reason === "transport_failure"))
  );
}

function retryDelayMs(sendCount: number, random: () => number): number | null {
  if (sendCount >= GAS_MAX_SEND_COUNT) return null;
  const base = sendCount === 1 ? 1_000 : 2_000;
  const jitter = Math.min(1, Math.max(0, random()));
  return Math.floor(base * (1 + jitter * 0.5));
}

async function defaultSleep(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
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

  let requestId: string;
  let requestFingerprint: string;
  let facts: ReturnType<typeof deriveGasTransactionFacts>;
  let quote: ReturnType<typeof quoteTestnetFeeBump>;
  let normalizedXdr: string;
  try {
    const normalized = normalizeXdr(args.transactionXdr);
    if (!normalized.ok) return { status: normalized.status };
    normalizedXdr = normalized.value;
    requestId = normalizeGasRequestId(args.requestId);
    requestFingerprint = await sha256(normalizedXdr);
    facts = deriveGasTransactionFacts(normalizedXdr);
    quote = quoteTestnetFeeBump(normalizedXdr);
  } catch (error) {
    if (error instanceof TestnetTransactionEnvelopeError) return { status: error.code };
    if (error instanceof TestnetFeeBumpError) return mapFeeBumpError(error);
    return { status: "invalid_internal_input" };
  }

  let claim = await claimGasExecution(ctx, args, scope);
  if (claim.status !== "claimed") return claim;

  if (claim.replayed) {
    let recovery: GasClaimResult | { status: "relayer_preflight_required" };
    try {
      recovery = await ctx.runMutation(internal.gas.execution.recoverClaim, {
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
      });
    } catch {
      return { status: "dependency_unavailable" };
    }

    if (recovery.status === "relayer_preflight_required") {
      let readiness;
      try {
        readiness = await ctx.runAction(internal.gas.relayer.readiness, {
          projectId: scope.projectId,
        });
      } catch {
        return { status: "dependency_unavailable" };
      }
      if (
        readiness.status !== "ready" ||
        readiness.network !== facts.network ||
        readiness.publicKey === null
      ) {
        return { status: "relayer_unavailable" };
      }
      try {
        recovery = await ctx.runMutation(internal.gas.execution.recoverClaim, {
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
          expectedRelayerPublicKey: readiness.publicKey,
        });
      } catch {
        return { status: "dependency_unavailable" };
      }
    }

    if (recovery.status !== "claimed") {
      if (recovery.status === "relayer_preflight_required") {
        return { status: "dependency_unavailable" };
      }
      return recovery;
    }
    claim = recovery;
    if (claim.replayed) return claim;
  }

  if (claim.leaseToken === null || claim.relayerPublicKey === "") {
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

  const clock = dependencies.clock ?? Date.now;
  const sleep = dependencies.sleep ?? defaultSleep;
  const random = dependencies.random ?? Math.random;
  const primaryUrl = rpcUrl();
  const fallbackUrl = fallbackRpcUrl();
  const canUseFallback = fallbackUrl !== undefined && fallbackUrl !== primaryUrl;

  type IterationResult =
    | { kind: "complete"; result: GasClaimResult }
    | { kind: "retry"; result: Extract<GasClaimResult, { status: "claimed" }>; delay: number };

  let currentClaim = claim;
  let fallbackSwitched = false;

  for (;;) {
    const reservationExpiresAt = Date.parse(currentClaim.execution.expiresAt);
    if (!Number.isFinite(reservationExpiresAt) || clock() >= reservationExpiresAt) {
      if (currentClaim.sendCount === 0) {
        try {
          const expiry = await ctx.runMutation(internal.gas.execution.recoverClaim, {
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
            expectedRelayerPublicKey: currentClaim.relayerPublicKey,
          });
          return expiry.status === "relayer_preflight_required"
            ? ({ status: "dependency_unavailable" } as GasClaimFailure)
            : expiry;
        } catch {
          return { status: "dependency_unavailable" } as GasClaimFailure;
        }
      }

      // Once a possible send exists, do not rebuild or re-enter transport
      // after expiry. The current projection remains held for reconciliation.
      return currentClaim;
    }

    let iteration: IterationResult;
    try {
      iteration = await withTestnetRelayerSigner(
        ctx,
        scope.projectId,
        async (signer): Promise<IterationResult> => {
          // Custody is resolved for this signing iteration only. Rotation or
          // disablement cannot reuse an earlier callback-scoped keypair.
          if (signer.publicKey !== currentClaim.relayerPublicKey) {
            return { kind: "complete", result: { status: "relayer_unavailable" } };
          }

          let built;
          try {
            built = buildTestnetFeeBumpTransaction(
              normalizedXdr,
              quote.baseFeeStroops,
              currentClaim.approvedHoldStroops,
              signer,
            );
          } catch (error) {
            return {
              kind: "complete",
              result:
                error instanceof TestnetFeeBumpError
                  ? mapFeeBumpError(error)
                  : ({ status: "invalid_internal_input" } as const),
            };
          }

          if (
            built.innerTransactionHash !== quote.innerTransactionHash ||
            built.outerMaxFeeStroops !== currentClaim.approvedHoldStroops ||
            built.feeSource !== currentClaim.relayerPublicKey ||
            (currentClaim.outerTransactionHash !== null &&
              built.outerTransactionHash !== currentClaim.outerTransactionHash)
          ) {
            return { kind: "complete", result: { status: "invalid_internal_input" } };
          }

          let authorization: GasSendAuthorizationResult | null = null;
          const authorize: TestnetFeeBumpRpcAuthorizationHook = async () => {
            try {
              authorization = await ctx.runMutation(internal.gas.execution.authorizeSend, {
                apiKeyId: scope.apiKeyId,
                projectId: scope.projectId,
                apiKeyHash: args.apiKeyHash,
                executionAttemptId: currentClaim.executionAttemptId,
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
                leaseToken: currentClaim.leaseToken!,
                leaseGeneration: currentClaim.leaseGeneration,
                expectedSendCount: currentClaim.sendCount,
              });
            } catch {
              authorization = null;
              throw new Error("send authorization unavailable");
            }
            return authorization.status === "authorized";
          };

          const makeAdapter = (
            endpoint: string | undefined,
            transport?: TestnetFeeBumpRpcTransport,
          ) =>
            dependencies.rpcAdapterFactory?.(authorize, endpoint) ??
            createTestnetFeeBumpRpcAdapter({
              ...(endpoint === undefined ? {} : { rpcUrl: endpoint }),
              ...(transport === undefined ? {} : { transport }),
              authorizeSend: authorize,
            });

          const sendRequest = {
            signedOuterXdr: built.signedOuterXdr,
            expectedOuterHash: built.outerTransactionHash,
            expectedInnerHash: built.innerTransactionHash,
            feeSource: built.feeSource,
            approvedFeeCeilingStroops: currentClaim.approvedHoldStroops,
          };
          let adapter: TestnetFeeBumpRpcAdapter;
          let outcome: TestnetFeeBumpSendOutcome;
          const usingFallback = fallbackSwitched && canUseFallback;
          try {
            adapter = makeAdapter(
              usingFallback ? fallbackUrl : primaryUrl,
              usingFallback ? dependencies.fallbackRpcTransport : dependencies.rpcTransport,
            );
            outcome = await adapter.send(sendRequest);
            if (!usingFallback && isFallbackEligible(outcome) && canUseFallback) {
              fallbackSwitched = true;
              adapter = makeAdapter(fallbackUrl, dependencies.fallbackRpcTransport);
              outcome = await adapter.send(sendRequest);
            }
          } catch {
            return { kind: "complete", result: { status: "dependency_unavailable" } };
          }
          if (outcome.status === "preflight_failed") {
            if (outcome.code === "send_authorization_denied" && authorization !== null) {
              return { kind: "complete", result: mapAuthorizationFailure(authorization) };
            }
            return { kind: "complete", result: mapRpcPreflightError(outcome.code) };
          }
          const authorized = authorization as GasSendAuthorizationResult | null;
          if (authorized === null || authorized.status !== "authorized") {
            return { kind: "complete", result: { status: "dependency_unavailable" } };
          }

          const sendCount = authorized.sendCount;
          const delay = isRetryableOutcome(outcome) ? retryDelayMs(sendCount, random) : null;
          const nextSendAt = delay === null ? undefined : clock() + delay;
          let recorded: GasSendOutcomeResult;
          try {
            recorded = await ctx.runMutation(internal.gas.execution.recordSendOutcome, {
              executionAttemptId: currentClaim.executionAttemptId,
              projectId: scope.projectId,
              outerTransactionHash: built.outerTransactionHash,
              sendCount,
              leaseToken: currentClaim.leaseToken!,
              leaseGeneration: currentClaim.leaseGeneration,
              ...(nextSendAt === undefined ? {} : { nextSendAt }),
              classification: sendClassification(outcome, sendCount),
            });
          } catch {
            return { kind: "complete", result: { status: "dependency_unavailable" } };
          }
          if (recorded.status !== "recorded") return { kind: "complete", result: recorded };

          if (outcome.status === "rejected" && outcome.innerResultCode === "txBadSeq") {
            let lookupOutcome: TestnetFeeBumpLookupOutcome;
            try {
              lookupOutcome = await adapter.lookup(built.outerTransactionHash);
            } catch {
              lookupOutcome = { status: "unavailable" };
            }

            let diagnosis: GasSequenceDiagnosisResult;
            try {
              diagnosis = await ctx.runMutation(internal.gas.execution.recordSequenceDiagnosis, {
                executionAttemptId: currentClaim.executionAttemptId,
                projectId: scope.projectId,
                outerTransactionHash: built.outerTransactionHash,
                sendCount: recorded.sendCount,
                leaseToken: currentClaim.leaseToken!,
                leaseGeneration: currentClaim.leaseGeneration,
                diagnosis: sequenceDiagnosisInput(lookupOutcome),
              });
            } catch {
              return { kind: "complete", result: { status: "dependency_unavailable" } };
            }
            if (diagnosis.status !== "recorded") {
              return { kind: "complete", result: diagnosis };
            }
          }

          if (
            isRetryableOutcome(outcome) &&
            recorded.sendCount < GAS_MAX_SEND_COUNT &&
            nextSendAt !== undefined
          ) {
            if (
              fallbackSwitched === false &&
              outcome.status === "unknown" &&
              (outcome.reason === "timeout" || outcome.reason === "transport_failure") &&
              canUseFallback
            ) {
              fallbackSwitched = true;
            }
            const recordedReservationExpiresAt = Date.parse(recorded.execution.expiresAt);
            const nextClaim = {
              ...currentClaim,
              outerTransactionHash: recorded.execution.outerTransactionHash,
              sendCount: recorded.sendCount,
              execution: recorded.execution,
            };
            if (clock() >= recordedReservationExpiresAt) {
              return { kind: "complete", result: nextClaim };
            }
            if (delay === null) return { kind: "complete", result: nextClaim };
            return { kind: "retry", result: nextClaim, delay };
          }

          return {
            kind: "complete",
            result: {
              ...currentClaim,
              outerTransactionHash: recorded.execution.outerTransactionHash,
              sendCount: recorded.sendCount,
              execution: recorded.execution,
            },
          };
        },
      );
    } catch (error) {
      if (error instanceof RelayerCustodyError) return { status: "relayer_unavailable" };
      return { status: "dependency_unavailable" };
    }

    if (iteration.kind === "complete") return iteration.result;
    currentClaim = iteration.result;
    try {
      await sleep(Math.max(0, iteration.delay));
    } catch {
      return { status: "dependency_unavailable" };
    }
  }
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
