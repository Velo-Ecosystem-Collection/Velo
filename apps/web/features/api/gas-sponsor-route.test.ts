import assert from "node:assert/strict";
import test from "node:test";

import { hashApiKey } from "../../core/api/auth.ts";
import {
  createGasSponsorHandler,
  GAS_SPONSOR_MAX_BODY_BYTES,
  type GasSponsorCaller,
  type GasSponsorResult,
} from "../../core/api/gas-route-handlers.ts";
import { withRouteTelemetry } from "../../core/observability.ts";

const API_KEY = `tk_live_${"a".repeat(32)}`;
const OTHER_API_KEY = `tk_live_${"b".repeat(32)}`;
const TRANSACTION_XDR = "valid-testnet-transaction-xdr";
const REQUEST_CORRELATION_ID = "gas-sponsor-test-001";
const EXPIRES_AT = 1_782_865_800_000;

type ResponseBody = {
  error?: { type: string; code: string; requestId: string; message: string };
  [key: string]: unknown;
};

function reservationResult(replayed = false): GasSponsorResult {
  return {
    status: "success",
    replayed,
    reservation: {
      requestId: "gas-request-001",
      transactionHash: "a".repeat(64),
      sourceWallet: "GTESTWALLET",
      targetContractIds: ["GTESTCONTRACT"],
      innerMaxFeeStroops: "100",
      reservedStroops: "200",
      actualFeeStroops: null,
      decisionCode: "reserved",
      rejectionCode: null,
      lifecycle: "reserved",
      expiresAt: EXPIRES_AT,
      createdAt: EXPIRES_AT - 1_000,
      updatedAt: EXPIRES_AT - 1_000,
    },
  };
}

function rejectionResult(
  rejectionCode: Extract<GasSponsorResult, { status: "rejected" }>["rejectionCode"],
): GasSponsorResult {
  return {
    status: "rejected",
    replayed: false,
    rejectionCode,
    decision: {
      requestId: "gas-request-denied-001",
      transactionHash: null,
      sourceWallet: null,
      targetContractIds: null,
      innerMaxFeeStroops: null,
      reservedStroops: null,
      actualFeeStroops: null,
      decisionCode: "rejected",
      rejectionCode,
      lifecycle: "rejected",
      expiresAt: null,
      createdAt: EXPIRES_AT - 1_000,
      updatedAt: EXPIRES_AT - 1_000,
    },
  };
}

async function invoke(
  result: GasSponsorResult | Error,
  options: {
    body?: string;
    headers?: Record<string, string>;
    omitIdempotencyKey?: boolean;
  } = {},
) {
  const calls: Array<{ args: Record<string, unknown> }> = [];
  const caller: GasSponsorCaller = {
    action: async (_reference, args) => {
      calls.push({ args });
      if (result instanceof Error) throw result;
      return result;
    },
  };
  const handler = withRouteTelemetry("gas.sponsor", createGasSponsorHandler(caller));
  const body = options.body ?? JSON.stringify({ transactionXdr: TRANSACTION_XDR });
  const requestHeaders = new Headers({
    authorization: `Bearer ${API_KEY}`,
    ...(options.omitIdempotencyKey ? {} : { "idempotency-key": "gas-idempotency-001" }),
    "x-correlation-id": REQUEST_CORRELATION_ID,
    ...options.headers,
  });
  const response = await handler(
    new Request("http://localhost/api/gas/sponsor", {
      method: "POST",
      headers: requestHeaders,
      body,
    }),
  );
  return { response, calls };
}

async function responseBody(response: Response): Promise<ResponseBody> {
  return (await response.json()) as ResponseBody;
}

function assertRouteHeaders(response: Response) {
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-correlation-id"), REQUEST_CORRELATION_ID);
  assert.equal(response.headers.get("x-request-id"), REQUEST_CORRELATION_ID);
  assert.match(response.headers.get("server-timing") ?? "", /velo_total;dur=/);
}

test("success and replay return the minimal reservation DTO", async () => {
  for (const replayed of [false, true]) {
    const { response } = await invoke(reservationResult(replayed));
    assert.equal(response.status, 200);
    assertRouteHeaders(response);
    const body = await responseBody(response);
    assert.deepEqual(body, {
      object: "gas_sponsor_reservation",
      requestId: "gas-request-001",
      replayed,
      decision: "reserved",
      transactionHash: "a".repeat(64),
      sourceWallet: "GTESTWALLET",
      targetContractIds: ["GTESTCONTRACT"],
      innerMaxFeeStroops: "100",
      reservedStroops: "200",
      expiresAt: "2026-07-01T00:30:00.000Z",
    });
    assert.equal(JSON.stringify(body).includes(API_KEY), false);
    assert.equal(JSON.stringify(body).includes(TRANSACTION_XDR), false);
  }
});

