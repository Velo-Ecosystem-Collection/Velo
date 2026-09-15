import assert from "node:assert/strict";
import test from "node:test";

import {
  isSidebarPathActive,
  projectDestination,
} from "../../../../packages/ui/src/components/ui-customs/sidebar/project-navigation.ts";
import { formatStroopsAsXlm, getGasAccessState } from "./gas-ui.ts";

test("formats exact stroops as seven-decimal XLM without floating point conversion", () => {
  assert.equal(formatStroopsAsXlm("0"), "0.0000000 XLM");
  assert.equal(formatStroopsAsXlm("1"), "0.0000001 XLM");
  assert.equal(formatStroopsAsXlm("12345678"), "1.2345678 XLM");
  assert.equal(formatStroopsAsXlm("9223372036854775807"), "922337203685.4775807 XLM");
  assert.equal(formatStroopsAsXlm("1.0"), "Unavailable");
});

test("keeps membership loading, denied, and ready states distinct", () => {
  assert.equal(
    getGasAccessState({ walletAddress: null, access: undefined, project: undefined }),
    "connect",
  );
  assert.equal(
    getGasAccessState({ walletAddress: "G...", access: undefined, project: undefined }),
    "loading",
  );
  assert.equal(
    getGasAccessState({ walletAddress: "G...", access: null, project: undefined }),
    "unavailable",
  );
  assert.equal(
    getGasAccessState({
      walletAddress: "G...",
      access: { role: "viewer" },
      project: null,
    }),
    "unavailable",
  );
  assert.equal(
    getGasAccessState({
      walletAddress: "G...",
      access: { role: "viewer" },
      project: { _id: "member-project" },
    }),
    "ready",
  );
});

test("builds member deep links even when the owner switcher list is empty", () => {
  assert.equal(projectDestination("member-project", "/gas"), "/projects/member-project/gas");
  assert.equal(projectDestination(null, "/gas"), null);
  assert.equal(
    isSidebarPathActive("/projects/member-project/gas", "/projects/member-project/gas"),
    true,
  );
  assert.equal(isSidebarPathActive("/dashboard", "/projects/member-project/gas"), false);
});
