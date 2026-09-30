import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

import { Velo } from "@carts1024/velo-sdk";
import * as ts from "typescript";

import {
  paymentIntentsIntegrationPrompt,
  paymentIntentsPromptSdkExamples,
} from "./payment-intents-integration-prompt.ts";

test("Payment Intents prompt covers secure SDK setup, lifecycle, and fulfillment", () => {
  for (const detail of [
    "velo.paymentIntents.create()",
    "velo.checkout.sessions.create()",
    "POST /api/v2/payment-intents",
    "both return a `PaymentIntent`",
    "velo.paymentIntents.retrieve()",
    "velo.paymentIntents.list()",
    "Velo.webhooks.verify()",
    "Checkout Sessions is an alternative SDK name",
    "do not call both methods as separate steps",
  ]) {
    assert.ok(paymentIntentsIntegrationPrompt.includes(detail), `missing prompt detail: ${detail}`);
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
    "Optional PDAX routing",
    "authentication, persistence, routing, package manager, and deployment conventions",
  ]) {
    assert.ok(paymentIntentsIntegrationPrompt.includes(guidance), `missing guidance: ${guidance}`);
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
    assert.ok(paymentIntentsIntegrationPrompt.includes("`" + status + "`"));
  }

  assert.match(paymentIntentsIntegrationPrompt, /payment\.succeeded[\s\S]*?webhook event type/);
  assert.match(
    paymentIntentsIntegrationPrompt,
    /In one database transaction[\s\S]*?durable outbox/,
  );
  assert.match(
    paymentIntentsIntegrationPrompt,
    /Before dispatching the SDK request[\s\S]*?stable attempt/,
  );
  assert.match(
    paymentIntentsIntegrationPrompt,
    /# Integrate Velo Payment Intents into this project\./,
  );
  assert.doesNotMatch(paymentIntentsIntegrationPrompt, /(?:sk|tk)_(?:live|test)_[A-Za-z0-9]{12,}/);
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
  const examplePath = resolve(testDirectory, "__payment_intents_prompt_examples__.ts");
  const {
    initialize,
    createPaymentIntent,
    retrievePaymentIntent,
    listPaymentIntents,
    verifyWebhook,
  } = paymentIntentsPromptSdkExamples;
  const source = [
    initialize,
    createPaymentIntent,
    [
      "declare const trustedOrder: Parameters<typeof createPaymentIntentForAttempt>[0];",
      "declare const paymentAttempt: Parameters<typeof createPaymentIntentForAttempt>[1];",
      "declare const paymentAttempts: Parameters<typeof createPaymentIntentForAttempt>[2];",
      "await createPaymentIntentForAttempt(trustedOrder, paymentAttempt, paymentAttempts);",
    ].join("\n"),
    retrievePaymentIntent,
    listPaymentIntents,
    verifyWebhook,
    [
      "declare const rawBody: string;",
      "declare const signature: string | null;",
      "await verifyPaymentWebhook(rawBody, signature);",
    ].join("\n"),
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

test("typed prompt examples compile and exercise create, retrieve, and paginated list", async () => {
  const diagnostics = compilePromptExamples();
  assert.deepEqual(
    diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")),
    [],
  );

  const paymentIntent = {
    id: "pi_payment_intents_prompt_test",
    object: "payment_intent",
    paymentIntentId: "pi_payment_intents_prompt_test",
    status: "created",
    amount: "12.34",
    asset: "USDC",
    description: "Test order 42",
    checkoutUrl: "https://checkout.testnet.example/pay/pi_payment_intents_prompt_test",
    successUrl: "https://merchant.example/orders/42/success",
    cancelUrl: "https://merchant.example/orders/42/cancel",
    expiresAt: "2026-10-01T00:30:00.000Z",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
  const webhookSecret = "test-webhook-secret-placeholder";
  const rawBody = JSON.stringify({
    version: "1",
    id: "evt_payment_intents_prompt_test",
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
  const testResults: Record<string, unknown> = {};
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    const request = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : null,
    };
    requests.push(request);

    const body =
      request.method === "POST"
        ? paymentIntent
        : request.url.includes("?status=paid&limit=50&cursor=")
          ? { object: "list", data: [], hasMore: false, nextCursor: null }
          : request.url.includes("?status=paid&limit=50")
            ? { object: "list", data: [paymentIntent], hasMore: true, nextCursor: "page-2" }
            : paymentIntent;

    return new Response(JSON.stringify(body), {
      status: request.method === "POST" ? 201 : 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const {
    initialize,
    createPaymentIntent,
    retrievePaymentIntent,
    listPaymentIntents,
    verifyWebhook,
  } = paymentIntentsPromptSdkExamples;
  const source = [
    initialize,
    createPaymentIntent,
    "const createdIntent = await createPaymentIntentForAttempt(trustedOrder, paymentAttempt, paymentAttempts);\ntestResults.createdId = createdIntent.paymentIntentId;",
    retrievePaymentIntent,
    "testResults.retrievedId = intent.id;",
    listPaymentIntents,
    "testResults.listedIds = listedIntents.map((item) => item.id);",
    verifyWebhook,
    "const verifiedEvent = await verifyPaymentWebhook(rawBody, signature);\ntestResults.verifiedType = verifiedEvent.type;",
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
      paymentAttempt: { id: "attempt-42-1", idempotencyKey: "order-42-payment-attempt-1" },
      paymentAttempts: {
        async attachPaymentIntent(input: Record<string, unknown>) {
          attachedPaymentIntents.push(input);
        },
      },
      paymentIntentId: paymentIntent.id,
      rawBody,
      signature,
      testResults,
      console: { info() {} },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requests.length, 4);
  assert.equal(requests[0]?.url, "https://api.testnet.example/api/v2/payment-intents");
  assert.equal(requests[0]?.method, "POST");
  assert.equal(requests[0]?.headers.get("authorization"), "Bearer test-api-key-placeholder");
  assert.equal(requests[0]?.headers.get("idempotency-key"), "order-42-payment-attempt-1");
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
        paymentIntentId: paymentIntent.id,
        status: "created",
        expiresAt: paymentIntent.expiresAt,
      },
    ]),
  );
  assert.equal(
    requests[1]?.url,
    "https://api.testnet.example/api/v2/payment-intents/pi_payment_intents_prompt_test",
  );
  assert.equal(requests[1]?.method, "GET");
  assert.equal(
    requests[2]?.url,
    "https://api.testnet.example/api/v2/payment-intents?status=paid&limit=50",
  );
  assert.equal(
    requests[3]?.url,
    "https://api.testnet.example/api/v2/payment-intents?status=paid&limit=50&cursor=page-2",
  );
  assert.deepEqual(JSON.parse(JSON.stringify(testResults)), {
    createdId: paymentIntent.id,
    retrievedId: paymentIntent.id,
    listedIds: [paymentIntent.id],
    verifiedType: "payment.succeeded",
  });
});
