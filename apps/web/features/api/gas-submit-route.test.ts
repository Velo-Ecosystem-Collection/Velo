import assert from "node:assert/strict";
import test from "node:test";

import { hashApiKey } from "../../core/api/auth.ts";
import {
  createGasSubmitHandler,
  GAS_SUBMIT_MAX_BODY_BYTES,
  GAS_SUBMIT_MAX_REQUEST_ID_BYTES,
  GAS_SUBMIT_MAX_XDR_BYTES,
  type GasSubmitCaller,
  type GasSubmitResult,
} from "../../core/api/gas-route-handlers.ts";
import { withRouteTelemetry } from "../../core/observability.ts";

const API_KEY = `tk_live_${"a".repeat(32)}`;
const OTHER_API_KEY = `tk_live_${"b".repeat(32)}`;
const TRANSACTION_HASH = "a".repeat(64);
const REQUEST_ID = "gas-request-001";
const CORRELATION_ID = "gas-submit-test-001";

type ResponseBody = {
  error?: { type: string; code: string; requestId: string; message: string; param?: string };
  [key: string]: unknown;
};

async function invoke(
  result: GasSubmitResult | Error,
  options: {
    body?: string;
    headers?: Record<string, string>;
  } = {},
) {
  const calls: Array<{ args: Record<string, unknown> }> = [];
  const caller: GasSubmitCaller = {
    action: async (_reference, args) => {
      calls.push({ args });
      if (result instanceof Error) throw result;
      return result;
    },
  };
  const handler = withRouteTelemetry("gas.submit", createGasSubmitHandler(caller));
  const request = new Request("http://localhost/api/gas/submit", {
    method: "POST",
    headers: new Headers({
      authorization: `Bearer ${API_KEY}`,
      "x-correlation-id": CORRELATION_ID,
      ...options.headers,
    }),
    body:
      options.body ?? JSON.stringify({ requestId: REQUEST_ID, transactionHash: TRANSACTION_HASH }),
  });
  const response = await handler(request);
  return { response, calls };
}

async function responseBody(response: Response): Promise<ResponseBody> {
  return (await response.json()) as ResponseBody;
}

function assertRouteHeaders(response: Response) {
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-correlation-id"), CORRELATION_ID);
  assert.equal(response.headers.get("x-request-id"), CORRELATION_ID);
  assert.match(response.headers.get("server-timing") ?? "", /velo_total;dur=/);
}

test("submit forwards only normalized authoritative fields and preserves credential precedence", async () => {
  const body = JSON.stringify({
    requestId: ` ${REQUEST_ID} `,
    transactionHash: TRANSACTION_HASH.toUpperCase(),
    projectId: "forged-project",
    status: "succeeded",
    relayer: "forged-relayer",
    fee: "999999",
    network: "mainnet",
  });
  const first = await invoke(
    { status: "handoff_unavailable" },
    {
      body,
      headers: { "x-api-key": OTHER_API_KEY },
    },
  );
  assert.equal(first.response.status, 503);
  assert.deepEqual(first.calls[0]?.args, {
    apiKeyHash: hashApiKey(API_KEY),
    requestId: REQUEST_ID,
    transactionHash: TRANSACTION_HASH,
  });

  const fallback = await invoke(
    { status: "handoff_unavailable" },
    {
      headers: { authorization: "", "x-api-key": OTHER_API_KEY },
    },
  );
  assert.equal(fallback.response.status, 503);
  assert.equal(fallback.calls[0]?.args.apiKeyHash, hashApiKey(OTHER_API_KEY));

  const malformedBearer = await invoke(
    { status: "handoff_unavailable" },
    {
      headers: { authorization: "Bearer malformed", "x-api-key": API_KEY },
    },
  );
  assert.equal(malformedBearer.response.status, 401);
  assert.equal(malformedBearer.calls.length, 0);
});

