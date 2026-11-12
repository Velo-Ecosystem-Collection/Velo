import { defineTable } from "convex/server";
import { v } from "convex/values";

export default defineTable({
  network: v.literal("testnet"),
  utcDay: v.string(),
  reservedFeeStroops: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_network_and_utc_day", ["network", "utcDay"]);
