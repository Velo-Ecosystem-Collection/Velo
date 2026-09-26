"use node";

import { Keypair } from "@stellar/stellar-sdk";
import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import type { GasCustodyContext, GasEncryptedSecret } from "./custody_crypto";
import type { GasRelayerCustodyLookup } from "./custody_internal";
import type { TestnetRelayerSigner } from "./custody_provider";
import type { GasRelayerMetadataLookup } from "./public_api_internal";

import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import {
  GasCustodyCryptoError,
  parseGasCustodyKeyring,
  type GasCustodyKeyring,
} from "./custody_crypto";
import {
  createSigner,
  EncryptedConvexGasRelayerCustodyProvider,
  type GasRelayerCustodyProvider,
} from "./custody_provider";
import { getGasRuntimeEnv } from "./runtime_env";
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

const custodyConfigurationStatusValidator = v.object({
  deploymentId: v.union(v.string(), v.null()),
  network: v.literal(GAS_NETWORK),
  provisioningEnabled: v.boolean(),
  keyringStatus: v.union(v.literal("valid"), v.literal("missing"), v.literal("invalid")),
  activeKeyVersion: v.union(v.string(), v.null()),
  keyVersionCount: v.number(),
});

export type { TestnetRelayerSigner } from "./custody_provider";

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

type ManagedSignerContext = Readonly<{
  provider: GasRelayerCustodyProvider;
  context: Omit<GasCustodyContext, "keyVersion">;
  encrypted: GasEncryptedSecret;
}>;

type ResolvedRelayer =
  | (RelayerReadiness & { status: "ready"; keypair: Keypair; managedSigner?: never })
  | (RelayerReadiness & { status: "ready"; keypair?: never; managedSigner: ManagedSignerContext })
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

async function resolveRelayer(
  ctx: ActionCtx,
  projectId: Id<"projects">,
  options: { allowDisabled?: boolean; requireManaged?: boolean } = {},
): Promise<ResolvedRelayer> {
  const runtimeEnv = getGasRuntimeEnv();
  let metadata: GasRelayerMetadataLookup;
  let custody: GasRelayerCustodyLookup;
  try {
    [metadata, custody] = await Promise.all([
      ctx.runQuery(internal.gas.public_api_internal.getRelayerMetadata, { projectId }),
      ctx.runQuery(internal.gas.execution.getCustodyRecord, { projectId }),
    ]);
  } catch {
    return unavailable(RELAYER_METADATA_UNAVAILABLE);
  }

  if (!metadata || metadata.status === "ambiguous") {
    return unavailable(RELAYER_METADATA_UNAVAILABLE);
  }
  if (metadata.status === "disabled" && options.allowDisabled !== true) {
    return unavailable(RELAYER_METADATA_DISABLED);
  }

  const metadataPublicKey = normalizeMetadataPublicKey(metadata);
  if (metadataPublicKey === null) return unavailable(RELAYER_METADATA_UNAVAILABLE);
  if (metadata.network !== GAS_NETWORK) {
    return unavailable(RELAYER_CONFIGURATION_MISMATCH);
  }

  if (custody?.status === "ambiguous") return unavailable(RELAYER_METADATA_UNAVAILABLE);
  if (custody) {
    if (custody.status !== "ready") return unavailable(RELAYER_CONFIGURATION_UNAVAILABLE);
    if (
      !custody.publicKey ||
      !custody.deploymentId ||
      !custody.keyVersion ||
      !custody.nonce ||
      !custody.ciphertext ||
      !custody.authTag ||
      custody.publicKey !== metadataPublicKey
    ) {
      return unavailable(RELAYER_CONFIGURATION_MISMATCH);
    }
    const configuredDeploymentId = runtimeEnv.VELO_GAS_CUSTODY_DEPLOYMENT_ID?.trim();
    if (!configuredDeploymentId || configuredDeploymentId !== custody.deploymentId) {
      return unavailable(RELAYER_CONFIGURATION_MISMATCH);
    }

    try {
      const keyring = parseGasCustodyKeyring(runtimeEnv.VELO_GAS_CUSTODY_KEYRING_JSON);
      return {
        status: "ready",
        network: GAS_NETWORK,
        publicKey: custody.publicKey,
        managedSigner: {
          provider: new EncryptedConvexGasRelayerCustodyProvider(keyring),
          context: {
            deploymentId: configuredDeploymentId,
            projectId,
            network: GAS_NETWORK,
            publicKey: custody.publicKey,
          },
          encrypted: {
            keyVersion: custody.keyVersion,
            nonce: custody.nonce,
            ciphertext: custody.ciphertext,
            authTag: custody.authTag,
          },
        },
      };
    } catch (error) {
      if (error instanceof GasCustodyCryptoError && error.code === "configuration_unavailable") {
        return unavailable(RELAYER_CONFIGURATION_UNAVAILABLE);
      }
      return unavailable(RELAYER_CONFIGURATION_MISMATCH);
    }
  }

  if (options.requireManaged === true) return unavailable(RELAYER_CONFIGURATION_UNAVAILABLE);

  // Compatibility provider for previously configured manual relayers. It is
  // reachable only when no managed custody record exists for this project.
  const configuration = parseSignerConfiguration(runtimeEnv.VELO_GAS_TESTNET_RELAYER_SIGNERS_JSON);
  if (!configuration.ok) return unavailable(configuration.status);
  const configured = configuration.entries.find((entry) => entry.projectId === projectId);
  if (!configured || metadataPublicKey !== configured.publicKey) {
    return unavailable(RELAYER_CONFIGURATION_MISMATCH);
  }

  return {
    status: "ready",
    network: GAS_NETWORK,
    publicKey: configured.publicKey,
    keypair: configured.keypair,
  };
}