test("submit forwards bounded XDR only with the strict XDR field set", async () => {
  const claimed = {
    object: "gas_submit_result" as const,
    requestId: CORRELATION_ID,
    transactionHash: TRANSACTION_HASH,
    outerTransactionHash: null,
    status: "claimed" as const,
    reservedStroops: "200",
    actualFeeStroops: null,
    expiresAt: "2026-09-03T12:49:56.789Z",
    reconciliationRequired: false,
  };
  const valid = await invoke(claimed, {
    body: JSON.stringify({
      requestId: ` ${CORRELATION_ID} `,
      transactionHash: TRANSACTION_HASH.toUpperCase(),
      transactionXdr: "signed-xdr",
    }),
  });
  assert.equal(valid.response.status, 202);
  assert.deepEqual(await responseBody(valid.response), claimed);
  assert.deepEqual(valid.calls[0]?.args, {
    apiKeyHash: hashApiKey(API_KEY),
    requestId: CORRELATION_ID,
    transactionHash: TRANSACTION_HASH,
    transactionXdr: "signed-xdr",
  });
  assertRouteHeaders(valid.response);

  const extra = await invoke(claimed, {
    body: JSON.stringify({
      requestId: CORRELATION_ID,
      transactionHash: TRANSACTION_HASH,
      transactionXdr: "signed-xdr",
      projectId: "forged-project",
    }),
  });
  assert.equal(extra.response.status, 400);
  assert.equal((await responseBody(extra.response)).error?.code, "invalid_request");
  assert.equal(extra.calls.length, 0);

  const empty = await invoke(claimed, {
    body: JSON.stringify({
      requestId: CORRELATION_ID,
      transactionHash: TRANSACTION_HASH,
      transactionXdr: "  ",
    }),
  });
  assert.equal(empty.response.status, 400);
  assert.equal(empty.calls.length, 0);

  const oversized = await invoke(claimed, {
    body: JSON.stringify({
      requestId: CORRELATION_ID,
      transactionHash: TRANSACTION_HASH,
      transactionXdr: "x".repeat(GAS_SUBMIT_MAX_XDR_BYTES + 1),
    }),
  });
  assert.equal(oversized.response.status, 413);
  assert.equal(oversized.calls.length, 0);
});

test("submit maps safe execution DTOs to running and terminal HTTP responses", async () => {
  const base = {
    object: "gas_submit_result" as const,
    requestId: CORRELATION_ID,
    transactionHash: TRANSACTION_HASH,
    outerTransactionHash: null,
    reservedStroops: "200",
    actualFeeStroops: null,
    expiresAt: "2026-09-03T12:49:56.789Z",
    reconciliationRequired: false,
  };

  const running = await invoke(
    { ...base, status: "submitted" },
    { body: JSON.stringify({ requestId: REQUEST_ID, transactionHash: TRANSACTION_HASH }) },
  );
  assert.equal(running.response.status, 202);
  assert.equal((await responseBody(running.response)).status, "submitted");
  assert.equal(running.response.headers.get("cache-control"), "no-store");

  const terminal = await invoke(
    {
      ...base,
      status: "succeeded",
      actualFeeStroops: "175",
      outerTransactionHash: "b".repeat(64),
    },
    { body: JSON.stringify({ requestId: REQUEST_ID, transactionHash: TRANSACTION_HASH }) },
  );
  assert.equal(terminal.response.status, 200);
  assert.equal((await responseBody(terminal.response)).actualFeeStroops, "175");
  assertRouteHeaders(terminal.response);
});

test("submit rejects malformed credentials, JSON, identifiers, hashes, and body bounds before Convex", async () => {
  const credentials = await invoke(
    { status: "handoff_unavailable" },
    {
      headers: { authorization: "Basic credentials", "x-api-key": "" },
    },
  );
  assert.equal(credentials.response.status, 401);
  assert.equal(credentials.calls.length, 0);

  const invalidBodies = [
    "",
    "not-json",
    "null",
    "[]",
    "{}",
    JSON.stringify({ requestId: "", transactionHash: TRANSACTION_HASH }),
    JSON.stringify({ requestId: "x", transactionHash: "not-a-hash" }),
    JSON.stringify({
      requestId: "é".repeat(Math.ceil(GAS_SUBMIT_MAX_REQUEST_ID_BYTES / 2) + 1),
      transactionHash: TRANSACTION_HASH,
    }),
  ];
  for (const body of invalidBodies) {
    const result = await invoke({ status: "handoff_unavailable" }, { body });
    assert.equal(result.response.status, 400);
    assert.equal((await responseBody(result.response)).error?.code, "invalid_request");
    assert.equal(result.calls.length, 0);
  }

  const declaredTooLarge = await invoke(
    { status: "handoff_unavailable" },
    {
      headers: { "content-length": String(GAS_SUBMIT_MAX_BODY_BYTES + 1) },
    },
  );
  assert.equal(declaredTooLarge.response.status, 413);
  assert.equal(declaredTooLarge.calls.length, 0);

  const actualTooLarge = await invoke(
    { status: "handoff_unavailable" },
    {
      body: JSON.stringify({
        requestId: REQUEST_ID,
        transactionHash: "x".repeat(GAS_SUBMIT_MAX_BODY_BYTES),
      }),
      headers: { "content-length": "1" },
    },
  );
  assert.equal(actualTooLarge.response.status, 413);
  assert.equal(actualTooLarge.calls.length, 0);

  const declaredMismatch = await invoke(
    { status: "handoff_unavailable" },
    {
      headers: { "content-length": "1" },
    },
  );
  assert.equal(declaredMismatch.response.status, 400);
  assert.equal(declaredMismatch.calls.length, 0);
});

