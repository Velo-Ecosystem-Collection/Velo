import { defineTable } from "convex/server";
import { v } from "convex/values";

export default defineTable({
  eventKey: v.string(),
  eventId: v.string(),
  projectId: v.id("projects"),
  network: v.optional(v.union(v.literal("testnet"), v.literal("mainnet"))),
  contractId: v.string(),
  transactionHash: v.string(),
  ledger: v.number(),
  timestamp: v.optional(v.number()),
  topic: v.string(),
  topics: v.array(v.any()),
  type: v.string(),
  raw: v.any(),
  decoded: v.optional(v.any()),
  journeyCorrelationId: v.optional(v.string()),
  observedAt: v.number(),
})
  .index("by_event_key", ["eventKey"])
  .index("by_project_ledger", ["projectId", "ledger"])
  .index("by_contract_ledger", ["contractId", "ledger"])
  .index("by_transaction_hash", ["transactionHash"]);
