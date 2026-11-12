import { defineTable } from "convex/server";
import { v } from "convex/values";

export default defineTable({
  challengeId: v.string(),
  accountAddress: v.string(),
  nonce: v.string(),
  challengeHash: v.string(),
  expiresAt: v.number(),
  createdAt: v.number(),
})
  .index("by_challenge_id", ["challengeId"])
  .index("by_nonce", ["nonce"])
  .index("by_expires_at", ["expiresAt"]);
