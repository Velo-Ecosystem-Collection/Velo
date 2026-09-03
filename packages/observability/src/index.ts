export const SPAN_NAMES = [
  "velo.http.server",
  "velo.convex.operation",
  "velo.worker.run",
  "velo.dependency.call",
  "velo.ui.render",
] as const;

export const TELEMETRY_STAGES = [
  "auth",
  "indexed_read",
  "mutation",
  "provider_auth",
  "provider_call",
  "submission",
  "ledger_wait",
  "observation",
  "state_update",
  "queue_wait",
  "webhook_network",
  "ui_render",
] as const;

export const METRIC_NAMES = [
  "velo_request_total",
  "velo_success_total",
  "velo_correlation_return_total",
  "velo_error_total",
  "velo_timeout_total",
  "velo_retry_total",
  "velo_rate_limit_total",
  "velo_cache_hit_total",
  "velo_idempotency_contention_total",
  "velo_queue_depth",
  "velo_queue_oldest_seconds",
  "velo_provider_event_backlog",
  "velo_webhook_backlog",
  "velo_cursor_lag_seconds",
  "velo_scanner_backlog",
  "velo_provider_healthy",
  "velo_webhook_lag_seconds",
  "velo_confirmation_lag_seconds",
  "velo_ui_propagation_seconds",
  "velo_telemetry_dead_letters",
  "velo_journey_duration_seconds",
  "velo_journey_p95_seconds",
  "velo_locked_slo_p95_seconds",
  "velo_billing_shadow_reservation_total",
  "velo_billing_shadow_consumption_total",
  "velo_billing_shadow_release_total",
  "velo_billing_insufficient_balance_total",
  "velo_billing_unmatched_success_total",
  "velo_billing_legacy_divergence_total",
  "velo_billing_reservation_recovery_total",
  "velo_billing_pdax_cost_variance",
  "velo_billing_topup_settlement_total",
  "velo_billing_reconciliation_exception_total",
  "velo_billing_daily_replay_total",
  "velo_billing_overdue_exception_total",
  "velo_billing_unmatched_receipt_total",
  "velo_billing_unmatched_consumption_total",
  "velo_billing_launch_gate_change_total",
  "velo_billing_cohort_activation_total",
  "velo_billing_net_revenue_usd",
  "velo_billing_contribution_margin_bps",
  "velo_billing_dispute_total",
  "velo_billing_support_minutes",
] as const;

export const DEPENDENCIES = ["convex", "pdax", "stellar_rpc", "horizon", "merchant"] as const;
export const OUTCOMES = ["success", "error", "timeout", "retry", "rejected"] as const;
export const ERROR_CODES = [
  "invalid_input",
  "unauthorized",
  "not_found",
  "rate_limited",
  "dependency_unavailable",
  "dependency_timeout",
  "conflict",
  "internal_error",
  "export_failed",
] as const;

export const UI_TELEMETRY_MARKERS = [
  "checkout_start",
  "checkout_ready",
  "payment_submitted_rendered",
  "payment_verified_rendered",
] as const;

export const PLAYGROUND_TELEMETRY_EVENTS = [
  "contract_loaded",
  "function_selected",
  "form_valid",
  "simulation_finished",
  "wallet_connection",
  "signature_finished",
  "submission_finished",
  "final_status",
  "history_replayed",
  "code_copied",
] as const;

export type SpanName = (typeof SPAN_NAMES)[number];
export type TelemetryStage = (typeof TELEMETRY_STAGES)[number];
export type MetricName = (typeof METRIC_NAMES)[number];
export type Dependency = (typeof DEPENDENCIES)[number];
export type TelemetryOutcome = (typeof OUTCOMES)[number];
export type TelemetryErrorCode = (typeof ERROR_CODES)[number];
export type UiTelemetryMarker = (typeof UI_TELEMETRY_MARKERS)[number];
export type PlaygroundTelemetryEventName = (typeof PLAYGROUND_TELEMETRY_EVENTS)[number];
export type PlaygroundTelemetryEvent = {
  schemaVersion: 1;
  event: PlaygroundTelemetryEventName;
  outcome: "success" | "error" | "rejected";
  network: "testnet" | "mainnet";
  durationMs?: number;
  errorCategory?: string;
  sessionId: string;
  playgroundRequestId: string;
};

