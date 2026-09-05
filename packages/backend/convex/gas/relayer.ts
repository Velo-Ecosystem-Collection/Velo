"use node";

import { Keypair } from "@stellar/stellar-sdk";
import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import type { GasRelayerMetadataLookup } from "./public_api_internal";

import { internal } from "../_generated/api";
import { env, internalAction } from "../_generated/server";
import { GAS_NETWORK } from "./types";

export const GAS_RELAYER_SIGNERS_ENV = "VELO_GAS_TESTNET_RELAYER_SIGNERS_JSON" as const;
export const GAS_MAX_RELAYER_SIGNERS_JSON_BYTES = 64 * 1024;
export const GAS_MAX_RELAYER_SIGNER_ENTRIES = 128;

const MAX_PROJECT_ID_BYTES = 128;
const RELAYER_CONFIGURATION_UNAVAILABLE = "configuration_unavailable" as const;
const RELAYER_CONFIGURATION_MISMATCH = "configuration_mismatch" as const;
const RELAYER_METADATA_UNAVAILABLE = "metadata_unavailable" as const;
const RELAYER_METADATA_DISABLED = "metadata_disabled" as const;

export type RelayerReadinessStatus =
  | "ready"
  | typeof RELAYER_METADATA_UNAVAILABLE
  | typeof RELAYER_METADATA_DISABLED
  | typeof RELAYER_CONFIGURATION_UNAVAILABLE
  | typeof RELAYER_CONFIGURATION_MISMATCH;

export type RelayerReadiness = {
  status: RelayerReadinessStatus;
  network: typeof GAS_NETWORK;
  publicKey: string | null;
};

export const relayerReadinessValidator = v.object({
  status: v.union(
    v.literal("ready"),
    v.literal(RELAYER_METADATA_UNAVAILABLE),
    v.literal(RELAYER_METADATA_DISABLED),
    v.literal(RELAYER_CONFIGURATION_UNAVAILABLE),
    v.literal(RELAYER_CONFIGURATION_MISMATCH),
  ),
  network: v.literal(GAS_NETWORK),
  publicKey: v.union(v.string(), v.null()),
});

export type TestnetRelayerSigner = Readonly<{
  publicKey: string;
  sign(payload: Uint8Array): Uint8Array;
}>;

export class RelayerCustodyError extends Error {
  readonly status: Exclude<RelayerReadinessStatus, "ready">;

  constructor(status: Exclude<RelayerReadinessStatus, "ready">) {
    super(`Relayer custody unavailable: ${status}`);
    this.name = "RelayerCustodyError";
    this.status = status;
  }
}

type ParsedSigner = Readonly<{
  projectId: string;
  publicKey: string;
  keypair: Keypair;
}>;

type ResolvedRelayer =
  | (RelayerReadiness & { status: "ready"; keypair: Keypair })
  | (RelayerReadiness & { status: Exclude<RelayerReadinessStatus, "ready"> });

function unavailable(status: Exclude<RelayerReadinessStatus, "ready">): ResolvedRelayer {
  return { status, network: GAS_NETWORK, publicKey: null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactSignerEntryShape(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value).sort();
  return (
    keys.length === 3 && keys[0] === "network" && keys[1] === "projectId" && keys[2] === "secretKey"
  );
}

function parseSignerConfiguration(
  rawConfiguration: string | undefined,
):
  | { ok: true; entries: ParsedSigner[] }
  | { ok: false; status: Exclude<RelayerReadinessStatus, "ready"> } {
  if (rawConfiguration === undefined || rawConfiguration.trim() === "") {
    return { ok: false, status: RELAYER_CONFIGURATION_UNAVAILABLE };
  }

  if (new TextEncoder().encode(rawConfiguration).byteLength > GAS_MAX_RELAYER_SIGNERS_JSON_BYTES) {
    return { ok: false, status: RELAYER_CONFIGURATION_MISMATCH };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawConfiguration);
  } catch {
    return { ok: false, status: RELAYER_CONFIGURATION_MISMATCH };
  }

  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.length > GAS_MAX_RELAYER_SIGNER_ENTRIES
  ) {
    return { ok: false, status: RELAYER_CONFIGURATION_MISMATCH };
  }

  const projectIds = new Set<string>();
  const secretKeys = new Set<string>();
  const publicKeys = new Set<string>();
  const entries: ParsedSigner[] = [];

  for (const candidate of parsed) {
    if (!isRecord(candidate) || !hasExactSignerEntryShape(candidate)) {
      return { ok: false, status: RELAYER_CONFIGURATION_MISMATCH };
    }

    const projectId = candidate.projectId;
    const network = candidate.network;
    const secretKey = candidate.secretKey;
    if (
      typeof projectId !== "string" ||
      projectId.length === 0 ||
      projectId.trim() !== projectId ||
      new TextEncoder().encode(projectId).byteLength > MAX_PROJECT_ID_BYTES ||
      network !== GAS_NETWORK ||
      typeof secretKey !== "string" ||
      secretKey.length === 0
    ) {
      return { ok: false, status: RELAYER_CONFIGURATION_MISMATCH };
    }

    if (projectIds.has(projectId) || secretKeys.has(secretKey)) {
      return { ok: false, status: RELAYER_CONFIGURATION_MISMATCH };
    }

    let keypair: Keypair;
    let publicKey: string;
    try {
      keypair = Keypair.fromSecret(secretKey);
      publicKey = keypair.publicKey();
    } catch {
      return { ok: false, status: RELAYER_CONFIGURATION_MISMATCH };
    }

    if (publicKeys.has(publicKey)) {
      return { ok: false, status: RELAYER_CONFIGURATION_MISMATCH };
    }

    projectIds.add(projectId);
    secretKeys.add(secretKey);
    publicKeys.add(publicKey);
    entries.push({ projectId, publicKey, keypair });
  }

  return { ok: true, entries };
}

