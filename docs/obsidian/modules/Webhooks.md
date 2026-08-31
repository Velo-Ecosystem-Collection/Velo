---
type: module
area: webhooks
status: current
last_updated: 2026-08-31
source_of_truth: repository
---

# Webhooks

## Purpose

Delivers signed merchant notifications for payment, project, transaction, contract, provider, and settlement events with durable logs and retries.

## Current Status

Implemented in code and covered by deterministic tests. Delivery is at-least-once transport with exactly-once observable state; live SLO qualification is not established.

## Primary Locations

- `packages/backend/convex/webhookDelivery.ts`
- `packages/backend/convex/webhook_endpoints/`
- `packages/backend/convex/webhook_deliveries/`
- `packages/backend/convex/webhook_domain_events/`
- `apps/web/features/projects/project-webhooks.tsx`
- `apps/web/app/api/v1/webhooks/deliveries/route.ts`
- `packages/velo-sdk/src/webhooks.ts`

## Responsibilities

- One project endpoint with enabled event-type allowlist and generated signing secret.
- Immutable domain-event key and durable delivery records.
- HMAC-SHA256 signing using `t=<timestamp>,v1=<hex>`.
- Retry of network/408/429/5xx failures up to five attempts using bounded delays and `Retry-After`.
- Lease token/generation fencing, dead-letter state, delivery logs, and authenticated owner replay.

## Common Change Locations

- Event payload shape/allowlist: `webhookDelivery.ts`, `webhook_endpoints/types.ts`, `packages/velo-sdk/src/webhooks.ts`.
- Endpoint validation/settings: `webhook_endpoints/helpers.ts`, `mutation.ts`, `schema.ts`.
- Durable delivery lifecycle: `webhook_deliveries/mutation.ts`, `query.ts`, `schema.ts`.
- UI/logs: `apps/web/features/projects/project-webhooks.tsx`.

## Risks / Gotchas

- Consumers must verify the raw request body and deduplicate using `x-velo-delivery`.
- A successful HTTP response is not exactly-once delivery; retries/replays can duplicate transport.
- Endpoint validation rejects unsafe destinations; do not weaken it to enable local production delivery.
- Secret rotation currently replaces the secret; a dual-secret grace window is not implemented.

## Related Notes

[[modules/Payments and Checkout]], [[modules/Settlement and PDAX]], [[operations/Environment Variables]], [[modules/Observability]]

