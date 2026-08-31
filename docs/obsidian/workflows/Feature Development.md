---
type: workflow
area: development
status: current
last_updated: 2026-08-31
source_of_truth: repository
---

# Feature Development

## Before Coding

1. Read [[Home]] and [[Repository Map]].
2. Identify the domain note and read it, especially **Common Change Locations** and **Risks / Gotchas**.
3. Read the relevant architecture/data/contract notes.
4. Inspect the smallest set of source entry points and nearby tests.
5. Confirm whether the request changes browser state, Convex state, Stellar evidence, provider operations, a contract, or only presentation.

## Routing Heuristics

| Request | Start with |
| --- | --- |
| Hosted payment/API | [[modules/Payments and Checkout]], [[stellar/Transaction Lifecycle]], `payment_intents/`, API routes. |
| Project/contract verification | [[modules/Projects and Verification]], [[contracts/VeloRegistry]], `projects/`, `project_contracts/`, `packages/stellar/src/registry.ts`. |
| Payment activation/credits | [[contracts/VeloPayAccess]], [[modules/Billing and Entitlements]], `payAccessSync.ts`. |
| Webhook behavior | [[modules/Webhooks]], `webhookDelivery.ts`, endpoint/delivery schemas/tests. |
| PDAX/settlement | [[modules/Settlement and PDAX]], `settlement/actions.ts`, `packages/pdax/src/client.ts`. |
| Playground | [[modules/Playground]], Playground server/API, `packages/stellar` spec/argument helpers. |
| Wallet/auth | [[modules/Wallet Authentication]], `core/wallet/`, `core/auth/`, Convex auth helpers. |
| Debug/events/telemetry | [[modules/Stellar Transactions and Contract Events]], [[modules/Observability]]. |

## During Coding

- Preserve package boundaries and generated-file rules.
- Keep private credentials server-side.
- Maintain idempotency and state-transition invariants when crossing network boundaries.
- Add focused tests next to the affected feature/package.
- Note newly discovered relationships, helpers, failure modes, or configuration requirements for the vault update.

## After Coding

Run the narrowest relevant tests/lint/build commands from [[operations/Testing]] and [[Development Guide]]. Update only vault notes whose knowledge changed; update their `last_updated` field and append a concise entry to [[changelog/Knowledge Changelog]] when the context change is significant.

