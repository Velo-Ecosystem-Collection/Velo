import { defineSchema } from "convex/server";

import apiKeys from "./api_keys/schema";
import {
  billingBalances,
  billingCostPeriods,
  billingExceptionEvidence,
  billingExceptionHistory,
  billingExceptions,
  billingFinanceReports,
  billingLaunchApprovals,
  billingLedgerEntries,
  billingNotifications,
  billingOffers,
  billingOperationalEvents,
  billingOperatorWallets,
  billingPdaxEconomics,
  billingPolicies,
  billingRefunds,
  billingReplayRuns,
  billingSupportRecords,
  billingTopups,
  billingTreasuries,
  creditLots,
  creditReservations,
  organizationBillingSettings,
  organizationMigrationCollisions,
  payAccessMirrorAttempts,
  payAccessMirrorStates,
  shadowBillingDecisions,
  treasuryReceipts,
} from "./billing/schema";
import contractEvents from "./contract_events/schema";
import feedback from "./feedback/schema";
import journeyStages from "./journey_stages/schema";
import organizations from "./organizations/schema";
import paymentIntentIdempotencyKeys from "./payment_intent_idempotency_keys/schema";
import paymentIntentRouteJobs from "./payment_intent_route_jobs/schema";
import paymentIntents from "./payment_intents/schema";
import paymentReconciliationJobs from "./payment_reconciliation_jobs/schema";
import pdaxRouteCache from "./pdax_route_cache/schema";
import {
  playgroundEnvironmentVariables,
  playgroundExecutions,
  playgroundRequestVersions,
  playgroundSavedContracts,
  playgroundSavedRequests,
  playgroundShares,
  playgroundWebhookFilters,
  projectMemberships,
} from "./playground_projects/schema";
import pollerState from "./poller_state/schema";
import projectContracts from "./project_contracts/schema";
import projects from "./projects/schema";
import providerConnections from "./provider_connections/schema";
import providerEvents from "./provider_events/schema";
import providerOperations from "./provider_operations/schema";
import providerResilience from "./provider_resilience/schema";
import rateLimitBuckets from "./rate_limit_buckets/schema";
import settlementQuotes from "./settlement_quotes/schema";
import settlementTransactions from "./settlement_transactions/schema";
import telemetryOutbox from "./telemetry_outbox/schema";
import transactions from "./transactions/schema";
import users from "./users/schema";
import { walletConfigPublications, walletConfigs } from "./wallet_configs/schema";
import webhookDeliveries from "./webhook_deliveries/schema";
import webhookDomainEvents from "./webhook_domain_events/schema";
import webhookEndpoints from "./webhook_endpoints/schema";

export default defineSchema({
  apiKeys,
  billingBalances,
  billingCostPeriods,
  billingExceptionEvidence,
  billingExceptionHistory,
  billingExceptions,
  billingFinanceReports,
  billingLaunchApprovals,
  billingLedgerEntries,
  billingNotifications,
  billingOffers,
  billingOperationalEvents,
  billingOperatorWallets,
  billingPdaxEconomics,
  billingPolicies,
  billingRefunds,
  billingReplayRuns,
  billingSupportRecords,
  billingTopups,
  billingTreasuries,
  creditLots,
  creditReservations,
  contractEvents,
  feedback,
  journeyStages,
  organizations,
  organizationBillingSettings,
  organizationMigrationCollisions,
  payAccessMirrorAttempts,
  payAccessMirrorStates,
  paymentIntentIdempotencyKeys,
  paymentIntentRouteJobs,
  paymentReconciliationJobs,
  paymentIntents,
  pdaxRouteCache,
  pollerState,
  projectContracts,
  projects,
  projectMemberships,
  playgroundSavedContracts,
  playgroundSavedRequests,
  playgroundRequestVersions,
  playgroundEnvironmentVariables,
  playgroundExecutions,
  playgroundShares,
  playgroundWebhookFilters,
  transactions,
  users,
  webhookDeliveries,
  webhookEndpoints,
  providerConnections,
  providerResilience,
  settlementQuotes,
  settlementTransactions,
  shadowBillingDecisions,
  treasuryReceipts,
  telemetryOutbox,
  providerEvents,
  providerOperations,
  rateLimitBuckets,
  webhookDomainEvents,
  walletConfigs,
  walletConfigPublications,
});
