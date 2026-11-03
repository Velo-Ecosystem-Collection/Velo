import { v } from "convex/values";

import { internalAction } from "../_generated/server";

/** Compatibility target for queued legacy provider reconciliation jobs. */
export const reconcileDue = internalAction({
  args: { limit: v.optional(v.number()) },
  handler: async () => ({ claimed: 0, resolved: 0 }),
});
