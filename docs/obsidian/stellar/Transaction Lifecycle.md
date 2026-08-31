---
type: reference
area: stellar
status: current
last_updated: 2026-08-31
source_of_truth: repository
---

# Transaction Lifecycle

## Project Registration and Contract Links

Convex stores draft/pending state → `@repo/stellar` prepares a Soroban transaction using server ledger/account data → wallet signs → Horizon/RPC submission returns a hash → UI or worker confirms → Convex stores `registered`/active/stale/error state → relevant webhook is enqueued.

## Hosted Checkout

`/pay/[paymentIntentId]` loads the intent reactively → `checkout.ts` performs account/trustline/balance preflight and builds a classic payment → wallet signs/submits → `transactions.reportSubmitted` records the hash and pending intent atomically → `scanner.watchTransaction` polls RPC with bounded adaptive backoff → `findVerifiedPayment` matches source/destination/amount/asset → `markVerifiedPaid` commits `paid` or a failure path → webhook/UI update.

The hash/submission callback is not proof of payment. Expiry and allowed transitions are enforced in Convex.

## Playground Invocation

Server reloads current contract spec/Wasm → simulates and assembles exact unsigned XDR → browser reviews fingerprint → Testnet wallet signs → server verifies signature/network/call/current Wasm → server submits to selected Testnet RPC → browser/API polls hash and retains normalized/raw terminal evidence. Mainnet stops at simulation.

## Event Ingestion

Project pollers use opaque `getEvents` cursors and latest-ledger checkpoints. Events and checkpoints are stored together, then webhook delivery can use `contract.event`. PayAccess has a global event poller that updates project payment-access cache.

## Failure and Recovery

RPC `pending/not found/unavailable` outcomes remain recoverable through bounded reconciliation; uncertain external outcomes must not be blindly resubmitted. See [[backend/Background Jobs]] and [[modules/Stellar Transactions and Contract Events]].

