---
type: reference
area: backend
status: current
last_updated: 2026-09-03
source_of_truth: repository
---

# Queries, Mutations, and Actions

This is a domain-level index of high-value Convex entry points, not an exhaustive generated API reference.

## Queries

- Projects: `projects/query.ts` — owner list/summary, ID/slug/public verification, API-key-backed events/transactions/deliveries.
- Payment intents: `payment_intents/queries.ts` — owner/project stats, public/internal projections, lifecycle-by-correlation.
- Contracts/events: `project_contracts/query.ts`, `contract_events/query.ts` — project links, event activity, poll targets.
- Transactions: `transactions/query.ts` — cached hash lookup.
- Webhooks: `webhook_endpoints/query.ts`, `webhook_deliveries/query.ts` — settings, summaries, delivery history.
- Settlement/provider: `settlement_quotes/query.ts`, `settlement_transactions/query.ts`, provider query modules.
- Gas: `gas/queries.ts` — viewer-scoped safe policy and Testnet relayer metadata reads.
- Wallets/Playground/Billing: corresponding domain `query.ts` files.

## Mutations

- Project/identity mutations manage drafts, registration sync, settings, membership, and profiles.
- Payment mutations create/transition intents, reserve/release billing, verify terminal payment, enrich PDAX routes, and recover route jobs.
- `transactions/mutation.ts` atomically records submitted state and starts reconciliation/watcher work.
- Billing mutations own immutable ledger/lot/balance operations, top-ups, exceptions, launch policy, and reconciliation.
- Webhook mutations create/claim/finish/retry/replay delivery records with lease fencing.
- Provider/event/poller mutations checkpoint workers and move ambiguous records into recovery/quarantine.
- Gas: `gas/mutations.ts` — editor policy upsert and owner relayer metadata upsert with Testnet-only fields, exact stroop handling, and safe projection returns.

## Actions

- `payment_intents/public_api.ts`: public API create/retrieve/list orchestration.
- `payment_intents/scanner.ts`: Stellar payment watcher and pending scan.
- `transactions/action.ts`: transaction RPC lookup/cache.
- `contractEventPolling.ts`, `payAccessSync.ts`: Soroban event workers.
- `settlement/actions.ts`: PDAX connection, balances, quotes, trade, withdrawal, callbacks, and polling.
- `payment_reconciliation_jobs/actions.ts`, `provider_operations/actions.ts`, `provider_events/processing.ts`: durable workers.
- `webhookDelivery.ts`: signed outbound delivery.
- `telemetry_outbox/actions.ts`: bounded OTLP export.

## HTTP

`http.ts` exposes `POST /api/webhooks/pdax/v1?token=...`. Next.js routes under `apps/web/app/api` are a separate server boundary and call these functions through Convex clients.

Related: [[backend/Background Jobs]], [[modules/Payments and Checkout]], [[modules/Settlement and PDAX]], [[modules/Webhooks]].
