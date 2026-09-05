import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

export type GasExecutionAttemptLookup = Doc<"gasExecutionAttempts"> | null | "ambiguous";

type GasExecutionReadContext = Pick<QueryCtx, "db">;
type GasExecutionIdentity = {
  projectId: Doc<"projects">["_id"];
  value: string;
};

async function findByRequestId(
  ctx: GasExecutionReadContext,
  identity: GasExecutionIdentity,
): Promise<GasExecutionAttemptLookup> {
  const matches = await ctx.db
    .query("gasExecutionAttempts")
    .withIndex("by_project_id_and_request_id", (q) =>
      q.eq("projectId", identity.projectId).eq("requestId", identity.value),
    )
    .take(2);
  if (matches.length > 1) return "ambiguous";
  return matches[0] ?? null;
}

async function findByIdempotencyKeyHash(
  ctx: GasExecutionReadContext,
  identity: GasExecutionIdentity,
): Promise<GasExecutionAttemptLookup> {
  const matches = await ctx.db
    .query("gasExecutionAttempts")
    .withIndex("by_project_id_and_idempotency_key_hash", (q) =>
      q.eq("projectId", identity.projectId).eq("idempotencyKeyHash", identity.value),
    )
    .take(2);
  if (matches.length > 1) return "ambiguous";
  return matches[0] ?? null;
}

async function findByInnerTransactionHash(
  ctx: GasExecutionReadContext,
  identity: GasExecutionIdentity,
): Promise<GasExecutionAttemptLookup> {
  const matches = await ctx.db
    .query("gasExecutionAttempts")
    .withIndex("by_project_id_and_inner_transaction_hash", (q) =>
      q.eq("projectId", identity.projectId).eq("innerTransactionHash", identity.value),
    )
    .take(2);
  if (matches.length > 1) return "ambiguous";
  return matches[0] ?? null;
}

/** Read one execution attempt by its project-scoped request identity. */
export async function findExecutionAttemptByRequestId(
  ctx: GasExecutionReadContext,
  projectId: Doc<"projects">["_id"],
  requestId: string,
): Promise<GasExecutionAttemptLookup> {
  return await findByRequestId(ctx, { projectId, value: requestId });
}

/** Read one execution attempt by its project-scoped idempotency hash. */
export async function findExecutionAttemptByIdempotencyKeyHash(
  ctx: GasExecutionReadContext,
  projectId: Doc<"projects">["_id"],
  idempotencyKeyHash: string,
): Promise<GasExecutionAttemptLookup> {
  return await findByIdempotencyKeyHash(ctx, { projectId, value: idempotencyKeyHash });
}

/** Read one execution attempt by its project-scoped immutable inner hash. */
export async function findExecutionAttemptByInnerTransactionHash(
  ctx: GasExecutionReadContext,
  projectId: Doc<"projects">["_id"],
  innerTransactionHash: string,
): Promise<GasExecutionAttemptLookup> {
  return await findByInnerTransactionHash(ctx, { projectId, value: innerTransactionHash });
}
