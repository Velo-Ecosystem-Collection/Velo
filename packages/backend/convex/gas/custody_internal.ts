import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

import { internal } from "../_generated/api";
import { GAS_NETWORK } from "./types";

export type GasRelayerCustodyRecord = {
  projectId: Id<"projects">;
  network: typeof GAS_NETWORK;
  status: "pending" | "ready" | "failed";
  attemptToken: string;
  attemptCount: number;
  publicKey?: string;
  deploymentId?: string;
  keyVersion?: string;
  nonce?: string;
  ciphertext?: string;
  authTag?: string;
  errorCode?:
    | "provisioning_disabled"
    | "configuration_unavailable"
    | "configuration_invalid"
    | "relayer_already_configured"
    | "provisioning_failed";
  createdAt: number;
  updatedAt: number;
};

export type GasRelayerCustodyLookup = GasRelayerCustodyRecord | { status: "ambiguous" } | null;

function newAttemptToken(): string {
  return globalThis.crypto.randomUUID();
}

/** Queue provisioning in the same transaction that creates a project. */
export async function queueInitialGasRelayerProvisioning(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  now: number,
): Promise<void> {
  const matches = await ctx.db
    .query("gasRelayerCustody")
    .withIndex("by_project_id", (q) => q.eq("projectId", projectId))
    .take(2);
  if (matches.length !== 0) throw new Error("Gas relayer custody already exists for new project");

  const attemptToken = newAttemptToken();
  await ctx.db.insert("gasRelayerCustody", {
    projectId,
    network: GAS_NETWORK,
    status: "pending",
    attemptToken,
    attemptCount: 1,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.scheduler.runAfter(0, internal.gas.relayer.provisionProject, {
    projectId,
    attemptToken,
  });
}

/** Atomically queue an owner retry; an existing manual relayer is never replaced. */
export async function startOwnerProvisioningAttempt(
  ctx: MutationCtx,
  projectId: Id<"projects">,
): Promise<"queued" | "already_pending" | "already_ready" | "legacy_relayer_exists"> {
  const project = await ctx.db.get(projectId);
  if (!project || project.retiredAt !== undefined) throw new Error("Project is unavailable");

  const custodyMatches = await ctx.db
    .query("gasRelayerCustody")
    .withIndex("by_project_id", (q) => q.eq("projectId", projectId))
    .take(2);
  if (custodyMatches.length > 1) throw new Error("Multiple Gas custody records exist for project");
  const custody = custodyMatches[0] ?? null;
  if (custody?.status === "ready") return "already_ready";
  if (custody?.status === "pending") return "already_pending";

  const accountMatches = await ctx.db
    .query("relayerAccounts")
    .withIndex("by_project_id_and_network", (q) =>
      q.eq("projectId", projectId).eq("network", GAS_NETWORK),
    )
    .take(2);
  if (accountMatches.length > 1) throw new Error("Multiple Gas relayers exist for project");
  if (accountMatches.length === 1 && !custody) return "legacy_relayer_exists";

  const now = Date.now();
  const attemptToken = newAttemptToken();
  if (custody) {
    await ctx.db.patch(custody._id, {
      status: "pending",
      attemptToken,
      attemptCount: custody.attemptCount + 1,
      errorCode: undefined,
      updatedAt: now,
    });
  } else {
    await ctx.db.insert("gasRelayerCustody", {
      projectId,
      network: GAS_NETWORK,
      status: "pending",
      attemptToken,
      attemptCount: 1,
      createdAt: now,
      updatedAt: now,
    });
  }
  await ctx.scheduler.runAfter(0, internal.gas.relayer.provisionProject, {
    projectId,
    attemptToken,
  });
  return "queued";
}
