import { v } from "convex/values";

import { mutation } from "../_generated/server";
import { WALLET_AUTH_SERVICE_SUBJECT } from "../auth.constants";

const MAX_SINGLE_FEE_STROOPS = 100_000_000;
const MAX_DAILY_FEE_STROOPS = 1_000_000_000;

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

export const reserve = mutation({
  args: {
    feeStroops: v.number(),
    dailyLimitStroops: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    await requireWalletAuthService(ctx);
    if (
      !Number.isSafeInteger(args.feeStroops) ||
      args.feeStroops <= 0 ||
      args.feeStroops > MAX_SINGLE_FEE_STROOPS
    ) {
      throw new Error("Invalid smart-account relayer fee reservation");
    }
    if (
      !Number.isSafeInteger(args.dailyLimitStroops) ||
      args.dailyLimitStroops <= 0 ||
      args.dailyLimitStroops > MAX_DAILY_FEE_STROOPS
    ) {
      throw new Error("Invalid smart-account daily fee budget");
    }

    const now = Date.now();
    const utcDay = new Date(now).toISOString().slice(0, 10);
    const existing = await ctx.db
      .query("smartAccountRelayerFeeBudgets")
      .withIndex("by_network_and_utc_day", (q) => q.eq("network", "testnet").eq("utcDay", utcDay))
      .unique();
    const alreadyReserved = existing?.reservedFeeStroops ?? 0;
    if (alreadyReserved + args.feeStroops > args.dailyLimitStroops) return false;

    if (existing) {
      await ctx.db.patch(existing._id, {
        reservedFeeStroops: alreadyReserved + args.feeStroops,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("smartAccountRelayerFeeBudgets", {
        network: "testnet",
        utcDay,
        reservedFeeStroops: args.feeStroops,
        createdAt: now,
        updatedAt: now,
      });
    }
    return true;
  },
});
