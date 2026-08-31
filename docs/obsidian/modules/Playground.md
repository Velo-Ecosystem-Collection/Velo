---
type: module
area: playground
status: partial
last_updated: 2026-08-31
source_of_truth: repository
---

# Playground

## Purpose

Loads live Soroban contract specifications, edits canonical arguments, simulates calls, presents exact XDR review, and supports constrained Testnet invocation with durable project history.

## Current Status

Testnet simulation/review/invocation code and deterministic tests are implemented. Mainnet supports loading/simulation only. Live fixture/wallet qualification remains pending.

## Primary Locations

- UI: `apps/web/features/playground/`, `apps/web/app/playground/`, `app/projects/[projectId]/playground/`.
- Server: `features/playground/server/contract-loader.ts`, `transaction-service.ts`, `project-context.ts`, `rate-limit.ts`.
- API: `apps/web/app/api/v1/playground/`.
- Shared protocol: `packages/stellar/src/contract-spec.ts`, `contract-arguments.ts`, `playground-codegen.ts`, `playground-project.ts`.
- Persistence: `packages/backend/convex/playground_projects/`.
- Fixtures: `contracts/playground-fixtures/`.

## Important Flow

Load contract → fetch current spec/Wasm from server-selected RPC → canonical argument validation/encoding → simulate → derive exact unsigned XDR/fingerprint → explicit review → Testnet wallet signs → server verifies signed envelope/current Wasm/call → server submits → status/evidence lookup → persist bounded history.

Mainnet simulation sets `signingEligible: false`; the server rejects non-Testnet invocation.

## Data Model

Project-scoped saved contracts, versioned requests, environment variables, executions, shares, memberships, and webhook filters live in `playground_projects/schema.ts`. Execution history has expiry and idempotency/journey indexes.

## Common Change Locations

- Argument model/limits: `packages/stellar/src/contract-arguments.ts`.
- Spec normalization: `packages/stellar/src/contract-spec.ts` and `features/playground/server/contract-loader.ts`.
- Simulation/submission trust boundary: `features/playground/server/transaction-service.ts` and API routes.
- Client lifecycle/recovery: `playground-client.tsx`, `simulation-state.ts`, `transaction-lifecycle.ts`.
- Project persistence: `packages/backend/convex/playground_projects/`.

## Risks / Gotchas

- Do not accept a user-selected arbitrary RPC URL or network passphrase.
- Review fingerprints, exact XDR, Wasm/spec freshness, and signed envelope before submission.
- Never persist signed XDR or wallet secrets in anonymous recovery state.
- Fixtures and mocked evidence are not live Testnet evidence.

## Related Notes

[[stellar/Transaction Lifecycle]], [[stellar/Network Configuration]], [[data/Convex Schema]], [[operations/Testing]]

