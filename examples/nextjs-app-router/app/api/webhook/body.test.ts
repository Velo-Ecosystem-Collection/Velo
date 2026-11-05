import assert from "node:assert/strict";
import test from "node:test";

import { readBoundedWebhookBody, WebhookBodyTooLargeError } from "./body.ts";

test("readBoundedWebhookBody decodes bounded UTF-8 streams", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"message":'));
      controller.enqueue(new TextEncoder().encode('"hello 🌎"}'));
      controller.close();
    },
  });

  const request = { body, headers: new Headers() };
  assert.equal(await readBoundedWebhookBody(request), '{"message":"hello 🌎"}');
});

test("readBoundedWebhookBody rejects and cancels bodies over the byte limit", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(4));
      controller.enqueue(new Uint8Array(1));
    },
    cancel() {
      cancelled = true;
    },
  });

  await assert.rejects(
    () => readBoundedWebhookBody({ body, headers: new Headers() }, 4),
    WebhookBodyTooLargeError,
  );
  assert.equal(cancelled, true);
});

test("readBoundedWebhookBody rejects oversized declared length before reading", async () => {
  let pulls = 0;
  const body = {
    getReader() {
      pulls++;
      throw new Error("body should not be read");
    },
  } as unknown as ReadableStream<Uint8Array>;
  const headers = new Headers({ "content-length": "100" });

  await assert.rejects(
    () => readBoundedWebhookBody({ body, headers }, 10),
    WebhookBodyTooLargeError,
  );
  assert.equal(pulls, 0);
});

test("readBoundedWebhookBody rejects malformed UTF-8", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([0xc3, 0x28]));
      controller.close();
    },
  });

  await assert.rejects(() => readBoundedWebhookBody({ body, headers: new Headers() }));
});
