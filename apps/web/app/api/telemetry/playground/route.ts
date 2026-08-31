import { withRouteTelemetry } from "@/core/observability";
import { exportSafeMetric, exportSafeSpan } from "@/core/otlp";
import { parsePlaygroundTelemetryEvent } from "@/features/playground/telemetry";

const buckets = new Map<string, { startedAt: number; count: number }>();

function allowed(request: Request) {
  const key = (request.headers.get("x-vercel-forwarded-for") ?? "anonymous").split(",", 1)[0]!;
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.startedAt >= 60_000) {
    if (buckets.size >= 1_000) buckets.delete(buckets.keys().next().value ?? "");
    buckets.set(key, { startedAt: now, count: 1 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= 120;
}

export const POST = withRouteTelemetry("playground.telemetry.v1", async (request, telemetry) => {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).origin !== new URL(request.url).origin) {
    return Response.json({ error: "Cross-origin telemetry is not accepted." }, { status: 403 });
  }
  if (!allowed(request)) {
    return Response.json(
      { error: "Telemetry rate limit exceeded." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }
  if (Number(request.headers.get("content-length") ?? "0") > 2_048) {
    return Response.json({ error: "Telemetry payload is too large." }, { status: 413 });
  }
  const event = parsePlaygroundTelemetryEvent(await request.json().catch(() => null));
  if (!event) return Response.json({ error: "Invalid telemetry payload." }, { status: 400 });

  exportSafeSpan({
    spanName: "velo.ui.render",
    operation: `playground.${event.event}`,
    stage: "ui_render",
    outcome: event.outcome === "success" ? "success" : "error",
    durationMs: event.durationMs,
    requestCorrelationId: telemetry.context.requestCorrelationId,
    journeyCorrelationId: event.playgroundRequestId,
    traceparent: telemetry.context.traceparent,
  });
  exportSafeMetric(event.outcome === "success" ? "velo_success_total" : "velo_error_total", 1, {
    service: "web",
    operation: `playground.${event.event}`,
    outcome: event.outcome === "success" ? "success" : "error",
    network: event.network,
  });
  if (event.durationMs !== undefined) {
    exportSafeMetric(
      "velo_journey_duration_seconds",
      event.durationMs / 1_000,
      {
        service: "web",
        operation: `playground.${event.event}`,
        outcome: event.outcome === "success" ? "success" : "error",
        network: event.network,
      },
      "histogram",
    );
  }
  return new Response(null, { status: 202 });
});
