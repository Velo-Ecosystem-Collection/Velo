---
type: architecture
area: backend
status: current
last_updated: 2026-09-03
source_of_truth: repository
---

# Backend Architecture

Convex under `packages/backend/convex` is the authoritative application backend. Domain folders keep schema, public queries/mutations, internal functions, and helpers near the state they own.

## Function Roles

- Queries read owner-scoped or public projections.
- Mutations perform transactional state transitions, idempotency, authorization, and job scheduling.
- Actions call Stellar RPC, PDAX, or other network dependencies, then delegate durable writes back to mutations.
- Internal queries/mutations/actions are used by workers and cross-domain orchestration. Gas sponsor orchestration will pass server-derived facts to `internal.gas.admission.reserve`, which revalidates scope and owns the atomic policy/budget/quota/log transition.
- `http.ts` exposes the canonical versioned PDAX callback directly from Convex.

## Authorization

- Console calls rely on the custom wallet JWT configured through `auth.config.ts` and `authConfig.ts`.
- Project helpers compare the Convex identity token identifier and normalized wallet subject/address; legacy address-only projects can be upgraded on access.
- Public merchant APIs hash bearer or `x-api-key` values and authorize them to a project/payment access state.
- Project role helpers also support owner/editor/viewer membership for project-integrated Playground features.
- Gas console functions reuse the same project role resolution: viewer-or-higher reads, editor-or-higher policy updates, and owner-only relayer metadata updates. Caller input cannot select network, accounting counters, timestamps, balance metadata, ownership, or internal IDs.

## Durable Work

Payment reconciliation, PDAX provider operations, provider callback hints, route enrichment, webhook delivery, telemetry export, event polling, PayAccess sync, and billing recovery use bounded pages, scheduled continuation, idempotency, and lease/generation checks. See [[backend/Background Jobs]], [[modules/Payments and Checkout]], [[modules/Settlement and PDAX]], and [[modules/Webhooks]].

## Backend Integration Rules

- Network calls stay in actions; state changes stay in mutations.
- RPC/PDAX outcomes that are uncertain must enter reconciliation rather than being blindly retried.
- Browser-originated pending/submission state is never sufficient to mark a payment paid.
- Provider callback payloads are normalized/redacted and unsigned PDAX callbacks are treated as hints until corroborated.
