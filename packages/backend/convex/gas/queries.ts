import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";

import type {
  GasLogProjection,
  GasPolicyProjection,
  RelayerAccountProjection,
  GasTelemetryProjection,
} from "./projections";

import { query } from "../_generated/server";
import { requireGasConsoleAccess } from "./authorization";
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
import { readGasTelemetry, normalizeTelemetryDayKey } from "./telemetry";
import { GAS_NETWORK } from "./types";
import { assertValidGasPolicyState, normalizeGasRequestId } from "./validation";

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
