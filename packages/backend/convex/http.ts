import { createTraceparent, isCorrelationId, isTraceparent } from "@repo/observability";
import { PdaxClient } from "@repo/pdax";
import { makeFunctionReference } from "convex/server";
import { httpRouter } from "convex/server";

import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";

import { internal } from "./_generated/api";
import { env, httpAction } from "./_generated/server";

const http = httpRouter();
const MAX_BODY_BYTES = 64 * 1024;
const ingestRef = makeFunctionReference<"mutation">("provider_events/mutation:ingestPdax");

const DEFAULT_TESTNET_HORIZON_URL = "https://horizon-testnet.stellar.org";
const DEFAULT_D2_DEPLOYMENT_NAME = "dev:capable-kingfisher-697";
const SOURCE_COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const PUBLIC_KEY_PATTERN = /^G[A-Z2-7]{55}$/;
const TRANSACTION_HASH_PATTERN = /^[a-f0-9]{64}$/;
const PHASES = new Set([
  "preflight",
  "after-settlement",
  "before-replay",
  "after-replay",
  "before-denial",
  "after-denial",
]);

function constantTimeEqual(left: string, right: string) {
  const length = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let i = 0; i < length; i++) {
    mismatch |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }
  return mismatch === 0;
}

function responseHeaders(correlationId: string) {
  return {
    "content-type": "application/json",
    "X-Correlation-Id": correlationId,
    "X-Request-Id": correlationId,
  };
}

function textResponse(status: number, message: string, correlationId: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: responseHeaders(correlationId),
  });
}

function operatorResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json",
    },
  });
}

function constantTimeTokenMatch(request: Request): boolean {
  const configured = env.VELO_GAS_D2_OPERATOR_TOKEN?.trim();
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  if (!configured || !authorization.startsWith("Bearer ")) return false;
  const supplied = authorization.slice("Bearer ".length).trim();
  if (!supplied) return false;
  return constantTimeEqual(supplied, configured);
}

function requiredQuery(url: URL, name: string): string | null {
  const value = url.searchParams.get(name)?.trim() ?? "";
  return value === "" ? null : value;
}

function optionalQuery(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name)?.trim() ?? "";
  return value === "" ? undefined : value;
}

function parseSnapshotScope(request: Request) {
  const url = new URL(request.url);
  const projectId = requiredQuery(url, "projectId");
  const phase = requiredQuery(url, "phase");
  const requestId = optionalQuery(url, "requestId");
  const transactionHash = optionalQuery(url, "transactionHash")?.toLowerCase();
  const idempotencyKeyHash = optionalQuery(url, "idempotencyKeyHash")?.toLowerCase();

  if (!projectId || !phase || !PHASES.has(phase)) return null;
  if (projectId.length > 128 || (requestId !== undefined && requestId.length > 128)) return null;
  if (transactionHash !== undefined && !TRANSACTION_HASH_PATTERN.test(transactionHash)) return null;
  if (idempotencyKeyHash !== undefined && !TRANSACTION_HASH_PATTERN.test(idempotencyKeyHash))
    return null;

  return {
    projectId,
    phase: phase as
      | "preflight"
      | "after-settlement"
      | "before-replay"
      | "after-replay"
      | "before-denial"
      | "after-denial",
    ...(requestId === undefined ? {} : { requestId }),
    ...(transactionHash === undefined ? {} : { transactionHash }),
    ...(idempotencyKeyHash === undefined ? {} : { idempotencyKeyHash }),
  };
}

function decimalXlmToStroops(value: unknown): bigint {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,7})?$/.test(value)) {
    throw new Error("Invalid Horizon balance");
  }
  const [whole, fraction = ""] = value.split(".");
  if (whole === undefined) throw new Error("Invalid Horizon balance");
  return BigInt(whole) * 10_000_000n + BigInt(fraction.padEnd(7, "0"));
}

async function readTestnetNativeBalance(publicKey: string): Promise<string> {
  if (!PUBLIC_KEY_PATTERN.test(publicKey)) throw new Error("Invalid account address");
  const horizonUrl = env.VELO_GAS_D2_HORIZON_URL?.trim() || DEFAULT_TESTNET_HORIZON_URL;
  const endpoint = `${horizonUrl.replace(/\/$/, "")}/accounts/${encodeURIComponent(publicKey)}`;
  const response = await fetch(endpoint, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("Testnet account balance unavailable");

  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Malformed Testnet account response");
  }
  const balances = (value as { balances?: unknown }).balances;
  if (!Array.isArray(balances)) throw new Error("Malformed Testnet account response");
  const native = balances.find(
    (balance): balance is { asset_type?: unknown; balance?: unknown } =>
      Boolean(balance) &&
      typeof balance === "object" &&
      !Array.isArray(balance) &&
      (balance as { asset_type?: unknown }).asset_type === "native",
  );
  if (!native) throw new Error("Native Testnet balance unavailable");
  const stroops = decimalXlmToStroops(native.balance);
  if (stroops <= 0n) throw new Error("Testnet account is not funded");
  return stroops.toString();
}

