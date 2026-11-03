import { v } from "convex/values";

import { internalMutation } from "../_generated/server";

/** Compatibility target for lease-recovery jobs scheduled by the retired provider worker. */
export const recoverExpiredLease = internalMutation({
  args: { operationId: v.id("providerOperations") },
  handler: async () => false,
});
