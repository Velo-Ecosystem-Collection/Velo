import assert from "node:assert/strict";
import test from "node:test";

import {
  deterministicSample,
  isCorrelationId,
  parsePlaygroundTelemetryEvent,
  parseTelemetryContext,
  projectSafeEvent,
  signUiTelemetryMarker,
  uiTelemetryMarkerPayload,
  validateMetricLabels,
  traceIdentifiers,
} from "./index.ts";

test("Playground telemetry projects only its privacy-safe event contract", () => {
  const event = {
    schemaVersion: 1,
    event: "contract_loaded",
    outcome: "success",
    network: "testnet",
    durationMs: 12,
    sessionId: "session-00000001",
    playgroundRequestId: "request-00000001",
    contractId: "must-not-survive",
    arguments: { secret: "must-not-survive" },
  };
  assert.deepEqual(parsePlaygroundTelemetryEvent(event), {
    schemaVersion: 1,
    event: "contract_loaded",
    outcome: "success",
    network: "testnet",
    durationMs: 12,
    sessionId: "session-00000001",
    playgroundRequestId: "request-00000001",
  });
});

test("accepts only validated correlation and W3C trace context", () => {
  assert.deepEqual(
    parseTelemetryContext({
      requestCorrelationId: "request-00000001",
      journeyCorrelationId: "journey-00000001",
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    }),
    {
      requestCorrelationId: "request-00000001",
      journeyCorrelationId: "journey-00000001",
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    },
  );
  assert.equal(parseTelemetryContext({ requestCorrelationId: "Bearer secret" }), null);
});

test("correlation IDs reject complete API keys, Stellar seeds, and JWT-shaped values", () => {
  assert.equal(isCorrelationId("request-00000001"), true);
  assert.equal(isCorrelationId(`tk_live_${"a".repeat(32)}`), false);
  assert.equal(isCorrelationId(`S${"A".repeat(55)}`), false);
  assert.equal(isCorrelationId("header.payload.signature"), false);
});

test("projects only actual catalog values and creates valid unique OTLP identifiers", () => {
  assert.deepEqual(
    projectSafeEvent({
      spanName: "made.up",
      stage: "secret",
      outcome: "wat",
      operation: "BAD VALUE",
    }),
    {},
  );
  const parent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
  const first = traceIdentifiers(parent);
  const second = traceIdentifiers(parent);
  assert.match(first.traceId, /^[0-9a-f]{32}$/);
  assert.match(first.spanId, /^(?!0{16})[0-9a-f]{16}$/);
  assert.notEqual(first.spanId, second.spanId);
});

test("allowlist projection drops hostile, cyclic, and sensitive fields", () => {
  const value: Record<string, unknown> = {
    spanName: "velo.http.server",
    operation: "payment.create",
    stage: "mutation",
    outcome: "success",
    authorization: "Bearer secret",
    customerId: "customer-1",
    payload: { accountNumber: "123" },
    error: new Error("raw provider response"),
  };
  value.cycle = value;
  assert.deepEqual(projectSafeEvent(value), {
    spanName: "velo.http.server",
    operation: "payment.create",
    stage: "mutation",
    outcome: "success",
  });
});

test("sampling is deterministic and metric labels are bounded", () => {
  assert.equal(deterministicSample("journey-1", 0.1), deterministicSample("journey-1", 0.1));
  assert.equal(validateMetricLabels({ service: "web", outcome: "success" }), true);
  assert.equal(validateMetricLabels({ correlation_id: "random" }), false);
});

test("UI telemetry signatures bind the intent, marker, duration, and timestamp", async () => {
  const input = {
    paymentIntentId: "payment-intent-0001",
    marker: "checkout_start",
    durationMs: 12,
    signedAt: 1_785_086_400_000,
  };
  assert.equal(
    uiTelemetryMarkerPayload(input),
    '["payment-intent-0001","checkout_start",12,1785086400000]',
  );
  const first = await signUiTelemetryMarker("test-secret", input);
  const replay = await signUiTelemetryMarker("test-secret", input);
  const changed = await signUiTelemetryMarker("test-secret", { ...input, durationMs: 13 });
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(first, replay);
  assert.notEqual(first, changed);
});

test("ten thousand entity identifiers cannot create metric labels", () => {
  for (let index = 0; index < 10_000; index += 1) {
    assert.equal(validateMetricLabels({ operation: "payment.create", outcome: "success" }), true);
    assert.equal(validateMetricLabels({ entity_id: crypto.randomUUID() }), false);
  }
});

test("one journey reconstructs ordered API through UI stages", () => {
  const journeyCorrelationId = "journey-00000001";
  const events = [
    ["api", 1],
    ["convex", 2],
    ["submission", 3],
    ["observation", 4],
    ["state_update", 5],
    ["webhook", 6],
    ["ui_render", 7],
  ].map(([stage, at]) => ({ journeyCorrelationId, stage, at: Number(at) }));
  const reconstructed = events
    .filter((event) => event.journeyCorrelationId === journeyCorrelationId)
    .sort((left, right) => left.at - right.at)
    .map((event) => event.stage);
  assert.deepEqual(reconstructed, [
    "api",
    "convex",
    "submission",
    "observation",
    "state_update",
    "webhook",
    "ui_render",
  ]);
});