test("Authorization Bearer takes precedence over x-api-key and both hash the forwarded key", async () => {
  const { response, calls } = await invoke(reservationResult(), {
    headers: { "x-api-key": OTHER_API_KEY },
  });
  assert.equal(response.status, 200);
  assert.equal(calls[0]?.args.apiKeyHash, hashApiKey(API_KEY));
  assert.equal(calls[0]?.args.idempotencyKey, "gas-idempotency-001");

  const xApiKey = await invoke(reservationResult(), {
    headers: { authorization: "", "x-api-key": OTHER_API_KEY },
  });
  assert.equal(xApiKey.response.status, 200);
  assert.equal(xApiKey.calls[0]?.args.apiKeyHash, hashApiKey(OTHER_API_KEY));

  const malformedPrecedence = await invoke(reservationResult(), {
    headers: { authorization: "Bearer malformed", "x-api-key": API_KEY },
  });
  assert.equal(malformedPrecedence.response.status, 401);
  assert.equal(malformedPrecedence.calls.length, 0);
});

test("missing and malformed credentials are uniformly unauthorized before Convex or body parsing", async () => {
  const cases: ReadonlyArray<{ id: string; headers: Record<string, string> }> = [
    { id: "missing", headers: { authorization: "", "x-api-key": "" } },
    { id: "blank-bearer", headers: { authorization: "Bearer ", "x-api-key": "" } },
    { id: "malformed-scheme", headers: { authorization: `Basic ${API_KEY}`, "x-api-key": "" } },
    {
      id: "wrong-prefix",
      headers: { authorization: `Bearer tk_test_${"c".repeat(32)}`, "x-api-key": "" },
    },
    {
      id: "wrong-length",
      headers: { authorization: `Bearer tk_live_${"c".repeat(31)}`, "x-api-key": "" },
    },
    {
      id: "malformed-x-api-key",
      headers: { authorization: "", "x-api-key": `tk_live_${"C".repeat(32)}` },
    },
  ];

  for (const credential of cases) {
    const sensitiveXdr = `${TRANSACTION_XDR}-${credential.id}-${API_KEY}`;
    const { response, calls } = await invoke(reservationResult(), {
      headers: credential.headers,
      body: JSON.stringify({ transactionXdr: sensitiveXdr }),
    });

    assert.equal(response.status, 401, credential.id);
    assertRouteHeaders(response);
    const body = await responseBody(response);
    assert.deepEqual(body.error, {
      type: "auth_error",
      code: "invalid_api_key",
      message: "Missing or invalid API key.",
      requestId: REQUEST_CORRELATION_ID,
    });
    assert.equal(calls.length, 0, credential.id);
    const serialized = JSON.stringify(body);
    assert.equal(serialized.includes(API_KEY), false);
    assert.equal(serialized.includes(sensitiveXdr), false);
  }
});

test("missing, blank, and oversized idempotency keys are invalid requests", async () => {
  const cases: Array<{ headers: Record<string, string>; omitIdempotencyKey?: boolean }> = [
    { headers: {}, omitIdempotencyKey: true },
    { headers: { "idempotency-key": "" } },
    { headers: { "idempotency-key": "é".repeat(128) } },
  ];
  for (const options of cases) {
    const { response, calls } = await invoke(reservationResult(), options);
    assert.equal(response.status, 400);
    assertRouteHeaders(response);
    const body = await responseBody(response);
    assert.equal(body.error?.code, "invalid_request");
    assert.equal(body.error?.requestId, REQUEST_CORRELATION_ID);
    assert.equal(calls.length, 0);
  }
});

test("malformed, non-object, and missing-field bodies are rejected before Convex", async () => {
  const bodies = [
    "",
    "not-json",
    "null",
    "[]",
    "{}",
    JSON.stringify({ transactionXdr: 42 }),
    JSON.stringify({ transactionXdr: "" }),
  ];
  for (const body of bodies) {
    const { response, calls } = await invoke(reservationResult(), { body });
    assert.equal(response.status, 400);
    assert.equal((await responseBody(response)).error?.code, "invalid_request");
    assert.equal(calls.length, 0);
  }
});

test("declared and actual body sizes are enforced at 64 KiB", async () => {
  const declaredTooLarge = await invoke(reservationResult(), {
    body: JSON.stringify({ transactionXdr: "small" }),
    headers: { "content-length": String(GAS_SPONSOR_MAX_BODY_BYTES + 1) },
  });
  assert.equal(declaredTooLarge.response.status, 413);
  assert.equal((await responseBody(declaredTooLarge.response)).error?.code, "invalid_request");
  assert.equal(declaredTooLarge.calls.length, 0);

  const actualTooLarge = await invoke(reservationResult(), {
    body: JSON.stringify({ transactionXdr: "x".repeat(GAS_SPONSOR_MAX_BODY_BYTES) }),
    headers: { "content-length": "1" },
  });
  assert.equal(actualTooLarge.response.status, 413);
  assert.equal((await responseBody(actualTooLarge.response)).error?.code, "invalid_request");
  assert.equal(actualTooLarge.calls.length, 0);

  const declaredMismatch = await invoke(reservationResult(), {
    body: JSON.stringify({ transactionXdr: TRANSACTION_XDR }),
    headers: { "content-length": "1" },
  });
  assert.equal(declaredMismatch.response.status, 400);
  assert.equal((await responseBody(declaredMismatch.response)).error?.code, "invalid_request");
  assert.equal(declaredMismatch.calls.length, 0);
});

