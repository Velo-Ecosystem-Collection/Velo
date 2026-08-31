---
type: architecture
area: contracts
status: current
last_updated: 2026-08-31
source_of_truth: repository
---

# Smart Contract Architecture

Velo currently maintains two independent Soroban crates. PayAccess depends on Registry at runtime through a cross-contract `get_project` call.

```text
VeloRegistry
  stores project owner/name/metadata hash/active state
  stores official contract IDs
        ↑ read by
VeloPayAccess
  stores activation and legacy checkout credits
  stores non-authoritative display balance mirror
```

## Registry

`contracts/registry/src/lib.rs` owns project provenance and owner-authorized contract references. It emits registration, update, add/remove, ownership-transfer, and deactivation events. See [[contracts/VeloRegistry]].

## PayAccess

`contracts/pay_access/src/lib.rs` initializes against a Registry address, authorizes project-owner activation/deactivation/credit consumption via the Registry project owner, and exposes a separately-authorized display balance mirror. See [[contracts/VeloPayAccess]].

## Deployment

`scripts/deploy-contracts.mjs` tests/builds and deploys Registry before PayAccess, initializes PayAccess with the Registry address and mirror authority, performs read-only smoke calls, and writes `deployments/<network>.json`. Treat that manifest and deployment environment as the recorded deployment source; older README IDs may be stale.

