import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const backend = readFileSync("../../packages/backend/convex/rate_limits/mutations.ts", "utf8");
const adapter = readFileSync("features/playground/server/rate-limit.ts", "utf8");
const loader = readFileSync("features/playground/server/contract-loader.ts", "utf8");
const routes = [
  "app/api/v1/playground/contracts/load/route.ts",
  "app/api/v1/playground/simulations/route.ts",
  "app/api/v1/playground/transactions/submit/route.ts",
  "app/api/v1/playground/transactions/[hash]/route.ts",
].map((path) => readFileSync(path, "utf8"));

test("anonymous Playground buckets have fixed operation-specific policies", () => {
  assert.match(backend, /contract_load: \{ capacity: 30, refill: 30 \/ 60 \}/);
  assert.match(backend, /simulation: \{ capacity: 10, refill: 10 \/ 60 \}/);
  assert.match(backend, /submission: \{ capacity: 5, refill: 5 \/ 60 \}/);
  assert.match(backend, /status: \{ capacity: 60, refill: 60 \/ 60 \}/);
  assert.match(backend, /signaturesMatch/);
  assert.match(backend, /Math\.abs\(now - args\.signedAt\) > 60_000/);
  assert.match(adapter, /x-vercel-forwarded-for/);
  assert.match(adapter, /shared-anonymous/);
  assert.doesNotMatch(adapter, /scopeKey.*identity/);
});

test("all public Playground routes apply their limiter and payload policy", () => {
  for (const source of routes) assert.match(source, /guardPlaygroundRequest/);
  assert.match(routes[0]!, /maxBytes: 4 \* 1_024/);
  assert.match(routes[1]!, /maxBytes: 256 \* 1_024/);
  assert.match(routes[2]!, /maxBytes: 512 \* 1_024/);
  assert.match(loader, /PAYLOAD_TOO_LARGE/);
  assert.match(adapter, /status: 429/);
  assert.match(adapter, /Retry-After/);
});
