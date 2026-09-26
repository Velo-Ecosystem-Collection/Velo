import assert from "node:assert/strict";
import test from "node:test";

import {
  VeloGasSubmissionUnknownError,
  VeloValidationError,
  type GasApi,
  type GasExecutionIdentity,
  type GasExecutionStatus,
  type GasSubmitResult,
} from "@carts1024/velo-sdk";

import type { GasExampleConfig } from "./gas-config.ts";

import { createGasRouter } from "./gas-route.ts";

const CONFIG: GasExampleConfig = {
  apiKey: `tg_test_${"a".repeat(32)}`,
  demoToken: "terminal-demo-token",
  baseUrl: "https://api.testnet.velo.pay",
  environment: "testnet",
};
const IDENTITY: GasExecutionIdentity = {
  requestId: "gas-request-0001",
  transactionHash: "a".repeat(64),
};

function submitResult(
  status: GasExecutionStatus,
  overrides: Partial<GasSubmitResult> = {},
): GasSubmitResult {
  return {
    object: "gas_submit_result",
    requestId: IDENTITY.requestId,
    transactionHash: IDENTITY.transactionHash,
    outerTransactionHash: "b".repeat(64),
    status,
    reservedStroops: "1100",
    actualFeeStroops: status === "succeeded" ? "900" : null,
    expiresAt: "2026-09-26T00:00:00.000Z",
    reconciliationRequired: status !== "succeeded",
    ...overrides,
  };
}

function gasApi(overrides: Partial<GasApi> = {}): GasApi {
  return {
    sponsor: async () => {
      throw new Error("unexpected sponsor call");
    },
    submit: async () => {
      throw new Error("unexpected submit call");
    },
    getStatus: async () => {
      throw new Error("unexpected status call");
    },
    waitForResult: async () => {
      throw new Error("unexpected wait call");
    },
    sponsorAndSubmit: async () => submitResult("succeeded"),
    ...overrides,
  };
}

type MockRequest = {
  get(name: string): string | undefined;
  body?: unknown;
};

type MockResponse = {
  locals: Record<string, unknown>;
  statusCode: number;
  headers: Map<string, string>;
  body?: unknown;
  headersSent: boolean;
  set(name: string, value: string): MockResponse;
  status(code: number): MockResponse;
  json(body: unknown): MockResponse;
};

type Handler = (req: MockRequest, res: MockResponse, next: (error?: unknown) => void) => unknown;

function getHandlers(gas: GasApi, getConfig: () => GasExampleConfig = () => CONFIG): Handler[] {
  const router = createGasRouter({ getConfig, createClient: () => ({ gas }) });
  const route = (
    router as unknown as {
      stack: Array<{ route?: { stack: Array<{ handle: Handler }> } }>;
    }
  ).stack.find((layer) => layer.route)?.route;
  assert.ok(route);
  return route.stack.map((layer) => layer.handle);
}

function mockResponse(): MockResponse {
  const response: MockResponse = {
    locals: {},
    statusCode: 200,
    headers: new Map(),
    headersSent: false,
    set(name, value) {
      this.headers.set(name.toLowerCase(), value);
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      this.headersSent = true;
      return this;
    },
  };
  return response;
}

async function invokeGasRoute(
  gas: GasApi,
  options: { token?: string; body?: unknown; getConfig?: () => GasExampleConfig } = {},
): Promise<MockResponse> {
  const handlers = getHandlers(gas, options.getConfig);
  const authorize = handlers[0];
  const handler = handlers[handlers.length - 1];
  assert.ok(authorize);
  assert.ok(handler);
  const request: MockRequest = {
    get: (name) =>
      name.toLowerCase() === "authorization"
        ? `Bearer ${options.token ?? CONFIG.demoToken}`
        : undefined,
    body: options.body,
  };
  const response = mockResponse();
  let authorized = false;
  authorize(request, response, () => {
    authorized = true;
  });
  if (authorized) await handler(request, response, () => undefined);
  return response;
}

