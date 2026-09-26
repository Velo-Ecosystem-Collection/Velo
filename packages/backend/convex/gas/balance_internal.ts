import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { ProjectRole } from "../playground_projects/helpers";
import type { TestnetBalanceFailureReason } from "./balance";
import type { RelayerAccountProjection } from "./projections";

import { internalMutation } from "../_generated/server";
import { consumeBucket } from "../rate_limits/mutations";
import { ensureGasAccounting } from "./accounting";
import { requireGasConsoleAccess, requireGasFundsOwnerAccess } from "./authorization";
import { TESTNET_BALANCE_FAILURE_REASONS } from "./balance";
import { projectRelayerAccount, relayerAccountProjectionValidator } from "./projections";
import { gasNetworkValidator, gasRelayerStatusValidator } from "./schema";
import { GAS_NETWORK } from "./types";
import { assertValidStroopValue, normalizeGasRequestId, parseStroopAmount } from "./validation";

export const RELAYER_BALANCE_REFRESH_COOLDOWN_MS = 30_000;
const GAS_FUNDING_INTENT_TTL_MS = 10 * 60 * 1_000;
export const RELAYER_BALANCE_REFRESH_SCOPE_PREFIX = "gas:relayer-balance:";

export function relayerBalanceRefreshScopeKey(projectId: Id<"projects">): string {
  return `${RELAYER_BALANCE_REFRESH_SCOPE_PREFIX}${projectId}`;
}

const projectRoleValidator = v.union(v.literal("owner"), v.literal("editor"), v.literal("viewer"));

/** The authorization facts captured before the provider read begins. */
export const refreshAuthorizationContextValidator = v.object({
  tokenIdentifier: v.string(),
  subject: v.string(),
  address: v.string(),
  role: projectRoleValidator,
  ownerAddress: v.string(),
  ownerTokenIdentifier: v.union(v.string(), v.null()),
  projectUpdatedAt: v.number(),
  membershipId: v.union(v.id("projectMemberships"), v.null()),
  membershipRole: v.union(projectRoleValidator, v.null()),
  membershipUpdatedAt: v.union(v.number(), v.null()),
});

export type RefreshAuthorizationContext = {
  tokenIdentifier: string;
  subject: string;
  address: string;
  role: ProjectRole;
  ownerAddress: string;
  ownerTokenIdentifier: string | null;
  projectUpdatedAt: number;
  membershipId: Id<"projectMemberships"> | null;
  membershipRole: ProjectRole | null;
  membershipUpdatedAt: number | null;
};

const readerFailureReasonValidator = v.union(
  v.literal(TESTNET_BALANCE_FAILURE_REASONS.invalidAddress),
  v.literal(TESTNET_BALANCE_FAILURE_REASONS.invalidConfiguration),
  v.literal(TESTNET_BALANCE_FAILURE_REASONS.wrongNetwork),
  v.literal(TESTNET_BALANCE_FAILURE_REASONS.timeout),
  v.literal(TESTNET_BALANCE_FAILURE_REASONS.providerFailure),
  v.literal(TESTNET_BALANCE_FAILURE_REASONS.malformedResponse),
);

export const relayerBalanceRefreshResultValidator = v.union(
  v.object({
    status: v.literal("success"),
    relayer: relayerAccountProjectionValidator,
  }),
  v.object({
    status: v.literal("cooldown"),
    retryAfterMs: v.number(),
  }),
  v.object({ status: v.literal("missing_relayer") }),
  v.object({
    status: v.literal("account_not_found"),
    relayer: relayerAccountProjectionValidator,
  }),
  v.object({
    status: v.literal("reader_failure"),
    reason: readerFailureReasonValidator,
    relayer: relayerAccountProjectionValidator,
  }),
  v.object({ status: v.literal("stale_refresh") }),
);

export type RelayerBalanceRefreshResult =
  | { status: "success"; relayer: RelayerAccountProjection }
  | { status: "cooldown"; retryAfterMs: number }
  | { status: "missing_relayer" }
  | { status: "account_not_found"; relayer: RelayerAccountProjection }
  | {
      status: "reader_failure";
      reason: TestnetBalanceFailureReason;
      relayer: RelayerAccountProjection;
    }
  | { status: "stale_refresh" };

const refreshObservationValidator = v.union(
  v.object({
    status: v.literal("success"),
    address: v.string(),
    balanceStroops: v.string(),
  }),
  v.object({ status: v.literal("account_not_found"), address: v.string() }),
  v.object({
    status: v.literal("failure"),
    reason: readerFailureReasonValidator,
  }),
);

const claimResultValidator = v.union(
  v.object({
    status: v.literal("claimed"),
    relayerId: v.id("relayerAccounts"),
    publicKey: v.string(),
    network: gasNetworkValidator,
    relayerStatus: gasRelayerStatusValidator,
    refreshToken: v.string(),
    refreshStartedAt: v.number(),
    authorization: refreshAuthorizationContextValidator,
  }),
  v.object({ status: v.literal("cooldown"), retryAfterMs: v.number() }),
  v.object({ status: v.literal("missing_relayer") }),
);

function sameRefreshAuthorizationContext(
  left: RefreshAuthorizationContext,
  right: RefreshAuthorizationContext,
): boolean {
  return (
    left.tokenIdentifier === right.tokenIdentifier &&
    left.subject === right.subject &&
    left.address === right.address &&
    left.role === right.role &&
    left.ownerAddress === right.ownerAddress &&
    left.ownerTokenIdentifier === right.ownerTokenIdentifier &&
    left.projectUpdatedAt === right.projectUpdatedAt &&
    left.membershipId === right.membershipId &&
    left.membershipRole === right.membershipRole &&
    left.membershipUpdatedAt === right.membershipUpdatedAt
  );
}