async function withResolvedSigner<T>(
  resolved: ResolvedRelayer,
  callback: (signer: TestnetRelayerSigner) => Promise<T> | T,
): Promise<T> {
  if (resolved.status !== "ready") throw new RelayerCustodyError(resolved.status);
  if (resolved.managedSigner) {
    try {
      return await resolved.managedSigner.provider.withSigner(
        resolved.managedSigner.context,
        resolved.managedSigner.encrypted,
        callback,
      );
    } catch (error) {
      if (error instanceof GasCustodyCryptoError && error.code === "configuration_unavailable") {
        throw new RelayerCustodyError(RELAYER_CONFIGURATION_UNAVAILABLE);
      }
      if (error instanceof GasCustodyCryptoError) {
        throw new RelayerCustodyError(RELAYER_CONFIGURATION_MISMATCH);
      }
      throw error;
    }
  }
  if (resolved.keypair) return await callback(createSigner(resolved.keypair));
  throw new RelayerCustodyError(RELAYER_CONFIGURATION_MISMATCH);
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
  return await withResolvedSigner(resolved, callback);
}

/** Withdrawal access requires encrypted managed custody even while metadata is paused. */
export async function withManagedTestnetRelayerSigner<T>(
  ctx: ActionCtx,
  projectId: Id<"projects">,
  callback: (signer: TestnetRelayerSigner) => Promise<T> | T,
): Promise<T> {
  const resolved = await resolveRelayer(ctx, projectId, {
    allowDisabled: true,
    requireManaged: true,
  });
  return await withResolvedSigner(resolved, callback);
}

/** Return only redacted Testnet custody readiness for internal preflight tooling. */
export const readiness = internalAction({
  args: { projectId: v.id("projects") },
  returns: relayerReadinessValidator,
  handler: async (ctx, args): Promise<RelayerReadiness> => {
    try {
      const publicKey = await withTestnetRelayerSigner(
        ctx,
        args.projectId,
        (signer) => signer.publicKey,
      );
      return {
        status: "ready",
        network: GAS_NETWORK,
        publicKey,
      };
    } catch (error) {
      return {
        status: error instanceof RelayerCustodyError ? error.status : RELAYER_METADATA_UNAVAILABLE,
        network: GAS_NETWORK,
        publicKey: null,
      };
    }
  },
});

