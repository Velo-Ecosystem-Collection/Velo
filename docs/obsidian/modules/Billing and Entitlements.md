---
type: module
area: billing
status: partial
last_updated: 2026-08-31
source_of_truth: repository
---

# Billing and Entitlements

## Purpose

Tracks promotional and paid Velo credits, reservations, top-ups, commercial/shadow books, policy gates, treasury receipts, financial reports, and billing exceptions.

## Current Status

Implemented backend code with Testnet/sandbox and guarded Mainnet paths. It is not evidence of a live commercial or Mainnet launch.

## Primary Locations

- `packages/backend/convex/billing/`
- `packages/backend/convex/payment_intents/mutations.ts`
- `apps/web/features/billing/`
- `apps/web/app/billing/page.tsx`

## Responsibilities

- `billingPolicies` and `organizationBillingSettings` control shadow mode, top-ups, enforcement, cohort, kill switch, and network gates.
- Immutable `billingLedgerEntries`, materialized `billingBalances`, and `creditLots` model grant/reserve/consume/release/expiry.
- `billingTopups` and `treasuryReceipts` connect verified Stellar transfers to paid credits.
- Exceptions, evidence/history, notifications, reports, replay runs, refunds, and PDAX economics support operations.
- `commercial.ts` reserves/releases/consumes credits when payment intents are created or terminal.

## Main Entry Points

`billing/mutations.ts`, `topups.ts`, `commercial.ts`, `reconciliation.ts`, `offers.ts`, `availability.ts`, and `queries.ts`. A top-up creates a billing PaymentIntent whose receiver is the configured treasury; `markVerifiedPaid` verifies the transfer before granting credits.

## Common Change Locations

- Credit semantics/state: `billing/schema.ts`, `helpers.ts`, `commercial.ts`.
- Top-up verification: `billing/topups.ts`, `payment_intents/verification.ts`, `payment_intents/mutations.ts`.
- Launch/kill-switch behavior: `billing/config.ts`, `availability.ts`, `launch.ts`, `operators.ts`.
- Billing UI: `apps/web/features/billing/billing-dashboard.tsx` and offer helpers.

## Risks / Gotchas

- Never edit balances or receipts to compensate for an incident; use immutable ledger entries and exception history.
- Testnet enforcement is explicitly enabled per organization; Mainnet requires verified/cohort/policy state and is gated.
- PayAccess display mirrors are not the commercial entitlement source; Convex billing ledgers are authoritative.
- Treasury and verifier anomalies require rollback/reconciliation.

## Related Notes

[[modules/Payments and Checkout]], [[contracts/VeloPayAccess]], [[operations/Deployment]], [[workflows/Debugging]]