function normalizeMetadataPublicKey(metadata: GasRelayerMetadataLookup): string | null {
  if (!metadata || metadata.status === "ambiguous") return null;

  try {
    const normalized = Keypair.fromPublicKey(metadata.publicKey).publicKey();
    return normalized === metadata.publicKey ? normalized : null;
  } catch {
    return null;
  }
}

async function resolveRelayer(ctx: ActionCtx, projectId: Id<"projects">): Promise<ResolvedRelayer> {
  const configuration = parseSignerConfiguration(env.VELO_GAS_TESTNET_RELAYER_SIGNERS_JSON);
  if (!configuration.ok) return unavailable(configuration.status);

  const configured = configuration.entries.find((entry) => entry.projectId === projectId);
  if (!configured) return unavailable(RELAYER_CONFIGURATION_MISMATCH);

  let metadata: GasRelayerMetadataLookup;
  try {
    metadata = await ctx.runQuery(internal.gas.public_api_internal.getRelayerMetadata, {
      projectId,
    });
  } catch {
    return unavailable(RELAYER_METADATA_UNAVAILABLE);
  }

  if (!metadata || metadata.status === "ambiguous") {
    return unavailable(RELAYER_METADATA_UNAVAILABLE);
  }
  if (metadata.status === "disabled") return unavailable(RELAYER_METADATA_DISABLED);

  const metadataPublicKey = normalizeMetadataPublicKey(metadata);
  if (metadataPublicKey === null) return unavailable(RELAYER_METADATA_UNAVAILABLE);
  if (metadata.network !== GAS_NETWORK || metadataPublicKey !== configured.publicKey) {
    return unavailable(RELAYER_CONFIGURATION_MISMATCH);
  }

  return {
    status: "ready",
    network: GAS_NETWORK,
    publicKey: configured.publicKey,
    keypair: configured.keypair,
  };
}

/**
 * Run a trusted signing operation with a signer that exists only for the callback.
 * The seed and SDK keypair never cross this callback boundary.
 */
export async function withTestnetRelayerSigner<T>(
  ctx: ActionCtx,
  projectId: Id<"projects">,
  callback: (signer: TestnetRelayerSigner) => Promise<T> | T,
): Promise<T> {
  const resolved = await resolveRelayer(ctx, projectId);
  if (resolved.status !== "ready") throw new RelayerCustodyError(resolved.status);

  const keypair = resolved.keypair;
  const publicKey = resolved.publicKey;
  if (publicKey === null) throw new RelayerCustodyError(RELAYER_CONFIGURATION_MISMATCH);
  const signer = Object.freeze({
    publicKey,
    sign(payload: Uint8Array): Uint8Array {
      if (!(payload instanceof Uint8Array)) throw new Error("Invalid relayer signing payload");
      return keypair.sign(Buffer.from(payload));
    },
  });

  return await callback(signer);
}

/** Return only redacted Testnet custody readiness for internal preflight tooling. */
export const readiness = internalAction({
  args: { projectId: v.id("projects") },
  returns: relayerReadinessValidator,
  handler: async (ctx, args): Promise<RelayerReadiness> => {
    const resolved = await resolveRelayer(ctx, args.projectId);
    if (resolved.status !== "ready") {
      return {
        status: resolved.status,
        network: GAS_NETWORK,
        publicKey: null,
      };
    }

    return {
      status: "ready",
      network: GAS_NETWORK,
      publicKey: resolved.publicKey,
    };
  },
});
