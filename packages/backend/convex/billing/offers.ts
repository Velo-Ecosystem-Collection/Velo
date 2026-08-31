import { v } from "convex/values";

import type { MutationCtx, QueryCtx } from "../_generated/server";

import { mutation, query } from "../_generated/server";
import { requireBillingOperator } from "./access";
import { currentBillingNetwork } from "./config";
import { billingNetworkValidator } from "./schema";

function normalizeAmount(value: string) {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,7})?$/.test(normalized) || Number(normalized) <= 0) {
    throw new Error("Offer price must be a positive Stellar amount");
  }
  return normalized;
}

function normalizeBillingAsset(value: string) {
  const normalized = value.trim().toUpperCase();
  if (normalized === "XLM" || normalized === "NATIVE") return "native";

  const asset = normalized.startsWith("G") ? `USDC:${normalized}` : normalized;
  if (!/^USDC:G[A-Z0-9]{3,}$/.test(asset)) {
    throw new Error(
      "Offer asset must be XLM/native or Testnet USDC as a Stellar G-address or USDC:<issuer>",
    );
  }
  return asset;
}

export async function activeOffer(
  ctx: QueryCtx | MutationCtx,
  now = Date.now(),
  network?: "testnet" | "public",
) {
  const candidates = network
    ? await ctx.db
        .query("billingOffers")
        .withIndex("by_network_and_active_and_active_from", (q) =>
          q.eq("network", network).eq("active", true).lte("activeFrom", now),
        )
        .order("desc")
        .take(50)
    : await ctx.db
        .query("billingOffers")
        .withIndex("by_active_and_active_from", (q) => q.eq("active", true).lte("activeFrom", now))
        .order("desc")
        .take(50);
  return (
    candidates.find((offer) => offer.activeUntil === undefined || offer.activeUntil > now) ?? null
  );
}

export const getActive = query({
  args: {},
  handler: async (ctx) => await activeOffer(ctx, Date.now(), currentBillingNetwork()),
});

export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireBillingOperator(ctx);
    const limit = Math.min(100, Math.max(1, Math.floor(args.limit ?? 50)));
    return await ctx.db.query("billingOffers").order("desc").take(limit);
  },
});

export const create = mutation({
  args: {
    sku: v.string(),
    creditQuantity: v.int64(),
    priceAmount: v.string(),
    asset: v.string(),
    network: billingNetworkValidator,
    treasuryAddress: v.string(),
    treasuryId: v.optional(v.id("billingTreasuries")),
    activeFrom: v.number(),
    activeUntil: v.optional(v.number()),
    refundPolicy: v.string(),
    activate: v.boolean(),
  },
  handler: async (ctx, args) => {
    const operator = await requireBillingOperator(ctx);
    const sku = args.sku.trim();
    const asset = normalizeBillingAsset(args.asset);
    const treasuryAddress = args.treasuryAddress.trim().toUpperCase();
    const refundPolicy = args.refundPolicy.trim();
    if (!sku || args.creditQuantity <= 0n || !asset || !treasuryAddress || !refundPolicy) {
      throw new Error("Offer fields are required");
    }
    if (!/^G[A-Z0-9]{3,}$/.test(treasuryAddress)) {
      throw new Error("Offer treasury must be a Stellar account");
    }
    if (args.activeUntil !== undefined && args.activeUntil <= args.activeFrom) {
      throw new Error("Offer activeUntil must follow activeFrom");
    }
    if (args.network === "public") {
      if (!args.treasuryId) throw new Error("Mainnet offers require a production treasury");
      const treasury = await ctx.db.get(args.treasuryId);
      if (
        !treasury ||
        !treasury.active ||
        treasury.network !== "public" ||
        treasury.address !== treasuryAddress ||
        treasury.asset !== asset
      ) {
        throw new Error("Mainnet offer must match an active production treasury");
      }
      if (!asset.startsWith("USDC:")) throw new Error("Mainnet offers require USDC");
    }
    const prior = await ctx.db
      .query("billingOffers")
      .withIndex("by_sku_and_version", (q) => q.eq("sku", sku))
      .order("desc")
      .take(1);
    const version = (prior[0]?.version ?? 0) + 1;
    const now = Date.now();
    if (args.activate) {
      const active = await ctx.db
        .query("billingOffers")
        .withIndex("by_network_and_active_and_active_from", (q) =>
          q.eq("network", args.network).eq("active", true),
        )
        .take(100);
      for (const offer of active) {
        await ctx.db.patch(offer._id, { active: false });
      }
    }
    return await ctx.db.insert("billingOffers", {
      sku,
      version,
      creditQuantity: args.creditQuantity,
      priceAmount: normalizeAmount(args.priceAmount),
      asset,
      network: args.network,
      treasuryAddress,
      ...(args.treasuryId ? { treasuryId: args.treasuryId } : {}),
      refundPolicy,
      active: args.activate,
      activeFrom: args.activeFrom,
      ...(args.activeUntil === undefined ? {} : { activeUntil: args.activeUntil }),
      createdBy: operator.walletAddress,
      createdAt: now,
    });
  },
});
