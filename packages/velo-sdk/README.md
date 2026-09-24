# Velo SDK for Node.js (Alpha)

The official Velo SDK for Node.js and modern JavaScript environments.

> [!NOTE]
> This package is currently in **Alpha** (`0.1.0-alpha.3`) and is meant for server-side environments only.

## Installation

```bash
npm install @carts1024/velo-sdk@alpha
# or
pnpm add @carts1024/velo-sdk@alpha
# or
yarn add @carts1024/velo-sdk@alpha
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

### Reserving Gas sponsorship

`velo.gas.sponsor()` reserves fee exposure for a user-signed Testnet Soroban
transaction. It is included in `0.1.0-alpha.3`. Gas Station is an alpha
Testnet feature; configure the deployed Velo URL explicitly and keep the API
key, caller authorization, signed XDR, and operation key on the server:

```ts
import { Velo } from "@carts1024/velo-sdk";

const velo = new Velo({
  apiKey: process.env.VELO_API_KEY!,
  // Set the verified Velo deployment URL for your environment.
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
Submission, status retrieval, composed `sponsorAndSubmit()`, and bounded
`waitForResult()` are also included in this release.

### Composing sponsorship and submission

`sponsorAndSubmit()` is a server-only convenience for a trusted application
server that already has the user's signed Testnet Soroban XDR. Its exact
signature is:

```ts
sponsorAndSubmit(
  transactionXdr: string,
  options: GasSponsorOptions,
): Promise<GasSubmitResult>
```

The caller must provide a stable idempotency key. The SDK snapshots the
normalized XDR and request context, establishes one deadline for sponsorship
and handoff, reuses the reservation identity, and calls submit at most once.
Keep the API key, signed XDR, and operation key in server-only code; do not
call this method from browser code or expose those values in a client response.

```ts
const result = await velo.gas.sponsorAndSubmit(signedTransactionXdr, {
  idempotencyKey: `checkout:${operationId}`,
  correlationId: `checkout:${operationId}`,
});

if (result.status === "succeeded") {
  // Successful execution: the outer hash and actual fee are available when settled.
  console.log(result.outerTransactionHash, result.actualFeeStroops);
} else {
  // `claimed`, `submission_unknown`, and `submitted` are still running.
  // `failed` and `cancelled` are terminal non-success results.
  console.log(`Gas execution is ${result.status}`);
}
```

Only `status: "succeeded"` indicates success. The helper returns the first
validated submission DTO and does not wait for ledger settlement. Use
`waitForResult()` when the server-side caller wants bounded observation.

### Submitting a sponsored transaction

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

### Manually recovering Gas status

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
or relayer credentials in browser storage or logs.

### Bounded Gas result observation

`waitForResult()` is an opt-in, server-side observer built on repeated
identity-only `getStatus()` calls:

```ts
const result = await velo.gas.waitForResult(identity, {
  timeoutMs: 30_000, // total wait budget; defaults to the SDK timeout
  maxAttempts: 10, // status calls, including transient failures
  initialDelayMs: 500, // first backoff delay
  maxDelayMs: 5_000, // exponential delay cap
  signal: request.signal, // optional caller cancellation
  correlationId: operationId,
});

if (result.status === "succeeded") {
  console.log(result.outerTransactionHash, result.actualFeeStroops);
}
```

`GasWaitOptions` is `RequestOptions` without `maxRetries` or `submission`,
plus the optional `maxAttempts`, `initialDelayMs`, and `maxDelayMs` limits.
The defaults are 10 calls, 500 ms initial delay, and a 5-second cap. Limits
must be positive safe integers, timer durations must fit JavaScript's
supported timer range, and `maxDelayMs` must be at least `initialDelayMs`.
Each call receives only the remaining total budget. Network failures, request
timeouts, HTTP 408, transient 429, and 5xx responses may be retried by the
observer; authentication, validation, policy-denial (including
`daily_cap_exceeded` and `wallet_rate_limited`), and malformed-response errors
are returned immediately. A valid `Retry-After` is treated as a minimum delay.

The observer stops immediately on `succeeded`, `failed`, or `cancelled`; only
`succeeded` is transaction success. If the budget or attempt limit is reached,
it returns the last validated DTO when one exists, including nullable fee
fields. Otherwise it throws `VeloGasWaitError` with reason `timeout` or
`attempts_exhausted`. Cancellation always throws that error with reason
`cancelled`. Its safe `recovery` contains only the normalized request ID and
inner transaction hash, so a trusted server can resume without the XDR:

```ts
import { VeloGasWaitError } from "@carts1024/velo-sdk";

try {
  const result = await velo.gas.waitForResult(identity, {
    timeoutMs: 5_000,
    signal: request.signal,
  });
  console.log(result.status);
} catch (error) {
  if (error instanceof VeloGasWaitError) {
    const resumed = await velo.gas.waitForResult(error.recovery, {
      timeoutMs: 30_000,
      correlationId: operationId,
    });
    console.log(resumed.status);
  } else {
    throw error;
  }
}
```

Local wait expiry or cancellation stops SDK observation only. It does not
expire the backend reservation, cancel a chain transaction, or change backend
reconciliation; those lifecycle decisions remain independent.

If submission crosses the transport boundary but the local result is unknown,
recover with the identity carried by the typed error. Do not submit the XDR a
second time:

```ts
import { VeloGasSubmissionUnknownError } from "@carts1024/velo-sdk";

try {
  await velo.gas.sponsorAndSubmit(signedTransactionXdr, {
    idempotencyKey: `checkout:${operationId}`,
  });
} catch (error) {
  if (error instanceof VeloGasSubmissionUnknownError) {
    const recovered = await velo.gas.getStatus(error.recovery);
    console.log(recovered.status, recovered.outerTransactionHash);
  } else {
    throw error;
  }
}
```

### Gas errors and recovery

Gas errors preserve the server's stable code, HTTP status, validated request
ID, and `Retry-After` hint without exposing response bodies or arbitrary server
messages:

| Situation                                                                                            | SDK result                                                                                                   | Recovery                                                                              |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Authentication, whitelist, cap/quota, expiry, handoff, or provider error                             | Typed `VeloAuthError`, `VeloValidationError`, `VeloRateLimitError`, or `VeloProviderError`                   | Handle the stable `code`; do not treat it as a transaction outcome.                   |
| Transient sponsorship failure                                                                        | Automatic retry within `maxRetries` and the total `timeoutMs`                                                | Every retry uses the same caller-held idempotency key and exact input.                |
| Submission timeout, disconnect, local cancellation, or malformed success response after XDR dispatch | `VeloGasSubmissionUnknownError` with `reason` `timeout`, `network_error`, `cancelled`, or `invalid_response` | Call `velo.gas.getStatus(error.recovery)`; never submit the XDR again automatically.  |
| Cancellation before a request is dispatched                                                          | The caller's existing `AbortSignal.reason`                                                                   | The request did not dispatch; callers may decide whether to retry.                    |
| Bounded observation deadline or attempt exhaustion                                                   | Last validated `GasSubmitResult`, or `VeloGasWaitError` with `reason` `timeout`/`attempts_exhausted`         | Resume with `waitForResult(error.recovery)` when no DTO was returned.                 |
| Bounded observation cancellation                                                                     | `VeloGasWaitError` with `reason` `cancelled` and safe `recovery` identity                                    | Resume with `waitForResult(error.recovery)`; no sponsorship or XDR submission occurs. |

`VeloGasSubmissionUnknownError` extends `VeloSubmissionUnknownError`. Its
`recovery` contains only the normalized request ID and inner transaction hash;
it never contains the signed XDR, API key, response body, or exception cause.
An unknown local outcome does not mean the chain transaction was cancelled.
`VeloGasWaitError` follows the same redaction boundary for observation recovery;
its fixed messages never include abort reasons, raw exceptions, credentials,
or XDR. Local observation expiry/cancellation is not backend reservation
expiry or reconciliation.

### Dashboard Gas Station guidance

The Velo project integration page provides two copyable, server-side snippets:
one for `sponsorAndSubmit()` and one for identity-only status recovery. The
snippets are maintained in `apps/web/features/projects/project-integration-guidance.ts`
and covered by `apps/web/features/projects/project-integration-guidance.test.ts`.

Set both variables explicitly in the consuming server environment:

```bash
VELO_GAS_API_KEY=replace_with_a_gas_scoped_project_key
VELO_BASE_URL=https://replace-with-your-velo-deployment.example
```

The snippets never interpolate project-page API-key data into client code.
The caller owns the stable operation ID and derives a stable idempotency key
from it. Authorization and durable operation/recovery storage belong to the
consuming server. On `VeloGasSubmissionUnknownError`, persist and reconcile
`error.recovery` with `velo.gas.getStatus()`; do not send the signed XDR again.
`waitForResult()` is an optional bounded identity-only observer.

Only `succeeded` is success. `claimed`, `submission_unknown`, and
`submitted` remain unresolved; `failed` and `cancelled` are terminal
non-success results. `actualFeeStroops: null` remains unknown.

The executable Next.js App Router Gas example in `examples/nextjs-app-router/`
contains the full route, streamed-input bound, and redacted response pattern.
Its bearer token is a local demo caller guard, not production authentication;
the example has no durable operation store or later status endpoint. The
`docs/instawards/Velo-Instawards-Deliverable-3-Integration-Guide.md` has
workspace setup and recovery guidance.

The package is published as ESM JavaScript with TypeScript declarations. The
Gas Station methods are Testnet-only during alpha and require an authorized
project API key on a trusted server.

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
The SDK test suite covers legacy normalization and unsupported-version handling after signature
verification.

The typed union includes payment, project, contract, transaction, settlement quote/trade/withdrawal,
and `provider.pdax.event.received` events. The SDK test suite covers settlement and provider event
shape validation.

Delivery IDs represent durable, fenced deliveries. Consumers must still deduplicate by
`x-velo-delivery`: Velo provides **exactly-once observable transitions**, not exactly-once
transport. Invalid signatures fail closed.

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
> This SDK is currently in **Alpha** (`0.1.0-alpha.3`) and subject to changes.
>
> - **Stellar Testnet Only**: During the alpha phase, all transactions and checkout sessions are routed through the Stellar Testnet. Mainnet is currently unsupported.
> - **ESM-Only**: The package uses ESM exports and requires `"type": "module"` or an ESM-compatible bundler/environment. CommonJS `require()` is not supported directly.
> - **Server-Side Only**: The SDK initializes and communicates using highly sensitive API keys and secrets. Do **NOT** use this SDK in browser environments or client-side code as it will leak your API credentials.
> - **Browser Limitations**: Direct wallet connection, browser-based payment tracking, and front-end React components are excluded from the current alpha release.
