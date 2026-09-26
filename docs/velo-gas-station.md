# Adding Gasless Transactions to your Stellar dApp

Velo Gas Station lets an application submit an eligible, user-signed Stellar
Testnet Soroban transaction without requiring the user wallet to pay the
network fee. The user still controls and signs the inner transaction. Velo's
relayer supplies the fee source, submits the transaction, and reports the
execution result.

This D4 guide extends the SDK request and recovery guidance in the
[D3 Gas integration guide](instawards/Velo-Instawards-Deliverable-3-Integration-Guide.md)
with managed relayer setup, owner funding and activation, and account
management. The guide describes workspace source behavior and does not claim
package publication, production deployment, or live Testnet acceptance.

This guide is for integrators using the server-side
<code>@carts1024/velo-sdk</code>. It describes the current workspace source
(manifest version <code>0.1.0-alpha.3</code>); publication status has not been
verified. Use a build that includes the Gas methods shown below.

## Architecture

~~~mermaid
sequenceDiagram
    participant Browser
    participant Wallet
    participant App as Integrator server
    participant Velo
    participant Stellar as Stellar Testnet

    Browser->>Wallet: Request signature for unsigned Soroban XDR
    Wallet-->>Browser: Signed inner transaction XDR
    Browser->>App: operationId + signed XDR
    App->>Velo: sponsorAndSubmit()
    Velo->>Velo: Check API key, policy, quota, allowlist
    Velo->>Stellar: Submit relayer FeeBump
    Stellar-->>Velo: Ledger result and fee evidence
    Velo-->>App: status, inner/outer hashes, actual fee
    App-->>Browser: Safe result projection
~~~

The SDK is a server boundary over Velo HTTP routes. It does not connect
directly to Convex and it does not replace the user's wallet.

## Before you integrate

Open the project console at <code>/projects/&lt;projectId&gt;/gas</code>.
Newly created projects use a Velo-managed Testnet relayer. Project creation
queues provisioning; a funding address is shown only after its encrypted
signing key has been committed to private Convex custody. If setup fails, the
owner can retry after the deployment's Testnet provisioning feature is enabled.

An owner then:

1. Funds the displayed public address with **Fund with wallet** or requests
   Testnet XLM with **Get Testnet funds**. Wallet funding creates an absent
   account or pays an existing one; faucet requests use the fixed Testnet
   endpoint and project cooldown.
2. Checks the verified, fresh balance and spendable amount after account
   reserves, liabilities, existing Gas commitments, and fees.
3. Reviews the suggested limit of **10 XLM/day**, the limit of **100 requests
   per wallet per UTC hour**, and the project's active linked contracts.
4. Explicitly enables sponsorship. There must be at least one active linked
   contract; otherwise sponsorship stays disabled. Pause and resume are owner
   controls.

Withdrawals require an expiring, single-use wallet-signed consent that binds
the destination to the authenticated owner. Velo pauses sponsorship, waits for
outstanding commitments to resolve, preserves account reserves and fees, and
then sends the withdrawal. Completed withdrawal leaves sponsorship paused
until the owner resumes it.

Velo-managed custody means the trusted backend can decrypt each relayer key.
Plaintext secrets are not persisted; the deployment stores only authenticated
ciphertext and metadata. Development and production use separate encryption
keyrings held in Convex environment variables. Back up every key version
securely and keep old versions during rotation until all records have been
verified. Loss of all applicable key versions means loss of access to those
accounts. See [ADR-0005](obsidian/decisions/ADR-0005-Managed-Testnet-Relayer-Custody.md)
for the custody limits, backup, and rotation procedure.

Existing manually configured relayers remain supported. Owners can continue to
manage their public relayer metadata and operators can retain the legacy
<code>VELO_GAS_TESTNET_RELAYER_SIGNERS_JSON</code> signer configuration for
those accounts. Managed custody never falls back to that registry after a
decryption failure and does not silently replace an existing account. Never
enter a secret key in the dashboard.

| Role | Gas Station capability |
| --- | --- |
| Viewer | Read policy, relayer status, telemetry, and activity. |
| Editor | Read Gas data and save policy changes. |
| Owner | Provision/retry, fund, activate, pause/resume, and withdraw; also has editor access. |

