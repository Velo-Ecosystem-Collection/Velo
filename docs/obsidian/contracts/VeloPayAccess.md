---
type: contract
area: contracts
status: current
last_updated: 2026-08-31
source_of_truth: repository
---

# VeloPayAccess

## Purpose

Controls on-chain payment activation for a Registry project and maintains legacy checkout credits plus a separate display-balance mirror.

## Location

`contracts/pay_access/src/`

## Public Interface

- `initialize(registry_contract, mirror_authority)`
- `activate_payments(project_id)` / `deactivate_payments(project_id)`
- `consume_checkout_credit(project_id, amount)`
- `get_payment_access_status(project_id)` / `get_checkout_credits(project_id)`
- `set_display_balance(project_id, credits, source_version)` / `get_display_balance(project_id)`
- `get_mirror_authority()` / `rotate_mirror_authority(new_authority)`

## Storage

Instance: Registry contract and mirror authority. Persistent: `Access(project_id)` containing `active`, `checkout_credits`, and activation ledger; `DisplayBalance(project_id)` containing credits and source version. Activation defaults to 100 checkout credits.

## Events

`PayAccessInitialized`, `PaymentsActivated`, `PaymentsDeactivated`, `CheckoutCreditConsumed`, `DisplayBalanceUpdated`, and `MirrorAuthorityRotated`.

## Authorization

Initialization is one-time. Project mutations invoke Registry `get_project`, require an existing/active project as appropriate, then require the Registry project owner. Display updates require the mirror authority; version must increase, with identical same-version replay treated idempotently. Rotation requires both old and new authority authorization.

## Called By / Calls Into

Called by dashboard wallet flows and backend event sync. Calls `VeloRegistry.get_project` at runtime. Convex commercial billing remains the authoritative entitlement ledger; display balance is compatibility/non-authoritative state.

## Important Files

`src/lib.rs`, `src/types.rs`, `src/events.rs`, `src/errors.rs`, `tests/pay_access.rs`.

## Known Constraints

Credits must be positive for consumption and non-negative for display; inactive/missing projects cannot activate or consume. Deployment must initialize the Registry address and mirror authority.

## Related Notes

[[modules/Payments and Checkout]], [[modules/Billing and Entitlements]], [[contracts/VeloRegistry]], [[architecture/Smart Contract Architecture]]

