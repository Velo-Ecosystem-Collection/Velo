import { createHmac } from "node:crypto";

import { env } from "@/core/config/env";
import { api } from "@repo/backend/convex/_generated/api";
import { ContractSpecError } from "@repo/stellar";
import { ConvexHttpClient } from "convex/browser";

import type { Id } from "@repo/backend/convex/_generated/dataModel";

export async function verifyPlaygroundProjectContext(request: Request) {
  const projectId = request.headers.get("x-velo-project-id");
  if (!projectId) return null;
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new ContractSpecError(
      "INVALID_ARGUMENT",
      "validate",
      "Project Playground access requires wallet authentication.",
    );
  }
  const convex = new ConvexHttpClient(env.NEXT_PUBLIC_CONVEX_URL);
  convex.setAuth(authorization.slice("Bearer ".length));
  const access = await convex.query(api.playground_projects.queries.getMyAccess, {
    projectId: projectId as Id<"projects">,
  });
  if (!access) {
    throw new ContractSpecError(
      "INVALID_ARGUMENT",
      "validate",
      "This wallet cannot access the selected Velo project.",
    );
  }
  return { projectId, access, convex };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function persistenceProof(payload: unknown) {
  const secret = process.env.VELO_PLAYGROUND_PERSISTENCE_SECRET;
  if (!secret) {
    if (process.env.VERCEL_ENV === "production") {
      throw new Error("VELO_PLAYGROUND_PERSISTENCE_SECRET is required in production");
    }
    return "development";
  }
  return createHmac("sha256", secret).update(stableStringify(payload)).digest("hex");
}

export async function persistTrustedSimulation(
  context: Awaited<ReturnType<typeof verifyPlaygroundProjectContext>>,
  record: {
    idempotencyKey: string;
    journeyCorrelationId: string;
    requestCorrelationId: string;
    network: "testnet" | "mainnet";
    contractId: string;
    functionName: string;
    sourceAccount: string;
    status: "success" | "failed";
    startedAt: number;
    completedAt: number;
    wasmHash: string;
    fee?: string;
  },
) {
  if (!context) return;
  const payload = {
    projectId: context.projectId as Id<"projects">,
    kind: "simulation" as const,
    idempotencyKey: record.idempotencyKey,
    journeyCorrelationId: record.journeyCorrelationId,
    requestCorrelationId: record.requestCorrelationId,
    network: record.network,
    contractId: record.contractId,
    functionName: record.functionName,
    sourceAccount: record.sourceAccount,
    status: record.status,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    wasmHash: record.wasmHash,
    ...(record.fee === undefined ? {} : { fee: record.fee }),
  };
  await context.convex.mutation(api.playground_projects.mutations.recordExecution, {
    ...payload,
    persistenceProof: persistenceProof(payload),
  });
}

export async function persistTrustedInvocation(
  context: Awaited<ReturnType<typeof verifyPlaygroundProjectContext>>,
  outcome: {
    idempotencyKey: string;
    journeyCorrelationId: string;
    requestCorrelationId: string;
    status: "pending" | "success" | "failed" | "unknown";
    transactionHash: string;
    fee?: string;
    errorCode?: string;
    eventSummaries?: unknown[];
    completedAt?: number;
  },
) {
  if (!context) return;
  const payload = {
    projectId: context.projectId as Id<"projects">,
    idempotencyKey: outcome.idempotencyKey,
    journeyCorrelationId: outcome.journeyCorrelationId,
    requestCorrelationId: outcome.requestCorrelationId,
    status: outcome.status,
    transactionHash: outcome.transactionHash,
    ...(outcome.fee === undefined ? {} : { fee: outcome.fee }),
    ...(outcome.errorCode === undefined ? {} : { errorCode: outcome.errorCode }),
    ...(outcome.eventSummaries === undefined ? {} : { eventSummaries: outcome.eventSummaries }),
    ...(outcome.completedAt === undefined ? {} : { completedAt: outcome.completedAt }),
  };
  await context.convex.mutation(api.playground_projects.mutations.recordInvocationOutcome, {
    ...payload,
    persistenceProof: persistenceProof(payload),
  });
}
