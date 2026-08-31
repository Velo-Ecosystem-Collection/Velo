This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/create-next-app).

## Getting Started

First, run the development server:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load Inter, a custom Google Font.

## Sprint 1 Playground

The anonymous `/playground` route loads and browses normalized Soroban contract
specifications on Testnet and Mainnet. Invocation is limited to the configured
Testnet `hello(Symbol) -> Vec<Symbol>` fixture: the server simulates and assembles an
unsigned transaction, the existing global wallet provider signs the exact XDR, and
the server verifies, submits, and polls it.

Configure live invocation with server environment values
`PLAYGROUND_HELLO_CONTRACT_ID` and `PLAYGROUND_HELLO_WASM_HASH`. Optional RPC
overrides are `STELLAR_TESTNET_RPC_URL` and `STELLAR_MAINNET_RPC_URL`, and must use
HTTPS. At the Sprint 1 boundary, Mainnet was inspection-only; Sprint 4 now supports
acknowledged Mainnet simulation while retaining the no-sign/no-submit policy.

Sprint 1 is **IMPLEMENTED — LIVE EVIDENCE PENDING**. The checked-in Testnet fixture
manifest records all five deployments and the live smoke passes, but no interactive
wallet transaction is recorded. See the
[architecture](../../docs/architecture/sprint-1-playground-contract-spec-foundation.md),
[API/type reference](../../docs/references/sprint-1-playground-api-and-type-support.md),
[fixture runbook](../../docs/operations/sprint-1-playground-fixture-runbook.md), and
[evidence report](../../docs/references/sprint-1-playground-evidence.md).

## Sprint 2 Playground argument builder

Selecting a function now opens a recursive argument builder. Form and JSON modes
share a parameter-keyed canonical value, preserve large integers as strings, and
support the Sprint 2 primitive, collection, and custom-type matrix. Invalid JSON or
invalid field drafts remain editable without replacing the last valid value.

Drafts are retained while switching functions and cleared when another contract is
loaded. Vector and map controls support accessible add, remove, and reorder actions;
reset restores type-derived examples, copy writes the last valid canonical JSON, and
addresses are classified as account, contract, or invalid. The read-only preview is
shown only when every argument is valid and contains a JSON object of per-parameter
base64 `ScVal` XDR values.

Sprint 2 is **IMPLEMENTED AND TESTED**. It established the canonical arguments and
editor later consumed by Sprint 3. See the
[Sprint 2 dynamic argument reference](../../docs/architecture/sprint-2-playground-dynamic-argument-system.md).

## Sprint 3 Playground simulation and preflight

Any supported Testnet function can now be simulated from the selected function's
canonical arguments. The server reloads the contract, rejects Wasm/spec drift,
encodes ordered `ScVal` arguments, loads the wallet source account, and returns a
300-second decision record with decoded/raw result, fees, authorization, read-only
and read-write footprint, diagnostics, state changes, and restore evidence.

Changing the contract, source account, function, arguments, base fee, or CPU leeway
marks the retained result stale. Expired and restore-required results remain
inspectable but cannot be signed. At the Sprint 3 boundary, Mainnet remained
inspection-only and signing/submission was limited to the hello fixture; Sprint 4
supersedes those boundaries below.

Sprint 3 is **IMPLEMENTED AND TESTED — LIVE FIXTURE EVIDENCE PENDING**. All 122 web
tests, lint/typechecks, the production build, and fixture contract tests pass. Live
generalized simulation for every deployed fixture awaits a funded Testnet source
account. See the
[Sprint 3 architecture and API](../../docs/architecture/sprint-3-playground-simulation-preflight.md).

## Sprint 4 Playground wallet and transaction lifecycle

The anonymous Playground now simulates supported contract calls on Testnet or
Mainnet and returns an exact-XDR review. The review exposes the source, contract and
Wasm hash, function, decoded arguments, sequence and time bounds, fees,
authorization, predicted writes, unsigned XDR, and transaction-hash fingerprint.
Changing the request context invalidates confirmation and requires re-simulation.

On Testnet, a fresh successful review can be explicitly confirmed and signed through
the existing global `WalletProvider` and Stellar Wallets Kit. The browser initiates
submission through Velo's API; the server verifies the signature, reviewed hash,
single contract invocation, expiry, and current Wasm before it submits through its
selected Testnet RPC. Pending identity survives refresh in `sessionStorage` without
persisting signed XDR. Final success and failure views include decoded results,
events, fees, ledger, explorer link, and raw XDR evidence.

Mainnet requires acknowledgement and is simulation-only. The client does not enable
signing, and the submit API independently rejects Mainnet.

Sprint 4 is **IMPLEMENTED AND TESTED — LIVE WALLET/NETWORK EVIDENCE PENDING**. The
following checks passed on 2026-07-23:

| Command                      | Result                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| `pnpm --filter web test`     | 138 of 138 tests passed                                                             |
| `pnpm --filter web lint:fix` | Oxlint, Oxfmt, route type generation, and TypeScript checks passed with no warnings |
| `pnpm --filter web build`    | Production build passed                                                             |
| Focused Stellar tests        | Contract argument and specification test files passed                               |
| Playground fixture tests     | 11 Cargo integration tests passed                                                   |
| `git diff --check`           | Passed                                                                              |

No live Freighter, Testnet transaction, refresh-recovery, or Mainnet simulation run
was performed in this implementation pass. See the
[Sprint 4 architecture](../../docs/architecture/sprint-4-playground-wallet-review-lifecycle.md)
and [API/lifecycle reference](../../docs/references/sprint-4-playground-api-and-lifecycle.md).

## Sprint 5 Playground standalone alpha

Sprint 5 adds 30-day, 50-entry device-local history with secret-aware replay,
deterministic TypeScript and Stellar CLI generation, privacy-safe funnel telemetry,
responsive/accessibility qualification, and distributed anonymous endpoint limits.
Configure `VELO_PLAYGROUND_RATE_LIMIT_SECRET` with the same random value in the web
runtime and Convex before production traffic. See the
[architecture](../../docs/architecture/sprint-5-playground-standalone-alpha.md) and
[evidence report](../../docs/references/sprint-5-playground-alpha-evidence.md).

## Sprint 10 observability

All public/provider route methods use the shared `withRouteTelemetry` boundary. Responses include `X-Correlation-Id` and the compatibility `X-Request-Id`; accepted payment intents also expose a durable journey ID. The server-only instrumentation hook exports sampled traces, unsampled metrics, and sanitized logs over OTLP without blocking request completion.

Set `VELO_OTEL_ENABLED=true` and configure `VELO_OTEL_EXPORTER_OTLP_ENDPOINT`. Optional server-only settings are `VELO_OTEL_EXPORTER_OTLP_AUTHORIZATION`, `VELO_OTEL_SUCCESS_SAMPLE_RATIO`, `VELO_OTEL_SERVICE_NAME`, `VELO_RELEASE_VERSION`, and `VELO_UI_TELEMETRY_INTAKE_SECRET`. Do not expose any of these as `NEXT_PUBLIC_*` values.

Sprint 10 is **IMPLEMENTED — LIVE EVIDENCE PENDING**. See the repository [architecture](../../docs/architecture/sprint-10-end-to-end-observability-and-redaction.md), [runbook](../../docs/operations/sprint-10-observability-and-redaction-runbook.md), and [evidence report](../../docs/references/sprint-10-observability-redaction-and-overhead-report.md).

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
