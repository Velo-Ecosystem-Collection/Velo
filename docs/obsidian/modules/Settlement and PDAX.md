---
type: module
area: settlement
status: partial
last_updated: 2026-08-31
source_of_truth: repository
---

# Settlement and PDAX

## Purpose

Provides a project-scoped PDAX UAT workflow for stablecoin balance lookup, quotes, conversion trades, PHP InstaPay UAT withdrawals, callback hints, reconciliation, and merchant settlement webhooks.

## Current Status

Implemented as a UAT/sandbox demonstration. Production settlement, compliance, and Mainnet readiness are not implemented/claimed.

## Primary Locations

- Client: `packages/pdax/src/client.ts`, `packages/pdax/README.md`.
- Convex: `packages/backend/convex/settlement/`, `provider_connections/`, `provider_operations/`, `provider_events/`.
- Persistence: `settlement_quotes/`, `settlement_transactions/`, `pdax_route_cache/`.
- UI: `apps/web/features/projects/project-settlement.tsx`, `app/projects/[projectId]/settlement/page.tsx`.
- Ingress: `packages/backend/convex/http.ts` at `/api/webhooks/pdax/v1?token=...`.

## Main Entry Points

`settlement/actions.ts` exposes `connect`, `getBalances`, `getQuote`, `executeTrade`, `fiatWithdraw`, `getOrder`, `handlePdaxWebhook`, `mockPdaxWebhook`, `registerWebhook`, `checkPayoutStatus`, and internal `pollPendingPayouts`.

## Data Model and Flow

- `providerConnections`: per-project PDAX token/session cache.
- `providerOperations`: durable trade/withdrawal operation with fingerprint, provider key, leases, and reconciliation state.
- `providerEvents`: normalized callback summary/digest, initially pending or quarantined.
- `settlementQuotes`: active/expired/executed quote terms.
- `settlementTransactions`: quote/trade/payout lifecycle and provider identifiers.
- `providerResilience`: per-project circuit/lease state.

Flow: paid PDAX intent → resolve deposit address/memo → PDAX UAT quote → durable trade operation → payout operation → callback or polling → provider corroboration → settlement state → signed webhook.

## Callback Trust Boundary

PDAX callbacks are not natively signed. The versioned Convex endpoint authenticates a shared token, validates content type/size/schema, persists a digest/summary, and treats the event as a reconciliation hint. It must not independently finalize an ambiguous financial state.

## Common Change Locations

- Provider API contract: `packages/pdax/src/client.ts` and `client.test.ts`.
- Orchestration/state: `packages/backend/convex/settlement/actions.ts`, `helpers.ts`.
- Durable recovery/fencing: `provider_operations/*`, `provider_events/processing.ts`.
- Payment route enrichment: `payment_intents/mutations.ts`, `payment_intent_route_jobs/schema.ts`.
- UI: `project-settlement.tsx`.

## Risks / Gotchas

- Keep credentials/tokens server-side; never include them in project-visible records or vault notes.
- An ambiguous trade or withdrawal must reconcile using the persisted provider key, not resubmit as a new operation.
- The old Next `/api/webhooks/pdax` route returns 410; update integrations to the versioned Convex callback.
- UAT balances/rates/bank execution are sandbox evidence only.

## Related Notes

[[modules/Payments and Checkout]], [[architecture/Integration Boundaries]], [[stellar/SEP Integrations]], [[operations/Deployment]]

