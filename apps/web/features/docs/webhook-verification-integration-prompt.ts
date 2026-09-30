export const webhookVerificationPromptExamples = {
  verification: `import { Velo, type WebhookEvent } from "@carts1024/velo-sdk";

export async function verifyVeloWebhook(
  rawBody: string, // untouched result of request.text()
  signatureHeader: string | null, // request.headers.get("x-velo-signature")
  secret: string,
): Promise<WebhookEvent> {
  return Velo.webhooks.verify({
    payload: rawBody,
    signature: signatureHeader,
    secret,
    toleranceSeconds: 300,
  });
}`,
};

export const webhookVerificationIntegrationPrompt = `# Integrate Velo Webhook Verification into this project

You are adapting webhook verification in an existing application. Inspect first, preserve its architecture, and implement the smallest safe integration that fits its current runtime, routes, persistence, queue, and tests.

## 1. Inspect the project before changing it

- Read repository and relevant package instructions (\`AGENTS.md\`), README files, manifests, and existing webhook/payment code.
- Identify the framework, package manager, deployed server runtime, route registration order, environment configuration, persistence/queue patterns, payment fulfillment flow, and existing tests.
- Find the Velo project and resource identifiers already associated with local records. Reuse the application's existing auth, logging, configuration, database transaction, queue, and idempotency patterns.
- Report any missing product or deployment facts. Do not invent project IDs, events, secrets, credentials, or payment records.

## 2. Explain the verification boundary

Velo signs \`<timestamp>.<raw request body>\` with HMAC-SHA256. The SDK checks the signature and timestamp freshness (300 seconds by default), then parses and validates the payload into the exported discriminated \`WebhookEvent\` type. Keep the body byte-for-byte/text-for-text unchanged until verification; parsing and serializing JSON again changes the signed input. Keep the server clock accurate so legitimate timestamps pass freshness checks.

Verification establishes that the signed body was produced by a holder of the webhook secret and was not changed. It does **not** deduplicate deliveries, authorize a user or order, confirm that a resource belongs to this project, or make fulfillment idempotent. Check the verified event's project and resource against trusted application records and business rules. The \`x-velo-delivery\` header is for durable delivery deduplication; it is not part of the signed body and is not signed business identity. Make business effects independently idempotent using the verified event/resource and your own durable uniqueness rules.

## 3. Confirm runtime and install the verified SDK release

- This integration requires a compatible server-side Node.js environment with ESM support (Node.js 18 or newer for this SDK). If the project is browser-only, Edge-only, or otherwise incompatible, explain the blocker and propose a small Node.js endpoint; do not introduce infrastructure or alter deployment settings without the user's decision.
- Inspect the selected SDK release's registry metadata/package contents and verify its public package export includes \`Velo.webhooks.verify\` and the \`WebhookEvent\` type. Do not assume a mutable \`latest\`/alpha tag or workspace source matches the selected release. If the needed API is absent, report the exact release blocker before installing anything.
- Install the selected compatible release with the repository's existing package manager and record the exact version. Do not switch package managers or add an unpublished/source dependency silently.
- Configure a reachable HTTPS webhook endpoint in Velo and subscribe it to only the event types the app needs. Keep \`VELO_WEBHOOK_SECRET\` in server-only environment configuration; never put it in client code, logs, prompts, or browser-visible responses. Use placeholders in examples and tests.
- Webhook verification is static: \`Velo.webhooks.verify()\` needs no Velo API key and no \`new Velo(...)\` client instance. Do not request or add an API key for verification alone.

## 4. Add the typed verification boundary

Adapt this example to the host route. Pass the untouched body and the \`x-velo-signature\` header directly; the SDK's default freshness tolerance is 300 seconds.

\`\`\`ts
${webhookVerificationPromptExamples.verification}
\`\`\`

After successful verification, use the event union's narrowing by \`event.type\`. A verified but irrelevant event can be deliberately ignored with a successful response after project checks; do not try to process it as an event the app does not support.

## 5. Framework recipes

### Next.js App Router (Node runtime)

Use a route handler such as \`app/api/webhooks/velo/route.ts\`. Set \`export const runtime = "nodejs";\`, read \`await request.text()\` exactly once (never \`request.json()\` first), and get \`request.headers.get("x-velo-signature")\` plus \`request.headers.get("x-velo-delivery")\`. Return a client error for missing/invalid signature or malformed signed content. After verification, check configured project/resource associations, then call the application's durable acceptance function. Respond success only after a database transaction has durably inserted/claimed the delivery and its processing job/outbox record; return a retryable 5xx if durable acceptance fails.

\`\`\`ts
export const runtime = "nodejs";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-velo-signature");
  const deliveryId = request.headers.get("x-velo-delivery");
  const secret = process.env.VELO_WEBHOOK_SECRET;
  if (!signature || !deliveryId) return new Response("Invalid webhook", { status: 400 });
  if (!secret) return new Response("Webhook unavailable", { status: 500 });

  let event: WebhookEvent;
  try {
    event = await Velo.webhooks.verify({ payload: rawBody, signature, secret });
  } catch {
    return new Response("Invalid webhook", { status: 400 });
  }

  try {
    await acceptVerifiedDeliveryAtomically({ deliveryId, event });
  } catch {
    return new Response("Temporary processing failure", { status: 503 });
  }
  return Response.json({ received: true }, { status: 202 });
}

// Import Velo and WebhookEvent from the SDK. Implement the acceptance helper
// using this application's existing database transaction or durable queue.

\`\`\`

## Express

Register the webhook route with \`express.raw({ type: "application/json" })\` **before** any global \`express.json()\` middleware. Otherwise JSON middleware consumes/parses the stream first and verification no longer receives the signed raw body. Convert the route's Buffer to UTF-8 once, read \`x-velo-signature\` and \`x-velo-delivery\`, verify, and durably accept as above. Register ordinary JSON middleware after the webhook route so other endpoints keep their existing behavior. Do not copy middleware order from an example that puts global JSON parsing first.

\`\`\`ts
app.post("/webhooks/velo", express.raw({ type: "application/json" }), async (req, res) => {
  const rawBody = req.body.toString("utf8");
  const signature = req.header("x-velo-signature") ?? null;
  const deliveryId = req.header("x-velo-delivery");
  const secret = process.env.VELO_WEBHOOK_SECRET;
  if (!signature || !deliveryId) return res.status(400).send("Invalid webhook");
  if (!secret) return res.status(500).send("Webhook unavailable");

  let event: WebhookEvent;
  try {
    event = await Velo.webhooks.verify({ payload: rawBody, signature, secret });
  } catch {
    return res.status(400).send("Invalid webhook");
  }

  try {
    await acceptVerifiedDeliveryAtomically({ deliveryId, event });
    return res.status(202).send("Accepted");
  } catch {
    return res.status(503).send("Temporary processing failure");
  }
});

app.use(express.json()); // Register after the raw-body webhook route.

// Import express, Velo, and WebhookEvent. Implement durable acceptance with
// this application's existing transaction/queue pattern.
\`\`\` 

## 6. Make acceptance, retries, and fulfillment safe

- Treat signature/shape failures as rejected requests. Keep verification in its own error boundary: do not turn a later database or fulfillment failure into a 400 signature error.
- Atomically insert a delivery row keyed by \`x-velo-delivery\` (for example, a unique constraint or transactional claim). Handle simultaneous copies through that uniqueness boundary. A duplicate already durably accepted or queued can be acknowledged; an unaccepted delivery must remain retryable.
- Persist the verified event or enqueue a durable outbox/job in the same transaction as delivery acceptance. If storage or queue acceptance fails transiently, return 5xx so Velo can retry. If processing is synchronous, return a retryable error for transient processing failures. Acknowledge only after durable acceptance, never just because verification passed.
- Make the business transition independently idempotent, even when the same event arrives with a different delivery ID: use a unique event/resource operation key and atomic state transition. The delivery header is outside the HMAC input, so never treat it as signed project, payment, user, or authorization identity.
- Verify \`event.project.id\` (and registry/project association where applicable) against trusted configuration. For payment fulfillment, match the verified PaymentIntent ID to the application's own order, check expected project, amount/asset and current state, and grant fulfillment once through a durable idempotent transition. A webhook signature alone is not authorization, and a browser success redirect is not payment proof.
- Process concurrent duplicates safely. A duplicate whose original event is durably queued may receive success; do not start a second effect. Retry transient worker failures from durable state. Keep side effects idempotent or publish them through an outbox with their own deduplication key.
- Acknowledge irrelevant but valid, correctly associated event types without fulfillment after an intentional no-op/filter decision. Do not retry them forever or treat them as payment success.
- Keep retryable failures distinct from permanent invalid requests: reject bad signatures and malformed payloads with 4xx; use retryable 5xx for temporary persistence, queue, or processing failures. Follow the application's existing response policy for already accepted duplicate deliveries.

## 7. Add focused tests and report the integration

- Add tests with independently generated HMAC-SHA256 signatures for a valid event, altered body, missing and malformed signature, stale and future timestamps, malformed JSON/event fields, and unsupported event versions. Include concurrent duplicate delivery, retries, irrelevant verified events, durable acceptance failures, project/resource mismatch, and exactly-once business-effect behavior using the project's existing persistence/test tools.
- Keep secrets as test-only placeholders. Do not log the secret, full signature, or sensitive raw payload. Test deterministic behavior locally; do not claim a live endpoint, delivery, or production validation unless it was actually performed.
- Document placeholder setup, endpoint reachability, selected event subscriptions, server-only \`VELO_WEBHOOK_SECRET\`, accurate server time, SDK version/runtime requirements, and any owner/operator setup steps.
- Finish with a concise report of changed routes/storage, the durable dedupe and business idempotency keys, tests/checks run, unresolved prerequisites, and any live validation that was actually observed. Never expose credentials or claim checks that were not run.
`;
