import { assertValidAccountAddress, assertValidMetadataHash } from "@repo/stellar/validation";
import { v } from "convex/values";

import { mutation } from "../_generated/server";
import { WALLET_AUTH_SERVICE_SUBJECT } from "../auth.constants";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_CHALLENGE_TTL_MS = CHALLENGE_TTL_MS + 30_000;
const CHALLENGE_ID_PATTERN = /^[A-Za-z0-9_-]{40,48}$/;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;
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
    nonce: v.string(),
    challengeHash: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    await requireWalletAuthService(ctx);
    if (!CHALLENGE_ID_PATTERN.test(args.challengeId)) throw new Error("Invalid challenge ID");
    if (!NONCE_PATTERN.test(args.nonce)) throw new Error("Invalid challenge nonce");

    const address = assertValidAccountAddress(args.address);
    const challengeHash = assertValidMetadataHash(args.challengeHash);
    const now = Date.now();
    if (args.expiresAt <= now || args.expiresAt > now + MAX_CHALLENGE_TTL_MS) {
      throw new Error("Invalid challenge expiry");
    }

    const existing = await ctx.db
      .query("contractAccountAuthChallenges")
      .withIndex("by_challenge_id", (q) => q.eq("challengeId", args.challengeId))
      .unique();
    if (existing) throw new Error("Challenge already exists");

    const expired = await ctx.db
      .query("contractAccountAuthChallenges")
      .withIndex("by_expires_at", (q) => q.lt("expiresAt", now))
      .take(CLEANUP_LIMIT);
    for (const challenge of expired) await ctx.db.delete(challenge._id);

    await ctx.db.insert("contractAccountAuthChallenges", {
      challengeId: args.challengeId,
      accountAddress: address,
      nonce: args.nonce,
      challengeHash,
      expiresAt: args.expiresAt,
      createdAt: now,
    });
  },
});

export const consume = mutation({
  args: {
    address: v.string(),
    nonce: v.string(),
    challengeHash: v.string(),
  },
  handler: async (ctx, args) => {
    await requireWalletAuthService(ctx);
    if (!NONCE_PATTERN.test(args.nonce)) return false;

    let address: string;
    let challengeHash: string;
    try {
      address = assertValidAccountAddress(args.address);
      challengeHash = assertValidMetadataHash(args.challengeHash);
    } catch {
      return false;
    }

    const challenge = await ctx.db
      .query("contractAccountAuthChallenges")
      .withIndex("by_nonce", (q) => q.eq("nonce", args.nonce))
      .unique();
    if (!challenge) return false;
    if (challenge.expiresAt <= Date.now()) {
      await ctx.db.delete(challenge._id);
      return false;
    }
    if (
      challenge.accountAddress !== address ||
      !CHALLENGE_ID_PATTERN.test(challenge.challengeId) ||
      challenge.challengeHash !== challengeHash
    ) {
      return false;
    }

    await ctx.db.delete(challenge._id);
    return true;
  },
});
