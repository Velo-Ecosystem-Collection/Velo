---
type: module
area: sdk
status: current
last_updated: 2026-08-31
source_of_truth: repository
---

# SDK and Wallets

## Purpose

Publishes consumer-facing integration packages: a server-side Velo Node SDK for payments/webhooks and a browser/React/CDN wallet widget for project-configured wallet access.

## Current Status

Both are alpha packages. SDK is server-side and ESM-only; wallet widget is published with React, browser, and custom-element exports.

## Primary Locations

- SDK: `packages/velo-sdk/src/client.ts`, `http.ts`, `webhooks.ts`, `types.ts`, `README.md`.
- Wallets: `packages/velo-wallets/src/`, package exports, `README.md`.
- Consumer examples: `examples/express/`, `examples/nextjs-app-router/`.
- Backend wallet configuration: `packages/backend/convex/wallet_configs/`.

## SDK Behavior

`Velo` exposes checkout session creation, PaymentIntent create/retrieve/list, and static/instance webhook verification. The HTTP client resolves production/testnet/development base URLs, applies total deadlines, retries only safe/idempotent calls, propagates correlation/trace headers, and reports typed errors.

## Wallet Widget Behavior

`@carts1024/velo-wallets` wraps Stellar Wallets Kit, provides a web component and React provider/widgets, and fetches published project configuration. Signing stays in the consuming browser; the package does not send signing inputs to Velo.

## Common Change Locations

- SDK public contract/transport: `packages/velo-sdk/src/client.ts`, `http.ts`, `types.ts`, `errors.ts`.
- Webhook event validation: `packages/velo-sdk/src/webhooks.ts`.
- Wallet runtime/config and styling: `packages/velo-wallets/src/` and `packages/backend/convex/wallet_configs/`.
- Integration guidance: package READMEs and example route handlers.

## Risks / Gotchas

- Never put SDK API keys or webhook secrets in browser code.
- Webhook consumers must pass the raw body to verification and deduplicate deliveries.
- SDK submission requests with unknown network outcome must reconcile by hash rather than resubmit.
- Published alpha API may change; preserve package export boundaries.

## Related Notes

[[modules/Payments and Checkout]], [[modules/Webhooks]], [[modules/Wallet Authentication]], [[frontend/Components and Features]]

