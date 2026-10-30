import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("collector has traces, metrics, and sanitized log pipelines", () => {
  const collector = read("observability/otel-collector.yaml");
  for (const pipeline of ["traces:", "metrics:", "logs:"])
    assert.match(collector, new RegExp(pipeline));
  assert.match(read("observability/tempo.yaml"), /block_retention: 336h/);
  assert.match(read("observability/loki.yaml"), /retention_period: 336h/);
  assert.match(read("observability/docker-compose.yml"), /retention\.time=90d/);
});

test("dashboard covers every Sprint 10 operating view", () => {
  const dashboard = JSON.parse(read("observability/grafana/dashboards/sprint-10.json"));
  for (const tag of [
    "journey",
    "dependency",
    "slo",
    "queue-backlog",
    "payment-reconciliation",
    "webhook",
    "ui",
    "exporter-health",
    "cardinality",
  ]) {
    assert.ok(dashboard.tags.includes(tag), `missing ${tag}`);
  }
  assert.equal(dashboard.panels.length, 8);
});

test("alerts use locked thresholds, owners, and concrete runbook anchors", () => {
  const alerts = read("observability/alerts.yaml");
  assert.match(alerts, /< 0\.999/);
  assert.match(alerts, />= 0\.005/);
  assert.match(alerts, /for: 10m/);
  for (const owner of ["API/Web", "Payments Backend"]) {
    assert.match(alerts, new RegExp(owner));
  }
  const anchors = [...alerts.matchAll(/runbook: "([^"]+)#([^"]+)"/g)];
  assert.equal(anchors.length, 5);
  for (const [, path, anchor] of anchors) {
    assert.match(path, /^docs\/operations\//);
    assert.ok(anchor.length > 3);
  }
});

test("every dashboard and alert metric is catalogued and has an emitter", () => {
  const catalogSource = read("packages/observability/src/index.ts");
  const emitterSource = [
    read("apps/web/core/observability.ts"),
    read("apps/web/app/api/telemetry/ui/route.ts"),
    read("packages/backend/convex/telemetry_outbox/gauges.ts"),
    read("packages/backend/convex/telemetry_outbox/helpers.ts"),
    read("packages/backend/convex/payment_intents/mutations.ts"),
    read("packages/backend/convex/rate_limits/mutations.ts"),
    read("observability/alerts.yaml"),
  ].join("\n");
  const referenced = new Set(
    [
      ...read("observability/alerts.yaml").matchAll(/\b(velo_[a-z0-9_]+)\b/g),
      ...read("observability/grafana/dashboards/sprint-10.json").matchAll(/\b(velo_[a-z0-9_]+)\b/g),
    ].map((match) => match[1]),
  );
  for (const referencedMetric of referenced) {
    const metric = referencedMetric.endsWith("_bucket")
      ? referencedMetric.slice(0, -7)
      : referencedMetric;
    assert.match(catalogSource, new RegExp(`"${metric}"`), `${metric} missing from catalog`);
    assert.match(emitterSource, new RegExp(metric), `${metric} missing from emitters`);
  }
  assert.doesNotMatch(catalogSource, /"velo_provider_(?:event_backlog|healthy)"/);
  assert.doesNotMatch(emitterSource, /velo_provider_(?:event_backlog|healthy)/);
});

test("scenario p95 recording rule and threshold join use the seven exact manifest labels", () => {
  const alerts = read("observability/alerts.yaml");
  assert.match(
    alerts,
    /record: velo_journey_p95_seconds\s+expr: histogram_quantile\(0\.95, sum by \(le, operation\) \(rate\(velo_journey_duration_seconds_bucket\[10m\]\)\)\)/,
  );
  assert.match(alerts, /velo_journey_p95_seconds > on\(operation\) velo_locked_slo_p95_seconds/);
  const manifest = JSON.parse(read("benchmarks/manifest.json"));
  const sources = [
    read("apps/web/core/observability.ts"),
    read("apps/web/app/api/telemetry/ui/route.ts"),
    read("packages/backend/convex/telemetry_outbox/gauges.ts"),
  ].join("\n");
  for (const scenario of Object.keys(manifest.thresholds.latencySloMs)) {
    assert.match(
      sources,
      new RegExp(`"${scenario}"`),
      `missing latency observation for ${scenario}`,
    );
  }
});

test("locked SLO gauges exactly match benchmark manifest p95 thresholds", () => {
  const manifest = JSON.parse(read("benchmarks/manifest.json"));
  const gauges = read("packages/backend/convex/telemetry_outbox/gauges.ts");
  for (const [scenario, thresholds] of Object.entries(manifest.thresholds.latencySloMs)) {
    assert.match(gauges, new RegExp(`"${scenario}": ${thresholds.p95 / 1000}(?:,|\\n)`));
  }
});