async function captureRefreshAuthorization(
  ctx: MutationCtx,
  projectId: Id<"projects">,
): Promise<RefreshAuthorizationContext> {
  const access = await requireGasConsoleAccess(ctx, projectId, "read");
  let membership: {
    _id: Id<"projectMemberships">;
    role: ProjectRole;
    updatedAt: number;
  } | null = null;

  // Ownership is the authoritative role. A membership row is only part of the
  // authorization context when it actually grants the current caller access.
  if (access.role !== "owner") {
    const membershipMatches = await ctx.db
      .query("projectMemberships")
      .withIndex("by_project_and_wallet_address", (q) =>
        q.eq("projectId", projectId).eq("walletAddress", access.address),
      )
      .take(2);
    if (membershipMatches.length > 1) throw new Error("Ambiguous project membership");
    const currentMembership = membershipMatches[0];
    if (!currentMembership) throw new Error("Unauthorized");
    membership = currentMembership;
  }

  return {
    tokenIdentifier: access.identity.tokenIdentifier,
    subject: String(access.identity.subject),
    address: access.address,
    role: access.role,
    ownerAddress: access.project.ownerAddress,
    ownerTokenIdentifier: access.project.ownerTokenIdentifier ?? null,
    projectUpdatedAt: access.project.updatedAt,
    membershipId: membership?._id ?? null,
    membershipRole: membership?.role ?? null,
    membershipUpdatedAt: membership?.updatedAt ?? null,
  };
}

async function findRelayer(ctx: MutationCtx, projectId: Id<"projects">) {
  const matches = await ctx.db
    .query("relayerAccounts")
    .withIndex("by_project_id_and_network", (q) =>
      q.eq("projectId", projectId).eq("network", GAS_NETWORK),
    )
    .take(2);
  if (matches.length > 1) throw new Error("Multiple Gas relayers exist for project");
  return matches[0] ?? null;
}

/** Authorize, consume the shared cooldown, and fence one relayer observation. */
export const claim = internalMutation({
  args: { projectId: v.id("projects") },
  returns: claimResultValidator,
  handler: async (ctx, args) => {
    const authorization = await captureRefreshAuthorization(ctx, args.projectId);
    const relayer = await findRelayer(ctx, args.projectId);
    if (!relayer) return { status: "missing_relayer" as const };

    const now = Date.now();
    const bucket = await consumeBucket(
      ctx,
      relayerBalanceRefreshScopeKey(args.projectId),
      1,
      1 / (RELAYER_BALANCE_REFRESH_COOLDOWN_MS / 1_000),
      now,
    );
    if (!bucket.allowed) {
      return { status: "cooldown" as const, retryAfterMs: bucket.retryAfterMs };
    }

    const refreshToken = crypto.randomUUID();
    await ctx.db.patch(relayer._id, {
      refreshToken,
      refreshStartedAt: now,
      updatedAt: now,
    });

    return {
      status: "claimed" as const,
      relayerId: relayer._id,
      publicKey: relayer.publicKey,
      network: relayer.network,
      relayerStatus: relayer.status,
      refreshToken,
      refreshStartedAt: now,
      authorization,
    };
  },
});

function validExactStroops(value: string): bigint | null {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) return null;
  try {
    return assertValidStroopValue(BigInt(value));
  } catch {
    return null;
  }
}

/** Reauthorize and atomically apply only the still-current observation. */
export const complete = internalMutation({
  args: {
    projectId: v.id("projects"),
    relayerId: v.id("relayerAccounts"),
    publicKey: v.string(),
    network: gasNetworkValidator,
    relayerStatus: gasRelayerStatusValidator,
    refreshToken: v.string(),
    refreshStartedAt: v.number(),
    authorization: refreshAuthorizationContextValidator,
    observation: refreshObservationValidator,
  },
  returns: relayerBalanceRefreshResultValidator,
  handler: async (ctx, args): Promise<RelayerBalanceRefreshResult> => {
    let currentAuthorization: RefreshAuthorizationContext;
    try {
      currentAuthorization = await captureRefreshAuthorization(ctx, args.projectId);
    } catch {
      // A caller that lost access during the provider read receives no snapshot.
      return { status: "stale_refresh" };
    }
    if (!sameRefreshAuthorizationContext(args.authorization, currentAuthorization)) {
      return { status: "stale_refresh" };
    }

    const relayer = await ctx.db.get("relayerAccounts", args.relayerId);
    const now = Date.now();
    if (
      !relayer ||
      relayer.projectId !== args.projectId ||
      relayer.publicKey !== args.publicKey ||
      relayer.network !== args.network ||
      relayer.status !== args.relayerStatus ||
      relayer.refreshToken !== args.refreshToken ||
      relayer.refreshStartedAt !== args.refreshStartedAt
    ) {
      return { status: "stale_refresh" };
    }

    if (
      !Number.isSafeInteger(args.refreshStartedAt) ||
      args.refreshStartedAt <= 0 ||
      now - args.refreshStartedAt >= RELAYER_BALANCE_REFRESH_COOLDOWN_MS
    ) {
      await ctx.db.patch(relayer._id, {
        refreshToken: undefined,
        refreshStartedAt: undefined,
        updatedAt: now,
      });
      return { status: "stale_refresh" };
    }

    const clearRefresh = {
      refreshToken: undefined,
      refreshStartedAt: undefined,
      updatedAt: now,
    };

    if (args.observation.status !== "failure" && args.observation.address !== args.publicKey) {
      await ctx.db.patch(relayer._id, clearRefresh);
      const current = await ctx.db.get("relayerAccounts", relayer._id);
      if (!current) return { status: "stale_refresh" };
      return {
        status: "reader_failure",
        reason: TESTNET_BALANCE_FAILURE_REASONS.malformedResponse,
        relayer: projectRelayerAccount(current),
      };
    }

    if (args.observation.status === "success") {
      const balanceStroops = validExactStroops(args.observation.balanceStroops);
      if (balanceStroops === null) {
        await ctx.db.patch(relayer._id, clearRefresh);
        const current = await ctx.db.get("relayerAccounts", relayer._id);
        if (!current) return { status: "stale_refresh" };
        return {
          status: "reader_failure",
          reason: TESTNET_BALANCE_FAILURE_REASONS.malformedResponse,
          relayer: projectRelayerAccount(current),
        };
      }

      await ctx.db.patch(relayer._id, {
        ...clearRefresh,
        balanceStroops,
        balanceUpdatedAt: now,
      });
      const current = await ctx.db.get("relayerAccounts", relayer._id);
      if (!current) return { status: "stale_refresh" };
      return { status: "success", relayer: projectRelayerAccount(current) };
    }

    await ctx.db.patch(relayer._id, clearRefresh);
    const current = await ctx.db.get("relayerAccounts", relayer._id);
    if (!current) return { status: "stale_refresh" };
    if (args.observation.status === "account_not_found") {
      return { status: "account_not_found", relayer: projectRelayerAccount(current) };
    }
    return {
      status: "reader_failure",
      reason: args.observation.reason,
      relayer: projectRelayerAccount(current),
    };
  },
});

