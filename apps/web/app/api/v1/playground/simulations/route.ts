import { env } from "@/core/config/env";
import { withRouteTelemetry } from "@/core/observability";
import {
  parsePlaygroundJson,
  playgroundErrorResponse,
} from "@/features/playground/server/contract-loader";
import {
  persistTrustedSimulation,
  verifyPlaygroundProjectContext,
} from "@/features/playground/server/project-context";
import { guardPlaygroundRequest } from "@/features/playground/server/rate-limit";
import { simulatePlayground } from "@/features/playground/server/transaction-service";
import { api } from "@repo/backend/convex/_generated/api";
import { ContractSpecError } from "@repo/stellar";
import { ConvexHttpClient } from "convex/browser";

import type { Id } from "@repo/backend/convex/_generated/dataModel";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function resolveProjectVariables(
  request: Request,
  input: unknown,
  verifiedContext: Awaited<ReturnType<typeof verifyPlaygroundProjectContext>>,
) {
  if (!record(input) || !record(input.projectContext)) return input;
  if (!verifiedContext || input.projectContext.projectId !== verifiedContext.projectId) {
    throw new ContractSpecError(
      "INVALID_ARGUMENT",
      "validate",
      "Project variable context must match the authenticated project header.",
    );
  }
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new ContractSpecError(
      "INVALID_ARGUMENT",
      "validate",
      "Project variable resolution requires an authenticated project member.",
    );
  }
  const projectId = input.projectContext.projectId;
  const argumentTemplateJson = input.projectContext.argumentTemplateJson;
  const resolutionHash = input.projectContext.resolutionHash;
  const requestVersionId = input.projectContext.requestVersionId;
  if (
    typeof projectId !== "string" ||
    typeof argumentTemplateJson !== "string" ||
    typeof resolutionHash !== "string" ||
    (input.network !== "testnet" && input.network !== "mainnet")
  ) {
    throw new ContractSpecError("INVALID_ARGUMENT", "validate", "Invalid project context.");
  }
  const convex = new ConvexHttpClient(env.NEXT_PUBLIC_CONVEX_URL);
  convex.setAuth(authorization.slice("Bearer ".length));
  const preview = await convex.query(api.playground_projects.queries.previewVariables, {
    projectId: projectId as Id<"projects">,
    network: input.network,
    argumentTemplateJson,
    ...(typeof input.expectedWasmHash === "string" ? { wasmHash: input.expectedWasmHash } : {}),
    ...(typeof requestVersionId === "string"
      ? { requestVersionId: requestVersionId as Id<"playgroundRequestVersions"> }
      : {}),
  });
  if (preview.issues.length || preview.resolutionHash !== resolutionHash) {
    throw new ContractSpecError(
      "INVALID_ARGUMENT",
      "validate",
      "Project variables changed or could not be resolved. Review the exact values again.",
    );
  }
  return { ...input, arguments: preview.resolvedArguments };
}

export const POST = withRouteTelemetry(
  "playground.simulation.create.v1",
  async (request, telemetry) => {
    const blocked = await guardPlaygroundRequest({
      request,
      operation: "simulation",
      correlationId: telemetry.correlationId,
      maxBytes: 256 * 1_024,
    });
    if (blocked) return blocked;
    try {
      const projectContext = await verifyPlaygroundProjectContext(request);
      const input = await parsePlaygroundJson(request, 256 * 1_024);
      const startedAt = Date.now();
      const result = await simulatePlayground(
        await resolveProjectVariables(request, input, projectContext),
        telemetry.correlationId,
      );
      const journeyCorrelationId =
        request.headers.get("x-velo-journey-id") ?? telemetry.correlationId;
      await persistTrustedSimulation(projectContext, {
        idempotencyKey: `${journeyCorrelationId}:simulation:${result.simulationId}`,
        journeyCorrelationId,
        requestCorrelationId: result.correlationId,
        network: result.request.network,
        contractId: result.request.contractId,
        functionName: result.request.functionName,
        sourceAccount: result.request.sourceAccount,
        status: result.status === "success" ? "success" : "failed",
        startedAt,
        completedAt: Date.now(),
        wasmHash: result.request.expectedWasmHash,
        fee: result.fee.total,
      });
      return Response.json(
        {
          ...result,
          playgroundRequestId: request.headers.get("x-velo-journey-id") ?? telemetry.correlationId,
        },
        {
          headers: {
            "Cache-Control": "no-store",
            "X-Correlation-ID": telemetry.correlationId,
          },
        },
      );
    } catch (error) {
      return playgroundErrorResponse(error, telemetry.correlationId);
    }
  },
);
