# Velo SDK for Node.js (Alpha)

The official Velo SDK for Node.js and modern JavaScript environments.

> [!NOTE]
> This package is currently in **Alpha** (`0.1.0-alpha.2`) and is meant for server-side environments only.

## Installation

```bash
npm install @carts1024/velo-sdk
# or
pnpm add @carts1024/velo-sdk
# or
yarn add @carts1024/velo-sdk
```

## Getting Started

Initialize the client with your Velo API key:

```ts
import { Velo } from "@carts1024/velo-sdk";

const velo = new Velo({
  apiKey: process.env.VELO_API_KEY!,
  environment: "testnet", // 'production', 'testnet', or 'development'
  timeoutMs: 10_000, // total wall-clock budget across all attempts
  maxRetries: 2,
});
```

### Creating a Checkout Session

```ts
const { checkoutUrl, paymentIntentId } = await velo.checkout.sessions.create({
  amount: "10.00",
  asset: "USDC",
  description: "Order #1001",
  successUrl: "https://yourdomain.com/success",
  cancelUrl: "https://yourdomain.com/cancel",
});

// Redirect customer to the checkout URL
```

### Retrieving a Payment Intent

```ts
const paymentIntent = await velo.paymentIntents.retrieve("pi_12345");
console.log(`Payment status: ${paymentIntent.status}`);
```

### Reserving Gas sponsorship (unreleased source addition)

The current source checkout also exposes `velo.gas.sponsor()` for trusted
server code. This addition is not in the published `0.1.0-alpha.2` package;
the package version remains unchanged. Configure the deployed Velo URL
explicitly and keep the API key, caller authorization, signed XDR, and
operation key on the server:

```ts
import { Velo } from "@carts1024/velo-sdk";

const velo = new Velo({
  apiKey: process.env.VELO_API_KEY!,
  // Replace the SOW target with the verified deployment URL for your environment.
  baseUrl: process.env.VELO_BASE_URL ?? "https://www.velo-build.dev",
});

// Authorize the caller in your own server/session layer before this point.
// signedTransactionXdr is an existing user-signed Testnet Soroban invocation.
const reservation = await velo.gas.sponsor(signedTransactionXdr, {
  idempotencyKey: `checkout:${operationId}`, // caller-held and stable on recovery
});

console.log(reservation.requestId, reservation.reservedStroops);
```

Sponsorship reserves the project's fee exposure; it does not submit the
transaction or confirm ledger execution. Transient sponsorship failures use
the configured retry count and one total deadline, reusing the exact signed
XDR, serialized body, idempotency key, and correlation headers. Policy
denials (`daily_cap_exceeded` and `wallet_rate_limited`) are returned without
automatic retry. If sponsorship times out before an identity is returned,
retry the exact signed XDR with the same idempotency key to recover the
original reservation. Do not create or sign a new operation automatically.
Submission, status retrieval, and composed `sponsorAndSubmit()` workflows are
unreleased source additions; the published `0.1.0-alpha.2` package does not
include them.

### Submitting a sponsored transaction (unreleased source addition)

The current source checkout also exposes `velo.gas.submit()` for the trusted
server handoff. Keep the request ID and inner transaction hash from the
reservation before sending the original user-signed Testnet XDR:

```ts
const identity = {
  requestId: reservation.requestId,
  transactionHash: reservation.transactionHash, // inner transaction hash
};

const result = await velo.gas.submit(
  {
    ...identity,
    transactionXdr: signedTransactionXdr,
  },
  { correlationId: "checkout-operation-1001" },
);

if (result.status === "succeeded") {
  console.log(result.outerTransactionHash, result.actualFeeStroops);
} else {
  console.log(`Gas execution is ${result.status}`);
}
```

The SDK sends the XDR only during this handoff and never retries it
automatically, even when conflicting retry options are supplied. A running
result (`claimed`, `submission_unknown`, or `submitted`) is not a successful
transaction; `failed` and `cancelled` are terminal non-success results even
when the HTTP response is `200`.

### Manually recovering Gas status (unreleased source addition)

After a local timeout, disconnect, or cancellation, do not infer chain
cancellation and do not submit the XDR again. Recover with the identity saved
before handoff:

