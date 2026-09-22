#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULT_REPORT_PATH =
  "docs/instawards/Velo-Instawards-Deliverable-2-Qualification-Run.json";

export const QUALIFICATION_COMMANDS = Object.freeze([
  Object.freeze({
    command: "pnpm",
    args: ["--filter", "@repo/backend", "exec", "vitest", "run", "convex/tests/gas"],
  }),
  Object.freeze({
    command: "pnpm",
    args: [
      "--filter",
      "@repo/backend",
      "exec",
      "vitest",
      "run",
      "convex/tests/gas/integration.test.ts",
    ],
  }),
  Object.freeze({
    command: "pnpm",
    args: [
      "--filter",
      "web",
      "exec",
      "node",
      "--experimental-strip-types",
      "--test",
      "features/api/gas-sponsor-route.test.ts",
      "features/api/gas-submit-route.test.ts",
    ],
  }),
  Object.freeze({ command: "pnpm", args: ["--filter", "@repo/stellar", "test"] }),
  Object.freeze({ command: "pnpm", args: ["--filter", "@repo/backend", "test"] }),
  Object.freeze({ command: "pnpm", args: ["--filter", "web", "test"] }),
  Object.freeze({ command: "pnpm", args: ["lint:fix"] }),
  Object.freeze({ command: "pnpm", args: ["--filter", "web", "build"] }),
  Object.freeze({ command: "git", args: ["diff", "--check"] }),
]);

const usage = `Qualify the local D2 Gas Station implementation.

Usage:
  node scripts/gas-d2-qualification.mjs [--output <path>]

Options:
  --output <path>  Sanitized JSON report path (default: ${DEFAULT_REPORT_PATH})
  --help           Show this help
`;

export function parseQualificationArgs(values) {
  let outputPath = DEFAULT_REPORT_PATH;

  for (let index = 0; index < values.length; index += 1) {
    const argument = values[index];
    if (argument === "--help") return { help: true, outputPath };
    if (argument !== "--output") throw new Error(`Unknown option: ${argument}`);

    const value = values[index + 1];
    if (!value || value.startsWith("--")) throw new Error("--output requires a value");
    outputPath = value;
    index += 1;
  }

  return { help: false, outputPath };
}

export function formatCommand(command, args) {
  return [command, ...args].map(quoteArgument).join(" ");
}

export async function executeCommand(command, args, options = {}) {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repositoryRoot,
      stdio: ["ignore", "inherit", "inherit"],
    });
    let settled = false;

    child.once("error", () => {
      if (settled) return;
      settled = true;
      resolve({ status: "launch_failed", exitCode: null, signal: null });
    });
    child.once("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      resolve({
        status: exitCode === 0 ? "passed" : "failed",
        exitCode,
        signal: signal ?? null,
      });
    });
  });
}

export async function readRepositoryState(cwd = repositoryRoot) {
  const headResult = await captureCommand("git", ["rev-parse", "HEAD"], cwd);
  const statusResult = await captureCommand("git", ["status", "--short"], cwd);
  const head = headResult.stdout.trim();
  const statusLines = statusResult.stdout.trim() ? statusResult.stdout.trim().split("\n") : [];

  return {
    head: /^[0-9a-f]{40}$/i.test(head) ? head : "unresolved",
    workingTree: {
      status:
        statusResult.exitCode === 0
          ? statusLines.length === 0
            ? "clean"
            : "modified"
          : "unresolved",
      changedPathCount: statusResult.exitCode === 0 ? statusLines.length : null,
    },
  };
}

export async function runQualification({
  commands = QUALIFICATION_COMMANDS,
  cwd = repositoryRoot,
  exec = executeCommand,
  now = () => new Date(),
  repositoryState = () => readRepositoryState(cwd),
} = {}) {
  const startedAt = timestamp(now);
  const before = await repositoryState();
  const checks = [];

  for (const specification of commands) {
    const checkStartedAt = timestamp(now);
    let outcome;

    try {
      outcome = normalizeOutcome(
        await exec(specification.command, [...specification.args], { cwd }),
      );
    } catch {
      outcome = { status: "launch_failed", exitCode: null, signal: null };
    }

    const completedAt = timestamp(now);
    checks.push({
      command: [specification.command, ...specification.args],
      commandText: formatCommand(specification.command, specification.args),
      startedAt: checkStartedAt,
      completedAt,
      durationMs: elapsed(checkStartedAt, completedAt),
      ...outcome,
    });
  }

  const after = await repositoryState();
  const failedChecks = checks.filter((check) => check.status !== "passed");

  return {
    schemaVersion: 1,
    status: failedChecks.length === 0 ? "passed" : "failed",
    startedAt,
    completedAt: timestamp(now),
    repository: { before, after },
    checks,
    failedCheckCount: failedChecks.length,
    exitCode: failedChecks.length === 0 ? 0 : 1,
  };
}

export async function writeQualificationReport(report, outputPath, cwd = repositoryRoot) {
  const resolvedPath = path.resolve(cwd, outputPath);
  await mkdir(path.dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return resolvedPath;
}

export async function main(
  values = process.argv.slice(2),
  { cwd = repositoryRoot, exec, now, repositoryState, writeReport = writeQualificationReport } = {},
) {
  const options = parseQualificationArgs(values);
  if (options.help) {
    console.log(usage);
    return 0;
  }

  const report = await runQualification({ cwd, exec, now, repositoryState });
  await writeReport(report, options.outputPath, cwd);

  for (const check of report.checks) {
    console.log(`${check.status}\t${check.exitCode ?? "n/a"}\t${check.commandText}`);
  }
  console.log(
    `D2 qualification ${report.status}; ${report.failedCheckCount} required check(s) failed; report is sanitized.`,
  );
  return report.exitCode;
}

async function captureCommand(command, args, cwd) {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let stdout = "";
    let settled = false;

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.once("error", () => {
      if (settled) return;
      settled = true;
      resolve({ exitCode: null, stdout: "" });
    });
    child.once("close", (exitCode) => {
      if (settled) return;
      settled = true;
      resolve({ exitCode, stdout });
    });
  });
}

function normalizeOutcome(value) {
  if (value?.status === "launch_failed") {
    return { status: "launch_failed", exitCode: null, signal: null };
  }

  const exitCode = Number.isInteger(value?.exitCode) ? value.exitCode : null;
  if (exitCode !== null) {
    return {
      status: exitCode === 0 ? "passed" : "failed",
      exitCode,
      signal: typeof value.signal === "string" ? value.signal : null,
    };
  }

  return { status: "failed", exitCode: null, signal: null };
}

function timestamp(now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function elapsed(startedAt, completedAt) {
  return Math.max(0, Date.parse(completedAt) - Date.parse(startedAt));
}

function quoteArgument(value) {
  if (/^[A-Za-z0-9_./:=<>@+,-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `"'"'`)}'`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exitCode = await main();
  } catch {
    console.error("D2 qualification could not complete; no command output was persisted.");
    process.exitCode = 1;
  }
}
