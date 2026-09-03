---
type: architecture
area: backend
status: current
last_updated: 2026-09-04
source_of_truth: repository
---

# Backend Architecture

Convex under `packages/backend/convex` is the authoritative application backend. Domain folders keep schema, public queries/mutations, internal functions, and helpers near the state they own.

## Function Roles

- Queries read owner-scoped or public projections.
- Mutations perform transactional state transitions, idempotency, authorization, and job scheduling.
- Actions call Stellar RPC, PDAX, or other network dependencies, then delegate durable writes back to mutations.
- Internal queries/mutations/actions are used by workers and cross-domain orchestration. The public Gas sponsor action authorizes through `internal.gas.public_api_internal.authorize`, enforces 64 KiB XDR and 255-byte idempotency bounds, derives the envelope facts, and passes them to `internal.gas.admission.reserve`, which revalidates scope and owns the atomic policy/budget/quota/log transition. The public Gas submit action uses the same authorization lookup and delegates to `internal.gas.submit.submit`, which revalidates scope, correlates the indexed project/request reservation, and owns the only D1 `reserved → expired` transition and same-day budget release. Public action dependency failures map to typed `dependency_unavailable`; malformed dependency projections and invariant failures are sanitized as `internal_error`. The Next.js `POST /api/gas/sponsor` and `POST /api/gas/submit` routes incrementally read a 64 KiB maximum body, cancel oversized streams when possible, hash the API key, and call these seams through minimal DTO boundaries; active submit requests stop at `handoff_unavailable` until D2 provides a trusted relayer boundary.
- `http.ts` exposes the canonical versioned PDAX callback directly from Convex.

## Authorization

- Console calls rely on the custom wallet JWT configured through `auth.config.ts` and `authConfig.ts`.
- Project helpers compare the Convex identity token identifier and normalized wallet subject/address; legacy address-only projects can be upgraded on access.
- Public merchant APIs hash bearer or `x-api-key` values and authorize them to a project/payment access state.
- Project role helpers also support owner/editor/viewer membership for project-integrated Playground features.
- Gas console functions reuse the same project role resolution: viewer-or-higher reads, editor-or-higher policy updates, and owner-only relayer metadata updates. Caller input cannot select network, accounting counters, timestamps, balance metadata, ownership, or internal IDs. Policy updates roll stale daily counters into the current UTC day and reject a same-day cap below existing reservations atomically. Indexed uniqueness checks are bounded and ambiguous records fail closed.

## Durable Work

Payment reconciliation, PDAX provider operations, provider callback hints, route enrichment, webhook delivery, telemetry export, event polling, PayAccess sync, and billing recovery use bounded pages, scheduled continuation, idempotency, and lease/generation checks. See [[backend/Background Jobs]], [[modules/Payments and Checkout]], [[modules/Settlement and PDAX]], and [[modules/Webhooks]].

## Backend Integration Rules

- Network calls stay in actions; state changes stay in mutations.
- RPC/PDAX outcomes that are uncertain must enter reconciliation rather than being blindly retried.
- Browser-originated pending/submission state is never sufficient to mark a payment paid.
- Provider callback payloads are normalized/redacted and unsigned PDAX callbacks are treated as hints until corroborated.
