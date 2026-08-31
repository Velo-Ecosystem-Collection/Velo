---
type: workflow
area: operations
status: current
last_updated: 2026-08-31
source_of_truth: repository
---

# Debugging

## First Pass

1. Start at [[Current System State]] and the relevant module note.
2. Reproduce through the public boundary where possible: page, API route, Convex function, package client, or contract test.
3. Capture the correlation/request/journey ID and current state identifier, not secret payloads.
4. Determine whether the problem is browser state, Convex authorization/state, Stellar RPC evidence, PDAX provider state, webhook transport, or telemetry.

## Common Checks

- Wrong dashboard data: verify wallet identity, selected project, matching Convex deployment, and project role.
- Payment not paid: inspect PaymentIntent status, transaction hash, `transactions` cache, RPC result, and operation match; do not trust browser submission success.
- PDAX stuck: inspect `providerOperations`/`providerEvents`, persisted provider reference, lease/reconciliation state, and UAT availability. Do not resubmit an ambiguous operation.
- Webhook missing: verify endpoint enabled/event allowlist, `webhookDeliveries`, dead-letter/retry fields, and delivery ID; use authenticated replay after fixing the endpoint.
- Event gap: inspect `pollerState` cursor/ledger/error and `contractEvents`; preserve atomic checkpointing.
- Auth failure: verify wallet network/address, challenge/JWKS/issuer configuration, JWT key ID, and Convex identity mapping.
- Billing mismatch: stop/rollback according to the billing runbook, preserve immutable records, and use exception/reconciliation flows.

## Evidence Safety

Do not paste API keys, private keys, seed phrases, JWT secrets, webhook secrets, PDAX credentials/tokens, signed XDR, or raw sensitive provider payloads into tickets, logs, vault notes, or copied diagnostic bundles.

Related: [[operations/Testing]], [[modules/Observability]], [[modules/Billing and Entitlements]], [[operations/Environment Variables]].

