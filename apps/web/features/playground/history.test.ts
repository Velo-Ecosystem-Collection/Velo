import assert from "node:assert/strict";
import test from "node:test";

import {
  containsSecretLookingValue,
  parsePlaygroundHistory,
  PlaygroundHistoryRepository,
  PLAYGROUND_HISTORY_MAX_ENTRIES,
  sanitizeHistoryArguments,
} from "./history.ts";

const contractId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
const hash = "a".repeat(64);
const entry = (index = 0) => ({
  schemaVersion: 1 as const,
  id: `entry-${index}`,
  kind: "request" as const,
  createdAt: new Date(Date.UTC(2026, 6, 27) - index * 1_000).toISOString(),
  network: "testnet" as const,
  contractId,
  wasmHash: hash,
  specHash: hash,
  replayable: true,
});

test("history parsing rejects corrupt and expired storage and caps newest entries", () => {
  assert.deepEqual(parsePlaygroundHistory("{broken"), { schemaVersion: 1, entries: [] });
  const entries = Array.from({ length: 60 }, (_, index) => entry(index));
  const parsed = parsePlaygroundHistory(
    JSON.stringify({ schemaVersion: 1, entries }),
    Date.UTC(2026, 6, 27),
  );
  assert.equal(parsed.entries.length, PLAYGROUND_HISTORY_MAX_ENTRIES);
  assert.equal(parsed.entries[0]!.id, "entry-0");
  const expired = entry();
  expired.createdAt = new Date(Date.UTC(2026, 4, 1)).toISOString();
  assert.equal(
    parsePlaygroundHistory(
      JSON.stringify({ schemaVersion: 1, entries: [expired] }),
      Date.UTC(2026, 6, 27),
    ).entries.length,
    0,
  );
});

test("history secret detection protects seeds, named fields, and bearer values", () => {
  assert.equal(containsSecretLookingValue({ private_key: "not-even-a-real-key" }), true);
  assert.equal(containsSecretLookingValue({ note: "Bearer abcdefghijklmnopqrstuvwxyz" }), true);
  assert.equal(containsSecretLookingValue({ greeting: "hello", amount: "10" }), false);
  assert.equal(sanitizeHistoryArguments({ greeting: "hello" }).replayable, true);
  assert.equal(sanitizeHistoryArguments({ seed: "hidden" }).replayable, false);
  const unsafe = { ...entry(), arguments: { private_key: "hidden" } };
  const restored = parsePlaygroundHistory(
    JSON.stringify({ schemaVersion: 1, entries: [unsafe] }),
    Date.UTC(2026, 6, 27),
  ).entries[0]!;
  assert.equal(restored.replayable, false);
  assert.equal(restored.arguments, undefined);
});

test("repository tolerates unavailable storage and supports upsert, remove, and clear", () => {
  const memory = new Map<string, string>();
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
  };
  const repository = new PlaygroundHistoryRepository(storage, () => Date.UTC(2026, 6, 27));
  assert.equal(repository.upsert(entry()).entries.length, 1);
  assert.equal(repository.remove("entry-0").entries.length, 0);
  repository.upsert(entry());
  assert.equal(repository.clear().entries.length, 0);

  const unavailable = new PlaygroundHistoryRepository({
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  });
  assert.deepEqual(unavailable.load(), { schemaVersion: 1, entries: [] });
  assert.doesNotThrow(() => unavailable.upsert(entry()));
});
