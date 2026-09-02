---
type: operations
area: development
status: current
last_updated: 2026-09-02
source_of_truth: repository
---

# Local Development

## Basic Setup

```bash
pnpm install
pnpm dev
```

For separate processes:

```bash
pnpm --filter web dev
pnpm --filter @repo/backend dev
```

## Git Hooks

The Husky pre-commit hook runs `pnpm lint:fix` and `pnpm build`. Git clients can invoke hooks with a restricted PATH that omits the package-manager and Node directories from an interactive shell; `.husky/pre-commit` resolves pnpm from PATH and standard macOS Homebrew locations, restores its directory for child tools such as Turborepo, and fails with an actionable error if pnpm is unavailable.

The web app uses port `3000`. Keep web and Convex URLs/deployments aligned. Use ignored `apps/web/.env.local` and backend deployment environment settings; copy names from configuration references, not secret values from another environment.

## Convex Changes

```bash
pnpm --filter @repo/backend exec convex dev --once
```

Convex schema/functions are under `packages/backend/convex`. Follow `packages/backend/AGENTS.md` and the generated AI guidelines before editing that area. Do not hand-edit `_generated` files.

## Local Observability

The optional stack is described by `observability/docker-compose.yml` and includes an OTEL collector, Prometheus, Tempo, Loki, and Grafana. From the repository root:

```bash
docker compose -f observability/docker-compose.yml up
```

Stop it with:

```bash
docker compose -f observability/docker-compose.yml down
```

Do not assume it is required for app development.

## Contract and Demo Setup

Use the Testnet contract deployment manifest and [[operations/Deployment]] before live flows. The end-to-end demo steps are in `docs/demo-setup.md`; they require funded Testnet wallets, configured contract IDs, and provider setup.

Related: [[Development Guide]], [[stellar/Network Configuration]], [[operations/Environment Variables]].
