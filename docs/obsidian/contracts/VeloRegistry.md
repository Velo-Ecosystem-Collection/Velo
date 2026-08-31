---
type: contract
area: contracts
status: current
last_updated: 2026-08-31
source_of_truth: repository
---

# VeloRegistry

## Purpose

Stores the authoritative on-chain identity of a Velo project and its official Soroban contract references.

## Location

`contracts/registry/src/`

## Responsibilities

- Allocate project IDs starting at 1.
- Store owner address, name, 32-byte metadata hash, active state, and creation ledger.
- Store up to 25 official contract IDs per project.
- Extend Soroban instance/persistent storage TTL on reads and writes.

## Public Interface

- `register_project(owner, name, metadata_hash) -> Result<u64>`
- `update_project(project_id, metadata_hash)`
- `add_contract(project_id, contract_id)`
- `remove_contract(project_id, contract_id)`
- `transfer_ownership(project_id, new_owner)`
- `deactivate_project(project_id)`
- `get_project(project_id) -> Option<Project>`
- `get_project_contracts(project_id) -> Vec<Address>`

## Storage

Instance: next project ID. Persistent: `Project(project_id)` and `ProjectContracts(project_id)`. `Project` contains `id`, `owner`, `name`, `metadata_hash`, `active`, and `created_ledger`.

## Events

`ProjectRegistered`, `ProjectUpdated`, `ContractAdded`, `ContractRemoved`, `OwnershipTransferred`, and `ProjectDeactivated`.

## Authorization

Owner mutations call `owner.require_auth()`. Reads do not require auth. Active-project checks apply to update/add; removal, transfer, and deactivation use owner authorization with their own inactive behavior.

## Called By / Calls Into

Called by web `@repo/stellar` registration/link helpers and by PayAccess's runtime cross-contract read. It does not call another Velo contract.

## Important Files

`src/lib.rs`, `src/types.rs`, `src/events.rs`, `src/errors.rs`, `tests/registry.rs`.

## Known Constraints

Name must be non-empty and at most 64 bytes; no more than 25 contracts are stored. Confirm local Registry state against Convex when status is pending/stale.

## Related Notes

[[modules/Projects and Verification]], [[contracts/Contracts Overview]], [[stellar/Transaction Lifecycle]]