export type UiTelemetryMarkerEnvelope = {
  paymentIntentId: string;
  marker: string;
  durationMs: number;
  signedAt: number;
};

export type TelemetryContext = {
  requestCorrelationId: string;
  journeyCorrelationId?: string;
  traceparent?: string;
  linkedTraceparent?: string;
};

export type SafeTelemetryEvent = {
  spanName: SpanName;
  operation: string;
  stage: TelemetryStage;
  outcome: TelemetryOutcome;
  durationMs?: number;
  dependency?: Dependency;
  errorCode?: TelemetryErrorCode;
  requestCorrelationId?: string;
  journeyCorrelationId?: string;
  traceId?: string;
  traceparent?: string;
  linkedTraceparent?: string;
  sampled?: boolean;
};

const CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const VELO_API_KEY = /^tk_(?:live|test)_[a-f0-9]{32}$/i;
const STELLAR_SECRET_SEED = /^S[A-Z2-7]{55}$/;
const JWT_LIKE_VALUE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const TRACEPARENT = /^00-(?!0{32})[0-9a-f]{32}-(?!0{16})[0-9a-f]{16}-[0-9a-f]{2}$/;
const METRIC_LABELS = new Set([
  "service",
  "operation",
  "stage",
  "outcome",
  "dependency",
  "provider",
  "queue",
  "network",
  "status_class",
]);
const SAFE_EVENT_KEYS = new Set<keyof SafeTelemetryEvent>([
  "spanName",
  "operation",
  "stage",
  "outcome",
  "durationMs",
  "dependency",
  "errorCode",
  "requestCorrelationId",
  "journeyCorrelationId",
  "traceId",
  "traceparent",
  "linkedTraceparent",
  "sampled",
]);

export function isCorrelationId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    CORRELATION_ID.test(value) &&
    !VELO_API_KEY.test(value) &&
    !STELLAR_SECRET_SEED.test(value) &&
    !JWT_LIKE_VALUE.test(value)
  );
}

export function isTraceparent(value: unknown): value is string {
  return typeof value === "string" && TRACEPARENT.test(value);
}

export function parseTelemetryContext(value: unknown): TelemetryContext | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  if (!isCorrelationId(source.requestCorrelationId)) return null;
  if (source.journeyCorrelationId !== undefined && !isCorrelationId(source.journeyCorrelationId)) {
    return null;
  }
  if (source.traceparent !== undefined && !isTraceparent(source.traceparent)) return null;
  return {
    requestCorrelationId: source.requestCorrelationId,
    ...(typeof source.journeyCorrelationId === "string"
      ? { journeyCorrelationId: source.journeyCorrelationId }
      : {}),
    ...(typeof source.traceparent === "string" ? { traceparent: source.traceparent } : {}),
  };
}

export function parsePlaygroundTelemetryEvent(value: unknown): PlaygroundTelemetryEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (
    source.schemaVersion !== 1 ||
    !PLAYGROUND_TELEMETRY_EVENTS.includes(source.event as PlaygroundTelemetryEventName) ||
    !["success", "error", "rejected"].includes(String(source.outcome)) ||
    !["testnet", "mainnet"].includes(String(source.network)) ||
    !isCorrelationId(source.sessionId) ||
    !isCorrelationId(source.playgroundRequestId)
  ) {
    return null;
  }
  if (
    source.durationMs !== undefined &&
    (typeof source.durationMs !== "number" ||
      !Number.isFinite(source.durationMs) ||
      source.durationMs < 0 ||
      source.durationMs > 3_600_000)
  ) {
    return null;
  }
  if (
    source.errorCategory !== undefined &&
    (typeof source.errorCategory !== "string" ||
      !/^[a-z][a-z0-9_]{0,63}$/.test(source.errorCategory))
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    event: source.event as PlaygroundTelemetryEventName,
    outcome: source.outcome as PlaygroundTelemetryEvent["outcome"],
    network: source.network as PlaygroundTelemetryEvent["network"],
    sessionId: source.sessionId,
    playgroundRequestId: source.playgroundRequestId,
    ...(typeof source.durationMs === "number" ? { durationMs: source.durationMs } : {}),
    ...(typeof source.errorCategory === "string" ? { errorCategory: source.errorCategory } : {}),
  };
}

