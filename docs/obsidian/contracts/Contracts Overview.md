---
type: contract
area: contracts
status: current
last_updated: 2026-08-31
source_of_truth: repository
---

# Contracts Overview

Velo's Soroban contracts are separate Rust crates, not a Cargo workspace with a shared root manifest. `contracts/playground-fixtures` is a separate fixture workspace used by Playground qualification.

| Contract | Crate/location | Purpose | Depends on |
| --- | --- | --- | --- |
| VeloRegistry | `contracts/registry`, crate `velo_registry` | Project identity, ownership, active state, metadata hash, official contract IDs. | Soroban SDK |
| VeloPayAccess | `contracts/pay_access`, crate `velo_pay_access` | Payment activation, legacy checkout credits, and versioned display balance mirror. | Soroban SDK; runtime call to Registry |

## Deployment Order

Use `pnpm contracts:deploy` / `scripts/deploy-contracts.mjs`. It runs locked Rust tests/builds, uploads/deploys Registry, uploads/deploys PayAccess, initializes PayAccess with Registry and mirror authority, runs read-only smoke calls, and writes `deployments/<network>.json`.

## Recorded Testnet State

`deployments/testnet.json` records a Testnet deployment manifest in this worktree. Contract READMEs and older guides contain different hard-coded IDs; treat the manifest and explicitly configured environment as the deployment record and verify before use.

## Testing

```bash
cargo test --manifest-path contracts/registry/Cargo.toml --locked
cargo test --manifest-path contracts/pay_access/Cargo.toml --locked
stellar contract build --manifest-path contracts/registry/Cargo.toml
stellar contract build --manifest-path contracts/pay_access/Cargo.toml
```

Related: [[contracts/VeloRegistry]], [[contracts/VeloPayAccess]], [[operations/Deployment]].

