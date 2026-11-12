import { signUiTelemetryMarker } from "@repo/observability";
import { convexTest } from "convex-test";
/// <reference types="vite/client" />
import { makeFunctionReference } from "convex/server";
import { expect, test } from "vitest";

import type { Doc } from "../_generated/dataModel";

import schema from "../schema";
import { buildMetricPayload, buildTracePayload, type OutboxRow } from "../telemetry_outbox/actions";
import { isConvexTelemetryEnabled } from "../telemetry_outbox/config";
import { boundedScenarioDurations } from "../telemetry_outbox/gauges";
import { recordMetric, recordSpan } from "../telemetry_outbox/helpers";

const modules = import.meta.glob("../**/*.ts");
const enqueue = makeFunctionReference<"mutation">("telemetry_outbox/mutations:enqueue");
const claim = makeFunctionReference<"mutation">("telemetry_outbox/mutations:claim");
const complete = makeFunctionReference<"mutation">("telemetry_outbox/mutations:complete");
const fail = makeFunctionReference<"mutation">("telemetry_outbox/mutations:fail");
const capture = makeFunctionReference<"mutation">("telemetry_outbox/gauges:capture");
const exportBatch = makeFunctionReference<"action">("telemetry_outbox/actions:exportBatch");
const recordUiMarker = makeFunctionReference<"mutation">(
  "telemetry_outbox/mutations:recordUiMarker",
);
const normalizeLegacy = makeFunctionReference<"mutation">(
  "telemetry_outbox/redactionMigration:normalizeLegacyDiagnostics",
);
const verifyLegacy = makeFunctionReference<"mutation">(
  "telemetry_outbox/redactionMigration:verifyNoLegacyDiagnostics",
);

test("Convex telemetry is enabled by default and disabled only by an explicit false", () => {
  expect(isConvexTelemetryEnabled(undefined)).toBe(true);
  expect(isConvexTelemetryEnabled("true")).toBe(true);
  expect(isConvexTelemetryEnabled("false")).toBe(false);
});

test("disabled Convex telemetry avoids outbox writes while preserving UI journey stages", async () => {
  const previousEnabled = process.env.VELO_CONVEX_TELEMETRY_ENABLED;
  const previousSecret = process.env.VELO_UI_TELEMETRY_INTAKE_SECRET;
  process.env.VELO_CONVEX_TELEMETRY_ENABLED = "false";
  process.env.VELO_UI_TELEMETRY_INTAKE_SECRET = "test-secret";

  try {
    const t = convexTest(schema, modules);
    expect(
      await t.mutation(enqueue, {
        kind: "metric",
        name: "velo_request_total",
        operation: "disabled",
        stage: "mutation",
        outcome: "success",
        value: 1,
      }),
    ).toBeNull();
    await t.run(async (ctx) => {
      expect(
        await recordMetric(ctx, "velo_retry_total", "disabled", "queue_wait", "retry"),
      ).toBeNull();
      expect(
        await recordSpan(ctx, "velo.worker.run", "disabled", "queue_wait", "error"),
      ).toBeNull();
    });

    const paymentIntentId = await t.run(async (ctx) => {
      const now = Date.now();
      const projectId = await ctx.db.insert("projects", {
        name: "disabled-ui",
        slug: "disabled-ui",
        description: "test",
        metadataJson: "{}",
        metadataHash: "0".repeat(64),
        ownerAddress: "GAFVCOWZWSJEAFOKBEBO2B4QITJ2YXN6YIYG6BUURQINVDVW4OPS3OL6",
        status: "draft",
        createdAt: now,
        updatedAt: now,
      });
      return await ctx.db.insert("paymentIntents", {
        projectId,
        amount: "1",
        asset: "native",
        merchantName: "disabled-ui",
        status: "created",
        expiresAt: now + 1_000,
        createdAt: now,
        updatedAt: now,
      });
    });
    const marker = {
      paymentIntentId,
      marker: "checkout_start",
      durationMs: 1,
      signedAt: Date.now(),
    };
    await t.mutation(recordUiMarker, {
      ...marker,
      signature: await signUiTelemetryMarker("test-secret", marker),
    });
    await t.mutation(capture, {});

    const state = await t.run(async (ctx) => ({
      outbox: await ctx.db.query("telemetryOutbox").collect(),
      stages: await ctx.db.query("journeyStages").collect(),
    }));
    expect(state.outbox).toHaveLength(0);
    expect(state.stages).toEqual([
      expect.objectContaining({
        journeyCorrelationId: `payment-intent:${paymentIntentId}`,
        name: "ui.rendered",
      }),
    ]);
  } finally {
    if (previousEnabled === undefined) delete process.env.VELO_CONVEX_TELEMETRY_ENABLED;
    else process.env.VELO_CONVEX_TELEMETRY_ENABLED = previousEnabled;
    if (previousSecret === undefined) delete process.env.VELO_UI_TELEMETRY_INTAKE_SECRET;
    else process.env.VELO_UI_TELEMETRY_INTAKE_SECRET = previousSecret;
  }
});

