import { withRouteTelemetry } from "@/core/observability";
import {
  contractSpecLoader,
  parsePlaygroundJson,
  playgroundErrorResponse,
} from "@/features/playground/server/contract-loader";
import { helloInvocationEligibility } from "@/features/playground/server/fixture";
import { verifyPlaygroundProjectContext } from "@/features/playground/server/project-context";
import { guardPlaygroundRequest } from "@/features/playground/server/rate-limit";

export const POST = withRouteTelemetry(
  "playground.contract.load.v1",
  async (request, telemetry) => {
    const blocked = await guardPlaygroundRequest({
      request,
      operation: "contract_load",
      correlationId: telemetry.correlationId,
      maxBytes: 4 * 1_024,
    });
    if (blocked) return blocked;
    try {
      await verifyPlaygroundProjectContext(request);
      const body = await parsePlaygroundJson(request, 4 * 1_024);
      const document = await contractSpecLoader.load(body, telemetry.correlationId);
      return Response.json(
        {
          ...document,
          playgroundRequestId: request.headers.get("x-velo-journey-id") ?? telemetry.correlationId,
          invocation: {
            eligible: helloInvocationEligibility(
              document.network,
              document.contractId,
              document.wasmHash,
            ),
            functionName: "hello",
            reason:
              document.network === "mainnet"
                ? "Mainnet is inspection-only in Sprint 1."
                : "Only the configured Testnet hello fixture can be invoked in Sprint 1.",
          },
        },
        {
          headers: {
            "Cache-Control": "no-store",
            "X-Correlation-ID": document.correlationId,
          },
        },
      );
    } catch (error) {
      return playgroundErrorResponse(error, telemetry.correlationId);
    }
  },
);