/** Validate deployment custody configuration without returning any key material. */
export const custodyConfigurationStatus = internalAction({
  args: {},
  returns: custodyConfigurationStatusValidator,
  handler: async () => {
    const runtimeEnv = getGasRuntimeEnv();
    const deploymentId = runtimeEnv.VELO_GAS_CUSTODY_DEPLOYMENT_ID?.trim() || null;
    const provisioningEnabled = runtimeEnv.VELO_GAS_MANAGED_RELAYER_PROVISIONING_ENABLED === "true";

    try {
      const keyring = parseGasCustodyKeyring(runtimeEnv.VELO_GAS_CUSTODY_KEYRING_JSON);
      return {
        deploymentId,
        network: GAS_NETWORK,
        provisioningEnabled,
        keyringStatus: "valid" as const,
        activeKeyVersion: keyring.activeVersion,
        keyVersionCount: keyring.keys.size,
      };
    } catch (error) {
      return {
        deploymentId,
        network: GAS_NETWORK,
        provisioningEnabled,
        keyringStatus:
          error instanceof GasCustodyCryptoError && error.code === "configuration_unavailable"
            ? ("missing" as const)
            : ("invalid" as const),
        activeKeyVersion: null,
        keyVersionCount: 0,
      };
    }
  },
});

/** Provision one dedicated Testnet signer and persist only authenticated ciphertext. */
export const provisionProject = internalAction({
  args: { projectId: v.id("projects"), attemptToken: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const runtimeEnv = getGasRuntimeEnv();
    let record;
    try {
      record = await ctx.runQuery(internal.gas.execution.getCustodyRecord, {
        projectId: args.projectId,
      });
    } catch {
      return null;
    }
    if (
      !record ||
      record.status === "ambiguous" ||
      record.status !== "pending" ||
      record.attemptToken !== args.attemptToken
    ) {
      return null;
    }

    if (runtimeEnv.VELO_GAS_MANAGED_RELAYER_PROVISIONING_ENABLED !== "true") {
      await markProvisioningFailed(ctx, args, "provisioning_disabled");
      return null;
    }
    const deploymentId = runtimeEnv.VELO_GAS_CUSTODY_DEPLOYMENT_ID?.trim();
    if (!deploymentId) {
      await markProvisioningFailed(ctx, args, "configuration_unavailable");
      return null;
    }

    let keyring: GasCustodyKeyring;
    try {
      keyring = parseGasCustodyKeyring(runtimeEnv.VELO_GAS_CUSTODY_KEYRING_JSON);
    } catch (error) {
      const errorCode =
        error instanceof GasCustodyCryptoError && error.code === "configuration_unavailable"
          ? "configuration_unavailable"
          : "configuration_invalid";
      await markProvisioningFailed(ctx, args, errorCode);
      return null;
    }

    try {
      const provisioned = await new EncryptedConvexGasRelayerCustodyProvider(keyring).provision({
        deploymentId,
        projectId: args.projectId,
        network: GAS_NETWORK,
      });
      const result = await ctx.runMutation(internal.gas.execution.commitProvisionedCustody, {
        projectId: args.projectId,
        attemptToken: args.attemptToken,
        publicKey: provisioned.publicKey,
        deploymentId,
        ...provisioned.encrypted,
      });
      if (result === "conflict") {
        await markProvisioningFailed(ctx, args, "relayer_already_configured");
      }
    } catch {
      await markProvisioningFailed(ctx, args, "provisioning_failed");
    }
    return null;
  },
});

