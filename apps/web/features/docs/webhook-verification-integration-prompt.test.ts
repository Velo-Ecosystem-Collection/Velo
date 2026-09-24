import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as ts from "typescript";

import {
  webhookVerificationIntegrationPrompt,
  webhookVerificationPromptExamples,
} from "./webhook-verification-integration-prompt.ts";

const secret = "webhook-verification-prompt-test-secret";

function compileVerifierExample() {
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
  const examplePath = resolve(testDirectory, "__webhook_verification_prompt_example__.ts");
  const source = [
    webhookVerificationPromptExamples.verification,
    [
      "declare const rawBody: string;",
      "declare const signature: string | null;",
      "declare const secret: string;",
      "void verifyVeloWebhook(rawBody, signature, secret).then((event) => {",
      '  if (event.type === "payment.succeeded") event.paymentIntent.id;',
      "});",
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
  return { diagnostics: ts.getPreEmitDiagnostics(program), source };
}

const webhookEvent = {
  version: "1",
  id: "evt_webhook_prompt_test",
  type: "payment.succeeded",
  test: true,
  sentAt: new Date().toISOString(),
  project: {
    id: "project_prompt_test",
    registryProjectId: "registry_prompt_test",
    name: "Prompt Test",
    slug: "prompt-test",
  },
  paymentIntent: {
    id: "pi_prompt_test",
    amount: "10.00",
    asset: "USDC",
    merchantName: "Prompt Test Merchant",
    description: "Prompt fixture",
    status: "paid",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
};

function signPayload(payload: string, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

async function loadDisplayedVerifier() {
  const javascript = ts.transpile(webhookVerificationPromptExamples.verification, {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  });
  const testDirectory = dirname(fileURLToPath(import.meta.url));
  const temporaryDirectory = await mkdtemp(resolve(testDirectory, ".webhook-prompt-example-"));

  try {
    const modulePath = resolve(temporaryDirectory, "verify.mjs");
    await writeFile(modulePath, javascript);
    const exampleModule: { verifyVeloWebhook?: unknown } = await import(
      pathToFileURL(modulePath).href
    );
    assert.equal(typeof exampleModule.verifyVeloWebhook, "function");
    return exampleModule.verifyVeloWebhook as (
      rawBody: string,
      signature: string | null,
      secret: string,
    ) => Promise<{ id: string; type: string }>;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

test("Webhook Verification prompt covers safe setup, middleware order, and durable processing", () => {
  for (const detail of [
    "HMAC-SHA256",
    "300 seconds by default",
    "discriminated `WebhookEvent` type",
    "does **not** deduplicate deliveries",
    "Do not request or add an API key for verification alone.",
    "server-side Node.js environment with ESM support",
    "selected SDK release's registry metadata/package contents",
    "server-only environment configuration",
    "x-velo-signature",
    "request.text()",
    "any global `express.json()` middleware",
    "x-velo-delivery",
    "not part of the signed body",
    "durable outbox/job",
    "independently idempotent",
    "concurrent duplicates",
    "payment fulfillment",
    "retryable 5xx",
    "without the user's decision",
  ]) {
    assert.ok(webhookVerificationIntegrationPrompt.includes(detail), `missing: ${detail}`);
  }

  assert.ok(
    webhookVerificationIntegrationPrompt.includes(webhookVerificationPromptExamples.verification),
  );
  assert.match(
    webhookVerificationIntegrationPrompt,
    /Register the webhook route with `express\.raw\(\{ type: "application\/json" \}\)` \*\*before\*\* any global `express\.json\(\)` middleware/,
  );
  assert.doesNotMatch(
    webhookVerificationIntegrationPrompt,
    /(?:sk|tk)_(?:live|test)_[A-Za-z0-9]{12,}/,
  );
});

test("displayed verification example type-checks against public SDK exports", () => {
  const { diagnostics } = compileVerifierExample();
  assert.deepEqual(
    diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")),
    [],
  );
});

test("displayed verifier accepts independently signed valid requests and rejects altered bodies", async () => {
  const verify = await loadDisplayedVerifier();
  const payload = JSON.stringify(webhookEvent);
  const signature = signPayload(payload);
  const event = await verify(payload, signature, secret);

  assert.equal(event.id, webhookEvent.id);
  assert.equal(event.type, "payment.succeeded");
  await assert.rejects(
    verify(payload.replace("10.00", "11.00"), signature, secret),
    /Signature mismatch/,
  );
});

test("displayed verifier rejects missing, malformed, stale, and future signatures", async () => {
  const verify = await loadDisplayedVerifier();
  const payload = JSON.stringify(webhookEvent);
  await assert.rejects(verify(payload, null, secret), /Missing signature header/);
  await assert.rejects(verify(payload, "invalid", secret), /Invalid signature header format/);

  const now = Math.floor(Date.now() / 1000);
  await assert.rejects(
    verify(payload, signPayload(payload, now - 301), secret),
    /timestamp expired/,
  );
  await assert.rejects(
    verify(payload, signPayload(payload, now + 301), secret),
    /timestamp expired/,
  );
});

test("displayed verifier rejects signed malformed payloads and unsupported versions", async () => {
  const verify = await loadDisplayedVerifier();
  const malformedJson = "{not-json";
  await assert.rejects(verify(malformedJson, signPayload(malformedJson), secret));

  const malformedEvent = JSON.stringify({ ...webhookEvent, paymentIntent: undefined });
  await assert.rejects(
    verify(malformedEvent, signPayload(malformedEvent), secret),
    /paymentIntent must be an object/,
  );

  const unsupportedEvent = JSON.stringify({ ...webhookEvent, version: "2" });
  await assert.rejects(
    verify(unsupportedEvent, signPayload(unsupportedEvent), secret),
    /unsupported version 2/,
  );
});
