---
type: architecture
area: integrations
status: current
last_updated: 2026-08-31
source_of_truth: repository
---

# Integration Boundaries

| Boundary | Protocol/owner | Important rules |
| --- | --- | --- |
| Browser ↔ Next.js | HTTP, App Router, wallet APIs | Browser can request state and submit signed material, but never receives server secrets. |
| Next.js ↔ Convex | `ConvexHttpClient` server calls and generated Convex React API | Next routes normalize public API errors, attach rate headers, and pass correlation context. |
| Browser ↔ Convex | Convex React subscriptions through the authenticated provider | Owner/member authorization comes from wallet JWT identity. |
| Browser ↔ Stellar | Wallet signing plus Horizon/RPC helpers | Network and contract config are validated; Testnet is the current checkout boundary. |
| Convex ↔ Stellar | Actions using `@repo/stellar` | RPC is the evidence source for transaction/event status; uncertain outcomes are reconciled. |
| Convex ↔ Soroban | Contract calls/events and deployment manifests | Registry is provenance authority; PayAccess reads Registry and mirrors only display state. |
| Convex ↔ PDAX | `@repo/pdax` from Convex actions | UAT credentials/tokens are server-only; callbacks are token-protected but unsigned and require corroboration. |
| Velo ↔ merchant webhook | Outbound HTTPS + HMAC-SHA256 | Delivery is durable/at-least-once; consumers deduplicate by delivery ID and verify raw payload. |
| Merchant SDK ↔ Velo | REST `/api/v2/payment-intents` | SDK is ESM/server-side, API-key authenticated, idempotency-aware, bounded, and retry-limited. |
| Velo ↔ telemetry stack | OTLP and Convex outbox | Export is bounded/fail-open for business traffic; credentials and authorization values stay server-side. |

The canonical PDAX ingress is Convex HTTP `/api/webhooks/pdax/v1?token=...`; the old Next route is retired. See [[Current System State]] and [[modules/Settlement and PDAX]].

