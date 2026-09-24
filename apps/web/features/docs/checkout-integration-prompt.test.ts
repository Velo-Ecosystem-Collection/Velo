import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

import { Velo } from "@carts1024/velo-sdk";
import * as ts from "typescript";

import {
  checkoutIntegrationPrompt,
  checkoutPromptSdkExamples,
} from "./checkout-integration-prompt.ts";

test("Checkout prompt covers SDK setup, states, durable idempotency, and trusted fulfillment", () => {
  for (const method of [
    "velo.checkout.sessions.create()",
    "velo.paymentIntents.retrieve()",
    "Velo.webhooks.verify()",
  ]) {
    assert.ok(checkoutIntegrationPrompt.includes(method), `missing SDK method: ${method}`);
  }

  for (const guidance of [
    "Node.js 18 or newer",
    "server-only environment configuration",
    "stable attempt identity/idempotency key",
    "same idempotency key and identical inputs",
    "`checkoutUrl` is nullable",
    "x-velo-signature",
    "x-velo-delivery",
    "durable and idempotent",
    "success redirect",
    "Testnet",
    "PDAX",
  ]) {
    assert.ok(checkoutIntegrationPrompt.includes(guidance), `missing guidance: ${guidance}`);
  }

  for (const status of [
    "awaiting_route",
    "created",
    "pending",
    "paid",
    "failed",
    "expired",
    "cancelled",
  ]) {
    assert.ok(checkoutIntegrationPrompt.includes("`" + status + "`"));
  }

  assert.match(checkoutIntegrationPrompt, /payment\.succeeded[\s\S]*?webhook event type/);
  assert.match(checkoutIntegrationPrompt, /In one database transaction[\s\S]*?durable outbox/);
  assert.match(
    checkoutIntegrationPrompt,
    /Before dispatching the SDK request[\s\S]*?stable attempt/,
  );
  assert.doesNotMatch(checkoutIntegrationPrompt, /(?:sk|tk)_(?:live|test)_[A-Za-z0-9]{12,}/);
});

function compilePromptExamples() {
  const testDirectory = dirname(fileURLToPath(import.meta.url));
  const appDirectory = resolve(testDirectory, "../..");
  const configPath = resolve(appDirectory, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  assert.equal(config.error, undefined, "web tsconfig should be readable");

  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, appDirectory);
  const options: ts.CompilerOptions = {
    ...parsed.options,
    composite: false,
    incremental: false,
    noEmit: true,
  };
  const examplePath = resolve(testDirectory, "__checkout_prompt_examples__.ts");
  const [initializeExample, createSessionExample, retrieveExample, verifyExample] =
    Object.values(checkoutPromptSdkExamples);
  const source = [
    initializeExample,
    createSessionExample,
    `declare const trustedOrder: Parameters<typeof createCheckoutForAttempt>[0];
declare const checkoutAttempt: Parameters<typeof createCheckoutForAttempt>[1];
declare const checkoutAttempts: Parameters<typeof createCheckoutForAttempt>[2];
await createCheckoutForAttempt(trustedOrder, checkoutAttempt, checkoutAttempts);
`,
    retrieveExample,
    verifyExample,
    `declare const rawBody: string;
declare const signature: string | null;
await verifyCheckoutWebhook(rawBody, signature);`,
  ].join("\n\n");
  const host = ts.createCompilerHost(options);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);

  host.fileExists = (fileName) => resolve(fileName) === examplePath || originalFileExists(fileName);
  host.readFile = (fileName) =>
    resolve(fileName) === examplePath ? source : originalReadFile(fileName);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) =>
    resolve(fileName) === examplePath
      ? ts.createSourceFile(fileName, source, languageVersion, true)
      : originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);

  const program = ts.createProgram({ rootNames: [examplePath], options, host });
  return ts.getPreEmitDiagnostics(program);
}

