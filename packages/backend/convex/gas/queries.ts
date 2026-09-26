import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";

import type {
  GasLogProjection,
  GasPolicyProjection,
  RelayerAccountProjection,
  GasTelemetryProjection,
} from "./projections";

import { query } from "../_generated/server";
import { requireGasConsoleAccess, requireGasFundsOwnerAccess } from "./authorization";
import { findExecutionAttemptByRequestId } from "./execution";
import {
  gasLogProjectionValidator,
  gasPolicyProjectionValidator,
  gasSubmitResultProjectionValidator,
  gasTelemetryProjectionValidator,
  projectGasExecutionAttempt,
  projectGasPolicy,
  projectGasLog,
  projectRelayerAccount,
  relayerAccountProjectionValidator,
} from "./projections";
import { getGasRuntimeEnv } from "./runtime_env";
import { gasCustodyErrorCodeValidator } from "./schema";
import { readGasTelemetry, normalizeTelemetryDayKey } from "./telemetry";
import { GAS_NETWORK } from "./types";
import { assertValidGasPolicyState, normalizeGasRequestId } from "./validation";

const gasRelayerProvisioningStatusValidator = v.object({
  state: v.union(
    v.literal("not_configured"),
    v.literal("pending"),
    v.literal("ready"),
    v.literal("failed"),
  ),
  managed: v.boolean(),
  publicKey: v.union(v.string(), v.null()),
  relayerStatus: v.union(v.literal("active"), v.literal("disabled"), v.null()),
  deploymentContextMatches: v.union(v.boolean(), v.null()),
  errorCode: v.union(gasCustodyErrorCodeValidator, v.null()),
});

const gasFundingStatusValidator = v.object({
  requestId: v.string(),
  operation: v.union(v.literal("create_account"), v.literal("payment")),
  amountStroops: v.string(),
  destinationPublicKey: v.string(),
  status: v.union(
    v.literal("prepared"),
    v.literal("sending"),
    v.literal("submission_unknown"),
    v.literal("verified"),
    v.literal("failed"),
  ),
  transactionHash: v.union(v.string(), v.null()),
  verifiedLedger: v.union(v.number(), v.null()),
  expiresAt: v.number(),
});

const gasManagedActivationReviewValidator = v.object({
  dailyCapStroops: v.string(),
  walletHourlyLimit: v.number(),
  activeContractIds: v.array(v.string()),
  policyEnabled: v.boolean(),
});

const gasFaucetStatusValidator = v.object({
  requestId: v.string(),
  status: v.union(
    v.literal("pending"),
    v.literal("funded"),
    v.literal("account_exists"),
    v.literal("uncertain"),
    v.literal("failed"),
  ),
  cooldownUntil: v.number(),
  checkedAt: v.union(v.number(), v.null()),
});

const gasWithdrawalStatusValidator = v.object({
  requestId: v.string(),
  status: v.union(
    v.literal("preparing"),
    v.literal("prepared"),
    v.literal("waiting_exposure"),
    v.literal("ready_to_send"),
    v.literal("sending"),
    v.literal("submission_unknown"),
    v.literal("verified"),
    v.literal("failed"),
    v.literal("cancelled"),
  ),
  relayerPublicKey: v.string(),
  ownerWallet: v.string(),
  amountStroops: v.string(),
  availableBalanceStroops: v.union(v.string(), v.null()),
  transactionHash: v.union(v.string(), v.null()),
  verifiedLedger: v.union(v.number(), v.null()),
  expiresAt: v.number(),
  errorCode: v.union(
    v.literal("insufficient_available_balance"),
    v.literal("submission_failed"),
    v.null(),
  ),
});

