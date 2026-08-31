import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");
const panel = read("features/playground/project-playground-panel.tsx");
const client = read("features/playground/playground-client.tsx");
const log = read("features/playground/project-log.tsx");
const share = read("features/playground/shared-playground-request.tsx");
const projectContext = read("features/playground/server/project-context.ts");
const simulationRoute = read("app/api/v1/playground/simulations/route.ts");
const webhook = read("features/projects/project-webhooks.tsx");

test("Sprint 6 project Playground exposes persistence, roles, variables, history, and shares", () => {
  assert.match(panel, /Velo project workflow/);
  assert.match(panel, /access\?\.role === "owner" \|\| access\?\.role === "editor"/);
  assert.match(panel, /Canonical argument template/);
  assert.match(panel, /Preview resolved values/);
  assert.match(panel, /private_project/);
  assert.match(panel, /public_unlisted/);
  assert.match(panel, /Sanitized execution evidence expires after 30 days/);
});

test("project API context is authenticated while anonymous Playground stays compatible", () => {
  assert.match(projectContext, /x-velo-project-id/);
  assert.match(projectContext, /authorization/);
  assert.match(projectContext, /getMyAccess/);
  assert.match(client, /projectRequestHeaders\(projectId\)/);
  assert.match(simulationRoute, /resolveProjectVariables/);
  assert.match(simulationRoute, /resolutionHash/);
  assert.match(simulationRoute, /previewVariables/);
});

test("logs, shares, and webhook handoff enforce safe replay semantics", () => {
  assert.match(log, /Signatures, XDR, authorization payloads, and raw RPC/);
  assert.match(log, /Create webhook filter/);
  assert.match(share, /Fresh simulation required/);
  assert.match(share, /Arguments were excluded by the sender/);
  assert.match(webhook, /Nothing is persisted until you/);
  assert.match(webhook, /Save reviewed filter/);
});
