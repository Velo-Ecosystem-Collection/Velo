---
type: operations
area: deployment
status: partial
last_updated: 2026-08-31
source_of_truth: repository
---

# Deployment

## Contract Deployment

Use `scripts/deploy-contracts.mjs` through `pnpm contracts:deploy`. It requires a Stellar CLI identity name and mirror-authority public key, locks the selected network passphrase, runs locked tests/builds unless skipped, deploys Registry then PayAccess, initializes the dependency, smoke-tests reads, and writes a manifest.

```bash
pnpm contracts:deploy --network testnet --source <identity> --mirror-authority <PUBLIC_KEY> --dry-run
pnpm contracts:deploy --network testnet --source <identity> --mirror-authority <PUBLIC_KEY>
pnpm contracts:deploy --network mainnet --source <identity> --mirror-authority <PUBLIC_KEY> --confirm-mainnet
```

Never pass secret keys or seed phrases as command arguments. Mainnet deployment requires the readiness checklist and explicit confirmation.

## Web/Convex Deployment Configuration

After contract deployment, configure the recorded contract IDs in the web and backend environments. Hosted production web config requires contract IDs; backend PayAccess sync uses `VELO_PAY_ACCESS_CONTRACT_ID` as canonical. Keep Convex auth JWKS reachable over HTTPS/data URI.

## Readiness Boundary

The repository is Testnet alpha. Mainnet payment, production settlement, and production availability are not claimed. Deployment manifests record historical deployment evidence; they do not replace independent readiness review.

## Freshness Warning

The current manifest is `deployments/testnet.json`, while older contract READMEs/guides contain different hard-coded IDs. Reconcile manifest, deployed commit, environment, and live chain state before updating docs or running a demo.

Related: [[contracts/Contracts Overview]], [[stellar/Network Configuration]], [[Current System State]], [[operations/Environment Variables]].