```ts
const status = await velo.gas.getStatus(identity);

console.log({
  status: status.status,
  innerHash: status.transactionHash,
  outerHash: status.outerTransactionHash,
  actualFeeStroops: status.actualFeeStroops, // null means unknown
});
```

`getStatus()` posts only `{ requestId, transactionHash }`, preserves the
inner/outer hash distinction, and returns the same six execution states. Keep
the identity as a safe recovery record; never persist the signed XDR, API key,
or relayer credentials in browser storage or logs. Bounded polling and
`sponsorAndSubmit()` composition are planned for later D3 sub-sprints.

### Gas errors and recovery

Gas errors preserve the server's stable code, HTTP status, validated request
ID, and `Retry-After` hint without exposing response bodies or arbitrary server
messages:

| Situation                                                                                            | SDK result                                                                                                   | Recovery                                                                             |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Authentication, whitelist, cap/quota, expiry, handoff, or provider error                             | Typed `VeloAuthError`, `VeloValidationError`, `VeloRateLimitError`, or `VeloProviderError`                   | Handle the stable `code`; do not treat it as a transaction outcome.                  |
| Transient sponsorship failure                                                                        | Automatic retry within `maxRetries` and the total `timeoutMs`                                                | Every retry uses the same caller-held idempotency key and exact input.               |
| Submission timeout, disconnect, local cancellation, or malformed success response after XDR dispatch | `VeloGasSubmissionUnknownError` with `reason` `timeout`, `network_error`, `cancelled`, or `invalid_response` | Call `velo.gas.getStatus(error.recovery)`; never submit the XDR again automatically. |
| Cancellation before a request is dispatched                                                          | The caller's existing `AbortSignal.reason`                                                                   | The request did not dispatch; callers may decide whether to retry.                   |

`VeloGasSubmissionUnknownError` extends `VeloSubmissionUnknownError`. Its
`recovery` contains only the normalized request ID and inner transaction hash;
it never contains the signed XDR, API key, response body, or exception cause.
An unknown local outcome does not mean the chain transaction was cancelled.

### Dual-Anchor Routing (V2)

Velo SDK (V2) supports routing payments through different anchors: `inhouse` (default) or `pdax`.

To request a specific anchor explicitly during checkout session creation, pass the optional `anchor` parameter:

```ts
const session = await velo.checkout.sessions.create({
  amount: "10.00",
  asset: "USDC",
  anchor: "pdax", // or "inhouse"
  description: "Dual-anchor payment",
  successUrl: "https://yourdomain.com/success",
  cancelUrl: "https://yourdomain.com/cancel",
});
```

API keys can be scoped to specific anchors. If an explicit `anchor` conflicts with the API key's scoped anchor, a `VeloValidationError` is thrown.

Retrieving or creating a payment intent in V2 returns the following anchor-aware response properties:

```ts
const intent = await velo.paymentIntents.retrieve("pi_12345");

console.log(intent.correlationId); // Durable Velo journey ID, when available
console.log(intent.anchor); // 'inhouse' | 'pdax'
console.log(intent.receiverAddress); // Destination wallet address (e.g. project owner or PDAX deposit address)
console.log(intent.receiverMemo); // String memo/tag if required (e.g. PDAX tag, else null)
console.log(intent.anchorDepositCurrency); // Mapped deposit currency (e.g. 'USDCXLM', else null)
console.log(intent.payerAddress); // Wallet address of the payer, populated after checkout flow
```

For PDAX, creation can return `status: "awaiting_route"` with `receiverAddress: null`. The hosted `checkoutUrl` waits automatically. Integrations that need destination fields directly should retrieve the intent until it becomes `created`; they must not construct a payment while it is `awaiting_route`.

---

## Webhook Verification

Velo signs webhook events sent to your endpoints using HMAC-SHA256. Webhook verification is required to verify that incoming payloads are authentic and untampered.

### Envelope version and event types

Current events use `version: "1"`. After HMAC verification, the SDK normalizes a legacy event with
no `version` to v1 and rejects an explicit unsupported version. Signature validation happens before
the unsupported-version error, preventing unauthenticated payloads from becoming a version oracle.
Evidence: [`verifyWebhookSignature normalizes a signed legacy event to version 1`](src/webhooks.test.ts)
and [`verifyWebhookSignature verifies HMAC before rejecting unsupported versions`](src/webhooks.test.ts).

