import { cronJobs, makeFunctionReference } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();
const drainPaymentReconciliation = makeFunctionReference<"action">(
  "payment_reconciliation_jobs/actions:drain",
);
const reconcileProviderOperations = makeFunctionReference<"action">(
  "provider_operations/actions:reconcileDue",
);
const drainProviderEvents = makeFunctionReference<"action">("provider_events/processing:drain");
const recoverPdaxRouteJobs = makeFunctionReference<"mutation">(
  "payment_intents/mutations:recoverPdaxRouteJobs",
);
const exportTelemetry = makeFunctionReference<"action">("telemetry_outbox/actions:exportBatch");
const expireTelemetry = makeFunctionReference<"mutation">("telemetry_outbox/mutations:expire");
const captureTelemetryGauges = makeFunctionReference<"mutation">("telemetry_outbox/gauges:capture");
const expireJourneyStages = makeFunctionReference<"mutation">("journey_stages/mutations:expire");
const expirePlaygroundExecutions = makeFunctionReference<"mutation">(
  "playground_projects/mutations:expireExecutions",
);
const recoverBillingReservations = makeFunctionReference<"mutation">(
  "billing/mutations:recoverExpiredReservations",
);
const expireBillingCreditLots = makeFunctionReference<"mutation">(
  "billing/mutations:expireCreditLots",
);
const reconcileBilling = makeFunctionReference<"mutation">("billing/reconciliation:run");
const replayBilling = makeFunctionReference<"mutation">("billing/reconciliation:runDailyReplay");
const SCHEDULED_WORKER_PAGE_SIZE = 25;

crons.interval(
  "poll recent contract events",
  { minutes: 1 },
  internal.contractEventPolling.pollScheduled,
  {},
);

crons.interval("export bounded telemetry outbox", { minutes: 1 }, exportTelemetry, { limit: 100 });
crons.interval("expire telemetry diagnostics", { hours: 1 }, expireTelemetry, { limit: 100 });
crons.interval("capture bounded telemetry gauges", { minutes: 1 }, captureTelemetryGauges, {});
crons.interval("expire safe journey stages", { hours: 1 }, expireJourneyStages, { limit: 100 });
crons.interval("expire project playground history", { hours: 1 }, expirePlaygroundExecutions, {
  limit: 100,
});
crons.interval("recover expired billing reservations", { minutes: 1 }, recoverBillingReservations, {
  limit: SCHEDULED_WORKER_PAGE_SIZE,
});
crons.interval("expire billing credit lots", { minutes: 1 }, expireBillingCreditLots, {
  limit: SCHEDULED_WORKER_PAGE_SIZE,
});
crons.interval("reconcile sandbox billing", { minutes: 5 }, reconcileBilling, {
  limit: SCHEDULED_WORKER_PAGE_SIZE,
});
crons.cron("verify daily commercial ledger replay", "0 0 * * *", replayBilling, {
  limit: SCHEDULED_WORKER_PAGE_SIZE,
});

crons.interval("drain payment reconciliation jobs", { minutes: 1 }, drainPaymentReconciliation, {
  limit: SCHEDULED_WORKER_PAGE_SIZE,
});

crons.interval(
  "reconcile durable provider operations",
  { minutes: 1 },
  reconcileProviderOperations,
  { limit: SCHEDULED_WORKER_PAGE_SIZE },
);

crons.interval("recover and drain provider events", { minutes: 1 }, drainProviderEvents, {
  limit: SCHEDULED_WORKER_PAGE_SIZE,
});

crons.interval("recover PDAX payment routes", { minutes: 1 }, recoverPdaxRouteJobs, {
  limit: SCHEDULED_WORKER_PAGE_SIZE,
});

crons.interval(
  "poll pay access events",
  { minutes: 1 },
  internal.payAccessSync.syncPayAccessEvents,
  {},
);

crons.interval(
  "poll pending payout status from PDAX",
  { minutes: 2 },
  internal.settlement.actions.pollPendingPayouts,
  {},
);

export default crons;
