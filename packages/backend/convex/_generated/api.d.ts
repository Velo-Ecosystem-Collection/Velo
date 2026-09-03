/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as authConfig from "../authConfig.js";
import type * as billing_access from "../billing/access.js";
import type * as billing_admin from "../billing/admin.js";
import type * as billing_availability from "../billing/availability.js";
import type * as billing_cohort from "../billing/cohort.js";
import type * as billing_commercial from "../billing/commercial.js";
import type * as billing_config from "../billing/config.js";
import type * as billing_constants from "../billing/constants.js";
import type * as billing_exceptions from "../billing/exceptions.js";
import type * as billing_finance from "../billing/finance.js";
import type * as billing_helpers from "../billing/helpers.js";
import type * as billing_launch from "../billing/launch.js";
import type * as billing_merchant from "../billing/merchant.js";
import type * as billing_mirror from "../billing/mirror.js";
import type * as billing_mirrorActions from "../billing/mirrorActions.js";
import type * as billing_mutations from "../billing/mutations.js";
import type * as billing_notifications from "../billing/notifications.js";
import type * as billing_offers from "../billing/offers.js";
import type * as billing_operators from "../billing/operators.js";
import type * as billing_queries from "../billing/queries.js";
import type * as billing_reconciliation from "../billing/reconciliation.js";
import type * as billing_scorecard from "../billing/scorecard.js";
import type * as billing_shadow from "../billing/shadow.js";
import type * as billing_topups from "../billing/topups.js";
import type * as contract_events_helpers from "../contract_events/helpers.js";
import type * as contract_events_mutation from "../contract_events/mutation.js";
import type * as contract_events_query from "../contract_events/query.js";
import type * as contract_events_types from "../contract_events/types.js";
import type * as contractEventPolling from "../contractEventPolling.js";
import type * as crons from "../crons.js";
import type * as feedback_mutation from "../feedback/mutation.js";
import type * as feedback_query from "../feedback/query.js";
import type * as gas_admission from "../gas/admission.js";
import type * as gas_authorization from "../gas/authorization.js";
import type * as gas_envelope from "../gas/envelope.js";
import type * as gas_mutations from "../gas/mutations.js";
import type * as gas_policy from "../gas/policy.js";
import type * as gas_projections from "../gas/projections.js";
import type * as gas_queries from "../gas/queries.js";
import type * as gas_types from "../gas/types.js";
import type * as gas_validation from "../gas/validation.js";
import type * as http from "../http.js";
import type * as journey_stages_mutations from "../journey_stages/mutations.js";
import type * as migrations from "../migrations.js";
import type * as organizations_helpers from "../organizations/helpers.js";
import type * as organizations_mutations from "../organizations/mutations.js";
import type * as organizations_queries from "../organizations/queries.js";
import type * as payAccessSync from "../payAccessSync.js";
import type * as payment_intents_actions from "../payment_intents/actions.js";
import type * as payment_intents_helpers from "../payment_intents/helpers.js";
import type * as payment_intents_mutations from "../payment_intents/mutations.js";
import type * as payment_intents_public_api from "../payment_intents/public_api.js";
import type * as payment_intents_public_api_internal from "../payment_intents/public_api_internal.js";
import type * as payment_intents_queries from "../payment_intents/queries.js";
import type * as payment_intents_scanner from "../payment_intents/scanner.js";
import type * as payment_intents_verification from "../payment_intents/verification.js";
import type * as payment_reconciliation_jobs_actions from "../payment_reconciliation_jobs/actions.js";
import type * as payment_reconciliation_jobs_mutations from "../payment_reconciliation_jobs/mutations.js";
import type * as playground_projects_helpers from "../playground_projects/helpers.js";
import type * as playground_projects_mutations from "../playground_projects/mutations.js";
import type * as playground_projects_queries from "../playground_projects/queries.js";
import type * as poller_state_helpers from "../poller_state/helpers.js";
import type * as poller_state_mutation from "../poller_state/mutation.js";
import type * as poller_state_query from "../poller_state/query.js";
import type * as poller_state_types from "../poller_state/types.js";
import type * as project_contracts_helpers from "../project_contracts/helpers.js";
import type * as project_contracts_mutation from "../project_contracts/mutation.js";
import type * as project_contracts_query from "../project_contracts/query.js";
import type * as project_contracts_types from "../project_contracts/types.js";
import type * as projects_helpers from "../projects/helpers.js";
import type * as projects_mutation from "../projects/mutation.js";
import type * as projects_query from "../projects/query.js";
import type * as projects_types from "../projects/types.js";
import type * as provider_connections_mutation from "../provider_connections/mutation.js";
import type * as provider_connections_query from "../provider_connections/query.js";
import type * as provider_events_mutation from "../provider_events/mutation.js";
import type * as provider_events_processing from "../provider_events/processing.js";
import type * as provider_operations_actions from "../provider_operations/actions.js";
import type * as provider_operations_mutations from "../provider_operations/mutations.js";
import type * as provider_operations_queries from "../provider_operations/queries.js";
import type * as rate_limits_cutover from "../rate_limits/cutover.js";
import type * as rate_limits_model from "../rate_limits/model.js";
import type * as rate_limits_mutations from "../rate_limits/mutations.js";
import type * as rate_limits_upstash from "../rate_limits/upstash.js";
import type * as seedBenchmarkKey from "../seedBenchmarkKey.js";
import type * as settlement_actions from "../settlement/actions.js";
import type * as settlement_helpers from "../settlement/helpers.js";
import type * as settlement_quotes_mutation from "../settlement_quotes/mutation.js";
import type * as settlement_quotes_query from "../settlement_quotes/query.js";
import type * as settlement_transactions_mutation from "../settlement_transactions/mutation.js";
import type * as settlement_transactions_query from "../settlement_transactions/query.js";
import type * as sprint8_migrations from "../sprint8_migrations.js";
import type * as telemetry_outbox_actions from "../telemetry_outbox/actions.js";
import type * as telemetry_outbox_config from "../telemetry_outbox/config.js";
import type * as telemetry_outbox_gauges from "../telemetry_outbox/gauges.js";
import type * as telemetry_outbox_helpers from "../telemetry_outbox/helpers.js";
import type * as telemetry_outbox_mutations from "../telemetry_outbox/mutations.js";
import type * as telemetry_outbox_redactionMigration from "../telemetry_outbox/redactionMigration.js";
import type * as tests_gas_fixtures from "../tests/gas/fixtures.js";
import type * as transactions_action from "../transactions/action.js";
import type * as transactions_helpers from "../transactions/helpers.js";
import type * as transactions_mutation from "../transactions/mutation.js";
import type * as transactions_query from "../transactions/query.js";
import type * as transactions_types from "../transactions/types.js";
import type * as users_mutation from "../users/mutation.js";
import type * as users_query from "../users/query.js";
import type * as wallet_configs_helpers from "../wallet_configs/helpers.js";
import type * as wallet_configs_mutation from "../wallet_configs/mutation.js";
import type * as wallet_configs_query from "../wallet_configs/query.js";
import type * as wallet_configs_validators from "../wallet_configs/validators.js";
import type * as webhook_deliveries_constants from "../webhook_deliveries/constants.js";
import type * as webhook_deliveries_helpers from "../webhook_deliveries/helpers.js";
import type * as webhook_deliveries_mutation from "../webhook_deliveries/mutation.js";
import type * as webhook_deliveries_query from "../webhook_deliveries/query.js";
import type * as webhook_deliveries_types from "../webhook_deliveries/types.js";
import type * as webhook_endpoints_helpers from "../webhook_endpoints/helpers.js";
import type * as webhook_endpoints_mutation from "../webhook_endpoints/mutation.js";
import type * as webhook_endpoints_query from "../webhook_endpoints/query.js";
import type * as webhook_endpoints_types from "../webhook_endpoints/types.js";
import type * as webhookDelivery from "../webhookDelivery.js";
import type { ApiFromModules, FilterApi, FunctionReference } from "convex/server";

