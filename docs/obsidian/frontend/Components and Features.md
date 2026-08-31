---
type: reference
area: frontend
status: current
last_updated: 2026-08-31
source_of_truth: repository
---

# Components and Features

## Feature Conventions

Feature behavior and UI are colocated under `apps/web/features/<domain>`. Route files under `apps/web/app` remain thin composition/entry points where possible. Cross-domain providers/configuration live in `apps/web/core`. Reusable visual primitives belong in `packages/ui`.

## High-Value Feature Areas

| Feature | Representative files |
| --- | --- |
| Project console | `features/projects/dashboard.tsx`, `project-contracts.tsx`, `project-payments.tsx`, `project-webhooks.tsx`, `project-settlement.tsx`. |
| Checkout | `features/checkout/checkout-client.tsx`, success/failed/cancel clients, `packages/stellar/src/checkout.ts`. |
| Playground | `features/playground/playground-client.tsx`, argument editor, simulation/lifecycle state, `server/`. |
| Billing | `features/billing/billing-dashboard.tsx`, offer/validation helpers. |
| Wallet/auth | `core/wallet/`, `core/auth/`, onboarding/profile. |
| Observability | `core/observability.ts`, debugger, event activity, journey/log views. |
| Shared UI | `@repo/ui/components/ui/` and `ui-customs/`, especially sidebar/loading. |

## Common Change Routing

- Add a page entry in `app/<route>/page.tsx`, but keep domain logic in `features/`.
- Add a server-only API boundary in `app/api/` and call Convex through the generated API.
- Add protocol mechanics to `packages/stellar`, not a duplicate implementation in a component.
- Add shared controls/styles to `packages/ui` only when multiple app areas need them.

## Risks

Client components can access wallet/public env configuration but must not receive API keys, provider credentials, signing secrets, or Convex server secrets. Keep authoritative payment/settlement decisions in Convex/backend paths.

Related: [[architecture/Frontend Architecture]], [[modules/Payments and Checkout]], [[modules/Playground]].

