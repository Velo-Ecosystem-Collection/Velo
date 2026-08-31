import assert from "node:assert/strict";
import test from "node:test";

import { parsePlaygroundTelemetryEvent } from "./telemetry.ts";

const valid = {
  schemaVersion: 1,
  event: "simulation_finished",
  outcome: "success",
  network: "testnet",
  durationMs: 123,
  sessionId: "session-12345678",
  playgroundRequestId: "request-12345678",
};

test("telemetry accepts only the bounded privacy-safe schema", () => {
  assert.deepEqual(parsePlaygroundTelemetryEvent(valid), valid);
  assert.deepEqual(parsePlaygroundTelemetryEvent({ ...valid, arguments: { secret: "x" } }), valid);
  assert.equal(parsePlaygroundTelemetryEvent({ ...valid, event: "raw_xdr" }), null);
  assert.equal(parsePlaygroundTelemetryEvent({ ...valid, durationMs: Infinity }), null);
  assert.equal(parsePlaygroundTelemetryEvent({ ...valid, sessionId: "short" }), null);
  assert.equal(parsePlaygroundTelemetryEvent({ ...valid, errorCategory: "raw message!" }), null);
});
