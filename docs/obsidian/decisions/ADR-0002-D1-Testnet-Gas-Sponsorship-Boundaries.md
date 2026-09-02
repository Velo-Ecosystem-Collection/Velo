---
type: decision
area: gas-station
status: accepted
last_updated: 2026-09-02
source_of_truth: repository
---

# ADR-0002: D1 Testnet Gas Sponsorship Boundaries

## Context

Deliverable 1 needs a durable admission boundary before any Convex, route, or relayer implementation begins. The boundary must make user authorization, Testnet signature verification, spending reservations, and the handoff to the later relayer service unambiguous.

## Decision

Accept only a user-signed, non-FeeBump transaction envelope with exactly one Soroban `invokeHostFunction`. The source signature is verified with the Stellar Testnet passphrase. Because network identity is not embedded in transaction XDR, Testnet is enforced through the signature base and passphrase rather than derived from the envelope. Classic, mixed, unsigned, multi-operation, and FeeBump envelopes are rejected.

D1 exposes only `POST /api/gas/sponsor` and `POST /api/gas/submit`; no versioned aliases are part of this contract. Sponsorship requires a valid, non-revoked project API key and an enabled Testnet gas policy, independently of `paymentAccessActive`. The sponsor request contains only bounded `transactionXdr` input and a required `Idempotency-Key`; the server derives the project-authoritative wallet, transaction hash, fee, signature/network result, and contract target.

The initial reservation is the inner maximum fee plus 100 stroops. D2 must atomically increase that reservation before constructing a FeeBump with a higher maximum. A reservation expires at the earlier of the inner transaction’s `maxTime` and 15 minutes after reservation creation. Denials consume neither daily budget nor wallet quota. A proven D2 pre-submission failure releases daily reserved budget; uncertain submissions remain reserved for reconciliation, and consumed wallet quota is not refunded.

In D1, `/submit` validates project ownership, transaction-hash correlation, expiry, duplicate submission, and lifecycle. It then returns `503 handoff_unavailable` without changing a `reserved` record or implying queued or network work. D2 owns FeeBump construction, signing, submission, retries, reconciliation, and network-success truth.

The complete decision and HTTP outcome matrix is maintained in the [[../../instawards/Velo-Instawards-Deliverable-1-Sprint-Plan|D1 sprint plan]].

## Trust boundaries and operational defaults

- Viewer-or-higher roles read project-scoped safe projections; editor-or-higher roles change gas policy; owners change relayer metadata.
- Gas logs are retained for 30 days and cleanup is processed in pages of 100.
- Authenticated policy denials may create redacted rejection audit records without reserving budget or quota. Invalid authentication and unparseable or oversized input do not create audit records.
- Public responses use the locked safe status mapping and contain no raw XDR, credentials, signatures, private keys, or unnecessary internal identifiers.

## Implementation status

This is an accepted design decision, not an implementation claim. Gas Station Convex schema, API routes, relayer code, generated files, SDK helpers, dashboard UI, and contracts remain planned work under Deliverable 1 and later deliverables. The existing system-state note remains unchanged because this ADR does not add functionality.

## Consequences

- D1 can reserve only a precisely derived and bounded fee amount while keeping client-supplied facts out of authorization decisions.
- The D2 relayer boundary must perform an explicit atomic reservation increase before taking on a higher FeeBump maximum.
- D1 cannot report a queued, submitted, or successful network action; those outcomes require D2 authority and reconciliation evidence.
- A future implementation must preserve the exact route, envelope, authorization, expiry, role, retention, and HTTP rules unless this ADR is superseded.

## Related records

- [[../../instawards/Velo-Instawards-SOW|Instawards SOW]]
- [Stellar Docs — Fee-bump transactions](https://developers.stellar.org/docs/build/guides/transactions/fee-bump-transactions)
