import { internalMutation } from "../_generated/server";
import { isConvexTelemetryEnabled } from "./config";

// Keep this mutation comfortably below Convex's transaction/system-operation
// budget. Gauge values are intentionally approximate, so a small bounded
// sample is preferable to letting diagnostics compete with business writes.
const MAX_SCAN = 25;
const MAX_DURATION_SAMPLES = 10;

export function boundedScenarioDurations(
  intents: Array<{
    createdAt: number;
    updatedAt: number;
    stageTimestamps?: {
      routeReady?: number;
      awaiting_signature?: number;
      signed?: number;
      submitted?: number;
      submissionReported?: number;
      confirmed?: number;
    };
  }>,
  deliveries: Array<{ responseTimeMs?: number }>,
  uiStages: Array<{ durationMs?: number }>,
) {
  const seconds = (end?: number, start?: number) =>
    end !== undefined && start !== undefined && end >= start ? (end - start) / 1_000 : undefined;
  return {
    "checkout-preparation": intents
      .map((row) => seconds(row.stageTimestamps?.routeReady, row.createdAt))
      .filter((value): value is number => value !== undefined),
    "transaction-submission": intents
      .map((row) =>
        seconds(
          row.stageTimestamps?.submissionReported ?? row.stageTimestamps?.submitted,
          row.stageTimestamps?.signed ?? row.stageTimestamps?.awaiting_signature ?? row.createdAt,
        ),
      )
      .filter((value): value is number => value !== undefined),
    "confirmation-detection": intents
      .map((row) =>
        seconds(
          row.stageTimestamps?.confirmed,
          row.stageTimestamps?.submissionReported ?? row.stageTimestamps?.submitted,
        ),
      )
      .filter((value): value is number => value !== undefined),
    "webhook-delivery": deliveries.flatMap((row) =>
      row.responseTimeMs === undefined ? [] : [Math.max(0, row.responseTimeMs) / 1_000],
    ),
    "ui-propagation": uiStages.flatMap((row) =>
      row.durationMs === undefined ? [] : [Math.max(0, row.durationMs) / 1_000],
    ),
  } as const;
}

export const capture = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (!isConvexTelemetryEnabled()) return { saturated: false };
    const now = Date.now();
    const [reconciliation, deliveries, pollers, outbox, intents, uiStages] = await Promise.all([
      ctx.db.query("paymentReconciliationJobs").take(MAX_SCAN),
      ctx.db.query("webhookDeliveries").take(MAX_SCAN),
      ctx.db.query("pollerState").take(MAX_SCAN),
      ctx.db.query("telemetryOutbox").take(MAX_SCAN),
      ctx.db.query("paymentIntents").take(MAX_SCAN),
      ctx.db
        .query("journeyStages")
        .withIndex("by_name_and_at", (q) => q.eq("name", "ui.rendered"))
        .take(MAX_SCAN),
    ]);
    const activeReconciliation = reconciliation.filter((row) => row.state !== "dead_letter");
    const values = [
      ["velo_queue_depth", activeReconciliation.length],
      ["velo_scanner_backlog", reconciliation.filter((row) => row.state === "pending").length],
      ["velo_webhook_backlog", deliveries.filter((row) => row.status !== "success").length],
      [
        "velo_cursor_lag_seconds",
        Math.max(0, ...pollers.map((row) => (now - row.updatedAt) / 1_000), 0),
      ],
      ["velo_telemetry_dead_letters", outbox.filter((row) => row.state === "dead_letter").length],
      [
        "velo_queue_oldest_seconds",
        Math.max(0, ...activeReconciliation.map((row) => (now - row.createdAt) / 1_000), 0),
      ],
      [
        "velo_webhook_lag_seconds",
        Math.max(
          0,
          ...deliveries
            .filter((row) => row.status === "pending")
            .map((row) => (now - row.createdAt) / 1_000),
          0,
        ),
      ],
      [
        "velo_confirmation_lag_seconds",
        Math.max(
          0,
          ...intents
            .filter((row) => row.status === "pending")
            .map((row) => (now - row.updatedAt) / 1_000),
          0,
        ),
      ],
    ] as const;
    for (const [name, value] of values) {
      await ctx.db.insert("telemetryOutbox", {
        kind: "metric",
        name,
        operation: "bounded_gauge_capture",
        stage: "observation",
        outcome: "success",
        value,
        state: "pending",
        attemptCount: 0,
        nextAttemptAt: now,
        leaseGeneration: 0,
        expiresAt: now + 14 * 24 * 60 * 60 * 1_000,
        createdAt: now,
      });
    }
    for (const [operation, durations] of Object.entries(
      boundedScenarioDurations(intents, deliveries, uiStages),
    )) {
      for (const value of durations.slice(0, MAX_DURATION_SAMPLES)) {
        await ctx.db.insert("telemetryOutbox", {
          kind: "metric",
          name: "velo_journey_duration_seconds",
          operation,
          stage: "observation",
          outcome: "success",
          value,
          state: "pending",
          attemptCount: 0,
          nextAttemptAt: now,
          leaseGeneration: 0,
          expiresAt: now + 14 * 24 * 60 * 60 * 1_000,
          createdAt: now,
        });
      }
    }
    const lockedP95Seconds = {
      "payment-intent-create": 0.35,
      "payment-intent-list": 0.25,
      "checkout-preparation": 1.5,
      "transaction-submission": 3,
      "confirmation-detection": 8,
      "ui-propagation": 0.35,
      "webhook-delivery": 2,
    } as const;
    for (const [operation, value] of Object.entries(lockedP95Seconds)) {
      await ctx.db.insert("telemetryOutbox", {
        kind: "metric",
        name: "velo_locked_slo_p95_seconds",
        operation,
        stage: "observation",
        outcome: "success",
        value,
        state: "pending",
        attemptCount: 0,
        nextAttemptAt: now,
        leaseGeneration: 0,
        expiresAt: now + 14 * 24 * 60 * 60 * 1_000,
        createdAt: now,
      });
    }
    return {
      saturated: [reconciliation, deliveries, pollers, outbox].some(
        (rows) => rows.length === MAX_SCAN,
      ),
    };
  },
});
