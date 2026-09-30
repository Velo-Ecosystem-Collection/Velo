import assert from "node:assert/strict";
import test from "node:test";

import { gasIntegrationSnippets } from "../projects/project-integration-guidance.ts";
import { gasIntegrationPrompt } from "./gas-integration-prompt.ts";

test("Gas integration prompt verifies the SDK before installation and covers all methods", () => {
  assert.match(
    gasIntegrationPrompt,
    /Before changing dependencies, inspect the selected published package version's package exports/,
  );
  assert.match(gasIntegrationPrompt, /Do not assume the default published version supports Gas/);

  for (const method of ["sponsor", "submit", "sponsorAndSubmit", "getStatus", "waitForResult"]) {
    assert.match(gasIntegrationPrompt, new RegExp(`\\b${method}\\b`));
  }
});

test("Gas integration prompt keeps server boundaries and caller authorization explicit", () => {
  assert.match(gasIntegrationPrompt, /trusted Node\.js server boundary/);
  assert.match(gasIntegrationPrompt, /Authenticate and authorize the caller and operation/);
  assert.match(
    gasIntegrationPrompt,
    /Keep `VELO_GAS_API_KEY` and `VELO_GAS_BASE_URL` in server-only environment configuration/,
  );
  assert.match(gasIntegrationPrompt, /browser code and browser storage/);
});

test("Gas integration prompt preserves identity-only recovery invariants and tested snippets", () => {
  assert.match(gasIntegrationPrompt, /Never resubmit the XDR after an uncertain handoff/);
  assert.match(gasIntegrationPrompt, /`getStatus\(error\.recovery\)`/);
  assert.match(gasIntegrationPrompt, /bounded `waitForResult\(\)`/);
  assert.ok(gasIntegrationPrompt.includes(gasIntegrationSnippets.sponsorAndSubmit));
  assert.ok(gasIntegrationPrompt.includes(gasIntegrationSnippets.statusRecovery));
});
