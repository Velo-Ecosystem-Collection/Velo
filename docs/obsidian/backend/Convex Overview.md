---
type: architecture
area: backend
status: current
last_updated: 2026-09-03
source_of_truth: repository
---

# Convex Overview

The Convex application lives in `packages/backend/convex`. `schema.ts` composes domain tables; `convex.config.ts` declares Convex environment values and installs migrations; `auth.config.ts` configures custom JWT auth; `http.ts` handles provider ingress; `crons.ts` defines scheduled work.

## Domain Boundaries

- `projects`, `organizations`, `users`, `project_contracts`: identity/project ownership and on-chain sync state.
- `payment_intents`, `transactions`, `payment_reconciliation_jobs`: PaymentIntent state and Stellar evidence/recovery.
- `billing`: commercial/shadow credit accounting and launch safety.
- `settlement`, `provider_*`, `payment_intent_route_jobs`, `pdax_route_cache`: PDAX operations and route enrichment.
- `webhook_*`: event snapshots, delivery transport, signatures, retries, and replay.
- `contract_events`, `poller_state`, `payAccessSync`, `contractEventPolling`: Soroban event ingestion.
- `gas`: Testnet-only Gas policy, relayer metadata, safe projections, console/API-key authorization, policy evaluation, the public `api.gas.public_api.sponsor` Node action, and the internal atomic admission/reservation boundary. The Next.js HTTP route remains planned.
- `playground_projects`, `wallet_configs`: project-integrated developer tools and published wallet runtime configuration.
- `telemetry_outbox`, `journey_stages`, `rate_limits`: diagnostics, lifecycle visibility, and admission control.

## Authorization Pattern

Authenticated Convex functions call project/organization helpers. Gas console functions use the shared project role guard (`viewer` reads, `editor` policy updates, `owner` relayer updates) and return field-by-field projections. Public merchant actions use hashed API-key lookup and project payment-access checks. The Gas sponsor action uses its independent API-key query and does not consult `paymentAccessActive`. Internal workers use `internal` references and must still validate ownership/state when crossing boundaries.

## Backend Rules

Before editing Convex code, read `packages/backend/AGENTS.md` and `packages/backend/convex/_generated/ai/guidelines.md` as required by the repository instructions. Generated Convex files are not hand-edited.

Related: [[backend/Queries Mutations Actions]], [[backend/Background Jobs]], [[data/Convex Schema]], [[architecture/Backend Architecture]].
