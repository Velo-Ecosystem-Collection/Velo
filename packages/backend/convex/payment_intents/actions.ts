import { v } from "convex/values";

import { internalAction } from "../_generated/server";

/** Compatibility target for legacy queued PDAX route-enrichment jobs. */
export const enrichPdaxRoute = internalAction({
  args: { paymentIntentId: v.id("paymentIntents") },
  handler: async () => null,
});
