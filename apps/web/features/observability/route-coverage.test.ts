import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { withRouteTelemetry } from "../../core/observability.ts";

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? routeFiles(path) : entry.name === "route.ts" ? [path] : [];
  });
}

test("every public route method uses the shared telemetry boundary", () => {
  const files = routeFiles("app/api");
  let methods = 0;
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const count = [
      ...source.matchAll(/export (?:async function|const) (GET|POST|PUT|PATCH|DELETE)/g),
    ].length;
    methods += count;
    assert.ok(
      source.includes("withRouteTelemetry") || source.includes("completeRequestTelemetry"),
      `${file} lacks route telemetry`,
    );
  }
  assert.equal(methods, 24);
  const convexIngress = readFileSync("../../packages/backend/convex/http.ts", "utf8");
  assert.match(convexIngress, /path: "\/api\/webhooks\/pdax\/v1"/);
  assert.match(convexIngress, /X-Correlation-Id/);
});

test("shared boundary returns correlation on every generated success", async () => {
  const handler = withRouteTelemetry("coverage.test", async () => Response.json({ ok: true }));
  let correlated = 0;
  for (let index = 0; index < 1_000; index += 1) {
    const response = await handler(new Request("http://localhost/test"));
    if (response.headers.has("x-correlation-id")) correlated += 1;
  }
  assert.ok(correlated / 1_000 >= 0.999);
});

test("handled and thrown errors always return both correlation aliases", async () => {
  const handled = withRouteTelemetry("coverage.handled", async () =>
    Response.json({ error: "bad" }, { status: 400 }),
  );
  const thrown = withRouteTelemetry("coverage.thrown", async () => {
    throw new Error("sensitive failure");
  });
  for (const response of [
    await handled(new Request("http://localhost/test")),
    await thrown(new Request("http://localhost/test")),
  ]) {
    assert.match(response.headers.get("x-correlation-id") ?? "", /.+/);
    assert.equal(response.headers.get("x-request-id"), response.headers.get("x-correlation-id"));
  }
});
