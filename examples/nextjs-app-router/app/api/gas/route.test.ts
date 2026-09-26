import assert from "node:assert/strict";
import test from "node:test";

import type { GasExecutionStatus, GasSubmitResult } from "@carts1024/velo-sdk";

import { isGasTerminalStatus, POST, toGasPublicResult } from "./route.ts";

const ENVIRONMENT = {
  VELO_GAS_API_KEY: `tg_test_${"a".repeat(32)}`,
  VELO_GAS_BASE_URL: "http://127.0.0.1:3000",
  VELO_GAS_DEMO_TOKEN: "terminal-demo-token",
  VELO_GAS_ENV: "development",
};
const TRANSACTION_HASH = "a".repeat(64);
const OUTER_TRANSACTION_HASH = "b".repeat(64);
const SOURCE_WALLET = `G${"A".repeat(55)}`;
const CONTRACT_ID = `C${"A".repeat(55)}`;
const REQUEST_ID = "gas-request-0001";

function validReservation(): Record<string, unknown> {
  return {
    object: "gas_sponsor_reservation",
    requestId: REQUEST_ID,
    replayed: false,
    decision: "reserved",
    transactionHash: TRANSACTION_HASH,
    sourceWallet: SOURCE_WALLET,
    targetContractIds: [CONTRACT_ID],
    innerMaxFeeStroops: "1000",
    reservedStroops: "1100",
    expiresAt: "2026-09-15T00:00:00.000Z",
  };
}

