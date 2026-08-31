---
type: module
area: stellar
status: current
last_updated: 2026-08-31
source_of_truth: repository
---

# Stellar Transactions and Contract Events

## Purpose

Provides reusable Stellar transaction inspection and Soroban event ingestion for payment verification, debugging, project observability, and webhook payloads.

## Primary Locations

- Shared helpers: `packages/stellar/src/transaction-debugger.ts`, `event-monitor.ts`, `checkout.ts`, `registry.ts`, `pay-access.ts`.
- Convex caches/workers: `packages/backend/convex/transactions/`, `contract_events/`, `contractEventPolling.ts`, `poller_state/`, `payAccessSync.ts`.
- UI: `apps/web/features/debugger/`, `features/projects/project-events.tsx`, `event-activity.tsx`.

## Responsibilities

- `transactions` caches normalized Testnet RPC transaction evidence and supports `submitted`, pending, terminal, unavailable, and unsupported states.
- Payment scanner matches actual payment operations against intent expectations.
- Project event pollers use opaque cursors/ledger checkpoints and bounded pages/concurrency.
- PayAccess sync interprets `pay` events and updates the project payment-access cache.

## Common Change Locations

- Transaction response normalization/cache: `packages/stellar/src/transaction-debugger.ts`, `packages/backend/convex/transactions/*`.
- Payment truth matching: `packages/backend/convex/payment_intents/verification.ts`.
- Event decode/poll: `packages/stellar/src/event-monitor.ts`, `contractEventPolling.ts`, `contract_events/*`.
- Dashboard presentation: `apps/web/features/debugger/` and `features/projects/`.

## Risks / Gotchas

- Current transaction table and web config are Testnet-only.
- Cursor/checkpoint writes must be atomic with event persistence to avoid skipping events.
- Polling uses bounded pages/workers; avoid unbounded scans or direct browser-wide RPC loops.
- RPC evidence is authoritative for observed status; browser callbacks are not.

## Related Notes

[[stellar/Stellar Integration]], [[stellar/Transaction Lifecycle]], [[backend/Background Jobs]], [[contracts/Contracts Overview]]

