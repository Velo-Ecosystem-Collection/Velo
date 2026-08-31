---
type: module
area: payments
status: current
last_updated: 2026-08-31
source_of_truth: repository
---

# Payments and Checkout

## Purpose

Creates hosted Stellar payment sessions for merchants, lets buyers sign a payment, and finalizes state only after backend ledger verification.

## Current Status

Implemented for Stellar Testnet alpha. V2 adds `inhouse` and `pdax` anchor routing; code-level support exists while live end-to-end qualification remains pending.

## Primary Locations

- API: `apps/web/app/api/v1/payment-intents/`, `apps/web/app/api/v2/payment-intents/`, `apps/web/core/api/payment-intent-route-handlers.ts`.
- Convex: `packages/backend/convex/payment_intents/`, `transactions/`, `payment_reconciliation_jobs/`.
- UI: `apps/web/app/pay/[paymentIntentId]/`, `apps/web/features/checkout/` and `features/projects/project-payments.tsx`.
- Stellar mechanics: `packages/stellar/src/checkout.ts`.

## Main Entry Points

- `POST/GET /api/v1/payment-intents` and `/api/v2/payment-intents`.
- SDK creates through `/api/v2/payment-intents`.
- `payment_intents/public_api.ts`: API-key authorization, rate admission, idempotency, and projection.
- `payment_intents/mutations.ts`: creation, status transitions, verification, PDAX route enrichment, and billing hooks.
- Hosted route: `/pay/[paymentIntentId]`.

## Data Model

`paymentIntents` stores amount, asset, receiver, payer, anchor, optional memo/deposit currency, expiry, transaction hashes, correlation, and stage timestamps. Supporting tables are `paymentIntentIdempotencyKeys`, `paymentIntentRouteJobs`, `paymentReconciliationJobs`, and `pdaxRouteCache`.

Statuses are `awaiting_route`, `created`, `pending`, `paid`, `failed`, `expired`, and `cancelled`. Default expiry is 30 minutes.

## Important Flow

Merchant API key → authorize project/payment access → resolve anchor (explicit request, key scope, project default, then in-house) → create intent → optional bounded PDAX destination lookup → buyer wallet preflight/sign/submit → record pending/hash → watcher/reconciliation checks Stellar → match source/destination/amount/asset → mark paid/failed → enqueue webhook.

The browser's pending callback is not payment proof. `payment_intents/scanner.ts` and `verification.ts` are the trust boundary.

## Billing Relationship

Payment intent creation can reserve commercial credits; terminal transitions settle/release billing reservations. Billing top-ups use a PaymentIntent with `intentType: billing_topup` and a treasury receiver. See [[modules/Billing and Entitlements]].

## Common Change Locations

- Public request/response or API errors: `apps/web/core/api/payment-intents.ts` and `payment-intent-route-handlers.ts`.
- API orchestration/rate/idempotency: `packages/backend/convex/payment_intents/public_api.ts` and `public_api_internal.ts`.
- Intent fields/statuses/verification: `payment_intents/schema.ts`, `helpers.ts`, `mutations.ts`, `verification.ts`.
- Buyer transaction behavior: `apps/web/features/checkout/checkout-client.tsx`, `packages/stellar/src/checkout.ts`.
- Background confirmation: `payment_intents/scanner.ts`, `payment_reconciliation_jobs/`, `transactions/mutation.ts`.

## Risks / Gotchas

- Do not let client or API route input choose an arbitrary in-house receiver; it is derived from project ownership.
- Do not retry an uncertain provider/transaction submission blindly; reconcile by hash or durable operation.
- PDAX intents may be `awaiting_route`; checkout must wait for receiver/memo enrichment.
- Asset strings and trustlines are network-sensitive; native/XLM and `CODE:ISSUER` are distinct paths.

## Related Notes

[[stellar/Transaction Lifecycle]], [[modules/Webhooks]], [[modules/Settlement and PDAX]], [[data/Convex Schema]], [[contracts/VeloPayAccess]]

