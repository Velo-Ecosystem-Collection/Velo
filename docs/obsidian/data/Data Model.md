---
type: reference
area: data
status: current
last_updated: 2026-08-31
source_of_truth: repository
---

# Data Model

Convex is the durable source for application state. Stellar and PDAX remain external evidence/provider systems; cached records retain enough normalized identifiers and status to reconcile without treating the cache as ledger authority.

## Core Relationships

```text
users / wallet identity
        ↓
organizations
        ↓
projects ── projectContracts ── Registry contract IDs
   │  │
   │  ├─ apiKeys → paymentIntents → transactions
   │  │                         └→ reconciliation jobs
   │  ├─ webhookEndpoints → webhookDomainEvents → webhookDeliveries
   │  ├─ providerConnections → providerOperations/providerEvents
   │  │                         └→ settlementQuotes/settlementTransactions
   │  ├─ billing settings/balances/lots/ledger/topups/receipts
   │  ├─ contractEvents ← pollerState
   │  ├─ walletConfigs/publications
   │  └─ Playground saved requests/executions/shares
   ```

## Identity and Access

`users` maps wallet/token identity to profile data. `organizations` owns verification/trial state. `projects` stores owner address/token, metadata, Registry state, payment-access cache, default anchor, and rate-limit backend. `projectMemberships` adds owner/editor/viewer roles for project features.

## Payment and Evidence

`paymentIntents` is the central payment state machine. `transactions` caches normalized Stellar evidence. `paymentReconciliationJobs` and `paymentIntentRouteJobs` own asynchronous work. `contractEvents` and `pollerState` support observable Soroban activity.

## External Provider and Delivery

Provider records keep PDAX connection/operation/event state separate from merchant-facing `settlementTransactions`. Webhook domain events and deliveries separate immutable event identity from transport attempts.

## Billing

Billing uses immutable ledger entries plus materialized balances and credit lots. Top-ups are linked to PaymentIntents and verified treasury receipts; PayAccess display mirrors are not entitlement authority.

## Data Safety

- API keys are hashed; raw keys are shown only at creation.
- PDAX credentials/tokens are server-only and should not be returned in project UI projections.
- Provider callbacks are stored as normalized summaries/digests in the new path; legacy raw fields exist during migration.
- Telemetry/journey records expire (currently 14 days for the documented telemetry/journey paths).

See [[data/Convex Schema]] for the table inventory and [[architecture/Integration Boundaries]] for system ownership.

