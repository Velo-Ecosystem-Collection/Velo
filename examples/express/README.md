# Velo SDK Express Server Example

This is a simple server application showing how to integrate `@carts1024/velo-sdk` into an Express application.

## Prerequisites

- Node.js >= 18
- pnpm

## Setup

1. Create a `.env` file from `.env.example` and set variables:

```bash
cp .env.example .env
```

Create two keys in the local dashboard at http://localhost:3000:

- Scope one key to **In-house** and assign it to `VELO_INHOUSE_API_KEY`.
- Scope the other key to **PDAX** and assign it to `VELO_PDAX_API_KEY`.
- Do not reuse the same key for both variables. Both values stay server-side and must start with `tk_live_`.

Set `VELO_ENV=development` when using the local Velo API. Each checkout request must specify `anchor` as `"inhouse"` or `"pdax"`; the server selects the corresponding API key before creating the SDK client.

For the Gas route, choose **Generate key → Gas Station · Testnet** on the project's API Keys page. Store the generated key as `VELO_GAS_API_KEY`; the example requires the `tg_test_[a-f0-9]{32}` format for this Gas-only Testnet credential. It cannot access Checkout or general project API endpoints. Set `VELO_GAS_DEMO_TOKEN` to a long random value for trusted server-to-server or terminal calls. Gas has separate `VELO_GAS_ENV` and `VELO_GAS_BASE_URL` settings so it does not change the Checkout environment. The default Gas environment is `testnet`; with no Gas base URL, the SDK uses its canonical Testnet API. An explicit Testnet base URL must be exactly `https://api.testnet.velo.pay`. For local work, set `VELO_GAS_ENV=development` and use only a loopback `VELO_GAS_BASE_URL`. The Gas route rejects `production` configuration and Mainnet API origins.

2. Run the application:

```bash
pnpm install
pnpm dev
```

The server will be running on `http://localhost:3001`.

## Gas sponsorship

`POST /api/gas` accepts exactly `{ "operationId": "...", "transactionXdr": "..." }`. The calling dApp must have its user sign the inner Stellar transaction first. The server keeps the Velo API key private, then uses `velo.gas.sponsorAndSubmit` with a stable idempotency key. It waits briefly for settlement and, if the submission response is uncertain, checks status with only the returned request ID and transaction hash. Responses expose only the operation ID, execution status, actual fee, and reconciliation flag.

The route checks a bearer demo token before reading the body, limits JSON input to 64 KiB, returns fixed redacted errors, and marks responses `no-store`. Treat the demo token as server-to-server/test tooling only. For a browser-facing app, replace that token check with the app's authenticated user session; never embed the demo token or Gas API key in frontend code. The managed Testnet relayer must already be funded, active, and allow the target contract.

Example trusted caller:

```bash
curl http://localhost:3001/api/gas \
  -H 'Authorization: Bearer YOUR_VELO_GAS_DEMO_TOKEN' \
  -H 'Content-Type: application/json' \
  --data '{"operationId":"order-1001","transactionXdr":"USER_SIGNED_TESTNET_XDR"}'
```

## Key Integration Details

- **Checkout Creation**: Defined in [server.ts](./server.ts), utilizing the `velo.checkout.sessions.create` method with a dedicated In-house or PDAX API key.
- **Gas Sponsorship**: Defined in [gas-route.ts](./gas-route.ts) and mounted before the global JSON parser in [server.ts](./server.ts). The client API key remains server-side; uncertain submission recovery uses identity only.
- **Webhook Signature Verification**: Defined in [server.ts](./server.ts). The webhook endpoint captures the raw request body using `express.raw` and verifies it with `Velo.webhooks.verify`.