test("disabled Convex exporter leaves queued rows unclaimed", async () => {
  const previousEnabled = process.env.VELO_CONVEX_TELEMETRY_ENABLED;
  process.env.VELO_CONVEX_TELEMETRY_ENABLED = "false";

  try {
    const t = convexTest(schema, modules);
    const id = await t.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert("telemetryOutbox", {
        kind: "metric",
        name: "velo_request_total",
        operation: "existing",
        stage: "mutation",
        outcome: "success",
        value: 1,
        state: "pending",
        attemptCount: 0,
        nextAttemptAt: now,
        leaseGeneration: 0,
        expiresAt: now + 1_000,
        createdAt: now,
      });
    });

    expect(await t.action(exportBatch, {})).toEqual({ exported: 0 });
    expect(await t.run(async (ctx) => await ctx.db.get(id))).toMatchObject({
      state: "pending",
      attemptCount: 0,
      leaseGeneration: 0,
    });
  } finally {
    if (previousEnabled === undefined) delete process.env.VELO_CONVEX_TELEMETRY_ENABLED;
    else process.env.VELO_CONVEX_TELEMETRY_ENABLED = previousEnabled;
  }
});

test("builds separate valid OTLP trace and metric payloads", () => {
  const base = {
    _id: "telemetryOutbox:test",
    operation: "test",
    stage: "mutation",
    outcome: "success",
    createdAt: 1_000,
    name: "velo.convex.operation",
    requestCorrelationId: "request-00000001",
    journeyCorrelationId: "journey-00000001",
  } as OutboxRow;
  const span = buildTracePayload([{ ...base, kind: "span", durationMs: 5 }]).resourceSpans[0]!
    .scopeSpans[0]!.spans[0]!;
  expect(span.traceId).toMatch(/^(?!0{32})[0-9a-f]{32}$/);
  expect(BigInt(span.endTimeUnixNano) - BigInt(span.startTimeUnixNano)).toBe(5_000_000n);
  expect(span.attributes).toEqual(
    expect.arrayContaining([
      { key: "velo.requestCorrelationId", value: { stringValue: "request-00000001" } },
      { key: "velo.journeyCorrelationId", value: { stringValue: "journey-00000001" } },
    ]),
  );
  const metric = buildMetricPayload([
    { ...base, kind: "metric", name: "velo_queue_depth", value: 3 },
  ]);
  expect(
    metric.resourceMetrics[0]!.scopeMetrics[0]!.metrics[0]!.gauge?.dataPoints[0]!.asDouble,
  ).toBe(3);
  const duration = buildMetricPayload([
    {
      ...base,
      kind: "metric",
      name: "velo_journey_duration_seconds",
      operation: "checkout-preparation",
      value: 1.2,
    },
  ]);
  const histogram = duration.resourceMetrics[0]!.scopeMetrics[0]!.metrics[0]!.histogram;
  expect(histogram?.aggregationTemporality).toBe(1);
  expect(
    histogram?.dataPoints[0]!.bucketCounts.map(Number).reduce((sum, count) => sum + count, 0),
  ).toBe(1);
  const counter = buildMetricPayload([
    { ...base, kind: "metric", name: "velo_retry_total", value: 1 },
  ]);
  expect(counter.resourceMetrics[0]!.scopeMetrics[0]!.metrics[0]!.sum).toMatchObject({
    aggregationTemporality: 1,
    isMonotonic: true,
  });
});

