import { defineTable } from "convex/server";
import { v } from "convex/values";

export default defineTable({
  projectId: v.id("projects"),
  keyHash: v.string(),
  prefix: v.string(),
  label: v.string(),
  createdAt: v.number(),
  lastUsedAt: v.optional(v.number()),
  requestCount: v.number(),
  paymentAnchor: v.optional(v.union(v.literal("inhouse"), v.literal("pdax"))),
  purpose: v.optional(v.union(v.literal("general"), v.literal("gas"))),
  revoked: v.boolean(),
})
  .index("by_project", ["projectId"])
  .index("by_key_hash", ["keyHash"]);