test("unauthorized callers are rejected before SDK execution", async () => {
  let calls = 0;
  const gas = gasApi({
    sponsorAndSubmit: async () => {
      calls++;
      return submitResult("succeeded");
    },
  });

  const response = await invokeGasRoute(gas, {
    body: Buffer.from(JSON.stringify({ operationId: "op-1", transactionXdr: "signed-xdr" })),
    token: "wrong-token",
  });
  assert.equal(response.statusCode, 401);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(response.body, {
    error: { code: "caller_unauthorized", message: "Gas demo authorization failed." },
  });
  assert.equal(calls, 0);
});

test("malformed and oversized bodies are rejected with fixed JSON errors", async () => {
  let calls = 0;
  const gas = gasApi({
    sponsorAndSubmit: async () => {
      calls++;
      return submitResult("succeeded");
    },
  });

  const malformed = await invokeGasRoute(gas, { body: Buffer.from("not-json") });
  assert.equal(malformed.statusCode, 400);
  assert.deepEqual(malformed.body, {
    error: { code: "invalid_input", message: "Gas request input is invalid." },
  });

  const oversized = await invokeGasRoute(gas, {
    body: Buffer.from(
      JSON.stringify({ operationId: "op-1", transactionXdr: "x".repeat(65 * 1_024) }),
    ),
  });
  assert.equal(oversized.statusCode, 413);
  assert.deepEqual(oversized.body, {
    error: { code: "payload_too_large", message: "Gas request body is too large." },
  });
  assert.equal(calls, 0);
});

test("successful execution uses stable idempotency and returns an allowlisted result", async () => {
  const idempotencyKeys: string[] = [];
  const gas = gasApi({
    sponsorAndSubmit: async (_xdr, options) => {
      idempotencyKeys.push(options.idempotencyKey);
      return submitResult("succeeded");
    },
  });

  const body = Buffer.from(
    JSON.stringify({ operationId: "order-1001", transactionXdr: "signed-xdr" }),
  );
  const first = await invokeGasRoute(gas, { body });
  const second = await invokeGasRoute(gas, { body });
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(first.headers.get("cache-control"), "no-store");
  assert.deepEqual(first.body, {
    operationId: "order-1001",
    status: "succeeded",
    actualFeeStroops: "900",
    reconciliationRequired: false,
  });
  assert.deepEqual(idempotencyKeys, ["express-gas:order-1001", "express-gas:order-1001"]);
});

test("policy details are redacted and denied requests do not leak upstream text", async () => {
  const gas = gasApi({
    sponsorAndSubmit: async () => {
      throw new VeloValidationError("private upstream details", {
        code: "contract_not_whitelisted",
      });
    },
  });

  const response = await invokeGasRoute(gas, {
    body: Buffer.from(JSON.stringify({ operationId: "order-1002", transactionXdr: "signed-xdr" })),
  });
  const body = JSON.stringify(response.body);
  assert.equal(response.statusCode, 403);
  assert.equal(body.includes("private upstream details"), false);
  assert.deepEqual(response.body, {
    error: { code: "policy_denied", message: "Gas sponsorship policy denied this request." },
  });
});

test("uncertain sends recover through identity-only status observation", async () => {
  let observed: GasExecutionIdentity | undefined;
  const gas = gasApi({
    sponsorAndSubmit: async () => {
      throw new VeloGasSubmissionUnknownError(IDENTITY, "network_error");
    },
    waitForResult: async (identity) => {
      observed = identity;
      return submitResult("succeeded");
    },
  });

  const response = await invokeGasRoute(gas, {
    body: Buffer.from(JSON.stringify({ operationId: "order-1003", transactionXdr: "signed-xdr" })),
  });
  assert.equal(response.statusCode, 200, JSON.stringify({ body: response.body, observed }));
  assert.deepEqual(response.body, {
    operationId: "order-1003",
    status: "succeeded",
    actualFeeStroops: "900",
    reconciliationRequired: false,
  });
  assert.deepEqual(observed, IDENTITY);
  assert.equal(Object.hasOwn(observed ?? {}, "transactionXdr"), false);
});

test("missing or Mainnet configuration fails closed", async () => {
  const gas = gasApi();
  const response = await invokeGasRoute(gas, {
    body: Buffer.from(JSON.stringify({ operationId: "op-1", transactionXdr: "signed-xdr" })),
    getConfig: () => {
      throw new Error("bad server configuration");
    },
  });
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, {
    error: { code: "configuration_error", message: "Gas example server configuration is invalid." },
  });
});
