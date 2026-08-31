import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import { internalMutation, internalQuery, mutation, query } from "../_generated/server";
import { requireBillingOperator } from "./access";
import { createBillingException } from "./exceptions";

const verifyRef = makeFunctionReference<"action">("billing/mirrorActions:verifySubmitted");

export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireBillingOperator(ctx);
    return await ctx.db
      .query("payAccessMirrorStates")
      .order("desc")
      .take(Math.min(100, Math.max(1, Math.floor(args.limit ?? 25))));
  },
});

export const submit = mutation({
  args: {
    mirrorStateId: v.id("payAccessMirrorStates"),
    desiredCredits: v.int64(),
    desiredVersion: v.number(),
    transactionHash: v.string(),
  },
  handler: async (ctx, args) => {
    const operator = await requireBillingOperator(ctx);
    const state = await ctx.db.get(args.mirrorStateId);
    if (!state) throw new Error("PayAccess mirror state not found");
    if (
      state.desiredCredits !== args.desiredCredits ||
      state.desiredVersion !== args.desiredVersion
    ) {
      throw new Error("PayAccess mirror state advanced; sign the latest balance");
    }
    const transactionHash = args.transactionHash.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(transactionHash)) throw new Error("Invalid transaction hash");
    const existing = await ctx.db
      .query("payAccessMirrorAttempts")
      .withIndex("by_transaction_hash", (q) => q.eq("transactionHash", transactionHash))
      .unique();
    if (existing) return existing._id;
    const now = Date.now();
    const attemptId = await ctx.db.insert("payAccessMirrorAttempts", {
      mirrorStateId: state._id,
      projectId: state.projectId,
      desiredCredits: state.desiredCredits,
      desiredVersion: state.desiredVersion,
      transactionHash,
      status: "submitted",
      submittedBy: operator.walletAddress,
      submittedAt: now,
      verificationAttempts: 0,
    });
    await ctx.db.patch(state._id, {
      submittedCredits: state.desiredCredits,
      submittedVersion: state.desiredVersion,
      status: "submitted",
      lastError: undefined,
      updatedAt: now,
    });
    await ctx.db.insert("billingOperationalEvents", {
      eventType: "mirror_submitted",
      actor: operator.walletAddress,
      organizationId: state.organizationId,
      evidenceJson: JSON.stringify({ attemptId, transactionHash }),
      occurredAt: now,
    });
    await ctx.scheduler.runAfter(5_000, verifyRef, { attemptId });
    return attemptId;
  },
});

export const getVerificationContext = internalQuery({
  args: { attemptId: v.id("payAccessMirrorAttempts") },
  handler: async (ctx, args) => {
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt) throw new Error("PayAccess mirror attempt not found");
    const state = await ctx.db.get(attempt.mirrorStateId);
    if (!state) throw new Error("PayAccess mirror state not found");
    return { attempt, state };
  },
});

export const completeVerification = internalMutation({
  args: {
    attemptId: v.id("payAccessMirrorAttempts"),
    success: v.boolean(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt) throw new Error("PayAccess mirror attempt not found");
    if (attempt.status !== "submitted") return { applied: false };
    const state = await ctx.db.get(attempt.mirrorStateId);
    if (!state) throw new Error("PayAccess mirror state not found");
    const now = Date.now();
    if (!args.success) {
      const error = args.error?.trim() || "PayAccess mirror verification mismatch";
      await ctx.db.patch(attempt._id, { status: "failed", error, verifiedAt: now });
      await ctx.db.patch(state._id, { status: "failed", lastError: error, updatedAt: now });
      await createBillingException(ctx, {
        organizationId: state.organizationId,
        exceptionType: "verification_ambiguous",
        severity: "high",
        dedupeKey: `pay-access-mirror:${attempt._id}`,
        summary: "PayAccess display mirror verification failed",
        evidence: { attemptId: attempt._id, transactionHash: attempt.transactionHash, error },
      });
      return { applied: true, success: false };
    }
    await ctx.db.patch(attempt._id, { status: "confirmed", verifiedAt: now });
    const desiredAdvanced =
      state.desiredVersion !== attempt.desiredVersion ||
      state.desiredCredits !== attempt.desiredCredits;
    await ctx.db.patch(state._id, {
      confirmedCredits: attempt.desiredCredits,
      confirmedVersion: attempt.desiredVersion,
      status: desiredAdvanced ? "pending" : "confirmed",
      lastError: undefined,
      updatedAt: now,
    });
    await ctx.db.insert("billingOperationalEvents", {
      eventType: "mirror_verified",
      actor: "system:pay_access_verifier",
      organizationId: state.organizationId,
      evidenceJson: JSON.stringify({
        attemptId: attempt._id,
        transactionHash: attempt.transactionHash,
      }),
      occurredAt: now,
    });
    return { applied: true, success: true };
  },
});

export const retryVerification = internalMutation({
  args: {
    attemptId: v.id("payAccessMirrorAttempts"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt || attempt.status !== "submitted") return { retrying: false };
    const state = await ctx.db.get(attempt.mirrorStateId);
    if (!state) throw new Error("PayAccess mirror state not found");
    const verificationAttempts = (attempt.verificationAttempts ?? 0) + 1;
    const error = args.error.trim() || "PayAccess display event is not finalized";
    if (verificationAttempts < 5) {
      await ctx.db.patch(attempt._id, { verificationAttempts, error });
      await ctx.scheduler.runAfter(verificationAttempts * 15_000, verifyRef, {
        attemptId: attempt._id,
      });
      return { retrying: true };
    }
    const now = Date.now();
    await ctx.db.patch(attempt._id, {
      status: "failed",
      verificationAttempts,
      error,
      verifiedAt: now,
    });
    await ctx.db.patch(state._id, { status: "failed", lastError: error, updatedAt: now });
    await createBillingException(ctx, {
      organizationId: state.organizationId,
      exceptionType: "verification_ambiguous",
      severity: "high",
      dedupeKey: `pay-access-mirror:${attempt._id}`,
      summary: "PayAccess display mirror could not be independently verified",
      evidence: {
        attemptId: attempt._id,
        transactionHash: attempt.transactionHash,
        verificationAttempts,
        error,
      },
    });
    return { retrying: false };
  },
});
