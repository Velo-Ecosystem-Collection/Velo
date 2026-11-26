import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const sidebarSource = fs.readFileSync(
  "../../packages/ui/src/components/ui-customs/sidebar/app-sidebar.tsx",
  "utf8",
);
const navMainSource = fs.readFileSync(
  "../../packages/ui/src/components/ui-customs/sidebar/nav-main.tsx",
  "utf8",
);

test("sidebar exposes the five Velo principles as navigation groups", () => {
  for (const principle of ["Build", "Verify", "Observe", "Pay", "Settle"]) {
    assert.match(sidebarSource, new RegExp(`title: "${principle}"`));
  }

  assert.match(sidebarSource, /title: "Build"[\s\S]*title: "Integration"/);
  assert.match(sidebarSource, /title: "Verify"[\s\S]*title: "Contracts"/);
  assert.match(sidebarSource, /title: "Observe"[\s\S]*title: "Events"/);
  assert.match(sidebarSource, /title: "Pay"[\s\S]*title: "Payments"/);
  assert.match(sidebarSource, /title: "Pay"[\s\S]*title: "Gas Station"/);
  assert.match(sidebarSource, /title: "Settle"[\s\S]*title: "Settlement"/);
});

test("dashboard stays above the principle groups as a standalone destination", () => {
  const dashboardIndex = sidebarSource.indexOf('title: "Dashboard"');
  const groupsIndex = sidebarSource.indexOf("const navGroups");

  assert.notEqual(dashboardIndex, -1);
  assert.notEqual(groupsIndex, -1);
  assert.ok(dashboardIndex < groupsIndex);
  assert.match(navMainSource, /items\?: NavMainItem\[\]/);
});

test("Velo Arc follows Project Playground and is limited to registered owners and editors", () => {
  const playgroundIndex = sidebarSource.indexOf('title: "Project Playground"');
  const arcIndex = sidebarSource.indexOf('title: "Open in Velo Arc"');

  assert.notEqual(playgroundIndex, -1);
  assert.notEqual(arcIndex, -1);
  assert.ok(arcIndex > playgroundIndex);
  assert.equal(
    (sidebarSource.slice(playgroundIndex, arcIndex).match(/title:/g) ?? []).length,
    1,
    "Open in Velo Arc should be the next Build item after Project Playground",
  );
  assert.match(sidebarSource, /activeProject\?\.status === "registered"/);
  assert.match(sidebarSource, /activeProject\.role === "owner" \|\| activeProject\.role === "editor"/);
  assert.match(sidebarSource, /onAction: canOpenArc \? onOpenArc : undefined/);
});

test("principle groups collapse while preserving active navigation state", () => {
  assert.match(navMainSource, /export type NavMainGroup/);
  assert.match(navMainSource, /openGroups/);
  assert.match(navMainSource, /CollapsibleContent/);
  assert.match(navMainSource, /isActive=\{item\.isActive\}/);
  assert.match(navMainSource, /aria-disabled="true"/);
  assert.match(navMainSource, /className="px-2 py-1"/);
  assert.match(sidebarSource, /<SidebarContent className="gap-0">/);
});
