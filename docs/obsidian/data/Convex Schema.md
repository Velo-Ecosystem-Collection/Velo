---
type: reference
area: backend
status: current
last_updated: 2026-09-03
source_of_truth: repository
---

# Convex Schema

The schema is assembled in `packages/backend/convex/schema.ts` from domain-local schema modules. This inventory is intentionally grouped, not a field-by-field API reference.

## Identity and Projects

- `users`, `organizations`, `projects`, `projectMemberships`, `projectContracts`, `apiKeys`.
- Projects carry Registry status/ID/hash, owner identity, payment-access cache, default anchor, and rate-limit backend.

## Payments and Billing

- `paymentIntents`, `paymentIntentIdempotencyKeys`, `paymentIntentRouteJobs`, `paymentReconciliationJobs`.
- Billing tables: `billingPolicies`, `organizationBillingSettings`, `billingOffers`, `billingLaunchApprovals`, `billingTreasuries`, `billingOperationalEvents`, `billingOperatorWallets`, `billingTopups`, `treasuryReceipts`, `billingExceptions`, `billingExceptionEvidence`, `billingExceptionHistory`, `billingCostPeriods`, `billingRefunds`, `billingPdaxEconomics`, `billingFinanceReports`, `billingReplayRuns`, `billingSupportRecords`, `billingNotifications`, `billingBalances`, `creditLots`, `billingLedgerEntries`, `creditReservations`, `organizationMigrationCollisions`, `shadowBillingDecisions`, `payAccessMirrorStates`, `payAccessMirrorAttempts`.

## Gas Station (partial D1 foundation)

- `gasPolicies` stores project-scoped, Testnet-only policy caps, UTC window state, and bounded contract allowlists.
- `gasLogs` stores required request correlation, optional derived fee/wallet/target facts, bounded decision and rejection codes, reservation lifecycle, and independent retention expiry. `gas/admission.ts` writes one reserved or replayable redacted rejection decision atomically.
- `relayerAccounts` stores project-scoped Testnet relayer public-key and balance metadata with active/disabled status; it contains no signing or custody state.
- `gas/projections.ts` provides field-by-field safe projections and explicit return validators for the three Gas tables. It converts stroops to decimal strings, keeps only policy/decision/lifecycle/public-key/balance/timestamp fields, and excludes Convex IDs, unnecessary project IDs, idempotency/request hashes, retention internals, raw XDR, signatures, credentials, and custody material. The log projection represents missing stored values as `null`.
- `gas/queries.ts` and `gas/mutations.ts` expose authenticated console CRUD and reads: viewer-scoped policy/relayer reads, cursor-paginated newest-first log reads restricted by `by_project_id_and_created_at`, editor policy upserts, and owner relayer metadata upserts. Log pages preserve native Convex cursor metadata while mapping every row through the safe projection. Policy updates preserve reservation/day accounting and creation time; relayer updates preserve trusted balance metadata and creation time. New records are always Testnet records, and public-key collisions/ambiguous indexed records fail closed.
- `gas/authorization.ts` provides the reusable console role guard (`read` viewer+, `updatePolicy` editor+, `updateRelayer` owner) and the server-boundary API-key verifier. API-key scope comes only from the stored `apiKeys` record; missing, malformed, unknown, revoked, orphaned, or ambiguous hashes fail uniformly. Gas authorization does not check the project's `paymentAccessActive` field.
- `gas/policy.ts` provides the pure `evaluateGasPolicy` helper and structural snapshot/input/result types. It derives the checked D1 reservation (`innerMaxFeeStroops + 100` stroops), applies deterministic network/operation/allowlist/cap/quota precedence, and returns bounded reason data without Convex reads, writes, or registration.
- `gas/admission.ts` exposes only `internal.gas.admission.reserve`. It revalidates API-key ID/hash/project scope and revocation without consulting `paymentAccessActive`, resolves idempotency before project-scoped reserved transaction hashes, rolls UTC daily/hour windows, evaluates one quota unit, and atomically patches policy/bucket state with a 30-day gas log. Policy denials persist no transaction hash, reservation amount, or expiry, so a corrected policy can admit a later retry under a new key.
- Gas-log indexes support project/time, project/source-wallet/time, project/transaction hash, project/idempotency hash, project/request ID, lifecycle/expiry, and retention expiry. Convex indexes do not enforce uniqueness; authorized writes must use indexed `.unique()` lookups.
- `rateLimitBuckets` is reused for Gas wallet quotas with `gas:<projectId>:wallet:<sourceWallet>` scope keys; integer `tokens` records consumed units and `updatedAt` identifies the UTC-hour window without creating per-hour rows.
- `packages/backend/convex/tests/gas/` covers Convex insertion/validator boundaries, int64 transport limits, canonical normalization, allowlist bounds, exact projection shapes, decimal-string amounts, malicious-field redaction, and atomic admission replay/conflict/rollover/concurrency behavior.
- This is schema, validation, authorization, pure policy-evaluation, authenticated console CRUD, and internal admission groundwork. Public API routes/orchestration, cleanup, and relayer execution remain later work.

## Stellar and Polling

- `transactions` stores normalized Testnet transaction/debugger cache.
- `contractEvents` stores decoded/raw contract event evidence and journey correlation.
- `pollerState` stores project/global ledger cursors, status, and lag metrics.

## Webhooks and Journey State

- `webhookEndpoints` stores one project endpoint, event allowlist, destination host, and signing secret.
- `webhookDomainEvents` stores immutable event identity/payload snapshots.
- `webhookDeliveries` stores transport attempts, status, retry/dead-letter, response, and lease data.
- `journeyStages` stores bounded high-level lifecycle milestones.

## PDAX and Settlement

- `providerConnections`, `providerEvents`, `providerOperations`, `providerResilience`, `pdaxRouteCache`.
- `settlementQuotes`, `settlementTransactions`.

## Playground and Wallet Runtime

- `playgroundSavedContracts`, `playgroundSavedRequests`, `playgroundRequestVersions`, `playgroundEnvironmentVariables`, `playgroundExecutions`, `playgroundShares`, `playgroundWebhookFilters`.
- `walletConfigs`, `walletConfigPublications`.

## Limits and Retention

Most worker queues are indexed by state and next-attempt/lease expiry to support bounded work. Exact field validators and indexes are in the domain `schema.ts` files; update this note when a schema materially changes.

Related: [[backend/Background Jobs]], [[modules/Billing and Entitlements]], [[modules/Playground]], [[modules/Webhooks]].
