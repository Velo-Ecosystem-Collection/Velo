import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  QUALIFICATION_COMMANDS,
  runQualification,
  writeQualificationReport,
} from "./gas-d2-qualification.mjs";

const repositoryState = {
  head: "a".repeat(40),
  workingTree: { status: "modified", changedPathCount: 2 },
};

function fixedClock() {
  let current = 0;
  return () => new Date(`2026-09-08T00:00:0${current++}.000Z`);
}

function qualificationOptions(exec) {
  return {
    commands: QUALIFICATION_COMMANDS.slice(0, 3),
    exec,
    now: fixedClock(),
    repositoryState: async () => repositoryState,
  };
}

test("runs every qualification command sequentially on complete success", async () => {
  const calls = [];
  const report = await runQualification(
    qualificationOptions(async (command, args) => {
      calls.push([command, ...args]);
      return { exitCode: 0 };
    }),
  );

  assert.equal(report.status, "passed");
  assert.equal(report.exitCode, 0);
  assert.deepEqual(
    calls,
    QUALIFICATION_COMMANDS.slice(0, 3).map(({ command, args }) => [command, ...args]),
  );
  assert.ok(report.checks.every((check) => check.status === "passed"));
  assert.deepEqual(report.repository.before, repositoryState);
  assert.deepEqual(report.repository.after, repositoryState);
});

test("continues independent checks after a failed command", async () => {
  const calls = [];
  const report = await runQualification(
    qualificationOptions(async (command, args) => {
      calls.push([command, ...args]);
      return { exitCode: calls.length === 1 ? 17 : 0 };
    }),
  );

  assert.equal(report.status, "failed");
  assert.equal(report.failedCheckCount, 1);
  assert.equal(calls.length, 3);
  assert.equal(report.checks[0].status, "failed");
  assert.equal(report.checks[1].status, "passed");
  assert.equal(report.checks[2].status, "passed");
});

test("records launch failure and continues to later checks", async () => {
  const calls = [];
  const report = await runQualification(
    qualificationOptions(async (command, args) => {
      calls.push([command, ...args]);
      if (calls.length === 2)
        throw new Error(
          "spawn failed secret=SGXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
        );
      return { exitCode: 0 };
    }),
  );

  assert.equal(report.status, "failed");
  assert.equal(report.failedCheckCount, 1);
  assert.equal(calls.length, 3);
  assert.equal(report.checks[1].status, "launch_failed");
  assert.equal(report.checks[1].exitCode, null);
  assert.equal(report.checks[2].status, "passed");
});

test("persists only sanitized command summaries", async () => {
  const report = await runQualification(
    qualificationOptions(async () => ({
      exitCode: 1,
      stdout: `secret=SGXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX xdr=${"A".repeat(120)}`,
      stderr: "provider response body contains credentials",
    })),
  );
  const directory = await mkdtemp(path.join(tmpdir(), "velo-gas-d2-qualification-"));
  const reportPath = path.join(directory, "report.json");

  try {
    await writeQualificationReport(report, reportPath);
    const persisted = await readFile(reportPath, "utf8");
    assert.equal(persisted.includes("secret="), false);
    assert.equal(persisted.includes("provider response"), false);
    assert.equal(persisted.includes("xdr="), false);
    assert.equal(persisted.includes("A".repeat(120)), false);
    assert.match(persisted, /"status": "failed"/);
    assert.match(persisted, /"commandText":/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
