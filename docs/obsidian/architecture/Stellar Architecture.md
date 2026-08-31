---
type: architecture
area: stellar
status: current
last_updated: 2026-08-31
source_of_truth: repository
---

# Stellar Architecture

Velo uses the `@stellar/stellar-sdk` through the private `@repo/stellar` package. The current web configuration is Testnet-oriented:

- Horizon: `https://horizon-testnet.stellar.org` for classic account/payment operations.
- Soroban RPC: configured through `NEXT_PUBLIC_STELLAR_RPC_URL`, defaulting to `https://soroban-testnet.stellar.org`.
- Network passphrase: `Test SDF Network ; September 2015`.
- Assets: `native`/`XLM` or `CODE:ISSUER`; the configured USDC issuer can provide a default non-native asset.

## Responsibilities

- Client helpers build and submit classic checkout payments and wallet-signed contract transactions.
- Backend actions inspect transaction status and operations, match payment source/destination/amount/asset, and cache safe transaction evidence.
- Soroban helpers load contract specs, encode arguments, simulate calls, assemble exact XDR, and inspect contract events.
- Pollers persist contract event checkpoints and project-scoped event records in Convex.

The contract boundary is described in [[architecture/Smart Contract Architecture]] and [[contracts/Contracts Overview]]. Network limitations are in [[stellar/Network Configuration]].

