---
type: reference
area: frontend
status: current
last_updated: 2026-08-31
source_of_truth: repository
---

# Routes

## Page Routes

| Route | Responsibility |
| --- | --- |
| `/` | Landing page. |
| `/login`, `/signup`, `/profile` | Wallet auth/profile onboarding. |
| `/dashboard`, `/projects/new` | Authenticated dashboard and project creation. |
| `/projects/[projectId]/api-keys` | API key management. |
| `/projects/[projectId]/contracts` | Official contract links. |
| `/projects/[projectId]/events` | Contract event activity. |
| `/projects/[projectId]/integration` | SDK/API integration snippets. |
| `/projects/[projectId]/logs/[journeyCorrelationId]` | Journey/log detail. |
| `/projects/[projectId]/payments` | Project payment list/metrics. |
| `/projects/[projectId]/playground` | Project Playground. |
| `/projects/[projectId]/settings` | Project settings. |
| `/projects/[projectId]/settlement` | PDAX UAT settlement. |
| `/projects/[projectId]/wallets` | Published wallet configuration. |
| `/projects/[projectId]/webhooks` | Endpoint and delivery configuration. |
| `/pay/[paymentIntentId]` and `/success`, `/failed`, `/cancel` | Hosted checkout and terminal pages. |
| `/docs`, `/debug`, `/verify/[slug]`, `/feedback`, `/playground` | Public docs, debugger, verification, feedback, and Playground. |

## API Routes

- Wallet auth: `/api/auth/wallet/challenge`, `/verify`, `/jwks`.
- Payments: `/api/v1/payment-intents`, `/api/v1/payment-intents/[id]`, and corresponding `/api/v2` routes.
- Merchant reads: `/api/v1/events`, `/api/v1/transactions/[hash]`, `/api/v1/webhooks/deliveries`.
- Playground: `/api/v1/playground/contracts/load`, `/simulations`, `/transactions/submit`, `/transactions/[hash]`.
- Wallet config and telemetry: `/api/v1/wallet-config/[publicKey]`, `/api/telemetry/playground`, `/api/telemetry/ui`.
- Webhook utilities: `/api/webhook-tester`; `/api/webhooks/pdax` is retired with 410.

The canonical provider callback is Convex HTTP `/api/webhooks/pdax/v1?token=...`, not the retired Next route. See [[modules/Settlement and PDAX]].

