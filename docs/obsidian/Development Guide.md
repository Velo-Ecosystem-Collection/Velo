---
type: operations
area: repository
status: current
last_updated: 2026-08-31
source_of_truth: repository
---

# Development Guide

Commands below come from the root and package manifests or existing repository runbooks. Use matching web and Convex deployments when exercising the app.

## Install and Run

```bash
pnpm install
pnpm dev
pnpm --filter web dev
pnpm --filter @repo/backend dev
```

`web` serves Next.js on port `3000`. Convex uses `convex dev`. Local environment values belong in ignored `.env.local` files; see [[operations/Environment Variables]].

## Build, Lint, and Type Checking

```bash
pnpm build
pnpm lint:fix
pnpm --filter web build
pnpm --filter web lint:fix
pnpm --filter @repo/backend lint:fix
pnpm --filter @repo/stellar lint:fix
pnpm --filter @repo/pdax lint:fix
pnpm --filter @carts1024/velo-sdk lint:fix
```

There is no dedicated root `typecheck` script. Package `lint:fix` scripts run TypeScript checks; the web script also runs Next route type generation.

## Tests

```bash
pnpm test
pnpm --filter web test
pnpm --filter web test:e2e
pnpm --filter @repo/backend test
pnpm --filter @repo/stellar test
pnpm --filter @repo/pdax test
pnpm --filter @carts1024/velo-sdk test
pnpm --filter @carts1024/velo-wallets test
pnpm --filter @repo/observability test
```

Backend tests are Vitest. Web, Stellar, PDAX, SDK, and observability tests use Node's built-in test runner where specified; wallets uses Vitest.

## Convex Operations

```bash
pnpm --filter @repo/backend exec convex dev --once
pnpm --filter @repo/backend exec convex run poller_state/query:getByScope '{"scope":"project:<projectId>"}'
pnpm --filter @repo/backend dashboard
```

Before editing Convex code, follow the root and backend `AGENTS.md` instructions and inspect the nearby domain tests.

## Soroban Contracts

```bash
cd contracts/registry && cargo test
cd contracts/pay_access && cargo test
stellar contract build --manifest-path contracts/registry/Cargo.toml
stellar contract build --manifest-path contracts/pay_access/Cargo.toml
pnpm contracts:deploy --network testnet --mirror-authority <PUBLIC_KEY> --dry-run
```

The supported deployment script runs contract tests/builds, deploys Registry before PayAccess, initializes PayAccess, performs read-only smoke calls, and writes a manifest. Mainnet additionally requires `--confirm-mainnet`; see [[operations/Deployment]].

