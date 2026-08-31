# Velo Convex Backend Operating Notes

## Tests

All backend tests live in [`tests`](tests). Keep new `*.test.ts` files there so deployable Convex
modules remain separate from test code. Tests using `convex-test` load the backend with
`import.meta.glob("../**/*.ts")` because the test directory is one level below the Convex root.

Run the suite from the repository root with `pnpm --filter @repo/backend test`.

## Sprint 8 reliability services

Financial provider calls are owned by `providerOperations`; payment RPC uncertainty is owned by
`paymentReconciliationJobs`; inbound PDAX callbacks are persisted in `providerEvents`; outbound
merchant notifications use immutable `webhookDomainEvents` plus fenced `webhookDeliveries`.
Together these provide **exactly-once observable transitions**, not exactly-once transport.

Provider and payment workers use indexed pages of at most 100 and continuation scheduling. The
capacity contract is covered by [`10,000 reconciliation jobs drain in exactly 100 bounded pages`](tests/durableReliability.test.ts). Provider lease fencing is covered by [`lease fencing rejects stale completion and ambiguous trades cannot resubmit`](tests/durableReliability.test.ts).

Public payment REST routes call one `payment_intents.public_api` action. The action authorizes,
admits both the API-key and project quota, then invokes one internal read or write. Projects use the
legacy Convex bucket while `rateLimitBackend` is `convex`; `migrating` fails closed; `upstash` uses
one exact Redis Lua operation. See the [payment limiter cutover runbook](../../../docs/operations/payment-rate-limit-cutover.md).

## Configuration and rollout

Required Convex environment variables:

- `PDAX_UAT_BASE_URL`, `PDAX_UAT_USERNAME`, and `PDAX_UAT_PASSWORD`
- `PDAX_CALLBACK_URL` and `PDAX_WEBHOOK_TOKEN`
- `STELLAR_RPC_URL`

The direct provider ingress is `POST /api/webhooks/pdax/v1?token=…`; the retired Next.js route
returns 410. After additive schema deployment, run `internal.sprint8_migrations.backfill` and
re-register active PDAX projects with `settlement.actions.registerWebhook({ projectId })`.

Use authenticated provider-operation queries and `provider_operations.mutations.redrive` for
operator recovery. Redrive preserves the original request fingerprint/provider UUID; an ambiguous
trade must not become a new submission. This invariant is covered by [`lease fencing rejects stale completion and ambiguous trades cannot resubmit`](tests/durableReliability.test.ts).

## Webhook delivery

Canonical payment and settlement mutations enqueue `internal.webhookDelivery.trigger` after the
transaction commits. Immutable domain events deduplicate deliveries per endpoint/schema version,
and lease token/generation fencing rejects stale workers. This is covered by [`duplicate delivery triggers share one fenced delivery`](tests/durableReliability.test.ts).

Network failures, HTTP 408/429, and 5xx responses retry at most five times with bounded jitter and
`Retry-After` support. Terminal retryable failure sets `deadLetter: true`; authenticated replay
reuses the durable record. Evidence: [`webhook delivery retry and backoff lifecycle`](tests/webhookDelivery.test.ts) and [`webhook retry scheduling honors Retry-After for retryable endpoint failures`](tests/webhookDelivery.test.ts).

The dispatcher uses an 8-second total deadline and a conservative 2-second setup abort. Queue
timing is stored in `nextAttemptAt`/`lastAttemptAt`; endpoint latency is stored in
`responseTimeMs`.

See the [Sprint 8 runbook](../../../docs/operations/sprint-8-durable-financial-reliability-runbook.md).

Sprint 8 has no live SLO qualification and no production availability evidence.

## Sprint 10 observability and redaction

Payment journeys now retain a durable correlation ID and trace context across scheduled reconciliation, provider ingestion, settlement, and webhook delivery. `getProjectPaymentLifecycleByCorrelation` verifies project ownership before indexed reads and returns ordered payment, provider/worker/UI, and webhook stages with missing-stage diagnostics.

Transaction-created telemetry uses a 100-row fenced outbox. The one-minute exporter deletes successful rows, retries failures at most five times, exposes dead letters, and never rolls back business mutations. One-minute bounded gauge capture covers queue, scanner, provider, webhook, confirmation, and exporter state; telemetry and journey-stage rows expire after 14 days.

New provider callbacks persist typed summaries and digests instead of raw payloads. The schema remains in its widening state while deployed data is migrated and verified; do not remove the optional legacy fields until the paginated verification returns zero forbidden rows.

Configure `VELO_OTEL_EXPORTER_OTLP_ENDPOINT` and optional `VELO_OTEL_EXPORTER_OTLP_AUTHORIZATION` in the Convex environment. Durable UI markers also require the same server-only `VELO_UI_TELEMETRY_INTAKE_SECRET` configured in the web environment.

Project Playground execution history requires the same server-only
`VELO_PLAYGROUND_PERSISTENCE_SECRET` in the web and Convex environments. It signs
trusted simulation and transaction outcomes before Convex accepts them. Never expose
it through a `NEXT_PUBLIC_*` variable.

The public Playground limiter requires
`VELO_PLAYGROUND_RATE_LIMIT_SECRET` to contain the same random server-only value in
Convex and the web runtime. Never expose it through a `NEXT_PUBLIC_*` variable.

Set `VELO_CONVEX_TELEMETRY_ENABLED=false` in the Convex deployment environment to stop new
outbox telemetry, bounded gauge scans, and exporter claims. The switch defaults to enabled when it
is unset. Existing outbox rows remain available for the hourly expiry worker to delete.

Sprint 10 is **IMPLEMENTED — LIVE EVIDENCE PENDING**. See the [architecture](../../../docs/architecture/sprint-10-end-to-end-observability-and-redaction.md), [operator runbook](../../../docs/operations/sprint-10-observability-and-redaction-runbook.md), and [evidence report](../../../docs/references/sprint-10-observability-redaction-and-overhead-report.md).