test("derives exact bounded scenario observations and samples only successful spans", async () => {
  expect(
    boundedScenarioDurations(
      [
        {
          createdAt: 1_000,
          updatedAt: 9_000,
          stageTimestamps: { routeReady: 2_500, signed: 3_000, submitted: 5_000, confirmed: 9_000 },
        },
      ],
      [{ responseTimeMs: 250 }],
      [{ durationMs: 125 }],
    ),
  ).toEqual({
    "checkout-preparation": [1.5],
    "transaction-submission": [2],
    "confirmation-detection": [4],
    "webhook-delivery": [0.25],
    "ui-propagation": [0.125],
  });
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    expect(await recordSpan(ctx, "velo.worker.run", "sampled", "queue_wait", "success")).toBeNull();
    expect(
      await recordSpan(ctx, "velo.worker.run", "error", "queue_wait", "error", {
        errorCode: "internal_error",
      }),
    ).not.toBeNull();
    expect(
      await recordMetric(ctx, "velo_retry_total", "retry", "queue_wait", "retry"),
    ).not.toBeNull();
  });
  const rows = await t.run(async (ctx) => await ctx.db.query("telemetryOutbox").collect());
  expect(rows.map((row) => row.name).sort()).toEqual(["velo.worker.run", "velo_retry_total"]);
});

test("success sampling can omit an outbox span while metrics remain unsampled", async () => {
  const t = convexTest(schema, modules);
  expect(
    await t.mutation(enqueue, {
      kind: "span",
      name: "velo.convex.operation",
      operation: "test",
      stage: "mutation",
      outcome: "success",
      sampled: false,
    }),
  ).toBeNull();
  expect(
    await t.mutation(enqueue, {
      kind: "metric",
      name: "velo_request_total",
      operation: "test",
      stage: "mutation",
      outcome: "success",
      sampled: false,
      value: 1,
    }),
  ).not.toBeNull();
});

test("rejects names outside closed span, metric, and error catalogs", async () => {
  const t = convexTest(schema, modules);
  await expect(
    t.mutation(enqueue, {
      kind: "span",
      name: "made.up",
      operation: "test",
      stage: "mutation",
      outcome: "error",
    }),
  ).rejects.toThrow("invalid_telemetry_catalog");
  await expect(
    t.mutation(enqueue, {
      kind: "metric",
      name: "velo_queue_depth",
      operation: "test",
      stage: "mutation",
      outcome: "error",
      errorCode: "raw_provider_message",
    }),
  ).rejects.toThrow("invalid_telemetry_catalog");
});

test("direct unauthenticated UI persistence is rejected", async () => {
  const t = convexTest(schema, modules);
  const paymentIntentId = await t.run(async (ctx) => {
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      name: "ui",
      slug: "ui",
      description: "test",
      metadataJson: "{}",
      metadataHash: "0".repeat(64),
      ownerAddress: "GAFVCOWZWSJEAFOKBEBO2B4QITJ2YXN6YIYG6BUURQINVDVW4OPS3OL6",
      status: "draft",
      createdAt: now,
      updatedAt: now,
    });
    return await ctx.db.insert("paymentIntents", {
      projectId,
      amount: "1",
      asset: "native",
      merchantName: "ui",
      status: "created",
      correlationId: "journey-00000001",
      expiresAt: now + 1_000,
      createdAt: now,
      updatedAt: now,
    });
  });
  await expect(
    t.mutation(recordUiMarker, {
      paymentIntentId,
      marker: "checkout_start",
      durationMs: 1,
      signedAt: Date.now(),
      signature: "0".repeat(64),
    }),
  ).rejects.toThrow("ui_telemetry_unauthorized");
});

test("leases are fenced, success deletes, and five failures dead-letter", async () => {
  const t = convexTest(schema, modules);
  const firstId = await t.mutation(enqueue, {
    kind: "span",
    name: "velo.worker.run",
    operation: "test",
    stage: "queue_wait",
    outcome: "error",
    errorCode: "export_failed",
  });
  const claimed = await t.mutation(claim, { leaseToken: "lease-a", limit: 100 });
  expect(claimed).toHaveLength(1);
  await t.mutation(complete, { ids: [firstId], leaseToken: "stale" });
  expect(await t.run(async (ctx) => await ctx.db.get(firstId))).not.toBeNull();
  await t.mutation(complete, { ids: [firstId], leaseToken: "lease-a" });
  expect(await t.run(async (ctx) => await ctx.db.get(firstId))).toBeNull();

  const failedId = await t.mutation(enqueue, {
    kind: "span",
    name: "velo.worker.run",
    operation: "test",
    stage: "queue_wait",
    outcome: "error",
    errorCode: "export_failed",
  });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await t.run(async (ctx) => {
      await ctx.db.patch(failedId, { state: "pending", nextAttemptAt: 0 });
    });
    const rows = (await t.mutation(claim, {
      leaseToken: `lease-${attempt}`,
      limit: 100,
    })) as Doc<"telemetryOutbox">[];
    await t.mutation(fail, { ids: rows.map((row) => row._id), leaseToken: `lease-${attempt}` });
  }
  const failed = (await t.run(
    async (ctx) => await ctx.db.get(failedId),
  )) as Doc<"telemetryOutbox"> | null;
  expect(failed?.state).toBe("dead_letter");
});