export function createTraceparent(random = crypto.getRandomValues.bind(crypto)): string {
  const trace = new Uint8Array(16);
  const span = new Uint8Array(8);
  random(trace);
  random(span);
  if (trace.every((value) => value === 0)) trace[0] = 1;
  if (span.every((value) => value === 0)) span[0] = 1;
  const hex = (values: Uint8Array) =>
    [...values].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `00-${hex(trace)}-${hex(span)}-01`;
}

export function deterministicSample(key: string, ratio = 0.1): boolean {
  if (ratio <= 0) return false;
  if (ratio >= 1) return true;
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0x1_0000_0000 < ratio;
}

export function uiTelemetryMarkerPayload(input: UiTelemetryMarkerEnvelope): string {
  return JSON.stringify([input.paymentIntentId, input.marker, input.durationMs, input.signedAt]);
}

export async function signUiTelemetryMarker(
  secret: string,
  input: UiTelemetryMarkerEnvelope,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(uiTelemetryMarkerPayload(input)),
  );
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function projectSafeEvent(value: unknown): Partial<SafeTelemetryEvent> {
  if (!value || typeof value !== "object") return {};
  const source = value as Record<string, unknown>;
  const projected: Record<string, unknown> = {};
  for (const key of SAFE_EVENT_KEYS) {
    const nested = source[key];
    if (typeof nested === "string" || typeof nested === "number" || typeof nested === "boolean") {
      projected[key] = nested;
    }
  }
  if (!SPAN_NAMES.includes(projected.spanName as SpanName)) delete projected.spanName;
  if (!TELEMETRY_STAGES.includes(projected.stage as TelemetryStage)) delete projected.stage;
  if (!OUTCOMES.includes(projected.outcome as TelemetryOutcome)) delete projected.outcome;
  if (projected.dependency && !DEPENDENCIES.includes(projected.dependency as Dependency))
    delete projected.dependency;
  if (projected.errorCode && !ERROR_CODES.includes(projected.errorCode as TelemetryErrorCode))
    delete projected.errorCode;
  if (typeof projected.operation !== "string" || !/^[a-z0-9._:-]{1,96}$/.test(projected.operation))
    delete projected.operation;
  if (projected.requestCorrelationId && !isCorrelationId(projected.requestCorrelationId))
    delete projected.requestCorrelationId;
  if (projected.journeyCorrelationId && !isCorrelationId(projected.journeyCorrelationId))
    delete projected.journeyCorrelationId;
  if (projected.traceId && !/^(?!0{32})[0-9a-f]{32}$/.test(String(projected.traceId)))
    delete projected.traceId;
  if (projected.traceparent && !isTraceparent(projected.traceparent)) delete projected.traceparent;
  if (projected.linkedTraceparent && !isTraceparent(projected.linkedTraceparent))
    delete projected.linkedTraceparent;
  return projected;
}

export function traceIdentifiers(traceparent: string): {
  traceId: string;
  parentSpanId: string;
  spanId: string;
} {
  if (!isTraceparent(traceparent)) throw new Error("invalid_traceparent");
  const [, traceId, parentSpanId] = traceparent.split("-");
  const span = new Uint8Array(8);
  crypto.getRandomValues(span);
  if (span.every((value) => value === 0)) span[0] = 1;
  return {
    traceId: traceId!,
    parentSpanId: parentSpanId!,
    spanId: [...span].map((value) => value.toString(16).padStart(2, "0")).join(""),
  };
}

export function normalizeErrorCode(error: unknown): TelemetryErrorCode {
  if (error instanceof DOMException && error.name === "AbortError") return "dependency_timeout";
  if (error && typeof error === "object") {
    const status = (error as { status?: unknown }).status;
    if (status === 401 || status === 403) return "unauthorized";
    if (status === 404) return "not_found";
    if (status === 409) return "conflict";
    if (status === 429) return "rate_limited";
    if (typeof status === "number" && status >= 500) return "dependency_unavailable";
  }
  return "internal_error";
}

export function validateMetricLabels(labels: Record<string, string>): boolean {
  return Object.keys(labels).every((label) => METRIC_LABELS.has(label));
}

export function telemetryHeaders(context: TelemetryContext): Record<string, string> {
  return {
    "x-correlation-id": context.requestCorrelationId,
    ...(context.journeyCorrelationId ? { "x-velo-journey-id": context.journeyCorrelationId } : {}),
    ...(context.traceparent ? { traceparent: context.traceparent } : {}),
  };
}
