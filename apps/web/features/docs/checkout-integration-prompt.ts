export const checkoutPromptSdkExamples = {
  initialize: `import {
  Velo,
  type PaymentIntent,
  type PaymentIntentStatus,
  type VeloConfig,
  type WebhookEvent,
} from "@carts1024/velo-sdk";

const config: VeloConfig = {
  apiKey: process.env.VELO_API_KEY!,
  baseUrl: process.env.VELO_BASE_URL!,
  environment: "testnet",
};

const velo = new Velo(config);`,
  createSession: `type TrustedOrder = {
  id: string;
  amount: string;
  asset: string;
  description: string;
  successUrl: string;
  cancelUrl: string;
};

type CheckoutAttempt = { id: string; idempotencyKey: string };
type CheckoutAttemptStore = {
  attachPaymentIntent(input: {
    orderId: string;
    attemptId: string;
    paymentIntentId: string;
    status: PaymentIntentStatus;
    expiresAt: string;
  }): Promise<void>;
};

export async function createCheckoutForAttempt(
  trustedOrder: TrustedOrder,
  checkoutAttempt: CheckoutAttempt,
  checkoutAttempts: CheckoutAttemptStore,
): Promise<{
  paymentIntentId: string;
  status: PaymentIntentStatus;
  checkoutUrl: string | null;
}> {
  // Load this already-persisted attempt for the authorized order before dispatch.
  const session: PaymentIntent = await velo.checkout.sessions.create(
    {
      amount: trustedOrder.amount,
      asset: trustedOrder.asset,
      description: trustedOrder.description,
      successUrl: trustedOrder.successUrl,
      cancelUrl: trustedOrder.cancelUrl,
    },
    { idempotencyKey: checkoutAttempt.idempotencyKey },
  );

  await checkoutAttempts.attachPaymentIntent({
    orderId: trustedOrder.id,
    attemptId: checkoutAttempt.id,
    paymentIntentId: session.paymentIntentId,
    status: session.status,
    expiresAt: session.expiresAt,
  });

  // Let the existing server route handle a null checkoutUrl without redirecting.
  return {
    paymentIntentId: session.paymentIntentId,
    status: session.status,
    checkoutUrl: session.checkoutUrl,
  };
}`,
  retrievePaymentIntent: `declare const paymentIntentId: string;

const intent: PaymentIntent = await velo.paymentIntents.retrieve(paymentIntentId);
const status: PaymentIntentStatus = intent.status;

switch (status) {
  case "awaiting_route":
  case "created":
  case "pending":
    console.info("Payment is not confirmed yet", status);
    break;
  case "paid":
    console.info("Velo reports a ledger-verified payment");
    break;
  case "failed":
  case "expired":
  case "cancelled":
    console.info("Do not fulfill this order", status);
    break;
}`,
  verifyWebhook: `export async function verifyCheckoutWebhook(
  rawBody: string,
  signature: string | null,
): Promise<WebhookEvent> {
  return Velo.webhooks.verify({
    payload: rawBody,
    signature,
    secret: process.env.VELO_WEBHOOK_SECRET!,
  });
}`,
} as const;