function validSubmitResult(
  status: GasExecutionStatus,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    object: "gas_submit_result",
    requestId: REQUEST_ID,
    transactionHash: TRANSACTION_HASH,
    outerTransactionHash: OUTER_TRANSACTION_HASH,
    status,
    reservedStroops: "1100",
    actualFeeStroops: status === "succeeded" ? "900" : null,
    expiresAt: "2026-09-15T00:00:00.000Z",
    reconciliationRequired: status !== "succeeded",
    ...overrides,
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function gasRequest(body: unknown, token = ENVIRONMENT.VELO_GAS_DEMO_TOKEN): Request {
  return new Request("http://localhost:3005/api/gas", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function withEnvironment<T>(callback: () => Promise<T>): Promise<T> {
  const original = {
    VELO_GAS_API_KEY: process.env.VELO_GAS_API_KEY,
    VELO_GAS_BASE_URL: process.env.VELO_GAS_BASE_URL,
    VELO_GAS_DEMO_TOKEN: process.env.VELO_GAS_DEMO_TOKEN,
    VELO_GAS_ENV: process.env.VELO_GAS_ENV,
  };
  Object.assign(process.env, ENVIRONMENT);
  try {
    return await callback();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function parseResponse(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

test("the public projection preserves all six execution states and redacts SDK fields", () => {
  const statuses: GasExecutionStatus[] = [
    "claimed",
    "submission_unknown",
    "submitted",
    "succeeded",
    "failed",
    "cancelled",
  ];

  for (const status of statuses) {
    const result = toGasPublicResult("operation-1", {
      ...validSubmitResult(status),
      status,
    } as GasSubmitResult);
    assert.deepEqual(Object.keys(result).sort(), [
      "actualFeeStroops",
      "operationId",
      "reconciliationRequired",
      "status",
    ]);
    assert.equal(result.operationId, "operation-1");
    assert.equal(result.status, status);
  }
  assert.equal(isGasTerminalStatus("succeeded"), true);
  assert.equal(isGasTerminalStatus("failed"), true);
  assert.equal(isGasTerminalStatus("cancelled"), true);
  assert.equal(isGasTerminalStatus("submitted"), false);
});

test("missing configuration fails closed and never calls upstream", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return jsonResponse({});
  };
  try {
    await withEnvironment(async () => {
      delete process.env.VELO_GAS_API_KEY;
      const response = await POST(
        gasRequest({ operationId: "operation-1", transactionXdr: "xdr" }),
      );
      assert.equal(response.status, 500);
      assert.deepEqual(await parseResponse(response), {
        error: {
          code: "configuration_error",
          message: "Gas example server configuration is invalid.",
        },
      });
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(calls, 0);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("unauthorized callers are rejected before their body is read or Velo is called", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let pulls = 0;
  globalThis.fetch = async () => {
    calls++;
    return jsonResponse({});
  };
  try {
    await withEnvironment(async () => {
      const request = {
        headers: new Headers({ Authorization: "Bearer wrong-token" }),
        signal: new AbortController().signal,
        get body(): ReadableStream<Uint8Array> {
          pulls++;
          throw new Error("body was read");
        },
      } as unknown as Request;
      const response = await POST(request);
      assert.equal(response.status, 401);
      assert.deepEqual(await parseResponse(response), {
        error: { code: "caller_unauthorized", message: "Gas demo authorization failed." },
      });
      assert.equal(pulls, 0);
      assert.equal(calls, 0);

      const oversizedTokenResponse = await POST(
        gasRequest({ operationId: "operation-1", transactionXdr: "xdr" }, "x".repeat(257)),
      );
      assert.equal(oversizedTokenResponse.status, 401);
      assert.deepEqual(await parseResponse(oversizedTokenResponse), {
        error: { code: "caller_unauthorized", message: "Gas demo authorization failed." },
      });
      assert.equal(calls, 0);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("malformed and oversized bodies are rejected without upstream calls", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return jsonResponse({});
  };
  try {
    await withEnvironment(async () => {
      const malformed = new Request("http://localhost:3005/api/gas", {
        method: "POST",
        headers: { Authorization: `Bearer ${ENVIRONMENT.VELO_GAS_DEMO_TOKEN}` },
        body: "not-json",
      });
      const malformedResponse = await POST(malformed);
      assert.equal(malformedResponse.status, 400);

      const oversizedResponse = await POST(
        gasRequest({ operationId: "operation-1", transactionXdr: "x".repeat(65 * 1_024) }),
      );
      assert.equal(oversizedResponse.status, 413);
      assert.deepEqual(await parseResponse(oversizedResponse), {
        error: { code: "payload_too_large", message: "Gas request body is too large." },
      });
      assert.equal(calls, 0);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sponsor denial is fixed and does not reach submission", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return jsonResponse(
      { error: { type: "validation_error", code: "contract_not_whitelisted", message: "secret" } },
      403,
    );
  };
  try {
    await withEnvironment(async () => {
      const response = await POST(
        gasRequest({ operationId: "operation-1", transactionXdr: "xdr" }),
      );
      assert.equal(response.status, 403);
      const body = await parseResponse(response);
      assert.deepEqual(body, {
        error: { code: "policy_denied", message: "Gas sponsorship policy denied this request." },
      });
      assert.equal(JSON.stringify(body).includes("secret"), false);
      assert.equal(calls, 1);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the workflow keeps idempotency stable and recovery observes with identity only", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ body: string; headers: Headers }> = [];
  let call = 0;
  globalThis.fetch = async (_url, options) => {
    requests.push({ body: String(options?.body ?? ""), headers: new Headers(options?.headers) });
    call++;
    if (call % 3 === 1) return jsonResponse(validReservation());
    if (call % 3 === 2) throw new TypeError("fetch failed");
    return jsonResponse(validSubmitResult("succeeded"));
  };
  try {
    await withEnvironment(async () => {
      const response = await POST(
        gasRequest({ operationId: "operation-1", transactionXdr: "signed-xdr" }),
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await parseResponse(response), {
        operationId: "operation-1",
        status: "succeeded",
        actualFeeStroops: "900",
        reconciliationRequired: false,
      });
      const repeatedResponse = await POST(
        gasRequest({ operationId: "operation-1", transactionXdr: "signed-xdr" }),
      );
      assert.equal(repeatedResponse.status, 200);
      assert.equal(requests.length, 6);
      const sponsorRequest = requests[0];
      const submitRequest = requests[1];
      const recoveryRequest = requests[2];
      const repeatedSponsorRequest = requests[3];
      assert.ok(sponsorRequest);
      assert.ok(submitRequest);
      assert.ok(recoveryRequest);
      assert.ok(repeatedSponsorRequest);
      assert.equal(sponsorRequest.headers.get("idempotency-key"), "nextjs-gas:operation-1");
      assert.equal(repeatedSponsorRequest.headers.get("idempotency-key"), "nextjs-gas:operation-1");
      assert.equal(sponsorRequest.body, repeatedSponsorRequest.body);
      assert.equal(submitRequest.headers.get("idempotency-key"), "nextjs-gas:operation-1");
      assert.deepEqual(JSON.parse(recoveryRequest.body), {
        requestId: REQUEST_ID,
        transactionHash: TRANSACTION_HASH,
      });
      assert.equal(recoveryRequest.headers.get("idempotency-key"), null);
      assert.equal(recoveryRequest.body.includes("signed-xdr"), false);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("running results are observed and terminal status controls HTTP status", async () => {
  const originalFetch = globalThis.fetch;
  let call = 0;
  globalThis.fetch = async () => {
    call++;
    if (call === 1) return jsonResponse(validReservation());
    if (call === 2) return jsonResponse(validSubmitResult("submitted"));
    return jsonResponse(validSubmitResult("failed", { actualFeeStroops: null }));
  };
  try {
    await withEnvironment(async () => {
      const response = await POST(
        gasRequest({ operationId: "operation-2", transactionXdr: "signed-xdr" }),
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await parseResponse(response), {
        operationId: "operation-2",
        status: "failed",
        actualFeeStroops: null,
        reconciliationRequired: true,
      });
      assert.equal(response.headers.get("access-control-allow-origin"), null);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("unknown submission and cancelled observation stay explicitly uncertain", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let call = 0;
  globalThis.fetch = async () => {
    call++;
    if (call === 1) return jsonResponse(validReservation());
    controller.abort();
    throw new TypeError("fetch failed");
  };
  try {
    await withEnvironment(async () => {
      const request = new Request("http://localhost:3005/api/gas", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ENVIRONMENT.VELO_GAS_DEMO_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ operationId: "operation-3", transactionXdr: "signed-xdr" }),
        signal: controller.signal,
      });
      const response = await POST(request);
      assert.equal(response.status, 202);
      assert.deepEqual(await parseResponse(response), {
        operationId: "operation-3",
        status: "submission_unknown",
        actualFeeStroops: null,
        reconciliationRequired: true,
      });
      assert.equal(call, 2);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
