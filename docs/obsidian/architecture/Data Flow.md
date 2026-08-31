---
type: architecture
area: system
status: current
last_updated: 2026-08-31
source_of_truth: repository
---

# Data Flow

## Project and Access Setup

```text
Wallet → Next wallet challenge/verify → Convex custom JWT
      → create draft project in Convex
      → wallet signs Registry transaction
      → Registry stores provenance
      → dashboard syncs registry ID/status
      → wallet signs PayAccess activation
      → PayAccess reads Registry and stores access
      → Convex PayAccess poller updates project cache
```

## Hosted Checkout

```text
Merchant server / SDK
  → Next `/api/v2/payment-intents`
  → Convex public API action
  → API-key authorization + rate admission + idempotency
  → PaymentIntent in Convex
  → optional PDAX route enrichment
  → buyer opens `/pay/[id]`
  → wallet signs classic Stellar payment
  → client reports pending/hash
  → watcher and reconciliation query Stellar RPC
  → match intended payment
  → Convex marks paid/failed
  → signed webhook + reactive UI update
```

## Settlement

```text
Paid PDAX PaymentIntent
  → owner connects PDAX UAT
  → Convex action logs in/refreshes tokens
  → balances and quote actions
  → durable provider operation reserves/leases trade or withdrawal
  → PDAX response/callback/polling
  → corroborated settlement state
  → signed settlement webhook
```

## Observability

Request and journey correlation values cross API, Convex workers, Stellar/PDAX calls, provider events, webhook deliveries, and UI stages. Telemetry spans/metrics enter a bounded Convex outbox and are exported by scheduled actions; sensitive payloads are projected or redacted.

See [[architecture/Integration Boundaries]], [[modules/Observability]], and [[stellar/Transaction Lifecycle]].

