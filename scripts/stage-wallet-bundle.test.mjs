import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { stageImmutableWalletBundle, stageWalletBundle } from "./stage-wallet-bundle-lib.mjs";

test("preserves an archived release while publishing a newer alias", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "velo-wallet-stage-"));
  try {
    const oldSource = path.join(root, "old.js");
    const newSource = path.join(root, "new.js");
    const oldDestination = path.join(root, "public/v1.0.0/velo-wallet.js");
    const newDestination = path.join(root, "public/v1.0.1/velo-wallet.js");
    const latestDestination = path.join(root, "public/v1/velo-wallet.js");
    await writeFile(oldSource, "old deployed release");
    await writeFile(newSource, "new release");

    await stageImmutableWalletBundle({ source: oldSource, versionedDestination: oldDestination });
    await stageWalletBundle({
      source: newSource,
      latestDestination,
      versionedDestination: newDestination,
    });

    assert.equal(await readFile(oldDestination, "utf8"), "old deployed release");
    assert.equal(await readFile(newDestination, "utf8"), "new release");
    assert.equal(await readFile(latestDestination, "utf8"), "new release");
    await writeFile(oldDestination, "unexpected existing asset");
    await assert.rejects(
      stageImmutableWalletBundle({ source: oldSource, versionedDestination: oldDestination }),
      /Refusing to overwrite existing versioned CDN asset/,
    );
    assert.equal(await readFile(latestDestination, "utf8"), "new release");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("creates a new versioned artifact and updates the mutable v1 alias", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "velo-wallet-stage-"));
  try {
    const source = path.join(root, "bundle.js");
    const latestDestination = path.join(root, "public/v1/velo-wallet.js");
    const versionedDestination = path.join(root, "public/v1.0.0/velo-wallet.js");
    await writeFile(source, "release bundle");

    const result = await stageWalletBundle({ source, latestDestination, versionedDestination });
    assert.deepEqual(result, { versionedCreated: true });
    assert.equal(await readFile(latestDestination, "utf8"), "release bundle");
    assert.equal(await readFile(versionedDestination, "utf8"), "release bundle");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refuses to overwrite a different versioned artifact before changing the v1 alias", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "velo-wallet-stage-"));
  try {
    const source = path.join(root, "bundle.js");
    const latestDestination = path.join(root, "public/v1/velo-wallet.js");
    const versionedDestination = path.join(root, "public/v1.0.0/velo-wallet.js");
    await writeFile(source, "new release bundle");
    await mkdir(path.dirname(latestDestination), { recursive: true });
    await mkdir(path.dirname(versionedDestination), { recursive: true });
    await writeFile(latestDestination, "existing alias");
    await writeFile(versionedDestination, "existing versioned release");

    await assert.rejects(
      stageWalletBundle({ source, latestDestination, versionedDestination }),
      /Refusing to overwrite existing versioned CDN asset/,
    );
    assert.equal(await readFile(latestDestination, "utf8"), "existing alias");
    assert.equal(await readFile(versionedDestination, "utf8"), "existing versioned release");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("allows idempotent staging when the immutable version already matches", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "velo-wallet-stage-"));
  try {
    const source = path.join(root, "bundle.js");
    const latestDestination = path.join(root, "public/v1/velo-wallet.js");
    const versionedDestination = path.join(root, "public/v1.0.0/velo-wallet.js");
    await writeFile(source, "same release bundle");
    await mkdir(path.dirname(versionedDestination), { recursive: true });
    await writeFile(versionedDestination, "same release bundle");

    const result = await stageWalletBundle({ source, latestDestination, versionedDestination });
    assert.deepEqual(result, { versionedCreated: false });
    assert.equal(await readFile(latestDestination, "utf8"), "same release bundle");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
