import { defineTable } from "convex/server";
import { v } from "convex/values";

export default defineTable({
  organizationId: v.optional(v.id("organizations")),
  name: v.string(),
  normalizedName: v.optional(v.string()),
  slug: v.string(),
  description: v.string(),
  website: v.optional(v.string()),
  metadataJson: v.string(),
  metadataHash: v.string(),
  logoStorageId: v.optional(v.id("_storage")),
  ownerAddress: v.string(),
  ownerTokenIdentifier: v.optional(v.string()),
  retiredAt: v.optional(v.number()),
  retiredByTokenIdentifier: v.optional(v.string()),
  status: v.union(
    v.literal("draft"),
    v.literal("pending_registration"),
    v.literal("registered"),
    v.literal("registration_error"),
    v.literal("stale"),
  ),
  registryProjectId: v.optional(v.number()),
  registrationTxHash: v.optional(v.string()),
  registrationError: v.optional(v.string()),
  createdLedger: v.optional(v.number()),
  lastSyncAt: v.optional(v.number()),
  apiKeyHash: v.optional(v.string()),
  apiKeyPrefix: v.optional(v.string()),
  apiKeyCreatedAt: v.optional(v.number()),
  paymentAccessActive: v.optional(v.boolean()),
  checkoutCredits: v.optional(v.number()),
  paymentAccessLastSyncAt: v.optional(v.number()),
  defaultPaymentAnchor: v.optional(v.union(v.literal("inhouse"), v.literal("pdax"))),
  rateLimitBackend: v.optional(
    v.union(v.literal("convex"), v.literal("migrating"), v.literal("upstash")),
  ),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_owner", ["ownerAddress"])
  .index("by_organization_id", ["organizationId"])
  .index("by_owner_token_identifier", ["ownerTokenIdentifier"])
  .index("by_owner_token_identifier_and_normalized_name", [
    "ownerTokenIdentifier",
    "normalizedName",
  ])
  .index("by_owner_address_and_normalized_name", ["ownerAddress", "normalizedName"])
  .index("by_slug", ["slug"])
  .index("by_owner_status", ["ownerAddress", "status"])
  .index("by_owner_token_identifier_status", ["ownerTokenIdentifier", "status"])
  .index("by_registry_project_id", ["registryProjectId"])
  .index("by_api_key_hash", ["apiKeyHash"]);
