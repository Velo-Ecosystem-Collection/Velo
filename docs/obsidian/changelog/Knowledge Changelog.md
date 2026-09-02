---
type: reference
area: changelog
status: current
last_updated: 2026-09-02
source_of_truth: repository
---

# Knowledge Changelog

## 2026-09-02

- Accepted [[decisions/ADR-0002-D1-Testnet-Gas-Sponsorship-Boundaries]] and locked the planned D1 Testnet Gas Station envelope, authorization, route, reservation, lifecycle, HTTP outcome, role, retention, and audit boundaries in the [[../../instawards/Velo-Instawards-Deliverable-1-Sprint-Plan]]. No Gas Station runtime functionality was implemented by that documentation change.
- Added the partial D1 Convex schema foundation: `gasPolicies`, `gasLogs`, and `relayerAccounts`, with bounded Testnet-only validators and indexes. Runtime authorization, admission, APIs, cleanup, and relayer behavior remain out of scope.

## 2026-08-31

- Initialized the Velo Obsidian knowledge vault under `docs/obsidian`.
- Documented the pnpm/Turborepo, Next.js, Convex, Stellar, PDAX, SDK, wallet, UI, examples, and Soroban boundaries.
- Documented current payment, verification, webhook, settlement, billing, Playground, polling, and observability flows.
- Added freshness warnings for stale contract IDs in older docs and the retired unversioned PDAX callback path.
- Added the agent workflow and root instruction integration so future agents consult and maintain the vault.

- Documented the pre-commit hook's pnpm PATH resolution for Git clients and macOS Homebrew environments.
Future entries should capture architectural/context changes rather than every code commit.
