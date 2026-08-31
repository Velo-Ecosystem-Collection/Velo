---
type: architecture
area: frontend
status: current
last_updated: 2026-08-31
source_of_truth: repository
---

# Frontend Architecture

The frontend is a Next.js 16 App Router application in `apps/web` using TypeScript, React, Convex React, Stellar Wallets Kit, and shared `@repo/ui` components.

## Provider and Shell Composition

`app/layout.tsx` composes providers in this order:

```text
WalletProvider
  → ConvexClientProvider
    → @repo/ui UiProviders
      → PwaProvider
        → route content
```

`core/app-shell.tsx` provides the authenticated console shell, sidebar/project selection, route protection, wallet notices, and owner/member context. Protected dashboard, billing, project, and profile routes redirect to `/login` when no wallet is connected; new wallet users are directed to `/signup`.

## Data and State

- Authenticated UI uses generated Convex `useQuery`/`useMutation` references.
- `ConvexClientProvider` bootstraps a wallet-specific JWT through Next wallet challenge/verify routes and keeps the token in session storage.
- Project selection is remembered in browser local storage per wallet address.
- Checkout and Playground use local component/reducer state for lifecycle presentation and minimal pending identity, while Convex/Stellar provide authoritative status.
- There is no separate global state library evident in the current app.

## Direct Protocol Boundaries

- Project registration, official contract linking, PayAccess activation, and checkout transaction preparation use `@repo/stellar` from client feature code and wallet signing.
- Hosted checkout performs client preflight and submits to Horizon, then Convex/backend verification decides final payment state.
- Playground submission is constrained to server-selected RPC and independently verifies signed XDR; Mainnet is simulation-only.

## Feature Organization

Feature directories group UI and local helpers by domain: `projects`, `checkout`, `playground`, `billing`, `debugger`, `observability`, `auth`, `profile`, `feedback`, `docs`, and `landing`. Shared visual primitives belong in `packages/ui`.

See [[frontend/Routes]], [[frontend/Components and Features]], and [[modules/Wallet Authentication]].

