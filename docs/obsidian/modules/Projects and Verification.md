---
type: module
area: projects
status: current
last_updated: 2026-08-31
source_of_truth: repository
---

# Projects and Verification

## Purpose

Connects a wallet-owned Velo project in Convex to a Soroban Registry project and a list of official contract IDs, with a public safe verification view.

## Current Status

Implemented in the Testnet alpha codebase; live deployment state must be checked against [[contracts/Contracts Overview]].

## Primary Locations

- `packages/backend/convex/projects/`
- `packages/backend/convex/project_contracts/`
- `contracts/registry/`
- `packages/stellar/src/registry.ts`
- `apps/web/features/projects/`
- `apps/web/app/projects/`, `apps/web/app/verify/[slug]/page.tsx`

## Responsibilities and Entry Points

- `projects/mutation.ts`: create/update drafts, registration state, settings, logos, and owner-scoped changes.
- `projects/query.ts`: owner project lists, dashboard summaries, project reads, public verification, and API-key-backed reads.
- `project_contracts/mutation.ts` and `query.ts`: pending/active/stale/error lifecycle for official contract links.
- `VeloRegistry`: authoritative on-chain project identity and contract references.

## Data Model

Convex `projects` stores metadata, owner identity, slug, Registry ID/transaction/status, payment-access cache, and default payment anchor. `projectContracts` stores each contract link and sync state. Organizations and memberships provide broader identity/role context.

## Important Flow

Draft → wallet signs `register_project` → Convex stores pending hash → confirmation sync stores Registry project ID → owner can add official contracts → public `/verify/[slug]` returns active only when local/Registry state is consistent.

## Common Change Locations

- Project fields or status: `packages/backend/convex/projects/schema.ts`, `mutation.ts`, `query.ts`.
- On-chain registration/link transactions: `packages/stellar/src/registry.ts` and `apps/web/features/projects/dashboard.tsx` / `project-contracts.tsx`.
- Public verification shape: `projects/query.ts` and `apps/web/features/projects/public-verification.tsx`.
- Project console UI/navigation: `apps/web/app/projects/` and `apps/web/core/app-shell.tsx`.

## Risks / Gotchas

- Owner authorization is wallet identity/token based; do not add unauthenticated project mutations.
- Registry and Convex can temporarily disagree while a transaction is pending or stale.
- Metadata hashes and contract IDs are validated; public verification intentionally returns no official contracts when a mismatch is detected.

## Related Notes

[[contracts/VeloRegistry]], [[data/Convex Schema]], [[modules/Wallet Authentication]], [[stellar/Transaction Lifecycle]]