The typed union includes payment, project, contract, transaction, settlement quote/trade/withdrawal,
and `provider.pdax.event.received` events. Settlement/provider shape validation is covered by
[`verifyWebhookSignature accepts settlement and provider event payloads`](src/webhooks.test.ts).

Delivery IDs represent durable, fenced deliveries. Consumers must still deduplicate by
`x-velo-delivery`: Velo provides **exactly-once observable transitions**, not exactly-once
transport. Invalid signatures fail closed, as covered by [`verifyWebhookSignature rejects signature mismatch`](src/webhooks.test.ts).

> [!IMPORTANT]
> Webhook signature verification requires the **raw, unparsed request body**. Do not parse the request body as JSON prior to calling verify.
>
> Your webhook signing secret (`VELO_WEBHOOK_SECRET`) must remain **server-side only**. Never expose it to the browser.

### Verification API

You can verify signatures using the static `Velo.webhooks.verify` method or an instance-level `velo.webhooks.verify` method:

```ts
const event = await Velo.webhooks.verify({
  payload: rawBody, // Raw string payload
  signature: signatureHeader, // 'x-velo-signature' header value
  secret: process.env.VELO_WEBHOOK_SECRET!, // Webhook signing secret
  toleranceSeconds: 300, // Optional clock drift tolerance (default 5 minutes)
});
```

`verify` will throw a `VeloWebhookSignatureVerificationError` (which extends `VeloValidationError`) if:

- The signature is missing or malformed.
- The timestamp is expired (older than `toleranceSeconds` or from the future).
- The computed signature does not match the header.

### Next.js App Router Example

```ts
import { NextResponse } from "next/server";
import { Velo } from "@carts1024/velo-sdk";

export async function POST(request: Request) {
  // 1. Get the raw text payload (DO NOT call request.json())
  const payload = await request.text();

  // 2. Get the signature header
  const signature = request.headers.get("x-velo-signature");
  const secret = process.env.VELO_WEBHOOK_SECRET!;

  try {
    // 3. Verify the signature
    const event = await Velo.webhooks.verify({
      payload,
      signature,
      secret,
    });

    // 4. Handle typed events
    switch (event.type) {
      case "payment.succeeded": {
        const paymentIntent = event.paymentIntent;
        console.log(`Payment succeeded for amount: ${paymentIntent.amount}`);
        break;
      }
      case "payment.failed": {
        console.log(`Payment failed: ${event.paymentIntent.id}`);
        break;
      }
      case "payment_access.activated": {
        console.log(`Project payment access activated!`);
        break;
      }
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Signature verification failed:", error);
    return new NextResponse("Webhook signature verification failed", { status: 400 });
  }
}
```

### Express.js Example

Ensure you capture the raw body as a string. You can use `express.raw` middleware for this specific route.

```ts
import express from "express";
import { Velo } from "@carts1024/velo-sdk";

const app = express();

app.post("/webhooks", express.raw({ type: "application/json" }), async (req, res) => {
  // 1. Get raw string payload
  const payload = req.body.toString("utf8");

  // 2. Get the signature header
  const signature = req.headers["x-velo-signature"];
  const secret = process.env.VELO_WEBHOOK_SECRET!;

  try {
    // 3. Verify signature
    const event = await Velo.webhooks.verify({
      payload,
      signature: Array.isArray(signature) ? signature[0] : signature || null,
      secret,
    });

    // 4. Handle events
    if (event.type === "payment.succeeded") {
      console.log(`Payment succeeded: ${event.paymentIntent.id}`);
    }

    res.status(200).send("OK");
  } catch (error) {
    console.error("Signature verification failed:", error);
    res.status(400).send("Webhook signature verification failed");
  }
});
```

---

## Environment Variables

Configure the following environment variables in your server environments:

