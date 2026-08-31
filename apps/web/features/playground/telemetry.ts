import type { PlaygroundTelemetryEvent } from "@repo/observability";

export {
  parsePlaygroundTelemetryEvent,
  PLAYGROUND_TELEMETRY_EVENTS,
  type PlaygroundTelemetryEvent,
  type PlaygroundTelemetryEventName,
} from "@repo/observability";

export function emitPlaygroundTelemetry(event: PlaygroundTelemetryEvent) {
  if (typeof navigator === "undefined") return;
  try {
    navigator.sendBeacon?.(
      "/api/telemetry/playground",
      new Blob([JSON.stringify(event)], { type: "application/json" }),
    );
  } catch {
    // Product telemetry is fail-open.
  }
}