test("typed prompt examples compile and exercise the workspace SDK with mocked transport", async () => {
  const diagnostics = compilePromptExamples();
  assert.deepEqual(
    diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")),
    [],
  );

  const paymentIntent = {
    id: "pi_checkout_prompt_test",
    object: "payment_intent",
    paymentIntentId: "pi_checkout_prompt_test",
    status: "created",
    amount: "12.34",
    asset: "USDC",
    description: "Test order 42",
    checkoutUrl: "https://checkout.testnet.example/pay/pi_checkout_prompt_test",
    successUrl: "https://merchant.example/orders/42/success",
    cancelUrl: "https://merchant.example/orders/42/cancel",
    expiresAt: "2026-10-01T00:30:00.000Z",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
  const webhookSecret = "test-webhook-secret-placeholder";
  const rawBody = JSON.stringify({
    version: "1",
    id: "evt_checkout_prompt_test",
    type: "payment.succeeded",
    test: true,
    sentAt: "2026-10-01T00:01:00.000Z",
    project: {
      id: "project-placeholder",
      registryProjectId: "registry-project-placeholder",
      name: "Prompt test project",
      slug: "prompt-test-project",
    },
    paymentIntent: {
      id: paymentIntent.id,
      amount: paymentIntent.amount,
      asset: paymentIntent.asset,
      merchantName: "Prompt test merchant",
      status: "paid",
      createdAt: paymentIntent.createdAt,
      updatedAt: paymentIntent.updatedAt,
    },
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = `t=${timestamp},v1=${createHmac("sha256", webhookSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex")}`;
  const requests: Array<{ url: string; method: string; headers: Headers; body: string | null }> =
    [];
  const attachedPaymentIntents: Array<Record<string, unknown>> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    const request = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : null,
    };
    requests.push(request);
    return new Response(JSON.stringify(paymentIntent), {
      status: request.method === "POST" ? 201 : 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const [initializeExample, createSessionExample, retrieveExample, verifyExample] =
    Object.values(checkoutPromptSdkExamples);
  const source = [
    initializeExample,
    createSessionExample,
    `await createCheckoutForAttempt(trustedOrder, checkoutAttempt, checkoutAttempts);
`,
    retrieveExample,
    verifyExample,
    `const verifiedEvent = await verifyCheckoutWebhook(rawBody, signature);
console.info(verifiedEvent.type);`,
  ].join("\n\n");
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  try {
    await runInNewContext(`(async () => { ${javascript}\n })()`, {
      require: (specifier: string) => {
        assert.equal(specifier, "@carts1024/velo-sdk");
        return { Velo };
      },
      exports: {},
      process: {
        env: {
          VELO_API_KEY: "test-api-key-placeholder",
          VELO_BASE_URL: "https://api.testnet.example",
          VELO_WEBHOOK_SECRET: webhookSecret,
        },
      },
      trustedOrder: {
        id: "order-42",
        amount: "12.34",
        asset: "USDC",
        description: "Test order 42",
        successUrl: "https://merchant.example/orders/42/success",
        cancelUrl: "https://merchant.example/orders/42/cancel",
      },
      checkoutAttempt: { id: "attempt-42-1", idempotencyKey: "order-42-checkout-attempt-1" },
      checkoutAttempts: {
        async attachPaymentIntent(input: Record<string, unknown>) {
          attachedPaymentIntents.push(input);
        },
      },
      paymentIntentId: paymentIntent.id,
      rawBody,
      signature,
      console: { info() {} },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.url, "https://api.testnet.example/api/v2/payment-intents");
  assert.equal(requests[0]?.method, "POST");
  assert.equal(requests[0]?.headers.get("authorization"), "Bearer test-api-key-placeholder");
  assert.equal(requests[0]?.headers.get("idempotency-key"), "order-42-checkout-attempt-1");
  assert.deepEqual(JSON.parse(requests[0]?.body ?? "{}"), {
    amount: "12.34",
    asset: "USDC",
    description: "Test order 42",
    successUrl: "https://merchant.example/orders/42/success",
    cancelUrl: "https://merchant.example/orders/42/cancel",
  });
  assert.equal(
    JSON.stringify(attachedPaymentIntents),
    JSON.stringify([
      {
        orderId: "order-42",
        attemptId: "attempt-42-1",
        paymentIntentId: paymentIntent.paymentIntentId,
        status: "created",
        expiresAt: paymentIntent.expiresAt,
      },
    ]),
  );
  assert.equal(
    requests[1]?.url,
    "https://api.testnet.example/api/v2/payment-intents/pi_checkout_prompt_test",
  );
  assert.equal(requests[1]?.method, "GET");
});
