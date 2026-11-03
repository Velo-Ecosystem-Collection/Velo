import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./project-webhooks.tsx", import.meta.url), "utf8");

test("new webhook selection is active-only while saved historical subscriptions are retained", () => {
  assert.match(source, /type ActiveEventType = \(typeof eventTypes\)\[number\]/);
  assert.match(source, /type EventType =[\s\S]*"provider\.pdax\.event\.received"/);
  assert.match(source, /disabled=\{!canManage \|\| !isActiveEventType\(eventType\)\}/);
  assert.match(source, /settings\?\.eventTypes\.includes\(eventType\)/);
  assert.match(source, /settings\?\.eventTypes \?\? \[\][\s\S]*!isActiveEventType/);
  assert.match(source, /eventTypes: Array\.from\([\s\S]*\.\.\.selectedTypes/);
  assert.match(source, /useState<ActiveEventType>\("contract\.event"\)/);
});
