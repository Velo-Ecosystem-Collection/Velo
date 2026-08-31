import { StrKey } from "@stellar/stellar-sdk";

import type { CanonicalArgumentValue } from "@repo/stellar";

export const PLAYGROUND_HISTORY_STORAGE_KEY = "velo:playground:history:v1";
export const PLAYGROUND_HISTORY_MAX_ENTRIES = 50;
export const PLAYGROUND_HISTORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_STORED_BYTES = 256 * 1_024;

export type PlaygroundHistoryEntryV1 = {
  schemaVersion: 1;
  id: string;
  kind: "contract" | "request";
  createdAt: string;
  network: "testnet" | "mainnet";
  contractId: string;
  wasmHash: string;
  specHash: string;
  functionName?: string;
  arguments?: Record<string, CanonicalArgumentValue>;
  replayable: boolean;
  privacyReason?: string;
  status?: "loaded" | "simulated" | "pending" | "success" | "failed" | "unknown";
  transactionHash?: string;
};

export type PlaygroundHistoryStoreV1 = {
  schemaVersion: 1;
  entries: PlaygroundHistoryEntryV1[];
};

export type PlaygroundStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validHash(value: unknown) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function validEntry(value: unknown): value is PlaygroundHistoryEntryV1 {
  if (!record(value)) return false;
  return (
    value.schemaVersion === 1 &&
    typeof value.id === "string" &&
    (value.kind === "contract" || value.kind === "request") &&
    typeof value.createdAt === "string" &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    (value.network === "testnet" || value.network === "mainnet") &&
    typeof value.contractId === "string" &&
    StrKey.isValidContract(value.contractId) &&
    validHash(value.wasmHash) &&
    validHash(value.specHash) &&
    typeof value.replayable === "boolean" &&
    (value.functionName === undefined || typeof value.functionName === "string") &&
    (value.arguments === undefined || record(value.arguments)) &&
    (value.transactionHash === undefined ||
      (typeof value.transactionHash === "string" &&
        /^[a-f0-9]{64}$/i.test(value.transactionHash))) &&
    (value.status === undefined ||
      ["loaded", "simulated", "pending", "success", "failed", "unknown"].includes(
        String(value.status),
      ))
  );
}

export function prunePlaygroundHistory(
  entries: PlaygroundHistoryEntryV1[],
  now = Date.now(),
): PlaygroundHistoryEntryV1[] {
  return entries
    .filter((entry) => validEntry(entry))
    .filter((entry) => now - Date.parse(entry.createdAt) <= PLAYGROUND_HISTORY_RETENTION_MS)
    .map((entry) => {
      if (!entry.arguments || !containsSecretLookingValue(entry.arguments)) return entry;
      const { arguments: _arguments, ...safe } = entry;
      return {
        ...safe,
        replayable: false,
        privacyReason: "Arguments were removed because they may contain sensitive values.",
      };
    })
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, PLAYGROUND_HISTORY_MAX_ENTRIES);
}

export function parsePlaygroundHistory(
  raw: string | null,
  now = Date.now(),
): PlaygroundHistoryStoreV1 {
  if (!raw || new TextEncoder().encode(raw).byteLength > MAX_STORED_BYTES) {
    return { schemaVersion: 1, entries: [] };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!record(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries)) {
      return { schemaVersion: 1, entries: [] };
    }
    return { schemaVersion: 1, entries: prunePlaygroundHistory(parsed.entries, now) };
  } catch {
    return { schemaVersion: 1, entries: [] };
  }
}

const SECRET_FIELD =
  /(?:^|[_-])(secret|seed|private(?:[_-]?key)?|mnemonic|password|token)(?:$|[_-])/i;
const SECRET_TEXT =
  /(?:bearer\s+[a-z0-9._~+/=-]{16,}|(?:api[_-]?key|private[_-]?key|seed|mnemonic)\s*[:=]\s*\S{12,})/i;

export function containsSecretLookingValue(value: unknown, key = "", depth = 0): boolean {
  if (depth > 12 || SECRET_FIELD.test(key)) return true;
  if (typeof value === "string") {
    return StrKey.isValidEd25519SecretSeed(value) || SECRET_TEXT.test(value);
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsSecretLookingValue(item, key, depth + 1));
  }
  if (record(value)) {
    return Object.entries(value).some(([childKey, child]) =>
      containsSecretLookingValue(child, childKey, depth + 1),
    );
  }
  return false;
}

export function sanitizeHistoryArguments(
  value: Record<string, CanonicalArgumentValue>,
):
  | { replayable: true; arguments: Record<string, CanonicalArgumentValue> }
  | { replayable: false; privacyReason: string } {
  if (containsSecretLookingValue(value)) {
    return {
      replayable: false,
      privacyReason: "Arguments were not stored because they may contain sensitive values.",
    };
  }
  return { replayable: true, arguments: structuredClone(value) };
}

export class PlaygroundHistoryRepository {
  private readonly storage: PlaygroundStorage;
  private readonly now: () => number;

  constructor(storage: PlaygroundStorage, now: () => number = Date.now) {
    this.storage = storage;
    this.now = now;
  }

  load(): PlaygroundHistoryStoreV1 {
    try {
      return parsePlaygroundHistory(
        this.storage.getItem(PLAYGROUND_HISTORY_STORAGE_KEY),
        this.now(),
      );
    } catch {
      return { schemaVersion: 1, entries: [] };
    }
  }

  replace(entries: PlaygroundHistoryEntryV1[]): PlaygroundHistoryStoreV1 {
    const store = {
      schemaVersion: 1 as const,
      entries: prunePlaygroundHistory(entries, this.now()),
    };
    try {
      this.storage.setItem(PLAYGROUND_HISTORY_STORAGE_KEY, JSON.stringify(store));
    } catch {
      // Private browsing and quota failures must not break the primary flow.
    }
    return store;
  }

  upsert(entry: PlaygroundHistoryEntryV1): PlaygroundHistoryStoreV1 {
    const current = this.load().entries.filter((candidate) => candidate.id !== entry.id);
    return this.replace([entry, ...current]);
  }

  remove(id: string): PlaygroundHistoryStoreV1 {
    return this.replace(this.load().entries.filter((entry) => entry.id !== id));
  }

  clear(): PlaygroundHistoryStoreV1 {
    try {
      this.storage.removeItem(PLAYGROUND_HISTORY_STORAGE_KEY);
    } catch {
      // Treat unavailable storage as already cleared.
    }
    return { schemaVersion: 1, entries: [] };
  }
}
