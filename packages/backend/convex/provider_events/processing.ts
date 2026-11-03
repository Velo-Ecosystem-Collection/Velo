import { v } from "convex/values";

import { internalAction } from "../_generated/server";

/** Compatibility target for queued legacy provider-event processing jobs. */
export const processOne = internalAction({
  args: {
    eventId: v.id("providerEvents"),
    requestCorrelationId: v.optional(v.string()),
    traceparent: v.optional(v.string()),
  },
  handler: async () => ({ processed: false, reason: "provider_processing_disabled" }),
});

/** Compatibility target for queued legacy provider-event drain jobs. */
export const drain = internalAction({
  args: { limit: v.optional(v.number()) },
  handler: async () => ({ claimed: 0 }),
});
