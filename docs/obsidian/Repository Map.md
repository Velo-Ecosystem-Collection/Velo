---
type: reference
area: repository
status: current
last_updated: 2026-08-31
source_of_truth: repository
---

# Repository Map

Velo is a pnpm workspace and Turborepo. Workspace packages are under `packages/*`, the main Next.js app is `apps/web`, merchant examples are under `examples/*`, and Soroban contracts are independent Rust crates under `contracts/*`.

| Path | Responsibility | Important files | Related notes |
| --- | --- | --- | --- |
| `apps/web/` | Next.js App Router UI, server routes, client providers, feature code, and public assets. | `app/layout.tsx`, `app/`, `core/`, `features/`, `next.config.js` | [[frontend/Frontend Overview]], [[frontend/Routes]] |
| `apps/web/app/` | Route entry points for landing, console, hosted checkout, public verification, playground, and API endpoints. | `page.tsx`, `dashboard/page.tsx`, `pay/[paymentIntentId]/page.tsx`, `api/` | [[frontend/Routes]], [[modules/Payments and Checkout]] |
| `apps/web/core/` | Cross-cutting frontend/API configuration, wallet auth, Convex provider, Stellar config, and telemetry. | `app-shell.tsx`, `config/env.ts`, `config/stellar.ts`, `providers/convex-provider.tsx`, `auth/` | [[architecture/Frontend Architecture]], [[modules/Wallet Authentication]] |
| `apps/web/features/` | UI and feature-domain implementations. | `projects/`, `checkout/`, `playground/`, `billing/`, `debugger/`, `observability/` | [[frontend/Components and Features]], [[modules/README]] |
| `packages/backend/convex/` | Convex schema, queries, mutations, actions, HTTP ingress, scheduled workers, migrations, and tests. | `schema.ts`, `crons.ts`, `http.ts`, domain directories, `tests/` | [[backend/Convex Overview]], [[data/Convex Schema]] |
| `packages/stellar/` | Shared Stellar SDK, Horizon, Soroban RPC, contract, event, transaction, auth, webhook, and Playground helpers. | `src/index.ts`, `src/checkout.ts`, `src/registry.ts`, `src/event-monitor.ts`, `src/transaction-debugger.ts` | [[stellar/Stellar Integration]], [[modules/Stellar Transactions and Contract Events]] |
| `packages/pdax/` | Server-only PDAX UAT client: auth, balances, quotes, trades, withdrawals, callback parsing, and webhook registration. | `src/client.ts`, `README.md` | [[modules/Settlement and PDAX]], [[stellar/SEP Integrations]] |
| `packages/velo-sdk/` | Published alpha, server-side ESM SDK for Velo payment intents and webhook verification. | `src/client.ts`, `src/http.ts`, `src/webhooks.ts`, `README.md` | [[modules/SDK and Wallets]] |
| `packages/velo-wallets/` | Published alpha browser/React/CDN wallet widget wrapping Stellar Wallets Kit. | `src/`, package exports, `README.md` | [[modules/SDK and Wallets]], [[modules/Wallet Authentication]] |
| `packages/ui/` | Shared React UI primitives and custom sidebar/loading components. | `src/components/ui/`, `src/components/ui-customs/`, `package.json` | [[frontend/Components and Features]] |
| `packages/observability/` | Shared telemetry types/helpers used by web, backend, Stellar, and PDAX packages. | `src/index.ts` | [[modules/Observability]], [[architecture/Integration Boundaries]] |
| `packages/typescript-config/` | Shared TypeScript configuration package. | `package.json`, config files | [[Development Guide]] |
| `contracts/registry/` | `velo_registry` Soroban crate for wallet-owned project identity and official contract references. | `src/lib.rs`, `src/types.rs`, `src/events.rs`, `tests/registry.rs` | [[contracts/VeloRegistry]], [[modules/Projects and Verification]] |
| `contracts/pay_access/` | `velo_pay_access` Soroban crate for project payment activation and checkout credits, linked to Registry. | `src/lib.rs`, `src/types.rs`, `src/events.rs`, `tests/pay_access.rs` | [[contracts/VeloPayAccess]], [[modules/Payments and Checkout]] |
| `contracts/playground-fixtures/` | Isolated Rust fixture workspace used by the Playground for contract-spec and invocation qualification. | crate directories, `Cargo.toml` | [[modules/Playground]], [[operations/Testing]] |
| `scripts/` | Contract deployment, wallet bundle staging, benchmark, release-gate, smoke, and evidence tooling. | `deploy-contracts.mjs`, benchmark scripts | [[operations/Deployment]], [[operations/Testing]] |
| `deployments/` | Network deployment manifests. | `testnet.json` | [[contracts/Contracts Overview]], [[stellar/Network Configuration]] |
| `examples/express/` | Express merchant integration example using the server-side SDK. | `server.ts`, `.env.example`, `README.md` | [[modules/SDK and Wallets]], [[workflows/Feature Development]] |
| `examples/nextjs-app-router/` | Next.js App Router merchant integration example using server routes and raw webhook verification. | `app/api/`, `.env.example`, `README.md` | [[modules/SDK and Wallets]], [[modules/Webhooks]] |
| `observability/` | Local OpenTelemetry collector, Prometheus, Tempo, Loki, and Grafana configuration. | `docker-compose.yml`, collector/Grafana config | [[modules/Observability]], [[operations/Local Development]] |
| `docs/` | Product context, architecture records, runbooks, PRDs, references, and release notes. | `velo-master-context.md`, `velo-pay-checkout.md`, `architecture/`, `operations/` | [[Home]], [[Current System State]] |

## Architectural Boundaries

- UI and Next route handlers may call Convex through generated API references; server routes must not move private credentials into client code.
- `packages/backend/convex` owns durable application state and worker transitions. Do not bypass its authorization or state machines from UI code.
- `packages/stellar` owns reusable protocol/ledger mechanics; contract-specific authority remains in `contracts/*`.
- `packages/pdax` is server-only and is called from Convex actions. PDAX UAT credentials and tokens must not cross into browser-visible records.
- The public SDK is a consumer boundary over Next API routes, not a direct Convex client.
- Contract deployment is an ordered release: Registry first, then PayAccess initialized with the Registry address.

## Change Routing

Start with this map, then read the relevant domain note. For a payment or settlement change, inspect [[modules/Payments and Checkout]], [[modules/Settlement and PDAX]], [[data/Convex Schema]], and [[stellar/Transaction Lifecycle]] before searching broadly.

