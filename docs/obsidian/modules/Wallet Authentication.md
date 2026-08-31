---
type: module
area: auth
status: current
last_updated: 2026-08-31
source_of_truth: repository
---

# Wallet Authentication

## Purpose

Uses a Stellar wallet to authenticate a Velo browser session and provide Convex with a verifiable custom JWT identity.

## Primary Locations

- `apps/web/core/wallet/wallet-provider.tsx`
- `apps/web/core/auth/convex-auth.ts`
- `apps/web/core/auth/wallet-jwt.ts`
- `apps/web/app/api/auth/wallet/{challenge,verify,jwks}/route.ts`
- `packages/backend/convex/auth.config.ts`, `authConfig.ts`, `projects/helpers.ts`

## Important Flow

Wallet connects via Stellar Wallets Kit → Next creates a WebAuth challenge transaction → wallet signs → Next validates challenge/signers and emits an ES256 JWT → Convex fetches the JWKS and validates issuer/application/key ID → project helpers authorize by token identifier and normalized wallet subject/address.

Public routes include landing, docs, verify, and pay. `AppShell` protects dashboard, billing, projects, and profile routes.

## Common Change Locations

- Wallet states/signing/network checks: `wallet-provider.tsx`.
- Challenge/JWT/JWKS behavior: `wallet-jwt.ts`, auth API routes, `authConfig.ts`.
- Convex ownership/migration checks: `packages/backend/convex/projects/helpers.ts` and organization helpers.

## Risks / Gotchas

- Private JWT key, challenge secret, and server wallet secret are server-only.
- Convex Cloud needs an HTTPS/data JWKS URL; localhost is not valid for hosted deployments.
- Token cache is tied to the wallet address and current auth key ID; disconnect/rejection clears it.
- This is a SEP-10-style challenge flow, not a complete SEP-10 service implementation.

## Related Notes

[[architecture/Frontend Architecture]], [[stellar/SEP Integrations]], [[operations/Environment Variables]]

