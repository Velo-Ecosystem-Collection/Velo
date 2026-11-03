import { assertValidPublicKey, assertValidTransactionHash } from "@repo/stellar/validation";
import { v } from "convex/values";

import { mutation } from "../_generated/server";
import { WALLET_AUTH_SERVICE_SUBJECT } from "../auth.constants";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_CHALLENGE_TTL_MS = CHALLENGE_TTL_MS + 30_000;
const CHALLENGE_ID_PATTERN = /^[A-Za-z0-9_-]{40,48}$/;
const CLEANUP_LIMIT = 100;

async function requireWalletAuthService(ctx: {
  auth: { getUserIdentity: () => Promise<unknown> };
}) {
  const identity = await ctx.auth.getUserIdentity();
  if (
    !identity ||
    typeof identity !== "object" ||
    !("subject" in identity) ||
    identity.subject !== WALLET_AUTH_SERVICE_SUBJECT
  ) {
    throw new Error("Unauthorized");
  }
}

export const issue = mutation({
  args: {
    challengeId: v.string(),
    address: v.string(),
    transactionHash: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    await requireWalletAuthService(ctx);
    if (!CHALLENGE_ID_PATTERN.test(args.challengeId)) throw new Error("Invalid challenge ID");

    const address = assertValidPublicKey(args.address);
    const transactionHash = assertValidTransactionHash(args.transactionHash);
    const now = Date.now();
    if (args.expiresAt <= now || args.expiresAt > now + MAX_CHALLENGE_TTL_MS) {
      throw new Error("Invalid challenge expiry");
    }

    const existing = await ctx.db
      .query("walletAuthChallenges")
      .withIndex("by_challenge_id", (q) => q.eq("challengeId", args.challengeId))
      .unique();
    if (existing) throw new Error("Challenge already exists");

    const expired = await ctx.db
      .query("walletAuthChallenges")
      .withIndex("by_expires_at", (q) => q.lt("expiresAt", now))
      .take(CLEANUP_LIMIT);
    for (const challenge of expired) await ctx.db.delete(challenge._id);

    await ctx.db.insert("walletAuthChallenges", {
      challengeId: args.challengeId,
      walletAddress: address,
      transactionHash,
      expiresAt: args.expiresAt,
      createdAt: now,
    });
  },
});

export const consume = mutation({
  args: {
    challengeId: v.string(),
    address: v.string(),
    transactionHash: v.string(),
  },
  handler: async (ctx, args) => {
    await requireWalletAuthService(ctx);
    if (!CHALLENGE_ID_PATTERN.test(args.challengeId)) return false;

    const address = assertValidPublicKey(args.address);
    const transactionHash = assertValidTransactionHash(args.transactionHash);
    const challenge = await ctx.db
      .query("walletAuthChallenges")
      .withIndex("by_challenge_id", (q) => q.eq("challengeId", args.challengeId))
      .unique();
    if (!challenge) return false;
    if (challenge.expiresAt <= Date.now()) {
      await ctx.db.delete(challenge._id);
      return false;
    }
    if (challenge.walletAddress !== address || challenge.transactionHash !== transactionHash) {
      return false;
    }

    await ctx.db.delete(challenge._id);
    return true;
  },
});