| Variable              | Required          | Description                                                                                                                                                                               |
| --------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VELO_API_KEY`        | **Yes**           | Your Velo project API key (e.g. `tk_live_...` or `tk_test_...`).                                                                                                                          |
| `VELO_WEBHOOK_SECRET` | Only for Webhooks | Used to verify signature of incoming webhook events.                                                                                                                                      |
| `VELO_BASE_URL`       | No                | Overrides the default Velo API endpoint. SDK defaults are `https://api.velo.pay` for production, `https://api.testnet.velo.pay` for testnet, and `http://localhost:3000` for development. |

---

## Idempotency

To prevent double-charging or duplicate session creation due to network retries, pass an `idempotencyKey` in the `RequestOptions` object as the second parameter:

```ts
const session = await velo.checkout.sessions.create(
  {
    amount: "10.00",
    asset: "USDC",
    description: "Order #1001",
  },
  {
    idempotencyKey: "unique-order-id-1001", // Prevents duplicates
  },
);
```

## Bounded transport and retries

Every SDK request has a total wall-clock deadline (`timeoutMs`, default 30 seconds) and accepts
an `AbortSignal` and opaque correlation ID through `RequestOptions`:

```ts
const controller = new AbortController();
const intent = await velo.paymentIntents.retrieve("pi_123", {
  signal: controller.signal,
  correlationId: "order-2026-0001",
  traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
});
```

`correlationId` becomes `X-Correlation-Id` for the current request. `traceparent` is an optional W3C trace context value propagated to Velo and supported downstream dependencies. A returned payment intent can also contain its durable journey `correlationId`; keep that value for journey lookup rather than replacing it with a later retry's request ID.

Only safe reads, or explicitly idempotent writes with an `idempotencyKey`, are retried. Retry
delays use capped jitter and honor `Retry-After`; creation is never retried without an idempotency
key. A submission request marked `{ submission: true }` is never retried and throws
`VeloSubmissionUnknownError` when the network outcome cannot be determined, so callers can
reconcile by transaction hash. `VeloTimeoutError`, `VeloRateLimitError`, `VeloProviderError`,
and `VeloValidationError` are exported for typed handling. Caller-initiated cancellation preserves
the caller's `AbortSignal.reason`, so cancellation may surface as a native abort reason rather than
an SDK-wrapped error.

The package uses the runtime's global `fetch`. Node 18+, serverless, edge, and browsers provide
different connection-pooling behavior; the SDK sets no agent-specific pool and cannot make a
browser share connections across origins. Keep API keys server-side and set a deadline below the
hosting platform's function deadline.

Idempotency keys are scoped to your project. Repeating a request with the same payload and same key will return the cached original response. Repeating with a different payload will throw a `VeloAPIError` with status code `409` (conflict).

### Migration notes for alpha.2 transport

- Add an `idempotencyKey` to checkout/session creation before relying on automatic retries.
- Pass `correlationId` from your order or request context when you need to join SDK calls with Velo API and webhook logs.
- Pass `traceparent` when your service already has a W3C trace and you want Velo calls to participate in it.
- Set `timeoutMs` below your serverless or API-route deadline; the SDK budget includes retries and retry waits.
- Treat `VeloSubmissionUnknownError` as "check by transaction hash / intent state" rather than "submit again."
- For webhook consumers, continue deduplicating deliveries by `x-velo-delivery` and verifying `x-velo-signature` with the raw request body.

Sprint 8 webhook evidence is deterministic and automated. It is not live SLO qualification or
production availability evidence.

---

## Testnet vs Mainnet & Alpha Limitations

> [!WARNING]
> This SDK is currently in **Alpha** (`0.1.0-alpha.2`) and subject to changes.
>
> - **Stellar Testnet Only**: During the alpha phase, all transactions and checkout sessions are routed through the Stellar Testnet. Mainnet is currently unsupported.
> - **ESM-Only**: The package uses ESM exports and requires `"type": "module"` or an ESM-compatible bundler/environment. CommonJS `require()` is not supported directly.
> - **Server-Side Only**: The SDK initializes and communicates using highly sensitive API keys and secrets. Do **NOT** use this SDK in browser environments or client-side code as it will leak your API credentials.
> - **Browser Limitations**: Direct wallet connection, browser-based payment tracking, and front-end React components are excluded from the current alpha release.
