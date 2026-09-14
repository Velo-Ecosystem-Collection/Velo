# Velo SDK Next.js App Router Example

This is a simple demo application showing how to integrate `@carts1024/velo-sdk` into a Next.js App Router application.

## Prerequisites

- Node.js >= 18
- pnpm

## Setup

1. Create a `.env.local` file from `.env.example` and set variables:

```bash
cp .env.example .env.local
```

Create two keys in the local dashboard at http://localhost:3000:

- Scope one key to **In-house** and assign it to `VELO_INHOUSE_API_KEY`.
- Scope the other key to **PDAX** and assign it to `VELO_PDAX_API_KEY`.
- Do not reuse the same key for both variables. Both values stay server-side and must start with `tk_live_`.

Set `VELO_ENV=development` when using the local Velo API. The checkout route selects the matching SDK client from the requested anchor, so an in-house request is never authenticated with the PDAX-scoped key (or vice versa).

The Gas route uses separate server-only configuration. Set `VELO_GAS_API_KEY` to the Gas-scoped project key, set `VELO_BASE_URL` explicitly to the Velo deployment, and choose a separate `VELO_GAS_DEMO_TOKEN` for the terminal caller. HTTPS is required for non-loopback deployments; `http://localhost`, `http://127.0.0.1`, and `http://[::1]` are allowed for local development. The local bearer guard demonstrates caller authorization only; production applications must bind this route to their own authenticated user/session and project authorization.

2. Run the application:

```bash
pnpm install
pnpm dev
```

The example runs at `http://localhost:3005`.

## Terminal Gas request

The Gas example accepts a user-signed Testnet Soroban XDR from a trusted terminal caller. Testnet prerequisites are a Gas-scoped API key, a configured and funded Testnet relayer, and a fresh supported signed XDR. The example does not sign, interpret, or persist the XDR.

```bash
export VELO_GAS_DEMO_TOKEN=replace_with_a_local_terminal_token
export VELO_GAS_OPERATION_ID=demo-operation-001
export SIGNED_XDR_FILE=/absolute/path/to/signed-testnet-transaction.xdr

node -e 'const fs=require("node:fs"); process.stdout.write(JSON.stringify({operationId:process.env.VELO_GAS_OPERATION_ID,transactionXdr:fs.readFileSync(process.argv[1],"utf8").trim()}))' "$SIGNED_XDR_FILE" \
  | curl --fail-with-body -sS http://localhost:3005/api/gas \
      -H "Authorization: Bearer $VELO_GAS_DEMO_TOKEN" \
      -H "Content-Type: application/json" \
      --data-binary @-
```

`operationId` is the caller-owned logical operation identity. The route derives the stable idempotency key `nextjs-gas:<operationId>` and does not create a replacement key or retry XDR submission. Repeating a logical call must reuse the same operation ID and the exact same signed input.

The response contains only `operationId`, `status`, nullable `actualFeeStroops`, and `reconciliationRequired`. HTTP `200` means the execution is terminal; that includes `failed` and `cancelled`, which are explicit non-success outcomes. Only `status: "succeeded"` is transaction success. HTTP `202` means `claimed`, `submission_unknown`, or `submitted`, and a local deadline/cancellation never implies transaction failure. If the outcome is uncertain, production applications must durably store the user-owned operation identity and resume observation with identity-only SDK calls; this example has no operation store or later status endpoint and does not expose recovery data in its response.

## Key Files

- [app/api/checkout/route.ts](file:///home/carts/Documents/Personal/Velo/examples/nextjs-app-router/app/api/checkout/route.ts): API route that instantiates the `Velo` client and creates payment intent checkout sessions securely on the server.
- [app/api/gas/config.ts](app/api/gas/config.ts): Lazy server configuration validation for the Gas key, explicit base URL, and separate terminal demo token.
- [app/api/gas/route.ts](app/api/gas/route.ts): Authenticated Node.js Route Handler that bounds input, calls `velo.gas.sponsorAndSubmit()`, observes running results, and returns a redacted allowlisted result.
- [app/api/webhook/route.ts](file:///home/carts/Documents/Personal/Velo/examples/nextjs-app-router/app/api/webhook/route.ts): Route handler demonstrating raw request body capturing and secure webhook verification via `Velo.webhooks.verify`.
