import { withRouteTelemetry } from "@/core/observability";
import {
  parsePlaygroundJson,
  playgroundErrorResponse,
} from "@/features/playground/server/contract-loader";
import {
  persistTrustedInvocation,
  verifyPlaygroundProjectContext,
} from "@/features/playground/server/project-context";
import { guardPlaygroundRequest } from "@/features/playground/server/rate-limit";
import { submitHello } from "@/features/playground/server/transaction-service";

export const POST = withRouteTelemetry(
  "playground.transaction.submit.v1",
  async (request, telemetry) => {
    const blocked = await guardPlaygroundRequest({
      request,
      operation: "submission",
      correlationId: telemetry.correlationId,
      maxBytes: 512 * 1_024,
    });
    if (blocked) return blocked;
    try {
      const projectContext = await verifyPlaygroundProjectContext(request);
      const input = await parsePlaygroundJson(request, 512 * 1_024);
      const result = await submitHello(input, telemetry.correlationId);
      const journeyCorrelationId =
        request.headers.get("x-velo-journey-id") ?? telemetry.correlationId;
      await persistTrustedInvocation(projectContext, {
        idempotencyKey: `${journeyCorrelationId}:invocation:${result.transactionHash}:${result.status}`,
        journeyCorrelationId,
        requestCorrelationId: telemetry.correlationId,
        status: result.status,
        transactionHash: result.transactionHash,
        fee: result.status === "success" ? result.feeCharged : undefined,
        errorCode: result.status === "failed" ? result.code : undefined,
        eventSummaries:
          result.status === "success"
            ? result.events.map((event) => ({
                order: event.order,
                contractId: event.contractId,
                topics: event.topics,
                ledger: event.ledger,
                transactionHash: event.transactionHash,
              }))
            : undefined,
        completedAt: result.status === "pending" ? undefined : Date.now(),
      });
      return Response.json(
        {
          ...result,
          playgroundRequestId: request.headers.get("x-velo-journey-id") ?? telemetry.correlationId,
        },
        {
          status: result.status === "pending" ? 202 : 200,
          headers: { "Cache-Control": "no-store" },
        },
      );
    } catch (error) {
      return playgroundErrorResponse(error, telemetry.correlationId);
    }
  },
);
