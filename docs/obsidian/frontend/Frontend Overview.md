---
type: architecture
area: frontend
status: current
last_updated: 2026-08-31
source_of_truth: repository
---

# Frontend Overview

`apps/web` is a Next.js 16 App Router application with client feature components, server route handlers, Convex React subscriptions, wallet context, shared UI, and PWA/telemetry support.

## Application Areas

- Public: landing, SDK/API docs, public project verification, transaction debugger, feedback, hosted payment pages.
- Console: dashboard, project creation/settings, contract links, event activity, API keys, integration snippets, webhooks, wallets, settlement, billing, profile.
- Playground: anonymous and project-scoped contract loading, simulation, review, invocation, history, and sharing.

## Auth Boundaries

`WalletProvider` owns wallet capability/connection/signing. `ConvexClientProvider` turns the wallet challenge into a Convex-authenticated session. `AppShell` gates protected routes and scopes the selected project. Public routes are deliberately readable without a Convex identity where their feature allows it.

## API/Client Layers

- Server route handlers use `ConvexHttpClient` and generated backend references.
- Client console code uses `convex/react` generated API calls.
- `@repo/stellar` is the protocol helper boundary.
- `@carts1024/velo-sdk` is for external server-side merchants, not browser use.

See [[architecture/Frontend Architecture]], [[frontend/Routes]], and [[frontend/Components and Features]].

