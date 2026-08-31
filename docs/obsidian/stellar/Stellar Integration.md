---
type: architecture
area: stellar
status: current
last_updated: 2026-08-31
source_of_truth: repository
---

# Stellar Integration

## Shared Package

`packages/stellar/src/index.ts` exports helpers for wallet auth/WebAuth, classic checkout payments, contract configuration, contract specs/arguments, Registry and PayAccess calls, event monitoring, transaction debugging, Playground code generation/project variables, validation, and webhook utilities.

## Classic Payments

`checkout.ts` builds a classic `Operation.payment` transaction after checking payer/receiver, amount, account existence, trustlines, and balance. It supports native XLM and `CODE:ISSUER` assets, optional text/numeric memo, and Testnet Horizon submission.

## Soroban

`registry.ts` and `pay-access.ts` build/preflight contract transactions and confirm results. Contract-spec/argument modules load and normalize live Soroban specs for Playground simulation and exact XDR review.

## Backend Evidence

`transaction-debugger.ts` normalizes RPC transaction evidence. Backend payment verification checks actual payment operations against the intent's expected receiver, amount, asset, and optional payer. `event-monitor.ts` provides bounded Soroban event lookup for Convex pollers.

## External Boundaries

Velo uses Horizon for classic account/payment operations and Soroban RPC for contract simulation, events, and transaction status. The browser may prepare/sign/submit selected Testnet transactions; Convex owns final payment verification and durable state.

Related: [[stellar/Transaction Lifecycle]], [[stellar/Network Configuration]], [[contracts/Contracts Overview]].
