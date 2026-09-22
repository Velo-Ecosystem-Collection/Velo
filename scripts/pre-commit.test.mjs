import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const resolver = join(process.cwd(), "scripts/resolve-pnpm.sh");

test("resolves a pnpm fallback when Git's PATH omits pnpm", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velo-pnpm-resolver-"));
  const fallback = join(directory, "pnpm");
  await writeFile(fallback, "#!/bin/sh\nexit 0\n");
  await chmod(fallback, 0o755);

  const result = spawnSync("/bin/sh", [resolver, fallback], {
    env: { PATH: directory },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), fallback);
});

test("fails clearly when pnpm is unavailable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velo-pnpm-resolver-"));

  const result = spawnSync("/bin/sh", [resolver, join(directory, "missing-pnpm")], {
    env: { PATH: directory },
    encoding: "utf8",
  });

  assert.equal(result.status, 127);
  assert.match(result.stderr, /requires pnpm/);
});
