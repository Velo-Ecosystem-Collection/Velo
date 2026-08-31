---
type: reference
area: stellar
status: partial
last_updated: 2026-08-31
source_of_truth: repository
---

# SEP Integrations

## Present

- Wallet authentication uses `@repo/stellar` WebAuth challenge/verification conventions similar to SEP-10, with Velo-issued ES256 JWTs for Convex. Full standalone SEP-10 infrastructure is not present.
- Stellar Wallets Kit provides browser wallet discovery, connection, and signing.
- Classic Stellar payments use the Stellar SDK/Horizon; non-native assets require trustlines.
- PDAX UAT callbacks are provider-specific and do not have native PDAX signatures. Velo uses a protected callback token, strict parsing, digests, and provider corroboration.

## Not Confirmed / Planned

No production SEP-24/SEP-31 anchor implementation is established by the current source. PDAX UAT settlement is an integration demonstration with `USDCXLM`/`PHP`, quotes, trades, and InstaPay UAT withdrawals.

Do not describe the UAT integration as a general Stellar anchor or Mainnet settlement service.

Related: [[modules/Wallet Authentication]], [[modules/Settlement and PDAX]], [[stellar/Stellar Integration]].

