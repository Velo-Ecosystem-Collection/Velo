---
type: operations
area: backend
status: current
last_updated: 2026-08-31
source_of_truth: repository
---

# Background Jobs

Scheduled definitions are in `packages/backend/convex/crons.ts`. Most jobs process bounded pages and schedule continuation when the page is full.

## Current Schedules

- Every minute: recent project contract-event polling, telemetry export/gauge capture, billing reservation recovery, billing credit-lot expiry, payment reconciliation drain, provider-operation reconciliation, provider-event recovery/drain, PDAX route recovery, PayAccess event sync.
- Every two minutes: pending PDAX payout polling.
- Every hour: telemetry/journey expiry and Playground execution expiry.
- Every five minutes: sandbox billing reconciliation.
- Daily at UTC midnight: commercial ledger replay.

## Worker Ownership

- Stellar/payment confirmation: `payment_reconciliation_jobs/`, `payment_intents/scanner.ts`, `transactions/`.
- Contract events: `contractEventPolling.ts` with `pollerState` cursors/checkpoints and max five concurrent project workers.
- PayAccess: `payAccessSync.ts` polls the configured PayAccess contract and updates the project cache.
- PDAX: `provider_operations/actions.ts`, `provider_events/processing.ts`, `settlement/actions.ts`, and route jobs use provider keys, leases, and recovery state.
- Webhooks: `webhookDelivery.ts` plus `webhook_deliveries/*` uses delivery leases and retry scheduling.
- Telemetry: `telemetry_outbox/actions.ts`, `mutations.ts`, `gauges.ts`.

## Reliability Rules

Lease token/generation checks prevent stale completion. Idempotency keys/fingerprints prevent duplicate logical operations. Unknown provider/RPC results enter reconciliation; they must not trigger an unkeyed resubmission.

## Important Distinction

`payment_intents/scanner.ts:checkPendingPayments` exists as an internal scan, but the current cron entry is the durable reconciliation job drain. Confirm the actual scheduler before changing worker behavior.

Related: [[architecture/Backend Architecture]], [[modules/Observability]], [[operations/Testing]].

