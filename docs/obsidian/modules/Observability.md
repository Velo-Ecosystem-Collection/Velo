---
type: module
area: observability
status: partial
last_updated: 2026-08-31
source_of_truth: repository
---

# Observability

## Purpose

Makes payment/provider/webhook/UI journeys inspectable through correlation IDs, trace context, dashboard views, durable journey stages, telemetry outbox records, and optional OTLP export.

## Primary Locations

- Shared package: `packages/observability/src/index.ts`.
- Web: `apps/web/core/observability.ts`, `core/otlp.ts`, `instrumentation.ts`, `app/api/telemetry/`.
- Convex: `telemetry_outbox/`, `journey_stages/`, `telemetry_outbox/gauges.ts`.
- UI: project dashboard, event activity, payment lifecycle/log views.
- Local stack: `observability/docker-compose.yml` and config files.

## Responsibilities

- Correlation/trace headers cross Next, Convex, Stellar, PDAX, provider events, and webhooks.
- `journeyStages` records bounded high-level provider/webhook/UI milestones with 14-day expiry.
- `telemetryOutbox` fences export attempts, retries boundedly, and dead-letters without rolling back business mutations.
- Redaction avoids raw provider payloads and secret-looking diagnostics in public evidence.

## Common Change Locations

- Route spans/headers: `apps/web/core/observability.ts` and `packages/observability/src/index.ts`.
- Durable export/redaction: `packages/backend/convex/telemetry_outbox/*`.
- Journey lookup: `packages/backend/convex/payment_intents/queries.ts`.
- Dashboard display: `apps/web/features/projects/dashboard.tsx`, payment/log features.

## Risks / Gotchas

- Correlation IDs are opaque and must not be derived from wallet data.
- Telemetry is diagnostic; it must not become a prerequisite for business state commits.
- Keep OTLP authorization and UI intake secrets out of client bundles and vault notes.
- Existing reports distinguish deterministic test evidence from live SLO qualification.

## Related Notes

[[architecture/Data Flow]], [[modules/Webhooks]], [[operations/Local Development]], [[operations/Environment Variables]]