A displayed balance is a verified ledger snapshot, not proof of signer
readiness. A snapshot older than five minutes is stale. Owners retain access to
withdraw funds from retired projects through the authenticated relayer-funds
view.

## Install and configure the SDK

The SDK is ESM-only and requires Node.js 18 or newer. The workspace manifest is
version <code>0.1.0-alpha.3</code>; publication status is unverified. Confirm
that the artifact you install includes the Gas methods before using this guide.
Configure these values only in the server, worker, or serverless function
environment:

~~~dotenv
VELO_GAS_API_KEY=tg_test_0123456789abcdef0123456789abcdef
VELO_BASE_URL=https://api.testnet.velo.pay
~~~

Generate this credential from the project's **Gas Station · Testnet** API-key
option. Its `tg_test_` prefix is scoped to Gas endpoints; a general project API
key is not authorized for sponsorship.

~~~ts
import { Velo } from "@carts1024/velo-sdk";

const velo = new Velo({
  apiKey: process.env.VELO_GAS_API_KEY!,
  baseUrl: process.env.VELO_BASE_URL!,
  environment: "testnet",
  timeoutMs: 30_000,
  maxRetries: 2,
});
~~~

The example flow is restricted to Testnet. Omit <code>VELO_BASE_URL</code> to
use the SDK's canonical Testnet origin, or configure
<code>https://api.testnet.velo.pay</code>. For local development, use
<code>environment: "development"</code> and a loopback URL such as
<code>http://localhost:3000</code>. The API origin and Stellar network must
still match the deployment's policy configuration.

## Build and sign the transaction

The application creates the unsigned Soroban invocation. The transaction must
be a user-signed, non-FeeBump Stellar Testnet envelope with exactly one
Soroban <code>invokeHostFunction</code> operation. Classic, mixed, unsigned,
multi-operation, and already FeeBump-wrapped envelopes are rejected by the Gas
boundary.

Signing remains a wallet operation. For example, a browser integration can use
Velo Wallets or another Stellar wallet:

~~~ts
const signedTransactionXdr = await wallet.signTransaction(unsignedTransactionXdr);

await fetch("/api/gas", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    operationId: "order-1001-gas",
    transactionXdr: signedTransactionXdr,
  }),
});
~~~

The browser should send the signed XDR to your own authenticated application
route. It should not instantiate <code>Velo</code> with a private API key.

## Sponsor and submit from your server

Use a caller-owned operation ID to derive a stable idempotency key. Store that
operation ID with your order or workflow record.

~~~ts
import { VeloGasSubmissionUnknownError } from "@carts1024/velo-sdk";

export async function sponsorGas(
  operationId: string,
  signedTransactionXdr: string,
) {
  // Authenticate the caller and authorize the project before this function.
  const result = await velo.gas.sponsorAndSubmit(signedTransactionXdr, {
    idempotencyKey: "my-app-gas:" + operationId,
    correlationId: "my-app-gas:" + operationId,
    timeoutMs: 30_000,
  });

  return {
    operationId,
    status: result.status,
    requestId: result.requestId,
    transactionHash: result.transactionHash,
    outerTransactionHash: result.outerTransactionHash,
    actualFeeStroops: result.actualFeeStroops,
  };
}
~~~

If the handoff crosses the network boundary and the local result is unknown,
the SDK throws <code>VeloGasSubmissionUnknownError</code>. Persist only its
recovery identity and reconcile by status:

~~~ts
import { VeloGasSubmissionUnknownError } from "@carts1024/velo-sdk";

try {
  return await sponsorGas(operationId, signedTransactionXdr);
} catch (error) {
  if (error instanceof VeloGasSubmissionUnknownError) {
    // Persist error.recovery with operationId. It contains no XDR or secret.
    return await velo.gas.getStatus(error.recovery);
  }
  throw error;
}
~~~

Never submit the same signed XDR again after a dispatch-uncertain error.
Reusing the identity is replay-safe; creating a new operation is not.

## SDK Gas API

The SDK maps to two unversioned Velo routes. Most integrators should use the
SDK methods instead of calling these routes directly:

| SDK operation | HTTP route | Request behavior |
| --- | --- | --- |
| `sponsor()` | `POST /api/gas/sponsor` | Sends the signed XDR and requires `Idempotency-Key`. |
| `submit()` | `POST /api/gas/submit` | Sends the reservation identity and signed XDR once. |
| `getStatus()` | `POST /api/gas/submit` | Sends only the reservation identity; no XDR. |

The SDK validates response shapes and normalizes hashes, addresses, fees, and
expiry values before returning them to the caller.

### sponsor(transactionXdr, options)

Reserves fee exposure without submitting. <code>options.idempotencyKey</code>
is required. The returned reservation contains the request ID, inner
transaction hash, source wallet, target contract IDs, maximum and reserved
fee in stroops, and expiry.

If sponsorship times out before a reservation is returned, repeat the exact
signed XDR with the same idempotency key to recover the original reservation.
Do not create or sign a replacement transaction automatically.

### submit(params, options)

Submits the original signed XDR for a reservation:

~~~ts
const reservation = await velo.gas.sponsor(signedTransactionXdr, {
  idempotencyKey: "my-app-gas:" + operationId,
});

const result = await velo.gas.submit({
  requestId: reservation.requestId,
  transactionHash: reservation.transactionHash,
  transactionXdr: signedTransactionXdr,
});
~~~

The SDK sends the XDR only during this handoff and does not automatically
retry it. Prefer <code>sponsorAndSubmit()</code> unless separate reservation
and handoff steps are required by your workflow.

### getStatus(identity, options)

Status recovery sends only the identity:

~~~ts
const result = await velo.gas.getStatus({
  requestId,
  transactionHash, // inner transaction hash
});
~~~

It never sends the signed XDR. The <code>outerTransactionHash</code> is the
relayer FeeBump hash and is distinct from the inner
<code>transactionHash</code>.

### waitForResult(identity, options)

<code>waitForResult()</code> is an optional, bounded observer built from
repeated identity-only status calls:

~~~ts
const result = await velo.gas.waitForResult(identity, {
  timeoutMs: 30_000,
  maxAttempts: 10,
  initialDelayMs: 500,
  maxDelayMs: 5_000,
});
~~~

It never sponsors, submits, cancels, or changes backend reconciliation. A local
timeout or cancellation stops observation only.

## Status and fee semantics

Only <code>succeeded</code> means the transaction succeeded.

| Status | Meaning |
| --- | --- |
| <code>claimed</code> | The backend claimed the execution attempt. |
| <code>submission_unknown</code> | The send result is uncertain; reconcile by identity. |
| <code>submitted</code> | The relayer handoff was accepted, but final ledger settlement is not yet proven. |
| <code>succeeded</code> | Trusted ledger evidence was reconciled. |
| <code>failed</code> | Terminal non-success result. |
| <code>cancelled</code> | Terminal non-success result. |

<code>actualFeeStroops</code> is a canonical decimal string when trusted
actual-fee evidence is available. <code>null</code> means unknown; it does not
mean zero. Keep the request ID, inner hash, outer hash, status, exact fee, and
reconciliation flag in your server-side operation record.

## Policy denials and retries

The Gas policy can reject before execution:

- <code>contract_not_whitelisted</code>: the transaction target is not allowlisted.
- <code>daily_cap_exceeded</code>: the project's daily reserved exposure is exhausted.
- <code>wallet_rate_limited</code>: the wallet's hourly quota is exhausted.
- Disabled or missing policy.
- Unavailable or inactive relayer configuration.

Policy denials do not execute the transaction or reserve new exposure. Do not
automatically retry the daily-cap, wallet-quota, or allowlist denials. If the
sponsorship request has a transient transport failure, the SDK may retry
within its total deadline using the same idempotency key and exact signed XDR.

The SDK bounds signed XDR and request input. Keep the XDR under 64 KiB and the
idempotency key under 255 UTF-8 bytes.