declare const fullApi: ApiFromModules<{
  authConfig: typeof authConfig;
  "billing/access": typeof billing_access;
  "billing/admin": typeof billing_admin;
  "billing/availability": typeof billing_availability;
  "billing/cohort": typeof billing_cohort;
  "billing/commercial": typeof billing_commercial;
  "billing/config": typeof billing_config;
  "billing/constants": typeof billing_constants;
  "billing/exceptions": typeof billing_exceptions;
  "billing/finance": typeof billing_finance;
  "billing/helpers": typeof billing_helpers;
  "billing/launch": typeof billing_launch;
  "billing/merchant": typeof billing_merchant;
  "billing/mirror": typeof billing_mirror;
  "billing/mirrorActions": typeof billing_mirrorActions;
  "billing/mutations": typeof billing_mutations;
  "billing/notifications": typeof billing_notifications;
  "billing/offers": typeof billing_offers;
  "billing/operators": typeof billing_operators;
  "billing/queries": typeof billing_queries;
  "billing/reconciliation": typeof billing_reconciliation;
  "billing/scorecard": typeof billing_scorecard;
  "billing/shadow": typeof billing_shadow;
  "billing/topups": typeof billing_topups;
  contractEventPolling: typeof contractEventPolling;
  "contract_events/helpers": typeof contract_events_helpers;
  "contract_events/mutation": typeof contract_events_mutation;
  "contract_events/query": typeof contract_events_query;
  "contract_events/types": typeof contract_events_types;
  crons: typeof crons;
  "feedback/mutation": typeof feedback_mutation;
  "feedback/query": typeof feedback_query;
  "gas/admission": typeof gas_admission;
  "gas/authorization": typeof gas_authorization;
  "gas/envelope": typeof gas_envelope;
  "gas/mutations": typeof gas_mutations;
  "gas/policy": typeof gas_policy;
  "gas/projections": typeof gas_projections;
  "gas/queries": typeof gas_queries;
  "gas/types": typeof gas_types;
  "gas/validation": typeof gas_validation;
  http: typeof http;
  "journey_stages/mutations": typeof journey_stages_mutations;
  migrations: typeof migrations;
  "organizations/helpers": typeof organizations_helpers;
  "organizations/mutations": typeof organizations_mutations;
  "organizations/queries": typeof organizations_queries;
  payAccessSync: typeof payAccessSync;
  "payment_intents/actions": typeof payment_intents_actions;
  "payment_intents/helpers": typeof payment_intents_helpers;
  "payment_intents/mutations": typeof payment_intents_mutations;
  "payment_intents/public_api": typeof payment_intents_public_api;
  "payment_intents/public_api_internal": typeof payment_intents_public_api_internal;
  "payment_intents/queries": typeof payment_intents_queries;
  "payment_intents/scanner": typeof payment_intents_scanner;
  "payment_intents/verification": typeof payment_intents_verification;
  "payment_reconciliation_jobs/actions": typeof payment_reconciliation_jobs_actions;
  "payment_reconciliation_jobs/mutations": typeof payment_reconciliation_jobs_mutations;
  "playground_projects/helpers": typeof playground_projects_helpers;
  "playground_projects/mutations": typeof playground_projects_mutations;
  "playground_projects/queries": typeof playground_projects_queries;
  "poller_state/helpers": typeof poller_state_helpers;
  "poller_state/mutation": typeof poller_state_mutation;
  "poller_state/query": typeof poller_state_query;
  "poller_state/types": typeof poller_state_types;
  "project_contracts/helpers": typeof project_contracts_helpers;
  "project_contracts/mutation": typeof project_contracts_mutation;
  "project_contracts/query": typeof project_contracts_query;
  "project_contracts/types": typeof project_contracts_types;
  "projects/helpers": typeof projects_helpers;
  "projects/mutation": typeof projects_mutation;
  "projects/query": typeof projects_query;
  "projects/types": typeof projects_types;
  "provider_connections/mutation": typeof provider_connections_mutation;
  "provider_connections/query": typeof provider_connections_query;
  "provider_events/mutation": typeof provider_events_mutation;
  "provider_events/processing": typeof provider_events_processing;
  "provider_operations/actions": typeof provider_operations_actions;
  "provider_operations/mutations": typeof provider_operations_mutations;
  "provider_operations/queries": typeof provider_operations_queries;
  "rate_limits/cutover": typeof rate_limits_cutover;
  "rate_limits/model": typeof rate_limits_model;
  "rate_limits/mutations": typeof rate_limits_mutations;
  "rate_limits/upstash": typeof rate_limits_upstash;
  seedBenchmarkKey: typeof seedBenchmarkKey;
  "settlement/actions": typeof settlement_actions;
  "settlement/helpers": typeof settlement_helpers;
  "settlement_quotes/mutation": typeof settlement_quotes_mutation;
  "settlement_quotes/query": typeof settlement_quotes_query;
  "settlement_transactions/mutation": typeof settlement_transactions_mutation;
  "settlement_transactions/query": typeof settlement_transactions_query;
  sprint8_migrations: typeof sprint8_migrations;
  "telemetry_outbox/actions": typeof telemetry_outbox_actions;
  "telemetry_outbox/config": typeof telemetry_outbox_config;
  "telemetry_outbox/gauges": typeof telemetry_outbox_gauges;
  "telemetry_outbox/helpers": typeof telemetry_outbox_helpers;
  "telemetry_outbox/mutations": typeof telemetry_outbox_mutations;
  "telemetry_outbox/redactionMigration": typeof telemetry_outbox_redactionMigration;
  "tests/gas/fixtures": typeof tests_gas_fixtures;
  "transactions/action": typeof transactions_action;
  "transactions/helpers": typeof transactions_helpers;
  "transactions/mutation": typeof transactions_mutation;
  "transactions/query": typeof transactions_query;
  "transactions/types": typeof transactions_types;
  "users/mutation": typeof users_mutation;
  "users/query": typeof users_query;
  "wallet_configs/helpers": typeof wallet_configs_helpers;
  "wallet_configs/mutation": typeof wallet_configs_mutation;
  "wallet_configs/query": typeof wallet_configs_query;
  "wallet_configs/validators": typeof wallet_configs_validators;
  webhookDelivery: typeof webhookDelivery;
  "webhook_deliveries/constants": typeof webhook_deliveries_constants;
  "webhook_deliveries/helpers": typeof webhook_deliveries_helpers;
  "webhook_deliveries/mutation": typeof webhook_deliveries_mutation;
  "webhook_deliveries/query": typeof webhook_deliveries_query;
  "webhook_deliveries/types": typeof webhook_deliveries_types;
  "webhook_endpoints/helpers": typeof webhook_endpoints_helpers;
  "webhook_endpoints/mutation": typeof webhook_endpoints_mutation;
  "webhook_endpoints/query": typeof webhook_endpoints_query;
  "webhook_endpoints/types": typeof webhook_endpoints_types;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<typeof fullApi, FunctionReference<any, "public">>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<typeof fullApi, FunctionReference<any, "internal">>;

export declare const components: {
  migrations: import("@convex-dev/migrations/_generated/component.js").ComponentApi<"migrations">;
};