async function readOperatorSnapshot(request: Request, ctx: ActionCtx) {
  if (!constantTimeTokenMatch(request)) return operatorResponse(401, { error: "Unauthorized" });
  const scope = parseSnapshotScope(request);
  if (!scope) return operatorResponse(400, { error: "Invalid snapshot scope" });
  const configuredProjectId = env.VELO_GAS_D2_PROJECT_ID?.trim();
  if (configuredProjectId && configuredProjectId !== scope.projectId) {
    return operatorResponse(404, { error: "Project not found" });
  }

  try {
    const data = await ctx.runQuery(internal.gas.operator.getOperatorSnapshotData, {
      ...scope,
      projectId: scope.projectId as Id<"projects">,
    });
    if (!data) return operatorResponse(404, { error: "Project not found" });
    const readiness = await ctx.runAction(internal.gas.relayer.readiness, {
      projectId: scope.projectId as Id<"projects">,
    });
    if (readiness.status !== "ready" || !readiness.publicKey) {
      return operatorResponse(503, { error: "Relayer custody is not ready" });
    }
    const [signerBalanceStroops, userBalanceStroops] = await Promise.all([
      readTestnetNativeBalance(readiness.publicKey),
      readTestnetNativeBalance(data.userPublicKey),
    ]);

    return operatorResponse(200, {
      schemaVersion: 1,
      scope: {
        projectId: scope.projectId,
        phase: scope.phase,
        ...(scope.requestId === undefined ? {} : { requestId: scope.requestId }),
        ...(scope.transactionHash === undefined ? {} : { transactionHash: scope.transactionHash }),
        ...(scope.idempotencyKeyHash === undefined
          ? {}
          : { idempotencyKeyHash: scope.idempotencyKeyHash }),
      },
      deployment: {
        deploymentId: env.VELO_GAS_D2_DEPLOYMENT_NAME?.trim() || DEFAULT_D2_DEPLOYMENT_NAME,
        environment: env.VELO_DEPLOYMENT_ENVIRONMENT || "development",
        network: "testnet",
      },
      signer: {
        status: "ready",
        network: "testnet",
        publicKey: readiness.publicKey,
        funded: true,
        balanceStroops: signerBalanceStroops,
      },
      user: {
        publicKey: data.userPublicKey,
        funded: true,
        balanceStroops: userBalanceStroops,
      },
      policy: data.policy,
      accounting: data.accounting,
      execution: data.execution,
      decision: data.decision,
      reservedExposureStroops: data.reservedExposureStroops,
    });
  } catch {
    return operatorResponse(503, { error: "Operator snapshot unavailable" });
  }
}

async function readDeploymentProvenance(request: Request) {
  if (!constantTimeTokenMatch(request)) return operatorResponse(401, { error: "Unauthorized" });
  const url = new URL(request.url);
  const projectId = requiredQuery(url, "projectId");
  const deploymentId = requiredQuery(url, "deploymentId");
  const configuredDeploymentId =
    env.VELO_GAS_D2_DEPLOYMENT_NAME?.trim() || DEFAULT_D2_DEPLOYMENT_NAME;
  const configuredProjectId = env.VELO_GAS_D2_PROJECT_ID?.trim();
  const commit = env.VELO_GAS_D2_DEPLOYED_SOURCE_COMMIT?.trim() || "";
  if (
    !projectId ||
    (configuredProjectId && projectId !== configuredProjectId) ||
    !deploymentId ||
    deploymentId !== configuredDeploymentId
  ) {
    return operatorResponse(400, { error: "Invalid provenance scope" });
  }
  if (!SOURCE_COMMIT_PATTERN.test(commit)) {
    return operatorResponse(503, { error: "Deployment provenance is not configured" });
  }

  return operatorResponse(200, {
    schemaVersion: 1,
    deploymentId: configuredDeploymentId,
    environment: env.VELO_DEPLOYMENT_ENVIRONMENT || "development",
    network: "testnet",
    verified: true,
    deployedSourceCommit: commit,
    verification: "operator-configured-deployed-commit",
  });
}

http.route({
  path: "/api/operator/d2/snapshot",
  method: "GET",
  handler: httpAction((ctx, request) => readOperatorSnapshot(request, ctx)),
});

http.route({
  path: "/api/operator/d2/provenance",
  method: "GET",
  handler: httpAction(async (_ctx, request) => readDeploymentProvenance(request)),
});

http.route({
  path: "/api/webhooks/pdax/v1",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const supplied = request.headers.get("x-correlation-id")?.trim();
    const correlationId = isCorrelationId(supplied) ? supplied : crypto.randomUUID();
    const suppliedTrace = request.headers.get("traceparent")?.trim();
    const traceparent = isTraceparent(suppliedTrace) ? suppliedTrace : createTraceparent();
    const configuredToken = process.env.PDAX_WEBHOOK_TOKEN;
    const token = new URL(request.url).searchParams.get("token") ?? "";
    if (!configuredToken || !constantTimeEqual(token, configuredToken)) {
      return textResponse(401, "Unauthorized", correlationId);
    }
    const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
    if (contentType !== "application/json")
      return textResponse(415, "JSON required", correlationId);
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > MAX_BODY_BYTES)
      return textResponse(413, "Payload too large", correlationId);
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return textResponse(400, "Malformed JSON", correlationId);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return textResponse(400, "Invalid PDAX event", correlationId);
    }
    let normalized: ReturnType<PdaxClient["parseWebhook"]>;
    try {
      normalized = new PdaxClient().parseWebhook(value);
    } catch {
      return textResponse(400, "Invalid PDAX event schema", correlationId);
    }
    const input = normalized as unknown as Record<string, unknown>;
    const identifier = normalized.identifier;
    const type = normalized.transaction_type;
    const rawEvent = JSON.stringify(normalized);
    const digestBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawEvent));
    const payloadDigest = Array.from(new Uint8Array(digestBytes), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const eventId = String(
      input.request_id ?? input.reference_number ?? input.reference_id ?? identifier,
    );
    const result = await ctx.runMutation(ingestRef, {
      eventId,
      identifier,
      type: type as "DEPOSIT" | "WITHDRAWAL",
      payloadDigest,
      status: typeof input.status === "string" ? input.status : undefined,
      requestCorrelationId: correlationId,
      traceparent,
    });
    return new Response(JSON.stringify(result), {
      status: result.status === "quarantined" ? 202 : 200,
      headers: responseHeaders(correlationId),
    });
  }),
});

export default http;