Gas transport failures are exposed as typed SDK errors. Handle
<code>VeloAuthError</code> for authentication, <code>VeloValidationError</code>
for invalid input or policy validation, <code>VeloRateLimitError</code> for
rate limits, and <code>VeloProviderError</code> for upstream availability. A
bounded observer can throw <code>VeloGasWaitError</code>; resume with its safe
<code>recovery</code> identity. Do not infer a chain result from any transport
error.

## Security checklist

- Run the SDK only on a trusted server.
- Keep the API key, operator tokens, and signer secrets out of browser bundles,
  logs, and user-visible responses.
- Do not store signed XDR in browser storage or durable application records.
- Store only the operation ID and normalized recovery identity needed to
  reconcile.
- Authenticate the caller and authorize the project before reading or
  forwarding signed input.
- Bound the request body and return an allowlisted response projection.
- Treat an unknown handoff as unknown, never as cancellation or failure.
- Treat only <code>succeeded</code> as success and
  <code>actualFeeStroops: null</code> as unknown.

## Express server example

The repository's <code>examples/express</code> app implements
<code>POST /api/gas</code> in <code>gas-route.ts</code>. It accepts exactly an
operation ID and a user-signed <code>transactionXdr</code>, runs the bounded
raw-body parser before Express's global JSON parser, and authenticates its
bearer demo token before parsing the body. It keeps the Gas API key on the
server, derives a stable <code>express-gas:&lt;operationId&gt;</code>
idempotency key, and recovers uncertain sends using identity-only SDK calls.
Responses are <code>no-store</code> and expose only operation ID, status, actual
fee, and reconciliation state. Fixed errors do not include SDK/provider
details.

Set <code>VELO_GAS_API_KEY</code> and a separate random
<code>VELO_GAS_DEMO_TOKEN</code>. In the Express example, Gas uses the separate
<code>VELO_GAS_ENV=testnet</code> and optional
<code>VELO_GAS_BASE_URL</code> settings, so it does not change the Checkout
environment. With no Gas base URL, the SDK uses the canonical Testnet API
origin; an explicit origin may only be
<code>https://api.testnet.velo.pay</code>. Local development accepts only a
loopback origin when <code>VELO_GAS_ENV=development</code>, and rejects
production/Mainnet selection. The bearer token is for trusted terminal or
server-to-server use. Replace the example guard with your authenticated user
session before exposing the route to browser users; never put either server
secret in frontend code.

## Next.js App Router example

The <code>examples/nextjs-app-router</code> sample exposes the same bounded
workflow at <code>app/api/gas/route.ts</code>. Its Gas configuration is separate
from Checkout: set <code>VELO_GAS_API_KEY</code>,
<code>VELO_GAS_DEMO_TOKEN</code>, <code>VELO_GAS_ENV</code>, and
<code>VELO_GAS_BASE_URL</code>. The example accepts only the issued
<code>tg_test_[a-f0-9]{32}</code> key format and the canonical Testnet origin
<code>https://api.testnet.velo.pay</code>; local development must explicitly
select <code>VELO_GAS_ENV=development</code> and use a loopback origin. It
rejects other API origins rather than reusing Checkout's <code>VELO_BASE_URL</code>.

## Live validation

The repository includes a D3 harness for a compatible deployed web app and
Convex backend:

~~~bash
node --experimental-strip-types scripts/gas-d3-smoke.mjs --mode preflight

node --experimental-strip-types scripts/gas-d3-smoke.mjs \
  --mode execute \
  --output docs/instawards/Velo-Instawards-Deliverable-3-Smoke-Run.json

node --experimental-strip-types scripts/gas-d3-smoke.mjs \
  --mode verify \
  --report docs/instawards/Velo-Instawards-Deliverable-3-Smoke-Run.json
~~~

Preflight must verify Testnet identity, deployment provenance, funded user
and relayer accounts, enabled policy, and fresh distinct allowed and denied
transactions. Acceptance also requires the allowed receipt to be
<code>succeeded</code> with trusted fee evidence, matching inner and outer
hashes, unchanged same-identity replay accounting, and a fresh whitelist
denial with no execution or reserved exposure.

The full deployment, reviewer-access, dashboard-evidence, and handoff
procedure is in the
[D3 live validation runbook](instawards/Velo-Instawards-Deliverable-3-Live-Validation-and-Handoff-Runbook.md).
