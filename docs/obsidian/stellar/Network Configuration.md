---
type: operations
area: stellar
status: current
last_updated: 2026-08-31
source_of_truth: repository
---

# Network Configuration

## Web Alpha Defaults

`apps/web/core/config/env.ts` requires `NEXT_PUBLIC_CONVEX_URL`, defaults the app URL to localhost, defaults Stellar network to `testnet`, defaults RPC to `https://soroban-testnet.stellar.org`, and accepts optional Registry/PayAccess IDs and USDC issuer. `core/config/stellar.ts` fixes the Testnet passphrase and Horizon URL.

`NEXT_PUBLIC_STELLAR_NETWORK` is currently a literal Testnet setting in the web validator; do not infer Mainnet checkout support from deployment-script support.

## Backend

Convex Stellar callers use `STELLAR_RPC_URL`, falling back to the public web RPC value/default. Billing configuration can distinguish `testnet` and `public` through `VELO_STELLAR_NETWORK`, but policy/cohort gates still control public billing paths.

## Contracts

`scripts/deploy-contracts.mjs` supports `testnet` and `mainnet`, locks network passphrases, and uses explicit RPC URL/passphrase arguments. Deployment manifests live in `deployments/`.

## Deployment Freshness

The recorded Testnet manifest is `deployments/testnet.json`. Older `contracts/*/README.md` and checkout guides contain different hard-coded IDs. Verify the manifest, deployed code commit, and environment together before any live action.

Related: [[contracts/Contracts Overview]], [[operations/Environment Variables]], [[modules/Playground]].