const fundingOperationValidator = v.union(v.literal("create_account"), v.literal("payment"));
const fundingIntentStatusValidator = v.union(
  v.literal("prepared"),
  v.literal("sending"),
  v.literal("submission_unknown"),
  v.literal("verified"),
  v.literal("failed"),
);

const fundingIntentFactsValidator = v.object({
  requestId: v.string(),
  operation: fundingOperationValidator,
  sourceWallet: v.string(),
  destinationPublicKey: v.string(),
  relayerId: v.id("relayerAccounts"),
  amountStroops: v.string(),
  feeStroops: v.string(),
  preparedTransactionHash: v.string(),
  transactionHash: v.union(v.string(), v.null()),
  status: fundingIntentStatusValidator,
  expiresAt: v.number(),
  verifiedLedger: v.union(v.number(), v.null()),
});

/** Owner authorization and the current Testnet destination before Horizon access. */
export const prepareFunding = internalMutation({
  args: { projectId: v.id("projects"), amountStroops: v.string() },
  returns: v.union(
    v.object({ status: v.literal("amount_invalid") }),
    v.object({ status: v.literal("missing_relayer") }),
    v.object({ status: v.literal("relayer_disabled") }),
    v.object({
      status: v.literal("ready"),
      sourceWallet: v.string(),
      relayerId: v.id("relayerAccounts"),
      publicKey: v.string(),
      amountStroops: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const access = await requireGasConsoleAccess(ctx, args.projectId, "updateRelayer");
    let amount: bigint;
    try {
      amount = parseStroopAmount(args.amountStroops);
      if (amount === 0n) return { status: "amount_invalid" as const };
    } catch {
      return { status: "amount_invalid" as const };
    }
    const relayer = await findRelayer(ctx, args.projectId);
    if (!relayer) return { status: "missing_relayer" as const };
    if (relayer.status !== "active") return { status: "relayer_disabled" as const };
    return {
      status: "ready" as const,
      sourceWallet: access.address,
      relayerId: relayer._id,
      publicKey: relayer.publicKey,
      amountStroops: amount.toString(),
    };
  },
});

export const storeFundingIntent = internalMutation({
  args: {
    projectId: v.id("projects"),
    requestId: v.string(),
    operation: fundingOperationValidator,
    sourceWallet: v.string(),
    destinationPublicKey: v.string(),
    relayerId: v.id("relayerAccounts"),
    amountStroops: v.string(),
    feeStroops: v.string(),
    preparedTransactionHash: v.string(),
    expiresAt: v.number(),
  },
  returns: v.literal("stored"),
  handler: async (ctx, args) => {
    const access = await requireGasConsoleAccess(ctx, args.projectId, "updateRelayer");
    if (access.address !== args.sourceWallet) throw new Error("Funding source wallet changed");
    const requestId = normalizeGasRequestId(args.requestId);
    const amountStroops = parseStroopAmount(args.amountStroops);
    const feeStroops = parseStroopAmount(args.feeStroops);
    if (!/^[a-f0-9]{64}$/.test(args.preparedTransactionHash)) {
      throw new Error("Invalid prepared funding transaction identity");
    }
    const now = Date.now();
    if (args.expiresAt <= now || args.expiresAt > now + GAS_FUNDING_INTENT_TTL_MS + 5_000) {
      throw new Error("Funding intent expiry is invalid");
    }
    const relayer = await findRelayer(ctx, args.projectId);
    if (
      !relayer ||
      relayer._id !== args.relayerId ||
      relayer.publicKey !== args.destinationPublicKey ||
      relayer.status !== "active"
    ) {
      throw new Error("Relayer changed while funding was prepared");
    }
    const matches = await ctx.db
      .query("gasFundingIntents")
      .withIndex("by_project_id_and_request_id", (q) =>
        q.eq("projectId", args.projectId).eq("requestId", requestId),
      )
      .take(2);
    if (matches.length !== 0) throw new Error("Funding request ID already exists");
    await ctx.db.insert("gasFundingIntents", {
      projectId: args.projectId,
      requestId,
      network: GAS_NETWORK,
      operation: args.operation,
      sourceWallet: args.sourceWallet,
      destinationPublicKey: args.destinationPublicKey,
      relayerId: args.relayerId,
      amountStroops,
      feeStroops,
      preparedTransactionHash: args.preparedTransactionHash,
      status: "prepared",
      expiresAt: args.expiresAt,
      createdAt: now,
      updatedAt: now,
    });
    return "stored" as const;
  },
});

export const claimFundingSubmission = internalMutation({
  args: { projectId: v.id("projects"), requestId: v.string() },
  returns: v.union(
    v.object({ status: v.literal("not_found") }),
    v.object({ status: v.literal("expired") }),
    v.object({ status: v.literal("not_submittable") }),
    v.object({ status: v.literal("relayer_changed") }),
    v.object({ status: v.literal("already_verified"), transactionHash: v.string() }),
    v.object({ status: v.literal("ready"), intent: fundingIntentFactsValidator }),
  ),
  handler: async (ctx, args) => {
    await requireGasConsoleAccess(ctx, args.projectId, "updateRelayer");
    const requestId = normalizeGasRequestId(args.requestId);
    const matches = await ctx.db
      .query("gasFundingIntents")
      .withIndex("by_project_id_and_request_id", (q) =>
        q.eq("projectId", args.projectId).eq("requestId", requestId),
      )
      .take(2);
    const intent = matches[0];
    if (matches.length !== 1 || !intent) return { status: "not_found" as const };
    if (intent.status === "verified" && intent.transactionHash) {
      return { status: "already_verified" as const, transactionHash: intent.transactionHash };
    }
    if (intent.status === "failed") return { status: "not_submittable" as const };
    if (intent.status === "prepared" && intent.expiresAt <= Date.now()) {
      await ctx.db.patch(intent._id, {
        status: "failed",
        errorCode: "submission_failed",
        updatedAt: Date.now(),
      });
      return { status: "expired" as const };
    }
    const relayer = await findRelayer(ctx, args.projectId);
    if (
      !relayer ||
      relayer._id !== intent.relayerId ||
      relayer.publicKey !== intent.destinationPublicKey
    ) {
      return { status: "relayer_changed" as const };
    }
    return {
      status: "ready" as const,
      intent: {
        requestId: intent.requestId,
        operation: intent.operation,
        sourceWallet: intent.sourceWallet,
        destinationPublicKey: intent.destinationPublicKey,
        relayerId: intent.relayerId,
        amountStroops: intent.amountStroops.toString(),
        feeStroops: intent.feeStroops.toString(),
        preparedTransactionHash: intent.preparedTransactionHash,
        transactionHash: intent.transactionHash ?? null,
        status: intent.status,
        expiresAt: intent.expiresAt,
        verifiedLedger: intent.verifiedLedger ?? null,
      },
    };
  },
});

export const authorizeFundingSend = internalMutation({
  args: {
    projectId: v.id("projects"),
    requestId: v.string(),
    preparedTransactionHash: v.string(),
    transactionHash: v.string(),
  },
  returns: v.union(v.literal("authorized"), v.literal("already_verified"), v.literal("mismatch")),
  handler: async (ctx, args): Promise<"authorized" | "already_verified" | "mismatch"> => {
    await requireGasConsoleAccess(ctx, args.projectId, "updateRelayer");
    const matches = await ctx.db
      .query("gasFundingIntents")
      .withIndex("by_project_id_and_request_id", (q) =>
        q.eq("projectId", args.projectId).eq("requestId", normalizeGasRequestId(args.requestId)),
      )
      .take(2);
    const intent = matches[0];
    if (matches.length !== 1 || !intent) return "mismatch";
    if (intent.status === "verified" && intent.transactionHash === args.transactionHash) {
      return "already_verified";
    }
    if (
      intent.preparedTransactionHash !== args.preparedTransactionHash ||
      args.preparedTransactionHash !== args.transactionHash ||
      (intent.status !== "prepared" &&
        intent.status !== "submission_unknown" &&
        intent.status !== "sending") ||
      (intent.transactionHash !== undefined && intent.transactionHash !== args.transactionHash)
    ) {
      return "mismatch";
    }
    await ctx.db.patch(intent._id, {
      status: "sending",
      transactionHash: args.transactionHash,
      errorCode: undefined,
      updatedAt: Date.now(),
    });
    return "authorized";
  },
});

export const finishFundingSubmission = internalMutation({
  args: {
    projectId: v.id("projects"),
    requestId: v.string(),
    transactionHash: v.string(),
    outcome: v.union(
      v.object({ status: v.literal("verified"), ledger: v.number() }),
      v.object({ status: v.literal("submission_unknown") }),
      v.object({ status: v.literal("failed") }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const matches = await ctx.db
      .query("gasFundingIntents")
      .withIndex("by_project_id_and_request_id", (q) =>
        q.eq("projectId", args.projectId).eq("requestId", args.requestId),
      )
      .take(2);
    const intent = matches[0];
    if (matches.length !== 1 || !intent) return null;
    if (intent.transactionHash !== args.transactionHash || intent.status === "verified")
      return null;
    if (args.outcome.status === "verified") {
      if (!Number.isSafeInteger(args.outcome.ledger) || args.outcome.ledger <= 0) return null;
      await ctx.db.patch(intent._id, {
        status: "verified",
        verifiedLedger: args.outcome.ledger,
        errorCode: undefined,
        updatedAt: Date.now(),
      });
    } else if (args.outcome.status === "submission_unknown") {
      await ctx.db.patch(intent._id, {
        status: "submission_unknown",
        errorCode: "submission_unknown",
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.patch(intent._id, {
        status: "failed",
        errorCode: "submission_failed",
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});

const GAS_FAUCET_COOLDOWN_MS = 24 * 60 * 60 * 1_000;
export const claimFaucetRequest = internalMutation({
  args: { projectId: v.id("projects") },
  returns: v.union(
    v.object({ status: v.literal("unauthorized") }),
    v.object({ status: v.literal("missing_relayer") }),
    v.object({ status: v.literal("cooldown"), retryAfterMs: v.number() }),
    v.object({ status: v.literal("in_progress"), requestId: v.string(), publicKey: v.string() }),
    v.object({ status: v.literal("claimed"), requestId: v.string(), publicKey: v.string() }),
  ),
  handler: async (ctx, args) => {
    let access;
    try {
      access = await requireGasFundsOwnerAccess(ctx, args.projectId);
    } catch {
      return { status: "unauthorized" as const };
    }
    if (access.project.retiredAt !== undefined) return { status: "unauthorized" as const };
    const relayers = await ctx.db
      .query("relayerAccounts")
      .withIndex("by_project_id_and_network", (q) =>
        q.eq("projectId", args.projectId).eq("network", GAS_NETWORK),
      )
      .take(2);
    const relayer = relayers[0];
    if (relayers.length !== 1 || !relayer) return { status: "missing_relayer" as const };
    const now = Date.now();
    const requests = await ctx.db
      .query("gasFaucetRequests")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .take(2);
    if (requests.length > 1) throw new Error("Multiple Gas faucet states exist for project");
    const existing = requests[0];
    if (existing?.status === "pending") {
      return {
        status: "in_progress" as const,
        requestId: existing.requestId,
        publicKey: existing.publicKey,
      };
    }
    if (existing && existing.cooldownUntil > now) {
      return {
        status: "cooldown" as const,
        retryAfterMs: existing.cooldownUntil - now,
      };
    }
    const requestId = crypto.randomUUID();
    const values = {
      projectId: args.projectId,
      requestId,
      relayerId: relayer._id,
      publicKey: relayer.publicKey,
      requestedAt: now,
      cooldownUntil: now + GAS_FAUCET_COOLDOWN_MS,
      status: "pending" as const,
      updatedAt: now,
    };
    if (existing) await ctx.db.patch(existing._id, values);
    else await ctx.db.insert("gasFaucetRequests", values);
    return { status: "claimed" as const, requestId, publicKey: relayer.publicKey };
  },
});

export const claimFaucetCheck = internalMutation({
  args: { projectId: v.id("projects"), requestId: v.string() },
  returns: v.union(
    v.object({ status: v.literal("not_found") }),
    v.object({ status: v.literal("already_funded") }),
    v.object({ status: v.literal("not_checkable") }),
    v.object({ status: v.literal("ready"), publicKey: v.string() }),
  ),
  handler: async (ctx, args) => {
    await requireGasFundsOwnerAccess(ctx, args.projectId);
    const matches = await ctx.db
      .query("gasFaucetRequests")
      .withIndex("by_project_id_and_request_id", (q) =>
        q.eq("projectId", args.projectId).eq("requestId", normalizeGasRequestId(args.requestId)),
      )
      .take(2);
    const request = matches[0];
    if (matches.length !== 1 || !request) return { status: "not_found" as const };
    if (request.status === "funded" || request.status === "account_exists") {
      return { status: "already_funded" as const };
    }
    if (request.status !== "uncertain" && request.status !== "pending") {
      return { status: "not_checkable" as const };
    }
    return { status: "ready" as const, publicKey: request.publicKey };
  },
});

export const finishFaucetRequest = internalMutation({
  args: {
    projectId: v.id("projects"),
    requestId: v.string(),
    status: v.union(
      v.literal("funded"),
      v.literal("account_exists"),
      v.literal("uncertain"),
      v.literal("failed"),
    ),
    checkedAt: v.number(),
    errorCode: v.optional(v.union(v.literal("provider_failure"), v.literal("account_not_found"))),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const matches = await ctx.db
      .query("gasFaucetRequests")
      .withIndex("by_project_id_and_request_id", (q) =>
        q.eq("projectId", args.projectId).eq("requestId", args.requestId),
      )
      .take(2);
    const request = matches[0];
    if (matches.length !== 1 || !request || request.status === "funded") return null;
    if (!Number.isSafeInteger(args.checkedAt) || args.checkedAt <= 0) return null;
    await ctx.db.patch(request._id, {
      status: args.status,
      checkedAt: args.checkedAt,
      errorCode: args.errorCode,
      updatedAt: Date.now(),
    });
    return null;
  },
});

const withdrawalStatusValidator = v.union(
  v.literal("preparing"),
  v.literal("prepared"),
  v.literal("waiting_exposure"),
  v.literal("ready_to_send"),
  v.literal("sending"),
  v.literal("submission_unknown"),
  v.literal("verified"),
  v.literal("failed"),
  v.literal("cancelled"),
);

const withdrawalFactsValidator = v.object({
  requestId: v.string(),
  nonce: v.string(),
  ownerWallet: v.string(),
  relayerId: v.id("relayerAccounts"),
  relayerPublicKey: v.string(),
  amountStroops: v.string(),
  expiresAt: v.number(),
  consentDigest: v.union(v.string(), v.null()),
  preparedConsentHash: v.union(v.string(), v.null()),
  transactionHash: v.union(v.string(), v.null()),
  status: withdrawalStatusValidator,
});

function withdrawalFacts(withdrawal: {
  requestId: string;
  nonce: string;
  ownerWallet: string;
  relayerId: Id<"relayerAccounts">;
  relayerPublicKey: string;
  amountStroops: bigint;
  expiresAt: number;
  consentDigest?: string;
  preparedConsentHash?: string;
  transactionHash?: string;
  status:
    | "preparing"
    | "prepared"
    | "waiting_exposure"
    | "ready_to_send"
    | "sending"
    | "submission_unknown"
    | "verified"
    | "failed"
    | "cancelled";
}) {
  return {
    requestId: withdrawal.requestId,
    nonce: withdrawal.nonce,
    ownerWallet: withdrawal.ownerWallet,
    relayerId: withdrawal.relayerId,
    relayerPublicKey: withdrawal.relayerPublicKey,
    amountStroops: withdrawal.amountStroops.toString(),
    expiresAt: withdrawal.expiresAt,
    consentDigest: withdrawal.consentDigest ?? null,
    preparedConsentHash: withdrawal.preparedConsentHash ?? null,
    transactionHash: withdrawal.transactionHash ?? null,
    status: withdrawal.status,
  };
}

export const createWithdrawalIntent = internalMutation({
  args: {
    projectId: v.id("projects"),
    requestId: v.string(),
    nonce: v.string(),
    amountStroops: v.string(),
    expiresAt: v.number(),
  },
  returns: v.union(
    v.object({ status: v.literal("invalid_amount") }),
    v.object({ status: v.literal("managed_relayer_required") }),
    v.object({ status: v.literal("maintenance_active") }),
    v.object({ status: v.literal("ready"), facts: withdrawalFactsValidator }),
  ),
  handler: async (ctx, args) => {
    const access = await requireGasFundsOwnerAccess(ctx, args.projectId);
    let amount: bigint;
    try {
      amount = parseStroopAmount(args.amountStroops);
      if (amount <= 0n) return { status: "invalid_amount" as const };
    } catch {
      return { status: "invalid_amount" as const };
    }
    const requestId = normalizeGasRequestId(args.requestId);
    if (!/^[a-f0-9-]{32,36}$/i.test(args.nonce)) return { status: "invalid_amount" as const };
    const now = Date.now();
    if (
      !Number.isSafeInteger(args.expiresAt) ||
      args.expiresAt <= now ||
      args.expiresAt > now + 310_000
    ) {
      return { status: "invalid_amount" as const };
    }
    const lockMatches = await ctx.db
      .query("gasProjectMaintenance")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .take(1);
    if (lockMatches.length > 0) return { status: "maintenance_active" as const };
    const custodyMatches = await ctx.db
      .query("gasRelayerCustody")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .take(2);
    const custody = custodyMatches[0];
    const relayers = await ctx.db
      .query("relayerAccounts")
      .withIndex("by_project_id_and_network", (q) =>
        q.eq("projectId", args.projectId).eq("network", GAS_NETWORK),
      )
      .take(2);
    const relayer = relayers[0];
    if (
      custodyMatches.length !== 1 ||
      !custody ||
      custody.status !== "ready" ||
      !custody.publicKey ||
      relayers.length !== 1 ||
      !relayer ||
      relayer.publicKey !== custody.publicKey
    ) {
      return { status: "managed_relayer_required" as const };
    }
    const withdrawalId = await ctx.db.insert("gasWithdrawals", {
      projectId: args.projectId,
      requestId,
      nonce: args.nonce,
      network: GAS_NETWORK,
      ownerWallet: access.address,
      relayerId: relayer._id,
      relayerPublicKey: relayer.publicKey,
      amountStroops: amount,
      status: "preparing",
      expiresAt: args.expiresAt,
      createdAt: now,
      updatedAt: now,
    });
    const withdrawal = await ctx.db.get("gasWithdrawals", withdrawalId);
    if (!withdrawal) throw new Error("Withdrawal intent was not created");
    return { status: "ready" as const, facts: withdrawalFacts(withdrawal) };
  },
});

export const pinWithdrawalConsent = internalMutation({
  args: {
    projectId: v.id("projects"),
    requestId: v.string(),
    consentDigest: v.string(),
    preparedConsentHash: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const access = await requireGasFundsOwnerAccess(ctx, args.projectId);
    if (
      !/^[a-f0-9]{64}$/.test(args.consentDigest) ||
      !/^[a-f0-9]{64}$/.test(args.preparedConsentHash)
    ) {
      throw new Error("Invalid withdrawal consent identity");
    }
    const matches = await ctx.db
      .query("gasWithdrawals")
      .withIndex("by_project_id_and_request_id", (q) =>
        q.eq("projectId", args.projectId).eq("requestId", normalizeGasRequestId(args.requestId)),
      )
      .take(2);
    const withdrawal = matches[0];
    if (
      matches.length !== 1 ||
      !withdrawal ||
      withdrawal.ownerWallet !== access.address ||
      withdrawal.status !== "preparing" ||
      withdrawal.expiresAt <= Date.now()
    ) {
      throw new Error("Withdrawal preparation is no longer valid");
    }
    await ctx.db.patch(withdrawal._id, {
      consentDigest: args.consentDigest,
      preparedConsentHash: args.preparedConsentHash,
      status: "prepared",
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const claimWithdrawalConsent = internalMutation({
  args: { projectId: v.id("projects"), requestId: v.string() },
  returns: v.union(
    v.object({ status: v.literal("not_found") }),
    v.object({ status: v.literal("expired") }),
    v.object({ status: v.literal("not_prepared") }),
    v.object({ status: v.literal("managed_relayer_changed") }),
    v.object({ status: v.literal("ready"), facts: withdrawalFactsValidator }),
  ),
  handler: async (ctx, args) => {
    const access = await requireGasFundsOwnerAccess(ctx, args.projectId);
    const matches = await ctx.db
      .query("gasWithdrawals")
      .withIndex("by_project_id_and_request_id", (q) =>
        q.eq("projectId", args.projectId).eq("requestId", normalizeGasRequestId(args.requestId)),
      )
      .take(2);
    const withdrawal = matches[0];
    if (matches.length !== 1 || !withdrawal || withdrawal.ownerWallet !== access.address) {
      return { status: "not_found" as const };
    }
    if (withdrawal.expiresAt <= Date.now() && withdrawal.status === "prepared") {
      await ctx.db.patch(withdrawal._id, { status: "failed", updatedAt: Date.now() });
      return { status: "expired" as const };
    }
    if (
      withdrawal.status !== "prepared" ||
      !withdrawal.consentDigest ||
      !withdrawal.preparedConsentHash
    ) {
      return { status: "not_prepared" as const };
    }
    const custodyMatches = await ctx.db
      .query("gasRelayerCustody")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .take(2);
    const custody = custodyMatches[0];
    const relayer = await ctx.db.get("relayerAccounts", withdrawal.relayerId);
    if (
      custodyMatches.length !== 1 ||
      custody?.status !== "ready" ||
      custody.publicKey !== withdrawal.relayerPublicKey ||
      !relayer ||
      relayer.publicKey !== withdrawal.relayerPublicKey
    ) {
      return { status: "managed_relayer_changed" as const };
    }
    return { status: "ready" as const, facts: withdrawalFacts(withdrawal) };
  },
});

export const authorizeWithdrawal = internalMutation({
  args: {
    projectId: v.id("projects"),
    requestId: v.string(),
    consentDigest: v.string(),
    consentTransactionHash: v.string(),
  },
  returns: v.union(
    v.object({ status: v.literal("not_found") }),
    v.object({ status: v.literal("mismatch") }),
    v.object({ status: v.literal("maintenance_active") }),
    v.object({ status: v.literal("waiting_exposure") }),
    v.object({ status: v.literal("ready_to_send") }),
  ),
  handler: async (ctx, args) => {
    const access = await requireGasFundsOwnerAccess(ctx, args.projectId);
    const matches = await ctx.db
      .query("gasWithdrawals")
      .withIndex("by_project_id_and_request_id", (q) =>
        q.eq("projectId", args.projectId).eq("requestId", normalizeGasRequestId(args.requestId)),
      )
      .take(2);
    const withdrawal = matches[0];
    if (matches.length !== 1 || !withdrawal || withdrawal.ownerWallet !== access.address) {
      return { status: "not_found" as const };
    }
    if (
      withdrawal.status !== "prepared" ||
      withdrawal.expiresAt <= Date.now() ||
      withdrawal.consentDigest !== args.consentDigest ||
      withdrawal.preparedConsentHash !== args.consentTransactionHash
    ) {
      return { status: "mismatch" as const };
    }
    const existingLock = await ctx.db
      .query("gasProjectMaintenance")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .take(1);
    if (existingLock.length > 0) return { status: "maintenance_active" as const };
    const now = Date.now();
    const policies = await ctx.db
      .query("gasPolicies")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .take(2);
    if (policies.length > 1) throw new Error("Multiple Gas policies exist for project");
    const policy = policies[0];
    let outstandingHolds = 0n;
    if (policy) {
      const accounting = await ensureGasAccounting(ctx, policy, now);
      if (!accounting.ok) throw new Error("Gas commitment state is unavailable");
      outstandingHolds = accounting.snapshot.outstandingHoldsStroops;
    }
    await ctx.db.insert("gasProjectMaintenance", {
      projectId: args.projectId,
      withdrawalRequestId: withdrawal.requestId,
      ownerWallet: withdrawal.ownerWallet,
      relayerId: withdrawal.relayerId,
      createdAt: now,
      updatedAt: now,
    });
    const relayer = await ctx.db.get("relayerAccounts", withdrawal.relayerId);
    if (!relayer || relayer.publicKey !== withdrawal.relayerPublicKey) {
      throw new Error("Managed relayer metadata changed");
    }
    await ctx.db.patch(relayer._id, {
      status: "disabled",
      refreshToken: undefined,
      refreshStartedAt: undefined,
      updatedAt: now,
    });
    if (policy?.enabled) await ctx.db.patch(policy._id, { enabled: false, updatedAt: now });
    await ctx.db.patch(withdrawal._id, {
      status: outstandingHolds > 0n ? "waiting_exposure" : "ready_to_send",
      updatedAt: now,
    });
    return outstandingHolds > 0n
      ? ({ status: "waiting_exposure" } as const)
      : ({ status: "ready_to_send" } as const);
  },
});

export const claimWithdrawalForSend = internalMutation({
  args: { projectId: v.id("projects"), requestId: v.string() },
  returns: v.union(
    v.object({ status: v.literal("not_found") }),
    v.object({ status: v.literal("waiting_exposure") }),
    v.object({ status: v.literal("maintenance_missing") }),
    v.object({
      status: v.literal("already_submitted"),
      transactionHash: v.string(),
      signedTransactionXdr: v.union(v.string(), v.null()),
      expiresAt: v.number(),
      facts: withdrawalFactsValidator,
    }),
    v.object({ status: v.literal("not_ready") }),
    v.object({ status: v.literal("ready"), facts: withdrawalFactsValidator }),
  ),
  handler: async (ctx, args) => {
    const access = await requireGasFundsOwnerAccess(ctx, args.projectId);
    const matches = await ctx.db
      .query("gasWithdrawals")
      .withIndex("by_project_id_and_request_id", (q) =>
        q.eq("projectId", args.projectId).eq("requestId", normalizeGasRequestId(args.requestId)),
      )
      .take(2);
    const withdrawal = matches[0];
    if (matches.length !== 1 || !withdrawal || withdrawal.ownerWallet !== access.address) {
      return { status: "not_found" as const };
    }
    if (withdrawal.transactionHash) {
      return {
        status: "already_submitted" as const,
        transactionHash: withdrawal.transactionHash,
        signedTransactionXdr: withdrawal.signedTransactionXdr ?? null,
        expiresAt: withdrawal.expiresAt,
        facts: withdrawalFacts(withdrawal),
      };
    }
    if (withdrawal.status !== "ready_to_send" && withdrawal.status !== "waiting_exposure") {
      return { status: "not_ready" as const };
    }
    const locks = await ctx.db
      .query("gasProjectMaintenance")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .take(1);
    if (locks.length !== 1 || locks[0]?.withdrawalRequestId !== withdrawal.requestId) {
      return { status: "maintenance_missing" as const };
    }
    const policies = await ctx.db
      .query("gasPolicies")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .take(2);
    const policy = policies[0];
    if (policies.length > 1) throw new Error("Multiple Gas policies exist for project");
    if (policy) {
      const accounting = await ensureGasAccounting(ctx, policy, Date.now());
      if (!accounting.ok) throw new Error("Gas commitment state is unavailable");
      if (accounting.snapshot.outstandingHoldsStroops > 0n) {
        await ctx.db.patch(withdrawal._id, { status: "waiting_exposure", updatedAt: Date.now() });
        return { status: "waiting_exposure" as const };
      }
    }
    await ctx.db.patch(withdrawal._id, { status: "ready_to_send", updatedAt: Date.now() });
    return { status: "ready" as const, facts: withdrawalFacts(withdrawal) };
  },
});

export const pinWithdrawalTransaction = internalMutation({
  args: {
    projectId: v.id("projects"),
    requestId: v.string(),
    transactionHash: v.string(),
    signedTransactionXdr: v.string(),
  },
  returns: v.union(v.literal("pinned"), v.literal("already_pinned"), v.literal("mismatch")),
  handler: async (ctx, args) => {
    const access = await requireGasFundsOwnerAccess(ctx, args.projectId);
    if (
      !/^[a-f0-9]{64}$/.test(args.transactionHash) ||
      args.signedTransactionXdr.length === 0 ||
      new TextEncoder().encode(args.signedTransactionXdr).byteLength > 64 * 1024
    ) {
      return "mismatch";
    }
    const matches = await ctx.db
      .query("gasWithdrawals")
      .withIndex("by_project_id_and_request_id", (q) =>
        q.eq("projectId", args.projectId).eq("requestId", normalizeGasRequestId(args.requestId)),
      )
      .take(2);
    const withdrawal = matches[0];
    if (matches.length !== 1 || !withdrawal || withdrawal.ownerWallet !== access.address)
      return "mismatch";
    if (withdrawal.transactionHash === args.transactionHash) return "already_pinned";
    if (withdrawal.transactionHash !== undefined || withdrawal.status !== "ready_to_send")
      return "mismatch";
    const locks = await ctx.db
      .query("gasProjectMaintenance")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .take(1);
    if (locks.length !== 1 || locks[0]?.withdrawalRequestId !== withdrawal.requestId)
      return "mismatch";
    const policies = await ctx.db
      .query("gasPolicies")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .take(2);
    if (policies.length > 1) throw new Error("Multiple Gas policies exist for project");
    const policy = policies[0];
    if (policy) {
      const accounting = await ensureGasAccounting(ctx, policy, Date.now());
      if (!accounting.ok || accounting.snapshot.outstandingHoldsStroops > 0n) return "mismatch";
    }
    await ctx.db.patch(withdrawal._id, {
      transactionHash: args.transactionHash,
      signedTransactionXdr: args.signedTransactionXdr,
      status: "sending",
      errorCode: undefined,
      updatedAt: Date.now(),
    });
    return "pinned";
  },
});

export const markWithdrawalInsufficientBalance = internalMutation({
  args: { projectId: v.id("projects"), requestId: v.string(), availableStroops: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const matches = await ctx.db
      .query("gasWithdrawals")
      .withIndex("by_project_id_and_request_id", (q) =>
        q.eq("projectId", args.projectId).eq("requestId", args.requestId),
      )
      .take(2);
    const withdrawal = matches[0];
    let available: bigint;
    try {
      available = parseStroopAmount(args.availableStroops);
    } catch {
      return null;
    }
    if (
      matches.length !== 1 ||
      !withdrawal ||
      withdrawal.status !== "ready_to_send" ||
      withdrawal.transactionHash !== undefined
    ) {
      return null;
    }
    await ctx.db.patch(withdrawal._id, {
      errorCode: "insufficient_available_balance",
      availableBalanceStroops: available,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const finishWithdrawalSubmission = internalMutation({
  args: {
    projectId: v.id("projects"),
    requestId: v.string(),
    transactionHash: v.string(),
    outcome: v.union(
      v.object({ status: v.literal("verified"), ledger: v.number() }),
      v.object({ status: v.literal("submission_unknown") }),
      v.object({ status: v.literal("failed") }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const matches = await ctx.db
      .query("gasWithdrawals")
      .withIndex("by_project_id_and_request_id", (q) =>
        q.eq("projectId", args.projectId).eq("requestId", args.requestId),
      )
      .take(2);
    const withdrawal = matches[0];
    if (
      matches.length !== 1 ||
      !withdrawal ||
      withdrawal.transactionHash !== args.transactionHash ||
      withdrawal.status === "verified"
    ) {
      return null;
    }
    if (
      args.outcome.status === "verified" &&
      Number.isSafeInteger(args.outcome.ledger) &&
      args.outcome.ledger > 0
    ) {
      await ctx.db.patch(withdrawal._id, {
        status: "verified",
        signedTransactionXdr: undefined,
        verifiedLedger: args.outcome.ledger,
        errorCode: undefined,
        updatedAt: Date.now(),
      });
      const locks = await ctx.db
        .query("gasProjectMaintenance")
        .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
        .take(1);
      if (locks[0]?.withdrawalRequestId === withdrawal.requestId) await ctx.db.delete(locks[0]._id);
    } else if (args.outcome.status === "submission_unknown") {
      await ctx.db.patch(withdrawal._id, { status: "submission_unknown", updatedAt: Date.now() });
    } else {
      await ctx.db.patch(withdrawal._id, {
        status: "failed",
        signedTransactionXdr: undefined,
        errorCode: "submission_failed",
        updatedAt: Date.now(),
      });
      const locks = await ctx.db
        .query("gasProjectMaintenance")
        .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
        .take(1);
      if (locks[0]?.withdrawalRequestId === withdrawal.requestId) await ctx.db.delete(locks[0]._id);
    }
    return null;
  },
});

export const cancelUnsentWithdrawal = internalMutation({
  args: { projectId: v.id("projects"), requestId: v.string() },
  returns: v.union(v.literal("cancelled"), v.literal("not_cancellable")),
  handler: async (ctx, args) => {
    const access = await requireGasFundsOwnerAccess(ctx, args.projectId);
    const matches = await ctx.db
      .query("gasWithdrawals")
      .withIndex("by_project_id_and_request_id", (q) =>
        q.eq("projectId", args.projectId).eq("requestId", normalizeGasRequestId(args.requestId)),
      )
      .take(2);
    const withdrawal = matches[0];
    if (
      matches.length !== 1 ||
      !withdrawal ||
      withdrawal.ownerWallet !== access.address ||
      withdrawal.transactionHash !== undefined ||
      !["prepared", "waiting_exposure", "ready_to_send"].includes(withdrawal.status)
    ) {
      return "not_cancellable";
    }
    await ctx.db.patch(withdrawal._id, { status: "cancelled", updatedAt: Date.now() });
    const locks = await ctx.db
      .query("gasProjectMaintenance")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .take(1);
    if (locks[0]?.withdrawalRequestId === withdrawal.requestId) await ctx.db.delete(locks[0]._id);
    return "cancelled";
  },
});
