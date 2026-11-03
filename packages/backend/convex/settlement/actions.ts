import { internalAction } from "../_generated/server";

/** Compatibility target for already-queued legacy payout polling jobs. */
export const pollPendingPayouts = internalAction({
  args: {},
  handler: async () => ({ updated: 0, total: 0 }),
});