test("request IDs are bounded in UTF-8 bytes", async () => {
  const valid = await invoke(
    { status: "handoff_unavailable" },
    {
      body: JSON.stringify({
        requestId: "é".repeat(Math.floor(GAS_SUBMIT_MAX_REQUEST_ID_BYTES / 2)),
        transactionHash: TRANSACTION_HASH,
      }),
    },
  );
  assert.equal(valid.response.status, 503);

  const oversized = await invoke(
    { status: "handoff_unavailable" },
    {
      body: JSON.stringify({
        requestId: "é".repeat(Math.ceil(GAS_SUBMIT_MAX_REQUEST_ID_BYTES / 2) + 1),
        transactionHash: TRANSACTION_HASH,
      }),
    },
  );
  assert.equal(oversized.response.status, 400);
  assert.equal(oversized.calls.length, 0);
});

test("every submit outcome maps to the stable HTTP contract", async () => {
  const cases: Array<{ result: GasSubmitResult; status: number; code: string }> = [
    { result: { status: "handoff_unavailable" }, status: 503, code: "handoff_unavailable" },
    { result: { status: "reservation_expired" }, status: 409, code: "reservation_expired" },
    { result: { status: "invalid_lifecycle" }, status: 409, code: "invalid_lifecycle" },
    { result: { status: "resource_not_found" }, status: 404, code: "resource_not_found" },
    { result: { status: "unauthorized" }, status: 401, code: "invalid_api_key" },
    { result: { status: "invalid_request" }, status: 400, code: "invalid_request" },
    { result: { status: "invalid_signature" }, status: 400, code: "invalid_signature" },
    { result: { status: "wrong_network" }, status: 400, code: "wrong_network" },
    {
      result: { status: "unsupported_transaction" },
      status: 400,
      code: "unsupported_transaction",
    },
    { result: { status: "payload_too_large" }, status: 413, code: "invalid_request" },
    { result: { status: "policy_denied" }, status: 403, code: "policy_denied" },
    { result: { status: "relayer_unavailable" }, status: 503, code: "relayer_unavailable" },
    { result: { status: "dependency_unavailable" }, status: 503, code: "dependency_unavailable" },
    { result: { status: "internal_error" }, status: 500, code: "internal_error" },
  ];

  for (const testCase of cases) {
    const { response } = await invoke(testCase.result);
    assert.equal(response.status, testCase.status, testCase.code);
    assertRouteHeaders(response);
    assert.equal((await responseBody(response)).error?.code, testCase.code);
  }
});

test("submit rejects unsafe execution DTOs without exposing internal fields", async () => {
  const unsafe = await invoke({
    object: "gas_submit_result",
    requestId: CORRELATION_ID,
    transactionHash: TRANSACTION_HASH,
    outerTransactionHash: null,
    status: "claimed",
    reservedStroops: "200",
    actualFeeStroops: null,
    expiresAt: "2026-09-03T12:49:56.789Z",
    reconciliationRequired: false,
    executionAttemptId: "secret-internal-id",
  } as unknown as GasSubmitResult);
  assert.equal(unsafe.response.status, 500);
  const body = JSON.stringify(await responseBody(unsafe.response));
  assert.equal(body.includes("secret-internal-id"), false);
});

test("transport failures are dependency errors and redact secrets/raw payloads", async () => {
  const sensitivePayload = `${API_KEY}-raw-secret-payload`;
  const { response } = await invoke(new Error(`Convex failed with ${sensitivePayload}`), {
    body: JSON.stringify({
      requestId: REQUEST_ID,
      transactionHash: TRANSACTION_HASH,
      status: sensitivePayload,
    }),
  });
  assert.equal(response.status, 503);
  assertRouteHeaders(response);
  const serialized = JSON.stringify(await responseBody(response));
  assert.equal(serialized.includes(API_KEY), false);
  assert.equal(serialized.includes(sensitivePayload), false);
  assert.equal(serialized.includes("Convex failed"), false);
});
