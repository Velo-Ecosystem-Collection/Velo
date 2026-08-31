---
type: operations
area: configuration
status: current
last_updated: 2026-08-31
source_of_truth: repository
---

# Environment Variables

Only names and purposes are documented here. Values belong in ignored local/deployment configuration and must never be copied into the vault.

## Web / Public Configuration

| Variable | Used by | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_CONVEX_URL` | Web | Convex cloud URL. |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | Web/PDAX setup | Convex site URL for HTTP callbacks. |
| `NEXT_PUBLIC_APP_URL` | Web/API/auth | Public app origin and checkout URL base. |
| `NEXT_PUBLIC_STELLAR_NETWORK` | Web | Current network selector; validator currently permits `testnet`. |
| `NEXT_PUBLIC_STELLAR_RPC_URL` | Web/backend fallback | Stellar Soroban RPC endpoint. |
| `NEXT_PUBLIC_VELO_REGISTRY_CONTRACT_ID` | Web | Registry contract ID. |
| `NEXT_PUBLIC_VELO_PAY_ACCESS_CONTRACT_ID` | Web | PayAccess contract ID. |
| `NEXT_PUBLIC_USDC_ISSUER` | Web | Optional configured USDC issuer/default asset. |
| `NEXT_PUBLIC_WALLETS_CDN_BASE_URL` | Web wallet config | Optional hosted wallet widget bundle origin. |
| `NEXT_PUBLIC_VELO_BENCHMARK_MARKERS` | Web | Enables benchmark marker behavior. |
| `VELO_REQUIRE_CONTRACT_IDS` | Web config | Forces contract IDs to be present. |
| `VERCEL_ENV` | Web config | Makes production contract IDs required. |

## Web / Server-Only Configuration

| Variable | Used by | Purpose |
| --- | --- | --- |
| `VELO_AUTH_CHALLENGE_SECRET` | Web auth | Secret fallback/input for wallet challenge key derivation. |
| `VELO_AUTH_JWT_PRIVATE_KEY_PEM` | Web auth | ES256 JWT signing key. Secret. |
| `VELO_AUTH_SERVER_SECRET` | Web auth | Optional server Stellar signing secret. Secret. |
| `VELO_UI_TELEMETRY_INTAKE_SECRET` | Web/Convex | Authenticates durable UI telemetry intake. Secret. |
| `VELO_PLAYGROUND_PERSISTENCE_SECRET` | Web/Convex | Signs trusted Playground project outcomes. Secret. |
| `VELO_PLAYGROUND_RATE_LIMIT_SECRET` | Web/Convex | Server-only Playground limiter secret. Secret. |
| `VELO_OTEL_ENABLED` | Web | Enables optional OpenTelemetry registration. |
| `VELO_OTEL_EXPORTER_OTLP_ENDPOINT` | Web/Convex | OTLP exporter endpoint. |
| `VELO_OTEL_EXPORTER_OTLP_AUTHORIZATION` | Web/Convex | OTLP authorization header/value. Secret. |
| `VELO_OTEL_SERVICE_NAME` | Web | OTEL service name. |
| `VELO_RELEASE_VERSION` | Web/OTEL | Release/version attribute. |
| `VELO_TELEMETRY_CONSOLE` | Web | Optional console telemetry output. |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES` | Web instrumentation | Standard OTEL overrides. Values may contain credentials; keep server-only. |

## Convex / Backend

| Variable | Used by | Purpose |
| --- | --- | --- |
| `VELO_PAY_ACCESS_CONTRACT_ID` | Convex | Canonical backend PayAccess contract ID. |
| `NEXT_PUBLIC_VELO_PAY_ACCESS_CONTRACT_ID` | Convex fallback | Compatibility fallback for PayAccess ID. |
| `STELLAR_RPC_URL` | Convex | Backend Stellar RPC endpoint. |
| `VELO_STELLAR_NETWORK` | Convex billing | Billing network (`testnet` or `public`). |
| `VELO_MAINNET_USDC_ISSUER` | Convex billing | Mainnet USDC issuer configuration. |
| `VELO_DEPLOYMENT_ENVIRONMENT` | Convex billing | `development`, `preview`, or `production` mode. |
| `VELO_AUTH_ISSUER` | Convex auth | JWT issuer override. |
| `VELO_AUTH_JWKS` | Convex auth | HTTPS/data JWKS source. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Convex rate limits | Optional Upstash rate-limit backend. Secrets/credentials. |
| `VELO_RATE_LIMIT_SCOPE_SECRET` | Convex rate limits | Rate-limit scope secret. Secret. |
| `VELO_ENABLE_RATE_LIMIT_BENCHMARK` | Convex rate limits | Enables staging rate-limit benchmark action. |
| `VELO_CONVEX_TELEMETRY_ENABLED` | Convex telemetry | Enables/disables new outbox/gauge telemetry. |

## PDAX UAT

| Variable | Used by | Purpose |
| --- | --- | --- |
| `PDAX_UAT_BASE_URL` | Convex/PDAX client | PDAX UAT API base URL. |
| `PDAX_UAT_USERNAME` | Convex/PDAX client | UAT credential. Secret. |
| `PDAX_UAT_PASSWORD` | Convex/PDAX client | UAT credential. Secret. |
| `PDAX_CALLBACK_URL` | Convex settlement | Public versioned Convex callback base URL. |
| `PDAX_WEBHOOK_TOKEN` | Convex HTTP ingress | Shared callback token. Secret. |

## Merchant Examples / SDK

| Variable | Used by | Purpose |
| --- | --- | --- |
| `VELO_API_KEY` | SDK examples/docs | Server-side merchant API key. Secret. |
| `VELO_WEBHOOK_SECRET` | SDK examples/docs | Merchant-side webhook verification secret. Secret. |
| `VELO_BASE_URL` | SDK examples | Optional Velo API base URL. |
| `VELO_ENV` | SDK examples | SDK environment selection. |
| `VELO_INHOUSE_API_KEY`, `VELO_PDAX_API_KEY` | SDK examples | Separate anchor-scoped server API keys. Secrets. |

Related: [[operations/Local Development]], [[modules/Wallet Authentication]], [[modules/Settlement and PDAX]], [[modules/SDK and Wallets]].

