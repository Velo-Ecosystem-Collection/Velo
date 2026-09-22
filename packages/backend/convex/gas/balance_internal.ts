import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { ProjectRole } from "../playground_projects/helpers";
import type { TestnetBalanceFailureReason } from "./balance";
import type { RelayerAccountProjection } from "./projections";

import { internalMutation } from "../_generated/server";
import { consumeBucket } from "../rate_limits/mutations";
import { requireGasConsoleAccess } from "./authorization";
import { TESTNET_BALANCE_FAILURE_REASONS } from "./balance";
import { projectRelayerAccount, relayerAccountProjectionValidator } from "./projections";
import { gasNetworkValidator, gasRelayerStatusValidator } from "./schema";
import { GAS_NETWORK } from "./types";
import { assertValidStroopValue } from "./validation";

export const RELAYER_BALANCE_REFRESH_COOLDOWN_MS = 30_000;
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
