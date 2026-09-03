---
type: reference
area: repository
status: current
last_updated: 2026-09-03
source_of_truth: repository
---

# Current System State

This is a code-and-documentation snapshot, not a production readiness claim. The repository and its public README describe Velo as Stellar Testnet alpha software.

## Production / Functional

Functional repository capabilities include:

- Next.js project console, public verification, hosted checkout, transaction debugger, contract event views, SDK docs, and Playground UI.
- Stellar Wallets Kit connection and wallet-signed, SEP-10-style challenge authentication with an app JWT and Convex custom-JWT verification.
- Project draft management, Registry registration, official contract linking, PayAccess activation, API key creation, and owner-scoped Convex queries/mutations.
- Velo Pay API/SDK PaymentIntent creation and retrieval, idempotency handling, anchor-aware V2 routing, and 30-minute checkout expiry.
- Backend ledger verification: browser submission only records pending state; the scanner/reconciliation path promotes a payment to `paid` only after matching Stellar evidence.
- Signed merchant webhooks, durable delivery records, retries, dead-letter state, delivery lookup, and authenticated replay.
- Stellar transaction caching/debugging and Soroban contract event polling with cursor/checkpoint state.
- PDAX UAT connection, balances, quotes, trades, InstaPay withdrawal flow, callback ingestion, payout polling, and normalized settlement webhooks.
- Published alpha packages `@carts1024/velo-sdk` and `@carts1024/velo-wallets`, plus Express and Next.js merchant examples.

## Implemented but Incomplete

- Durable payment/provider/webhook workers, telemetry outbox, redaction, billing ledgers, and rate-limit backends are implemented with deterministic tests, but the repository explicitly does not claim live SLO qualification or production availability.
- Playground Testnet simulation, exact-XDR review, signing, submission, recovery, and evidence paths are implemented/tested; live funded-wallet and fixture evidence is still an operational gate.
- PDAX integration is a UAT/sandbox demonstration, not production settlement or compliance infrastructure.
- Billing includes commercial/shadow books, top-ups, reservations, reconciliation, and guarded launch policy, but Mainnet enforcement is gated by policy, cohort, treasury, and approval state.

## Experimental

- Mainnet Playground contract loading/simulation is inspection-only; invocation/signing/submission is disabled.
- Benchmark and release-gate scripts under `scripts/` and local OpenTelemetry/Grafana assets under `observability/` support qualification but are not product runtime features.
- Upstash rate limiting is supported by code, while projects are initialized with the Convex backend and `migrating` intentionally fails closed.

## Partial Foundation

- The deterministic Gas Station vocabulary, exact-value stroop arithmetic, checksum-backed Stellar normalization and bounded allowlist helpers, Testnet-only fixture scaffold, partial D1 Convex schema, reusable authorization foundation, pure policy evaluator, authenticated console CRUD, atomic admission mutation, public Convex sponsor action, typed submit action/mutation, and deterministic boundary/redaction tests now exist under `packages/backend/convex/gas/` and `packages/backend/convex/tests/gas/`. `@repo/stellar` validates the accepted Testnet non-FeeBump Soroban envelope, verifies its source signature against the Testnet signature base (and identifies a known Public-network signature), and derives the source wallet, Testnet transaction hash, inner maximum fee, single contract target, and optional Convex-safe `maxTime`. `gas/envelope.ts` adapts and revalidates those facts to the locked Gas literals and signed-int64 stroop boundary. The schema composes `gasPolicies`, `gasLogs`, and `relayerAccounts` with bounded validators and lookup indexes for policy, audit, reservation, retention, and relayer metadata; the atomic admission mutation reuses `rateLimitBuckets` under a Gas project/wallet namespace for UTC-hour quota units, and explicit safe projections expose only allowlisted dashboard/API fields. `gas/authorization.ts` enforces the console role matrix, resolves valid API-key hashes to stored project scope independently of `paymentAccessActive`, and revalidates that exact scope at write boundaries; `gas/public_api_internal.ts` exposes the initial lookup only as an internal query. `gas/policy.ts` evaluates validated snapshots and server-derived facts without I/O, using checked exact-stroop reservation arithmetic and deterministic rejection precedence. `gas/queries.ts`, `gas/mutations.ts`, `gas/admission.ts`, `gas/submit.ts`, and `gas/public_api.ts` provide viewer reads, cursor-paginated project-scoped gas-log reads, editor policy upserts, owner relayer metadata upserts, the private server-derived reservation and submit lifecycle boundaries, and public sponsor/submit orchestration while preserving trusted accounting/balance fields and enforcing the Testnet boundary. Submit validates ownership and derived-hash correlation, expires overdue reservations atomically with same-UTC-day budget release only, never refunds wallet quota, and returns `handoff_unavailable` for active D1 reservations without claiming relayer or network work. Gas-log pages map every row through the safe projection and preserve native Convex cursor metadata; status, wallet, and date filters remain out of scope. `apps/web/app/api/gas/sponsor/route.ts` and `apps/web/app/api/gas/submit/route.ts` now provide telemetry-wrapped, bounded HTTP boundaries; cleanup, relaying, and runtime gas sponsorship remain unimplemented.

## Planned / Not Implemented

- Managed Testnet Gas Station fee sponsorship runtime: relayer signer, SDK/dashboard integration, cleanup, and reviewer evidence package. The Convex sponsor/submit orchestration, internal atomic reservation and D1 lifecycle boundaries, authenticated policy, relayer metadata CRUD, and sponsor/submit HTTP boundaries are implemented; the four-day Deliverable 1 plan is [[../instawards/Velo-Instawards-Deliverable-1-Sprint-Plan]].
- General Mainnet payment/checkout support and production settlement/compliance flows.
- Full RPC gateway and broad analytics/indexing products.
- Broader SEP-10 infrastructure and confirmed SEP-31/SEP-24 production anchor integrations.
- Webhook dual-secret grace-window rotation.
- End-to-end hosted demo qualification across target wallets/devices, plus live latency/SLO evidence.

## Freshness Hazards

- `deployments/testnet.json` is the checked-in deployment manifest to consult for the current recorded deployment. Older contract READMEs and `docs/velo-pay-checkout.md` contain different hard-coded Testnet IDs; do not copy those IDs without reconciling the manifest and environment.
- The canonical PDAX callback is Convex HTTP `POST /api/webhooks/pdax/v1?token=...`. The Next.js `POST /api/webhooks/pdax` route is intentionally retired with `410 Gone`; older docs use the unversioned path.
- Older context says a cron directly checks pending PaymentIntents. Current `packages/backend/convex/crons.ts` schedules the durable payment reconciliation drain; `checkPendingPayments` remains an internal scanner action and should not be assumed to be the scheduled entry point.