test("forged project, wallet, fee, network, hash, and contract fields never reach Convex", async () => {
  const body = JSON.stringify({
    transactionXdr: ` ${TRANSACTION_XDR} `,
    projectId: "forged-project",
    wallet: "forged-wallet",
    sourceWallet: "forged-source",
    fee: "999999",
    innerMaxFeeStroops: "999999",
    network: "mainnet",
    transactionHash: "forged-hash",
    targetContractIds: ["forged-contract"],
    contractId: "forged-contract",
  });
  const { response, calls } = await invoke(reservationResult(), { body });
  assert.equal(response.status, 200);
  assert.deepEqual(calls[0]?.args, {
    apiKeyHash: hashApiKey(API_KEY),
    idempotencyKey: "gas-idempotency-001",
    transactionXdr: TRANSACTION_XDR,
  });
});

test("every Convex sponsor result maps to its stable HTTP error contract", async () => {
  const cases: Array<{
    result: GasSponsorResult;
    status: number;
    code: string;
    retryAfter?: boolean;
  }> = [
    { result: { status: "unauthorized" }, status: 401, code: "invalid_api_key" },
    { result: { status: "invalid_request" }, status: 400, code: "invalid_request" },
    { result: { status: "invalid_signature" }, status: 400, code: "invalid_signature" },
    { result: { status: "wrong_network" }, status: 400, code: "wrong_network" },
    { result: { status: "unsupported_transaction" }, status: 400, code: "unsupported_transaction" },
    {
      result: { status: "idempotency_key_conflict" },
      status: 409,
      code: "idempotency_key_conflict",
    },
    { result: { status: "duplicate_transaction" }, status: 409, code: "duplicate_transaction" },
    { result: rejectionResult("policy_disabled"), status: 403, code: "policy_disabled" },
    {
      result: rejectionResult("contract_not_whitelisted"),
      status: 403,
      code: "contract_not_whitelisted",
    },
    {
      result: rejectionResult("daily_cap_exceeded"),
      status: 429,
      code: "daily_cap_exceeded",
      retryAfter: true,
    },
    {
      result: rejectionResult("wallet_rate_limited"),
      status: 429,
      code: "wallet_rate_limited",
      retryAfter: true,
    },
    { result: { status: "internal_error" }, status: 500, code: "internal_error" },
  ];

  for (const testCase of cases) {
    const { response } = await invoke(testCase.result);
    assert.equal(response.status, testCase.status, testCase.code);
    assertRouteHeaders(response);
    const body = await responseBody(response);
    assert.equal(body.error?.code, testCase.code);
    assert.equal(body.error?.requestId, REQUEST_CORRELATION_ID);
    if (testCase.retryAfter) {
      assert.match(response.headers.get("retry-after") ?? "", /^[1-9][0-9]*$/);
    } else {
      assert.equal(response.headers.has("retry-after"), false);
    }
  }
});

test("transport failures are sanitized and never echo credentials or raw XDR", async () => {
  const dependencyError = new Error(`Convex failed for ${API_KEY} and ${TRANSACTION_XDR}`);
  const { response } = await invoke(dependencyError);
  assert.equal(response.status, 503);
  assertRouteHeaders(response);
  const serialized = JSON.stringify(await responseBody(response));
  assert.equal(serialized.includes(API_KEY), false);
  assert.equal(serialized.includes(TRANSACTION_XDR), false);
  assert.equal(serialized.includes("Convex failed"), false);

  const internal = await invoke({ status: "internal_error" });
  assert.equal(internal.response.status, 500);
  const internalSerialized = JSON.stringify(await responseBody(internal.response));
  assert.equal(internalSerialized.includes(API_KEY), false);
  assert.equal(internalSerialized.includes(TRANSACTION_XDR), false);
});

test("inconsistent Convex success results fail closed", async () => {
  const valid = reservationResult();
  if (valid.status !== "success") throw new Error("Expected a valid reservation fixture");
  const inconsistent = {
    status: "success",
    replayed: false,
    reservation: {
      ...valid.reservation,
      decisionCode: "rejected",
    },
  } as unknown as GasSponsorResult;
  const { response } = await invoke(inconsistent);
  assert.equal(response.status, 500);
  assert.equal((await responseBody(response)).error?.code, "internal_error");
});
