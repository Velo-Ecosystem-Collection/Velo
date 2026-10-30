import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";

import { WALLET_AUTH_SERVICE_SUBJECT } from "../auth.constants";

export async function getAuthenticatedIdentity(ctx: QueryCtx | MutationCtx | ActionCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity || identity.subject === WALLET_AUTH_SERVICE_SUBJECT) return null;
  return identity;
}

export async function requireIdentity(ctx: QueryCtx | MutationCtx | ActionCtx) {
  const identity = await getAuthenticatedIdentity(ctx);
  if (!identity) throw new Error("Not authenticated");
  return identity;
}
