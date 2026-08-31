import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

import { env } from "../_generated/server";
import { requireIdentity } from "../projects/helpers";

export type ProjectRole = "owner" | "editor" | "viewer";
const ROLE_RANK: Record<ProjectRole, number> = { viewer: 1, editor: 2, owner: 3 };
const HASH_PATTERN = /^[a-f0-9]{64}$/i;
const VARIABLE_NAME_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
const SECRET_NAME_PATTERN = /(?:^|_)(SECRET|SEED|PRIVATE_KEY|MNEMONIC|PASSWORD|TOKEN)(?:_|$)/i;
const SECRET_TEXT_PATTERN =
  /(?:bearer\s+[a-z0-9._~+/=-]{16,}|(?:api[_-]?key|private[_-]?key|seed|mnemonic)\s*[:=]\s*\S{12,})/i;

export function normalizeWalletAddress(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!/^G[A-Z2-7]{55}$/.test(normalized)) throw new Error("Invalid Stellar wallet address");
  return normalized;
}

export function normalizeContractId(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!/^C[A-Z2-7]{55}$/.test(normalized)) throw new Error("Invalid Stellar contract ID");
  return normalized;
}

export function normalizeHash(value: string, label: string) {
  const normalized = value.trim().toLowerCase();
  if (!HASH_PATTERN.test(normalized)) throw new Error(`Invalid ${label}`);
  return normalized;
}

export function normalizeTags(tags: string[]) {
  return Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean))).slice(0, 20);
}

export function safeOptionalUrl(value?: string) {
  if (!value?.trim()) return undefined;
  const url = new URL(value.trim());
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Invalid URL");
  return url.toString();
}

export async function requireProjectRole(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
  minimum: ProjectRole,
) {
  const identity = await requireIdentity(ctx);
  const project = await ctx.db.get(projectId);
  if (!project) throw new Error("Project not found");
  const address = normalizeWalletAddress(String(identity.subject));

  let role: ProjectRole | null =
    project.ownerTokenIdentifier === identity.tokenIdentifier || project.ownerAddress === address
      ? "owner"
      : null;
  if (!role) {
    const membership = await ctx.db
      .query("projectMemberships")
      .withIndex("by_project_and_wallet_address", (q) =>
        q.eq("projectId", projectId).eq("walletAddress", address),
      )
      .unique();
    role = membership?.role ?? null;
  }
  if (!role) throw new Error("Unauthorized");
  if (ROLE_RANK[role] < ROLE_RANK[minimum]) {
    throw new Error(`${minimum === "editor" ? "Editor" : "Owner"} access required`);
  }
  return { identity, project, address, role };
}

export async function requireProjectRoleByToken(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
  tokenIdentifier: string,
  subject: string,
  minimum: ProjectRole,
) {
  const project = await ctx.db.get(projectId);
  if (!project) throw new Error("Project not found");
  const address = normalizeWalletAddress(subject);
  let role: ProjectRole | null =
    project.ownerTokenIdentifier === tokenIdentifier || project.ownerAddress === address
      ? "owner"
      : null;
  if (!role) {
    role =
      (
        await ctx.db
          .query("projectMemberships")
          .withIndex("by_project_and_wallet_address", (q) =>
            q.eq("projectId", projectId).eq("walletAddress", address),
          )
          .unique()
      )?.role ?? null;
  }
  if (!role) throw new Error("Unauthorized");
  if (ROLE_RANK[role] < ROLE_RANK[minimum]) {
    throw new Error(`${minimum === "editor" ? "Editor" : "Owner"} access required`);
  }
  return { project, address, role };
}

export function normalizeVariable(name: string, value: string) {
  const normalizedName = name.trim().toUpperCase();
  const normalizedValue = value.trim();
  if (!VARIABLE_NAME_PATTERN.test(normalizedName)) {
    throw new Error("Variable names must use uppercase letters, numbers, and underscores");
  }
  if (
    SECRET_NAME_PATTERN.test(normalizedName) ||
    SECRET_TEXT_PATTERN.test(normalizedValue) ||
    /^S[A-Z2-7]{55}$/.test(normalizedValue.toUpperCase())
  ) {
    throw new Error("Playground variables cannot contain secret material");
  }
  if (normalizedValue.length > 4096) throw new Error("Variable value is too large");
  return { name: normalizedName, value: normalizedValue };
}

export function assertBoundedJson(value: unknown, label = "payload", maxBytes = 256 * 1024) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined || new TextEncoder().encode(serialized).byteLength > maxBytes) {
    throw new Error(`${label} is too large`);
  }
  if (
    SECRET_TEXT_PATTERN.test(serialized) ||
    /"(?:secret|seed|privateKey|mnemonic)"\s*:/i.test(serialized)
  ) {
    throw new Error(`${label} contains secret-looking data`);
  }
  return structuredClone(value);
}

export function parseBoundedJson(value: string, label = "payload", maxBytes = 256 * 1024) {
  if (new TextEncoder().encode(value).byteLength > maxBytes) {
    throw new Error(`${label} is too large`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
  assertBoundedJson(parsed, label, maxBytes);
  return parsed;
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyPersistenceProof(payload: unknown, proof: string) {
  const secret = env.VELO_PLAYGROUND_PERSISTENCE_SECRET;
  if (!secret) {
    if (proof === "development" && env.VELO_DEPLOYMENT_ENVIRONMENT !== "production") return;
    throw new Error("Project execution persistence is unavailable");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(stableStringify(payload)),
  );
  const expected = Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (expected.length !== proof.length) throw new Error("Invalid execution persistence proof");
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ proof.charCodeAt(index);
  }
  if (mismatch !== 0) throw new Error("Invalid execution persistence proof");
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function stripPublicSnapshotArguments(snapshotJson: string, includeArguments: boolean) {
  const bounded = parseBoundedJson(snapshotJson, "Share snapshot", 128 * 1024) as Record<
    string,
    unknown
  >;
  if (!includeArguments) {
    const { argumentTemplate: _argumentTemplate, arguments: _arguments, ...safe } = bounded;
    return JSON.stringify(safe);
  }
  const serialized = JSON.stringify(bounded);
  if (serialized.includes('"$variable"')) {
    throw new Error("Public shares cannot contain project variable references");
  }
  return JSON.stringify(bounded);
}
