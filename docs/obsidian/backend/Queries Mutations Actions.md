---
type: reference
area: backend
status: current
last_updated: 2026-09-04
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
- Gas: `gas/queries.ts` — viewer-scoped safe policy and Testnet relayer metadata reads plus cursor-paginated, newest-first, project-scoped gas-log reads with native cursor metadata and field-by-field safe projections.
- Wallets/Playground/Billing: corresponding domain `query.ts` files.

## Mutations

- Project/identity mutations manage drafts, registration sync, settings, membership, and profiles.
- Payment mutations create/transition intents, reserve/release billing, verify terminal payment, enrich PDAX routes, and recover route jobs.
- `transactions/mutation.ts` atomically records submitted state and starts reconciliation/watcher work.
- Billing mutations own immutable ledger/lot/balance operations, top-ups, exceptions, launch policy, and reconciliation.
- Webhook mutations create/claim/finish/retry/replay delivery records with lease fencing.
- Provider/event/poller mutations checkpoint workers and move ambiguous records into recovery/quarantine.
- Gas: `gas/mutations.ts` — editor policy upsert and owner relayer metadata upsert with Testnet-only fields, exact stroop handling, stale-day rollover, same-day cap-reduction protection, and safe projection returns; `gas/admission.ts` — internal atomic API-key revalidation, bounded uniqueness checks, idempotency, policy, quota, and reservation decision mutation; `gas/submit.ts` — bounded reservation lookup, lifecycle expiry, and guarded same-day budget release.

## Actions

- `payment_intents/public_api.ts`: public API create/retrieve/list orchestration.
- `payment_intents/scanner.ts`: Stellar payment watcher and pending scan.
- `transactions/action.ts`: transaction RPC lookup/cache.
- `contractEventPolling.ts`, `payAccessSync.ts`: Soroban event workers.
- `settlement/actions.ts`: PDAX connection, balances, quotes, trade, withdrawal, callbacks, and polling.
- `payment_reconciliation_jobs/actions.ts`, `provider_operations/actions.ts`, `provider_events/processing.ts`: durable workers.
- `webhookDelivery.ts`: signed outbound delivery.
- `telemetry_outbox/actions.ts`: bounded OTLP export.
- `gas/public_api.ts`: public Node-runtime sponsor/submit orchestration. Sponsor enforces its own 64 KiB XDR and 255-byte idempotency bounds before hashing, derives signed Testnet envelope facts, and delegates one atomic reservation call; both actions classify authorization/admission/submit dependency failures as `dependency_unavailable` and validate successful reservation projections. `apps/web/core/api/gas-route-handlers.ts` and the two `apps/web/app/api/gas/*/route.ts` routes provide bounded, cancellable HTTP callers, sanitized status mappings, and minimal public DTOs.

## HTTP

`http.ts` exposes `POST /api/webhooks/pdax/v1?token=...`. Next.js routes under `apps/web/app/api` are a separate server boundary and call these functions through Convex clients, including the Testnet-only `POST /api/gas/sponsor` boundary.

Related: [[backend/Background Jobs]], [[modules/Payments and Checkout]], [[modules/Settlement and PDAX]], [[modules/Webhooks]].
