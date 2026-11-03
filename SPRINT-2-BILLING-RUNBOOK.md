# Sprint 2 Sandbox Billing Runbook

## Safety boundary

- Use Stellar Testnet USDC and a dedicated Testnet treasury.
- Keep `mainnetCreditEnforcement` false.
- Enable `sandboxEnforcementEnabled` only for approved internal organizations.
- Treat the Convex commercial ledger as authoritative. Never edit or delete ledger entries.
- Resolve incorrect balances with a compensating adjustment linked to a billing exception.

## Bootstrap

1. From a trusted operator environment, run the internal
   `billing/operators:bootstrap` mutation with the first operator's connected Stellar address and
   an audit actor. Bootstrap succeeds only while no active operator exists.
2. Sign in with that wallet and open `/billing`, then initialize the deny-by-default policy.
3. Create and activate an offer using:
   - SKU `credits-100`
   - 100 credits
   - 20 USDC
   - the full `USDC:<TESTNET_ISSUER>` asset
   - the dedicated Testnet treasury address
   - approved refund copy
4. Enable ledger writes, promotional grants, and Testnet top-ups. Leave the kill switch on until
   the internal organization and treasury are ready.
5. Verify the internal organization, grant its trial, and enable its sandbox enforcement flag.
6. Turn off the global billing kill switch.

## End-to-end qualification

Exercise these flows from `/billing`:

1. Promotional grant → merchant PaymentIntent → reservation → verified success → consume.
2. Reservation → failed or cancelled PaymentIntent → release.
3. Zero balance → PaymentIntent creation returns `insufficient_billing_credits`.
4. Top-up → hosted checkout → verified treasury receipt → exact paid grant → merchant receipt.

For the top-up flow, compare the hosted checkout destination, asset, amount, network, and source
wallet against the offer snapshot. Confirm one `treasuryReceipts` row, one `paid_grant` ledger
entry, and one settled top-up.

## Exceptions and reconciliation

- The scheduled worker reports top-up, receipt, reservation, ledger, and materialized-balance
  discrepancies without changing balances.
- Review open exceptions in `/billing` → Operations.
- `retry_verification` is appropriate when the transaction exists but RPC verification was
  incomplete.
- `acknowledge` closes an explained discrepancy without changing credits.
- `compensating_adjustment` creates an immutable ledger entry and must include a resolution note.
- Never acknowledge an unmatched treasury receipt without independently checking Stellar
  Testnet evidence.

## Kill-switch drill

1. Enable `billingKillSwitch`.
2. Confirm new top-ups are rejected.
3. Confirm merchant PaymentIntent creation remains available and creates no commercial
   reservation.
4. Confirm existing ledger, receipts, notifications, and reconciliation exceptions remain
   visible.
5. Disable the kill switch only after the initiating incident or drill is documented.

## Recovery

- Expired unsuccessful reservations are released and generate an in-app recovery notification.
- Active verification leases defer recovery.
- Ambiguous or dead-lettered verification creates an exception instead of releasing a possibly
  successful payment.
- Historical PDAX reservations are reviewed against their retained settlement records only.
  No provider reconciliation is available; do not infer payout completion from a deposit or
  rewrite the reservation without an independently verified historical outcome.