export const rotateCustodyEncryptionKey = internalAction({
  args: { projectId: v.id("projects") },
  returns: v.union(
    v.literal("rotated"),
    v.literal("already_current"),
    v.literal("stale"),
    v.literal("configuration_unavailable"),
    v.literal("configuration_invalid"),
    v.literal("custody_unavailable"),
  ),
  handler: async (
    ctx,
    args,
  ): Promise<
    | "rotated"
    | "already_current"
    | "stale"
    | "configuration_unavailable"
    | "configuration_invalid"
    | "custody_unavailable"
  > => {
    const runtimeEnv = getGasRuntimeEnv();
    const deploymentId = runtimeEnv.VELO_GAS_CUSTODY_DEPLOYMENT_ID?.trim();
    if (!deploymentId) return "configuration_unavailable";
    let keyring: GasCustodyKeyring;
    try {
      keyring = parseGasCustodyKeyring(runtimeEnv.VELO_GAS_CUSTODY_KEYRING_JSON);
    } catch (error) {
      return error instanceof GasCustodyCryptoError && error.code === "configuration_unavailable"
        ? "configuration_unavailable"
        : "configuration_invalid";
    }
    let custody;
    try {
      custody = await ctx.runQuery(internal.gas.execution.getCustodyRecord, {
        projectId: args.projectId,
      });
    } catch {
      return "custody_unavailable";
    }
    if (
      !custody ||
      custody.status === "ambiguous" ||
      custody.status !== "ready" ||
      !custody.publicKey ||
      !custody.deploymentId ||
      !custody.keyVersion ||
      !custody.nonce ||
      !custody.ciphertext ||
      !custody.authTag ||
      custody.deploymentId !== deploymentId
    ) {
      return "custody_unavailable";
    }
    if (custody.keyVersion === keyring.activeVersion) return "already_current";

    try {
      const encrypted = await new EncryptedConvexGasRelayerCustodyProvider(keyring).reencrypt(
        {
          deploymentId,
          projectId: args.projectId,
          network: GAS_NETWORK,
          publicKey: custody.publicKey,
        },
        {
          keyVersion: custody.keyVersion,
          nonce: custody.nonce,
          ciphertext: custody.ciphertext,
          authTag: custody.authTag,
        },
      );
      return await ctx.runMutation(internal.gas.execution.rotateProvisionedCustodyKey, {
        projectId: args.projectId,
        expectedKeyVersion: custody.keyVersion,
        deploymentId,
        keyVersion: encrypted.keyVersion,
        nonce: encrypted.nonce,
        ciphertext: encrypted.ciphertext,
        authTag: encrypted.authTag,
      });
    } catch {
      return "custody_unavailable";
    }
  },
});

/** Verify or migrate a ready custody row whose authenticated deployment context is stale. */
type RecoverCustodyDeploymentContextResult =
  | "verified"
  | "migrated"
  | "already_matches"
  | "stale"
  | "sponsorship_enabled"
  | "maintenance_locked"
  | "configuration_unavailable"
  | "configuration_invalid"
  | "custody_unavailable";