test("telemetry claims stay within the bounded exporter batch", async () => {
  const t = convexTest(schema, modules);
  for (let index = 0; index < 60; index += 1) {
    await t.mutation(enqueue, {
      kind: "metric",
      name: "velo_request_total",
      operation: "bounded_claim_test",
      stage: "mutation",
      outcome: "success",
      value: 1,
    });
  }

  const claimed = await t.mutation(claim, { leaseToken: "bounded-lease", limit: 100 });
  expect(claimed).toHaveLength(50);
  expect(
    await t.run(
      async (ctx) =>
        (await ctx.db.query("telemetryOutbox").collect()).filter((row) => row.state === "pending")
          .length,
    ),
  ).toBe(10);
});

test("outbox deletion preserves the durable safe journey projection", async () => {
  const t = convexTest(schema, modules);
  const outboxId = await t.mutation(enqueue, {
    kind: "span",
    name: "velo.ui.render",
    operation: "ui.rendered",
    stage: "ui_render",
    outcome: "error",
    errorCode: "internal_error",
    journeyCorrelationId: "journey-00000001",
  });
  await t.run(async (ctx) => {
    await ctx.db.insert("journeyStages", {
      journeyCorrelationId: "journey-00000001",
      name: "ui.rendered",
      source: "ui",
      outcome: "success",
      at: Date.now(),
      expiresAt: Date.now() + 1_000,
    });
  });
  await t.run(
    async (ctx) => await ctx.db.patch(outboxId, { state: "leased", leaseToken: "lease" }),
  );
  await t.mutation(complete, { ids: [outboxId], leaseToken: "lease" });
  expect(await t.run(async (ctx) => await ctx.db.get(outboxId))).toBeNull();
  expect(await t.run(async (ctx) => await ctx.db.query("journeyStages").take(10))).toHaveLength(1);
});

test("redaction migration independently advances both cursors and is idempotent", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const now = Date.now();
    for (let index = 0; index < 3; index += 1) {
      await ctx.db.insert("providerEvents", {
        provider: "pdax",
        eventId: `event-${index}`,
        type: "WITHDRAWAL",
        rawEvent: `{"secret":${index}}`,
        processed: true,
        createdAt: now + index,
      });
      await ctx.db.insert("providerOperations", {
        projectId: await ctx.db.insert("projects", {
          name: `p-${index}`,
          slug: `p-${index}`,
          description: "test",
          metadataJson: "{}",
          metadataHash: "0".repeat(64),
          ownerAddress: "GAFVCOWZWSJEAFOKBEBO2B4QITJ2YXN6YIYG6BUURQINVDVW4OPS3OL6",
          status: "draft",
          createdAt: now,
          updatedAt: now,
        }),
        provider: "pdax",
        operation: "trade",
        clientKey: `client-${index}`,
        requestFingerprint: "fingerprint",
        providerKey: `provider-${index}`,
        state: "succeeded",
        attemptCount: 1,
        reconciliationCount: 0,
        nextAttemptAt: now,
        leaseGeneration: 0,
        unresolvedExpiresAt: now + 1_000,
        resultJson: '{"raw":true}',
        createdAt: now,
        updatedAt: now,
      });
    }
  });
  let eventCursor: string | undefined;
  let operationCursor: string | undefined;
  let done = false;
  while (!done) {
    const page = await t.mutation(normalizeLegacy, { limit: 2, eventCursor, operationCursor });
    eventCursor = page.eventCursor;
    operationCursor = page.operationCursor;
    done = page.eventsDone && page.operationsDone;
  }
  const verification = await t.mutation(verifyLegacy, { limit: 10 });
  expect(verification.providerEvents).toBe(0);
  expect(verification.providerOperations).toBe(0);
  const again = await t.mutation(normalizeLegacy, { limit: 10 });
  expect(again.normalizedEvents + again.normalizedOperations).toBe(0);
});
