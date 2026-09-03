import assert from "node:assert/strict";
import test from "node:test";

import {
  parseListPaymentIntentQuery,
  publicPaymentIntentFromDoc,
  veloErrorResponse,
} from "../../core/api/payment-intents.ts";

test("public payment intent mapper returns contract shape", () => {
  const intent = publicPaymentIntentFromDoc(
    {
      _id: "pi_test_123",
      status: "created",
      amount: "10.00",
      asset: "USDC",
      description: undefined,
      successUrl: "https://merchant.example/success",
      cancelUrl: undefined,
      expiresAt: 1782865800000,
      createdAt: 1782864000000,
      updatedAt: 1782864000000,
    },
    "https://app.velo.example",
  );

  assert.equal(intent.id, "pi_test_123");
  assert.equal(intent.object, "payment_intent");
  assert.equal(intent.paymentIntentId, "pi_test_123");
  assert.equal(intent.checkoutUrl, "https://app.velo.example/pay/pi_test_123");
  assert.equal(intent.description, null);
  assert.equal(intent.successUrl, "https://merchant.example/success");
  assert.equal(intent.cancelUrl, null);
  assert.equal(intent.createdAt, "2026-07-01T00:00:00.000Z");
});

test("list query parsing defaults and bounds limit", () => {
  const defaults = parseListPaymentIntentQuery(new URLSearchParams());
  assert.equal(defaults.ok, true);
  if (!defaults.ok) throw new Error("expected defaults");
  assert.equal(defaults.paginationOpts.numItems, 20);
  assert.equal(defaults.paginationOpts.cursor, null);

  const bounded = parseListPaymentIntentQuery(
    new URLSearchParams({ status: "paid", limit: "500", cursor: "abc" }),
  );
  assert.equal(bounded.ok, true);
  if (!bounded.ok) throw new Error("expected bounded");
  assert.equal(bounded.status, "paid");
  assert.equal(bounded.paginationOpts.numItems, 100);
  assert.equal(bounded.paginationOpts.cursor, "abc");
});

test("list query parsing rejects invalid filters", async () => {
  const invalidStatus = parseListPaymentIntentQuery(new URLSearchParams({ status: "complete" }));
  assert.equal(invalidStatus.ok, false);
  if (invalidStatus.ok) throw new Error("expected invalid status");
  assert.equal(invalidStatus.response.status, 400);
  const body = await invalidStatus.response.json();
  assert.equal(body.error.type, "validation_error");
  assert.equal(body.error.param, "status");
});

test("veloErrorResponse returns normalized envelope and request id header", async () => {
  const response = veloErrorResponse({
    status: 404,
    type: "not_found_error",
    code: "payment_intent_not_found",
    message: "Payment intent not found.",
  });

  assert.equal(response.status, 404);
  assert.ok(response.headers.get("X-Request-Id"));
  const body = await response.json();
  assert.equal(body.error.type, "not_found_error");
  assert.equal(body.error.code, "payment_intent_not_found");
  assert.equal(body.error.requestId, response.headers.get("X-Request-Id"));
});

test("veloErrorResponse replaces secret-shaped request IDs", async () => {
  const response = veloErrorResponse({
    status: 500,
    type: "api_error",
    code: "internal_error",
    message: "Internal server error.",
    requestId: `tk_live_${"a".repeat(32)}`,
  });
  const body = (await response.json()) as { error: { requestId: string } };
  assert.notEqual(body.error.requestId, `tk_live_${"a".repeat(32)}`);
  assert.equal(body.error.requestId, response.headers.get("X-Request-Id"));
});