export const recoverCustodyDeploymentContext = internalAction({
  args: {
    projectId: v.id("projects"),
    expectedStoredDeploymentId: v.string(),
    expectedPublicKey: v.string(),
    mode: v.union(v.literal("verify"), v.literal("migrate")),
  },
  returns: v.union(
    v.literal("verified"),
    v.literal("migrated"),
    v.literal("already_matches"),
    v.literal("stale"),
    v.literal("sponsorship_enabled"),
    v.literal("maintenance_locked"),
    v.literal("configuration_unavailable"),
    v.literal("configuration_invalid"),
    v.literal("custody_unavailable"),
  ),
  handler: async (ctx, args): Promise<RecoverCustodyDeploymentContextResult> => {
    const runtimeEnv = getGasRuntimeEnv();
    const targetDeploymentId = runtimeEnv.VELO_GAS_CUSTODY_DEPLOYMENT_ID?.trim();
    if (!targetDeploymentId) return "configuration_unavailable" as const;

    let keyring: GasCustodyKeyring;
    try {
      keyring = parseGasCustodyKeyring(runtimeEnv.VELO_GAS_CUSTODY_KEYRING_JSON);
    } catch (error) {
      return error instanceof GasCustodyCryptoError && error.code === "configuration_unavailable"
        ? ("configuration_unavailable" as const)
        : ("configuration_invalid" as const);
    }

    let custody;
    try {
      custody = await ctx.runQuery(internal.gas.execution.getCustodyRecord, {
        projectId: args.projectId,
      });
    } catch {
      return "custody_unavailable" as const;
    }
    if (
      !custody ||
      custody.status === "ambiguous" ||
      custody.status !== "ready" ||
      !custody.publicKey ||
      !custody.deploymentId ||
      !custody.keyVersion ||
      !custody.nonce ||
      !custody.ciphertext ||
      !custody.authTag
    ) {
      return "custody_unavailable" as const;
    }
    if (
      custody.deploymentId !== args.expectedStoredDeploymentId ||
      custody.publicKey !== args.expectedPublicKey
    ) {
      return "stale" as const;
    }
    let preflight;
    try {
      preflight = await ctx.runQuery(internal.gas.execution.getCustodyContextMigrationPreflight, {
        projectId: args.projectId,
        publicKey: custody.publicKey,
      });
    } catch {
      return "custody_unavailable" as const;
    }
    if (preflight.policyState === "enabled") return "sponsorship_enabled" as const;
    if (preflight.maintenanceLockActive) return "maintenance_locked" as const;
    if (preflight.policyState === "ambiguous" || preflight.relayerState !== "matching") {
      return "custody_unavailable" as const;
    }

    const sourceContext = {
      deploymentId: custody.deploymentId,
      projectId: args.projectId,
      network: GAS_NETWORK,
      publicKey: custody.publicKey,
    } as const;
    const targetContext = {
      ...sourceContext,
      deploymentId: targetDeploymentId,
    };
    let encrypted: GasEncryptedSecret;
    try {
      encrypted = await new EncryptedConvexGasRelayerCustodyProvider(keyring).reencryptForContext(
        sourceContext,
        targetContext,
        {
          keyVersion: custody.keyVersion,
          nonce: custody.nonce,
          ciphertext: custody.ciphertext,
          authTag: custody.authTag,
        },
      );
    } catch {
      return "custody_unavailable" as const;
    }

    if (args.mode === "verify") return "verified" as const;
    if (custody.deploymentId === targetDeploymentId) return "already_matches" as const;

    try {
      const migrationResult: "migrated" | "stale" | "sponsorship_enabled" | "maintenance_locked" =
        await ctx.runMutation(internal.gas.execution.migrateProvisionedCustodyDeploymentContext, {
          projectId: args.projectId,
          expectedStoredDeploymentId: custody.deploymentId,
          targetDeploymentId,
          expectedKeyVersion: custody.keyVersion,
          expectedUpdatedAt: custody.updatedAt,
          expectedPublicKey: custody.publicKey,
          keyVersion: encrypted.keyVersion,
          nonce: encrypted.nonce,
          ciphertext: encrypted.ciphertext,
          authTag: encrypted.authTag,
        });
      return migrationResult;
    } catch {
      return "custody_unavailable" as const;
    }
  },
});

async function markProvisioningFailed(
  ctx: ActionCtx,
  args: { projectId: Id<"projects">; attemptToken: string },
  errorCode:
    | "provisioning_disabled"
    | "configuration_unavailable"
    | "configuration_invalid"
    | "relayer_already_configured"
    | "provisioning_failed",
): Promise<void> {
  try {
    await ctx.runMutation(internal.gas.execution.markCustodyProvisioningFailed, {
      projectId: args.projectId,
      attemptToken: args.attemptToken,
      errorCode,
    });
  } catch {
    // The pending record remains retryable if its status update is unavailable.
  }
}
