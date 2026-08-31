---
type: operations
area: testing
status: current
last_updated: 2026-08-31
source_of_truth: repository
---

# Testing

## Test Locations

- Web feature/API tests: `apps/web/features/**/*.test.ts` and related route tests.
- Convex tests: `packages/backend/convex/tests/*.test.ts` via Vitest/convex-test.
- Stellar tests: `packages/stellar/src/*.test.ts`.
- PDAX/SDK/observability tests: package `src/*.test.ts`.
- Wallet package tests: `packages/velo-wallets` via Vitest.
- Contract tests: `contracts/registry/tests/registry.rs`, `contracts/pay_access/tests/pay_access.rs`, and fixture tests.
- Benchmark/release tests: `scripts/*.test.mjs`.

## Useful Commands

```bash
pnpm test
pnpm --filter web test
pnpm --filter @repo/backend test
pnpm --filter @repo/stellar test
pnpm --filter @repo/pdax test
pnpm --filter @carts1024/velo-sdk test
pnpm --filter @carts1024/velo-wallets test
cd contracts/registry && cargo test
cd contracts/pay_access && cargo test
```

## Verification Priorities

- Payment changes: API contract, idempotency, status transitions, ledger matching, expiry, and webhook triggers.
- Auth/project changes: wallet/JWT validation and owner/member authorization.
- Stellar changes: network/passphrase, XDR, trustline, account, hash, event cursor, and RPC failure paths.
- Provider changes: operation fingerprint, persisted provider key, lease fencing, ambiguity/reconciliation, callback quarantine.
- Webhook changes: raw-body signature, deduplication, retry/dead-letter, replay, and destination validation.
- Billing changes: immutable ledger, receipt uniqueness, reservations, reconciliation, kill switch, and exception recovery.

Deterministic tests do not prove live Testnet/PDAX/SLO availability. Existing architecture/runbook docs identify live-evidence gaps explicitly.

Related: [[workflows/Debugging]], [[Current System State]], [[operations/Deployment]].

