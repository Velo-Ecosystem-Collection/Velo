---
type: architecture
area: stellar
status: current
last_updated: 2026-09-04
source_of_truth: repository
---

# Stellar Integration

## Shared Package

`packages/stellar/src/index.ts` exports helpers for wallet auth/WebAuth, classic checkout payments, contract configuration, contract specs/arguments, Registry and PayAccess calls, event monitoring, transaction debugging, authoritative Testnet transaction-envelope validation, Playground code generation/project variables, validation, and webhook utilities.

## Classic Payments

`checkout.ts` builds a classic `Operation.payment` transaction after checking payer/receiver, amount, account existence, trustlines, and balance. It supports native XLM and `CODE:ISSUER` assets, optional text/numeric memo, and Testnet Horizon submission.

## Soroban

`registry.ts` and `pay-access.ts` build/preflight contract transactions and confirm results. Contract-spec/argument modules load and normalize live Soroban specs for Playground simulation and exact XDR review.

`transaction-envelope.ts` is the reusable authoritative admission helper for Sprint 3.1 and Sprint 4.4 hardening. It bounds XDR at 64 KiB before decoding, parses with `Networks.TESTNET`, accepts only a signed non-FeeBump transaction with exactly one source signature carrying the source-key hint and exactly one `invokeHostFunction`/`invokeContract` operation targeting a contract address, rejects alternate operation sources, verifies the signature against the Testnet signature base, identifies a Public-network signature as `wrong_network`, and derives the source wallet, Testnet transaction hash, inner maximum fee, single contract target, and optional Convex-safe `maxTime` in seconds. Absent or zero `maxTime` is unbounded; values that cannot safely become Convex millisecond timestamps are invalid requests. `packages/backend/convex/gas/envelope.ts` validates and maps those facts to the locked Gas domain literals and stroop boundary. Runtime deterministic test builders in `packages/stellar/src/test-fixtures.ts` construct valid, wrong-network, unsigned, classic, mixed, multi-operation, FeeBump, and max-time cases from public labels without checked-in envelopes or signing secrets.

## Backend Evidence

`transaction-debugger.ts` normalizes RPC transaction evidence. Backend payment verification checks actual payment operations against the intent's expected receiver, amount, asset, and optional payer. `event-monitor.ts` provides bounded Soroban event lookup for Convex pollers.

## External Boundaries

Velo uses Horizon for classic account/payment operations and Soroban RPC for contract simulation, events, and transaction status. The browser may prepare/sign/submit selected Testnet transactions; Convex owns final payment verification and durable state.

Related: [[stellar/Transaction Lifecycle]], [[stellar/Network Configuration]], [[contracts/Contracts Overview]].
