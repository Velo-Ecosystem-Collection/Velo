---
type: reference
area: repository
status: current
last_updated: 2026-08-31
source_of_truth: repository
---

# Velo

Velo is an alpha developer-infrastructure platform for Stellar builders. The current repository combines wallet-owned project verification, Stellar Testnet hosted checkout, ledger-verified payment state, signed merchant webhooks, transaction and contract-event observability, a Node.js SDK, project-configured wallets, and a PDAX UAT settlement demonstration.

The vault is a navigation and context layer. Implementation remains authoritative in the repository; see [[decisions/ADR-0001-Obsidian-Knowledge-Vault]].

## Start Here

- [[Repository Map]]
- [[Current System State]]
- [[architecture/Architecture Overview]]
- [[Development Guide]]

## Architecture

- [[architecture/Frontend Architecture]]
- [[architecture/Backend Architecture]]
- [[architecture/Stellar Architecture]]
- [[architecture/Smart Contract Architecture]]
- [[architecture/Data Flow]]
- [[architecture/Integration Boundaries]]

## Core Technologies

- Next.js App Router + TypeScript
- Convex
- Stellar Horizon and Soroban RPC
- Soroban / Rust
- Stellar Wallets Kit
- PDAX UAT

## Core Domains

- [[modules/Projects and Verification]]
- [[modules/Payments and Checkout]]
- [[modules/Webhooks]]
- [[modules/Settlement and PDAX]]
- [[modules/Billing and Entitlements]]
- [[modules/Playground]]
- [[modules/Stellar Transactions and Contract Events]]
- [[modules/Wallet Authentication]]
- [[modules/Observability]]
- [[modules/SDK and Wallets]]

## Data and Contracts

- [[data/Data Model]]
- [[data/Convex Schema]]
- [[contracts/Contracts Overview]]
- [[contracts/VeloRegistry]]
- [[contracts/VeloPayAccess]]

## Frontend and Backend

- [[frontend/Frontend Overview]]
- [[frontend/Routes]]
- [[frontend/Components and Features]]
- [[backend/Convex Overview]]
- [[backend/Queries Mutations Actions]]
- [[backend/Background Jobs]]

## Development

- [[operations/Local Development]]
- [[operations/Testing]]
- [[operations/Environment Variables]]
- [[operations/Deployment]]
- [[workflows/Feature Development]]
- [[workflows/Debugging]]

## AI Agents

- [[workflows/Agent Workflow]]

## Decisions

- [[decisions/README]]

## Existing High-Signal Documentation

- `README.md` — public repository/product entry point.
- `docs/velo-master-context.md` — broader product and workflow context.
- `docs/velo-pay-checkout.md` — checkout/API guide.
- `docs/demo-setup.md` — end-to-end Testnet/PDAX demo.
- `packages/backend/convex/README.md` — Convex reliability and operations notes.
- `packages/velo-sdk/README.md` — SDK and webhook consumer behavior.