export const checkoutIntegrationPrompt = `# Integrate Velo Checkout Sessions into this project

You are modifying an existing application. First inspect the project and its instructions, then implement a complete, secure Velo Checkout Sessions integration that fits its current architecture. Keep this prompt self-contained; the repository links at the end are supplementary reading.

## 1. Inspect the consumer project before changing it

- Read the repository's \`AGENTS.md\` files, README, package/workspace manifests, and the instructions for the relevant application area.
- Identify its framework, package manager, Node.js version and server runtime, module format, authentication and authorization model, order and payment persistence, existing server routes/services, deployment configuration, and tests.
- Trace how trusted order data is loaded, how the buyer is authorized to start checkout, where success/cancel redirects come from, and how payment confirmation currently reaches fulfillment.
- Reuse existing routes, validation, session, logging, persistence, job, and test patterns. Explain the implementation plan and any unmet prerequisites. Seek a product decision before adding server infrastructure to a browser-only project or changing an incompatible runtime/deployment architecture.

## 2. Understand the payment boundary

\`velo.checkout.sessions.create()\` creates a Velo PaymentIntent and returns a hosted checkout URL when one is available. The buyer follows that URL and uses their wallet to review and sign the Stellar payment; Velo hosts the buyer's wallet interaction. The merchant server still owns the order, its access rules, and fulfillment. Velo confirms a payment only after trusted backend ledger verification. A success redirect, browser callback, client-submitted PaymentIntent ID, or transaction hash is not proof of payment.

## 3. Verify project, network, asset, and webhook prerequisites

Check and report each item before claiming the integration is ready:

- The Velo project is configured for Stellar Testnet and its payment access is activated. The selected project API key is valid for payment intents and compatible with the chosen anchor; confirm the key's scope rather than guessing.
- The configured \`VELO_BASE_URL\` points to the deployed Velo API for the intended environment. An SDK environment option or URL alone does not prove project activation or network readiness.
- The buyer's Testnet wallet has enough Testnet funds for the payment and network fee. For an issued asset, the buyer must also have the applicable asset trustline; native XLM has no issuer trustline. Confirm the exact asset code/issuer and Testnet support instead of assuming every wallet can pay every asset.
- A reachable merchant webhook endpoint is configured for the relevant payment events, and its signing secret is available to the server as \`VELO_WEBHOOK_SECRET\`. Confirm production HTTPS and deployment reachability using the host project's process.
- **Optional PDAX routing:** use this only if the merchant intentionally selects the PDAX anchor. Verify the Velo project's PDAX route is enabled, the API key is compatible with that anchor, and the required PDAX UAT/business onboarding and destination configuration are complete with the responsible operator. Report operator-owned gaps separately. PDAX is not a prerequisite for an in-house checkout; do not invent credentials or ask the integrator to expose them.

## 4. Verify and install the compatible SDK

- Use the project's package manager and Node.js 18 or newer. The Velo SDK is server-side and ESM-compatible; keep its imports in Node.js server code and do not bundle it into browser code.
- Before adding a dependency, inspect the exact selected published \`@carts1024/velo-sdk\` release, package exports, README, and changelog. Verify that this release actually exports \`Velo\`, \`velo.checkout.sessions.create()\`, \`velo.paymentIntents.retrieve()\`, and \`Velo.webhooks.verify()\`. Do not infer support from a mutable \`latest\` or \`alpha\` tag or from the repository source alone.
- Install the verified version with the existing package manager, for example \`pnpm add @carts1024/velo-sdk\`, \`npm install @carts1024/velo-sdk\`, or \`yarn add @carts1024/velo-sdk\`. Record the selected version and confirm its exports after installation.
- If the published release or host runtime is incompatible, stop before wiring the application to unpublished source or adding a new service. Report the blocker and ask for the product decision needed to proceed.

## 5. Configure the trusted server client

Keep \`VELO_API_KEY\`, \`VELO_BASE_URL\`, and \`VELO_WEBHOOK_SECRET\` in server-only environment configuration. Use placeholders in sample env files; never put real credentials in source, logs, browser responses, or client bundles. Validate required environment at server startup or through the host's established configuration pattern.

The following framework-neutral TypeScript examples use the SDK's exported types and methods. They are sequential parts of one server module, so later examples use the \`velo\` client and types imported above. Adapt them to the existing app rather than introducing a second web framework:

### Initialize the server SDK

\`\`\`ts
${checkoutPromptSdkExamples.initialize}
\`\`\`

## 6. Create a session from a trusted, durable order attempt

- Authenticate the caller and authorize ownership/access to the order before creating checkout. Derive amount, asset, description, order ownership, anchor, and success/cancel destinations from trusted server-side order and application configuration. Never trust these values from browser-submitted checkout fields. Validate redirect destinations against the application's own allowed origin/path policy.
- Before dispatching the SDK request, durably create or load a checkout-attempt record tied to the authorized order and owner. Persist a stable attempt identity/idempotency key and the exact normalized request inputs needed for recovery. Persist the PaymentIntent association as soon as the SDK response provides its ID, before returning a checkout URL to the buyer.
- Reuse the same idempotency key and identical inputs when recovering an uncertain request. Do not mint a new key simply because a request timed out or returned an ambiguous error. Treat an idempotency conflict as a recovery/data-consistency condition: load and reconcile the existing attempt, or surface it for investigation; do not silently create a second charge.
- \`checkoutUrl\` is nullable. Persist the PaymentIntent ID/status even when no URL is returned, and do not redirect to a missing URL. In \`awaiting_route\`, preserve the attempt and wait/retrieve according to the existing bounded server or hosted-checkout flow; do not fabricate receiver fields or initiate a payment. A \`pending\` payment is still unconfirmed.
- Handle expiry, buyer cancellation, validation/auth/provider errors, and idempotency conflicts as explicit order states using the host project's existing retry and error patterns. Do not fulfill on a redirect or let arbitrary errors expose credentials/provider response bodies.

### Create a checkout session

\`\`\`ts
${checkoutPromptSdkExamples.createSession}
\`\`\`

## 7. Retrieve and interpret PaymentIntent state

The current PaymentIntent status union has seven values: \`awaiting_route\`, \`created\`, \`pending\`, \`paid\`, \`failed\`, \`expired\`, and \`cancelled\`. Preserve all seven in host types and UI logic. Only the trusted \`paid\` status represents a Velo PaymentIntent confirmed through its ledger-verification flow. Keep pending states pending; failed, expired, and cancelled intents do not fulfill an order.

The event name \`payment.succeeded\` is a webhook event type, while \`paid\` is a PaymentIntent status value. They are related signals in different fields; do not compare one to the other or treat a browser redirect as either.

### Retrieve an intent

\`\`\`ts
${checkoutPromptSdkExamples.retrievePaymentIntent}
\`\`\`

## 8. Verify webhooks and fulfill durably

- Read the incoming request body as raw text/bytes before parsing JSON. Verify the \`x-velo-signature\` header with \`Velo.webhooks.verify()\` and the server-only \`VELO_WEBHOOK_SECRET\`. Reject invalid/missing signatures before processing payload fields.
- Read \`x-velo-delivery\` and deduplicate deliveries durably. Webhook transport may be retried or replayed; a repeated delivery must not create a second fulfillment.
- For a verified \`payment.succeeded\` event, match \`event.paymentIntent.id\` and project identity to the stored order/payment-attempt association. Validate the expected amount, asset, ownership, and current order state against trusted persisted data. Never let an event choose an unrelated order or overwrite a newer terminal state.
- Make fulfillment durable and idempotent. In one database transaction, record the delivery/confirmed payment and either apply an idempotent fulfillment or enqueue a durable outbox/job with a unique order/payment key. Acknowledge success only after durable processing or enqueueing has committed. If persistence/enqueueing fails, return a retryable failure so delivery can be retried.
- Ignore or explicitly handle unrelated event types. Do not fulfill based only on a client callback, redirect query, submitted hash, unverified webhook body, or an event whose payment/order association does not match.

### Verify the raw webhook body

\`\`\`ts
${checkoutPromptSdkExamples.verifyWebhook}
\`\`\`

After verification, perform the durable dedupe, association checks, and fulfillment enqueue described above using the host project's transaction/job patterns.

## 9. Test, document, and report

- Add host-project tests for caller/order authorization, trusted amount/asset/redirect derivation, attempt persistence before dispatch, same-key/same-input recovery, nullable URL and \`awaiting_route\` handling, pending and all terminal statuses, expiry/cancellation, API/idempotency errors, raw-body signature rejection, delivery deduplication, payment/order matching, and idempotent durable fulfillment. Use mocked SDK transport and persistence collaborators for deterministic tests.
- Document placeholder environment variables, how to configure the selected Testnet project/API key and webhook, the explicit deployed Velo URL, buyer asset/funding prerequisites, and any optional PDAX operator requirements.
- Run the host project's focused tests, type/lint checks, and build. Report missing setup or operator prerequisites. Clearly separate mocked verification from live Testnet evidence; do not claim a live payment unless it was explicitly authorized and actually observed.

## Authoritative Velo references

These links are supplementary; the instructions and API facts above are enough to begin:

- SDK Checkout Sessions, PaymentIntent types, webhook behavior, and setup: https://github.com/Velo-Ecosystem-Collection/Velo/blob/main/packages/velo-sdk/README.md
- SDK public method and status types: https://github.com/Velo-Ecosystem-Collection/Velo/blob/main/packages/velo-sdk/src/client.ts and https://github.com/Velo-Ecosystem-Collection/Velo/blob/main/packages/velo-sdk/src/types.ts
- Next.js checkout and raw-webhook examples: https://github.com/Velo-Ecosystem-Collection/Velo/tree/main/examples/nextjs-app-router
- Express checkout and webhook example: https://github.com/Velo-Ecosystem-Collection/Velo/tree/main/examples/express
- Ledger verification and payment state transitions: https://github.com/Velo-Ecosystem-Collection/Velo/tree/main/packages/backend/convex/payment_intents
- Durable Velo webhook delivery contract: https://github.com/Velo-Ecosystem-Collection/Velo/blob/main/packages/backend/convex/webhookDelivery.ts
- Public SDK documentation and this prompt: https://github.com/Velo-Ecosystem-Collection/Velo/blob/main/apps/web/app/docs/page.tsx
`;