export const getRelayerFundsForOwner = query({
  args: { projectId: v.id("projects") },
  returns: v.object({
    projectName: v.string(),
    retired: v.boolean(),
    managed: v.boolean(),
    publicKey: v.union(v.string(), v.null()),
    status: v.union(v.literal("active"), v.literal("disabled"), v.null()),
    balanceStroops: v.union(v.string(), v.null()),
    balanceUpdatedAt: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, args) => {
    const access = await requireGasFundsOwnerAccess(ctx, args.projectId);
    const relayers = await ctx.db
      .query("relayerAccounts")
      .withIndex("by_project_id_and_network", (q) =>
        q.eq("projectId", args.projectId).eq("network", GAS_NETWORK),
      )
      .take(2);
    if (relayers.length > 1) throw new Error("Multiple Gas relayers exist for project");
    const relayer = relayers[0] ?? null;
    const custody = await ctx.db
      .query("gasRelayerCustody")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .take(2);
    if (custody.length > 1) throw new Error("Multiple Gas custody records exist for project");
    const managed = custody[0]?.status === "ready" && custody[0]?.publicKey === relayer?.publicKey;
    return {
      projectName: access.project.name,
      retired: access.project.retiredAt !== undefined,
      managed,
      publicKey: relayer?.publicKey ?? null,
      status: relayer?.status ?? null,
      balanceStroops: relayer?.balanceStroops?.toString() ?? null,
      balanceUpdatedAt: relayer?.balanceUpdatedAt ?? null,
    };
  },
});

export const getWithdrawalStatus = query({
  args: { projectId: v.id("projects"), requestId: v.string() },
  returns: v.union(gasWithdrawalStatusValidator, v.null()),
  handler: async (ctx, args) => {
    const access = await requireGasFundsOwnerAccess(ctx, args.projectId);
    const requestId = normalizeGasRequestId(args.requestId);
    const matches = await ctx.db
      .query("gasWithdrawals")
      .withIndex("by_project_id_and_request_id", (q) =>
        q.eq("projectId", args.projectId).eq("requestId", requestId),
      )
      .take(2);
    if (matches.length > 1) throw new Error("Multiple Gas withdrawals exist for request");
    const withdrawal = matches[0];
    if (!withdrawal || withdrawal.ownerWallet !== access.address) return null;
    return {
      requestId: withdrawal.requestId,
      status: withdrawal.status,
      relayerPublicKey: withdrawal.relayerPublicKey,
      ownerWallet: withdrawal.ownerWallet,
      amountStroops: withdrawal.amountStroops.toString(),
      availableBalanceStroops: withdrawal.availableBalanceStroops?.toString() ?? null,
      transactionHash: withdrawal.transactionHash ?? null,
      verifiedLedger: withdrawal.verifiedLedger ?? null,
      expiresAt: withdrawal.expiresAt,
      errorCode: withdrawal.errorCode ?? null,
    };
  },
});

export const getFaucetStatus = query({
  args: { projectId: v.id("projects"), requestId: v.string() },
  returns: v.union(gasFaucetStatusValidator, v.null()),
  handler: async (ctx, args) => {
    await requireGasFundsOwnerAccess(ctx, args.projectId);
    const requestId = normalizeGasRequestId(args.requestId);
    const matches = await ctx.db
      .query("gasFaucetRequests")
      .withIndex("by_project_id_and_request_id", (q) =>
        q.eq("projectId", args.projectId).eq("requestId", requestId),
      )
      .take(2);
    if (matches.length > 1) throw new Error("Multiple Gas faucet requests exist for project");
    const request = matches[0];
    if (!request) return null;
    return {
      requestId: request.requestId,
      status: request.status,
      cooldownUntil: request.cooldownUntil,
      checkedAt: request.checkedAt ?? null,
    };
  },
});

export const getManagedActivationReview = query({
  args: { projectId: v.id("projects") },
  returns: gasManagedActivationReviewValidator,
  handler: async (ctx, args) => {
    const access = await requireGasFundsOwnerAccess(ctx, args.projectId);
    if (access.project.retiredAt !== undefined) throw new Error("Project is retired");
    const contracts = await ctx.db
      .query("projectContracts")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .take(100);
    const activeContractIds = contracts
      .filter((contract) => contract.status === "active")
      .map((contract) => contract.contractId);
    const policies = await ctx.db
      .query("gasPolicies")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .take(2);
    if (policies.length > 1) throw new Error("Multiple Gas policies exist for project");
    const policy = policies[0];
    return {
      dailyCapStroops: (policy?.dailyCapStroops ?? 100_000_000n).toString(),
      walletHourlyLimit: policy?.walletHourlyLimit ?? 100,
      activeContractIds,
      policyEnabled: policy?.enabled ?? false,
    };
  },
});

/** Read only safe managed-custody status; ciphertext and encryption metadata stay private. */
export const getProvisioningStatus = query({
  args: { projectId: v.id("projects") },
  returns: gasRelayerProvisioningStatusValidator,
  handler: async (ctx, args) => {
    await requireGasConsoleAccess(ctx, args.projectId, "read");
    const custodyMatches = await ctx.db
      .query("gasRelayerCustody")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .take(2);
    if (custodyMatches.length > 1)
      throw new Error("Multiple Gas custody records exist for project");
    const custody = custodyMatches[0] ?? null;

    const relayerMatches = await ctx.db
      .query("relayerAccounts")
      .withIndex("by_project_id_and_network", (q) =>
        q.eq("projectId", args.projectId).eq("network", GAS_NETWORK),
      )
      .take(2);
    if (relayerMatches.length > 1) throw new Error("Multiple Gas relayers exist for project");
    const relayer = relayerMatches[0] ?? null;

    if (!custody) {
      return {
        state: relayer ? ("ready" as const) : ("not_configured" as const),
        managed: false,
        publicKey: relayer?.publicKey ?? null,
        relayerStatus: relayer?.status ?? null,
        deploymentContextMatches: null,
        errorCode: null,
      };
    }
    if (custody.status === "pending") {
      return {
        state: "pending" as const,
        managed: true,
        publicKey: null,
        relayerStatus: null,
        deploymentContextMatches: null,
        errorCode: null,
      };
    }
    if (custody.status === "failed") {
      return {
        state: "failed" as const,
        managed: true,
        publicKey: null,
        relayerStatus: null,
        deploymentContextMatches: null,
        errorCode: custody.errorCode ?? "provisioning_failed",
      };
    }
    if (!custody.publicKey || relayer?.publicKey !== custody.publicKey) {
      return {
        state: "failed" as const,
        managed: true,
        publicKey: null,
        relayerStatus: null,
        deploymentContextMatches: null,
        errorCode: "provisioning_failed" as const,
      };
    }
    const configuredDeploymentId = getGasRuntimeEnv().VELO_GAS_CUSTODY_DEPLOYMENT_ID?.trim();
    return {
      state: "ready" as const,
      managed: true,
      publicKey: custody.publicKey,
      relayerStatus: relayer?.status ?? null,
      deploymentContextMatches: configuredDeploymentId
        ? custody.deploymentId === configuredDeploymentId
        : null,
      errorCode: null,
    };
  },
});

/** Owner-only safe funding status, without signed XDR or custody fields. */
export const getFundingStatus = query({
  args: { projectId: v.id("projects"), requestId: v.string() },
  returns: v.union(gasFundingStatusValidator, v.null()),
  handler: async (ctx, args) => {
    await requireGasConsoleAccess(ctx, args.projectId, "updateRelayer");
    const requestId = normalizeGasRequestId(args.requestId);
    const matches = await ctx.db
      .query("gasFundingIntents")
      .withIndex("by_project_id_and_request_id", (q) =>
        q.eq("projectId", args.projectId).eq("requestId", requestId),
      )
      .take(2);
    if (matches.length > 1) throw new Error("Multiple Gas funding intents exist for request");
    const intent = matches[0];
    if (!intent) return null;
    return {
      requestId: intent.requestId,
      operation: intent.operation,
      amountStroops: intent.amountStroops.toString(),
      destinationPublicKey: intent.destinationPublicKey,
      status: intent.status,
      transactionHash: intent.transactionHash ?? null,
      verifiedLedger: intent.verifiedLedger ?? null,
      expiresAt: intent.expiresAt,
    };
  },
});

/** Read the authenticated project's Testnet Gas policy. */
export const getPolicy = query({
  args: { projectId: v.id("projects") },
  returns: v.union(gasPolicyProjectionValidator, v.null()),
  handler: async (ctx, args): Promise<GasPolicyProjection | null> => {
    await requireGasConsoleAccess(ctx, args.projectId, "read");

    const policyMatches = await ctx.db
      .query("gasPolicies")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .take(2);
    if (policyMatches.length > 1) throw new Error("Multiple Gas policies exist for project");
    const policy = policyMatches[0] ?? null;
    if (policy) assertValidGasPolicyState(policy);

    return policy ? projectGasPolicy(policy) : null;
  },
});

/** Read the authenticated project's Testnet relayer metadata. */
export const getRelayerAccount = query({
  args: { projectId: v.id("projects") },
  returns: v.union(relayerAccountProjectionValidator, v.null()),
  handler: async (ctx, args): Promise<RelayerAccountProjection | null> => {
    await requireGasConsoleAccess(ctx, args.projectId, "read");

    const accountMatches = await ctx.db
      .query("relayerAccounts")
      .withIndex("by_project_id_and_network", (q) =>
        q.eq("projectId", args.projectId).eq("network", GAS_NETWORK),
      )
      .take(2);
    if (accountMatches.length > 1) throw new Error("Multiple Gas relayers exist for project");
    const account = accountMatches[0] ?? null;

    return account ? projectRelayerAccount(account) : null;
  },
});

/** Read the authenticated project's Gas logs in newest-first pages. */
export const listLogsPage = query({
  args: {
    projectId: v.id("projects"),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(gasLogProjectionValidator),
  handler: async (ctx, args) => {
    await requireGasConsoleAccess(ctx, args.projectId, "read");

    const page = await ctx.db
      .query("gasLogs")
      .withIndex("by_project_id_and_created_at", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .paginate(args.paginationOpts);

    return {
      ...page,
      page: page.page.map(projectGasLog),
    } satisfies {
      page: GasLogProjection[];
      continueCursor: string;
      isDone: boolean;
      splitCursor?: string | null;
      pageStatus?: "SplitRecommended" | "SplitRequired" | null;
    };
  },
});

/**
 * Read exact fee telemetry for an explicit UTC reporting day. The caller must
 * advance the argument at the UTC boundary and after resume; this query never
 * reads the wall clock or mutates accounting state.
 */
export const getTelemetry = query({
  args: {
    projectId: v.id("projects"),
    utcDayKey: v.string(),
  },
  returns: gasTelemetryProjectionValidator,
  handler: async (ctx, args): Promise<GasTelemetryProjection> => {
    await requireGasConsoleAccess(ctx, args.projectId, "read");
    const utcDayKey = normalizeTelemetryDayKey(args.utcDayKey);
    return await readGasTelemetry(ctx, args.projectId, utcDayKey);
  },
});

/** Read one retained, sanitized execution attempt by project-scoped request ID. */
export const getExecutionDetail = query({
  args: {
    projectId: v.id("projects"),
    requestId: v.string(),
  },
  returns: v.union(
    // The execution projection is intentionally the same DTO used by submit
    // replay; no raw attempt fields are added at the dashboard boundary.
    gasSubmitResultProjectionValidator,
    v.null(),
  ),
  handler: async (ctx, args) => {
    await requireGasConsoleAccess(ctx, args.projectId, "read");
    const requestId = normalizeGasRequestId(args.requestId);
    const attempt = await findExecutionAttemptByRequestId(ctx, args.projectId, requestId);
    if (attempt === "ambiguous") {
      throw new Error("Multiple Gas execution attempts exist for request");
    }
    return attempt ? projectGasExecutionAttempt(attempt) : null;
  },
});
