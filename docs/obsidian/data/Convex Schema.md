---
type: reference
area: backend
status: current
last_updated: 2026-09-02
source_of_truth: repository
---

# Convex Schema

The schema is assembled in `packages/backend/convex/schema.ts` from domain-local schema modules. This inventory is intentionally grouped, not a field-by-field API reference.

## Identity and Projects

- `users`, `organizations`, `projects`, `projectMemberships`, `projectContracts`, `apiKeys`.
- Projects carry Registry status/ID/hash, owner identity, payment-access cache, default anchor, and rate-limit backend.

## Payments and Billing

- `paymentIntents`, `paymentIntentIdempotencyKeys`, `paymentIntentRouteJobs`, `paymentReconciliationJobs`.
- Billing tables: `billingPolicies`, `organizationBillingSettings`, `billingOffers`, `billingLaunchApprovals`, `billingTreasuries`, `billingOperationalEvents`, `billingOperatorWallets`, `billingTopups`, `treasuryReceipts`, `billingExceptions`, `billingExceptionEvidence`, `billingExceptionHistory`, `billingCostPeriods`, `billingRefunds`, `billingPdaxEconomics`, `billingFinanceReports`, `billingReplayRuns`, `billingSupportRecords`, `billingNotifications`, `billingBalances`, `creditLots`, `billingLedgerEntries`, `creditReservations`, `organizationMigrationCollisions`, `shadowBillingDecisions`, `payAccessMirrorStates`, `payAccessMirrorAttempts`.

## Gas Station (partial D1 foundation)

- `gasPolicies` stores project-scoped, Testnet-only policy caps, UTC window state, and bounded contract allowlists.
- `gasLogs` stores required request correlation, optional derived fee/wallet/target facts, bounded decision and rejection codes, reservation lifecycle, and independent retention expiry.
- `relayerAccounts` stores project-scoped Testnet relayer public-key and balance metadata with active/disabled status; it contains no signing or custody state.
- Gas-log indexes support project/time, project/source-wallet/time, project/transaction hash, project/idempotency hash, project/request ID, lifecycle/expiry, and retention expiry. Convex indexes do not enforce uniqueness; authorized writes must use indexed `.unique()` lookups.
- This is schema-only groundwork. Policy evaluation, authorization, admission, API routes, cleanup, and relayer execution remain later work.

## Stellar and Polling

- `transactions` stores normalized Testnet transaction/debugger cache.
- `contractEvents` stores decoded/raw contract event evidence and journey correlation.
- `pollerState` stores project/global ledger cursors, status, and lag metrics.

## Webhooks and Journey State

- `webhookEndpoints` stores one project endpoint, event allowlist, destination host, and signing secret.
- `webhookDomainEvents` stores immutable event identity/payload snapshots.
- `webhookDeliveries` stores transport attempts, status, retry/dead-letter, response, and lease data.
- `journeyStages` stores bounded high-level lifecycle milestones.

## PDAX and Settlement

- `providerConnections`, `providerEvents`, `providerOperations`, `providerResilience`, `pdaxRouteCache`.
- `settlementQuotes`, `settlementTransactions`.

## Playground and Wallet Runtime

- `playgroundSavedContracts`, `playgroundSavedRequests`, `playgroundRequestVersions`, `playgroundEnvironmentVariables`, `playgroundExecutions`, `playgroundShares`, `playgroundWebhookFilters`.
- `walletConfigs`, `walletConfigPublications`.

## Limits and Retention

Most worker queues are indexed by state and next-attempt/lease expiry to support bounded work. Exact field validators and indexes are in the domain `schema.ts` files; update this note when a schema materially changes.

Related: [[backend/Background Jobs]], [[modules/Billing and Entitlements]], [[modules/Playground]], [[modules/Webhooks]].
