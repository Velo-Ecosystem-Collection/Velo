---
type: architecture
area: system
status: current
last_updated: 2026-08-31
source_of_truth: repository
---

# Architecture Overview

Velo is a layered application platform around Stellar Testnet workflows:

```text
Developer / merchant browser
        ↓
Next.js App Router UI and API routes (`apps/web`)
        ↓
Convex queries, mutations, actions, HTTP ingress, and scheduled workers
        ↓                    ↓
Stellar Horizon/RPC     PDAX UAT API
        ↓                    ↓
Registry / PayAccess     callbacks and payout state
Soroban contracts
```

## Layer Responsibilities

| Layer | Current responsibility | Status |
| --- | --- | --- |
| Browser/UI | Wallet connection, owner console, hosted checkout, Playground editing/review, reactive Convex views, and selected direct Stellar preparation/submission flows. | Implemented Testnet alpha |
| Next.js route layer | Wallet auth endpoints, public V1/V2 payment API, transaction/event/webhook reads, Playground APIs, telemetry intake, and retired PDAX compatibility route. | Implemented; some live qualification pending |
| Convex | Authoritative application records, owner/API-key authorization, payment state, billing, provider state, event caches, webhook queues, telemetry, and scheduled recovery. | Implemented; production evidence pending |
| `@repo/stellar` | Shared Stellar SDK mechanics, asset/payment building, Soroban contract calls, RPC event/transaction inspection, auth helpers, and Playground codecs. | Implemented/tested |
| Soroban | Registry owns project provenance; PayAccess owns on-chain activation/legacy credits and reads Registry. | Implemented contracts; deployment/readiness gated |
| `@repo/pdax` | Server-only UAT authentication, balances, conversion, withdrawal, callback parsing, and registration. | Implemented UAT only |
| Merchant boundary | Server-side SDK clients create/read PaymentIntents; merchant endpoints receive signed, retryable webhook deliveries. | Implemented alpha |

## Primary End-to-End Loop

1. A builder connects a Stellar wallet and completes wallet-signed authentication.
2. The builder creates a Convex-backed project, then signs a Registry transaction.
3. The builder activates PayAccess after the contract verifies the Registry project.
4. A merchant server creates a PaymentIntent through `/api/v2/payment-intents` or the SDK.
5. A buyer signs a Stellar payment at `/pay/[paymentIntentId]`.
6. Convex records pending state; backend Stellar verification is the authority for `paid`.
7. Webhook delivery and dashboard subscriptions expose the resulting state.
8. Optional paid PDAX intents can feed the UAT quote/trade/withdrawal workflow.

See [[architecture/Data Flow]], [[stellar/Transaction Lifecycle]], and [[modules/Payments and Checkout]].

## Explicit Non-Claims

- Testnet alpha is not Mainnet readiness.
- Durable records and lease fencing provide observable convergence, not exactly-once network transport.
- PDAX UAT is not production settlement or compliance support.
- Existing benchmark/test evidence is not live SLO or availability evidence.

