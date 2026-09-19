/// <reference types="vite/client" />

import { Networks } from "@stellar/stellar-sdk";
import { expect, test, vi } from "vitest";

import type { ActionCtx } from "../../_generated/server";

import {
  DEFAULT_TESTNET_HORIZON_URL,
  TESTNET_BALANCE_FAILURE_REASONS,
  TESTNET_BALANCE_MAX_RESPONSE_BYTES,
  readTestnetNativeBalance,
} from "../../gas/balance";
import { GAS_MAX_STROOPS } from "../../gas/types";
import { readOperatorSnapshot } from "../../http";

const SIGNER = "GAI7NKM2MASZ4OJH2LQNMXL4VEUVOWPVDNRVTB6XQRWYYRX3JD4KX4ZI";
const USER = "GBNHK3TLWWXBCEGNFHB45Z66R4AI5YUALKUFBP4WF7YK5JLZIAAG2DLI";
const PROJECT_ID = "project_balance_test";
const OPERATOR_TOKEN = "operator-balance-test-token";

type FetchCall = { input: string; init: RequestInit | undefined };

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function networkResponse(passphrase = Networks.TESTNET): Response {
  return jsonResponse({ network_passphrase: passphrase });
}

function accountResponse(address: string, balance: unknown): Response {
  return jsonResponse({
    account_id: address,
    balances: [{ asset_type: "native", balance }],
  });
}

function fetchQueue(responses: Array<Response | Error>): {
  fetcher: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
    calls.push({ input, init });
    const response = responses.shift();
    if (response === undefined) throw new Error("unexpected fetch");
    if (response instanceof Error) throw response;
    return response;
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

async function read(address: string, responses: Array<Response | Error>, options = {}) {
  const { fetcher, calls } = fetchQueue(responses);
  const result = await readTestnetNativeBalance(address, { ...options, fetch: fetcher });
  return { result, calls };
}

test("reads exact native amounts, including zero and the signed-int64 maximum", async () => {
  const cases = [
    ["0", "0"],
    ["0.0000001", "1"],
    ["1.2345678", "12345678"],
    ["922337203685.4775807", GAS_MAX_STROOPS.toString()],
  ] as const;

  for (const [decimal, stroops] of cases) {
    const { result } = await read(USER, [networkResponse(), accountResponse(USER, decimal)]);
    expect(result).toEqual({ status: "success", address: USER, balanceStroops: stroops });
  }
});

test("rejects malformed, negative, numeric, and overflowing amounts", async () => {
  const values: unknown[] = [
    "-1",
    "1.23456789",
    "1e3",
    "NaN",
    "Infinity",
    1,
    "922337203685.4775808",
  ];

  for (const value of values) {
    const { result } = await read(USER, [networkResponse(), accountResponse(USER, value)]);
    expect(result).toEqual({
      status: "failure",
      reason: TESTNET_BALANCE_FAILURE_REASONS.malformedResponse,
    });
  }
});

test("requires a checksum-valid address, matching account identity, and one native balance", async () => {
  const invalidChecksum = `${USER.slice(0, -1)}Q`;
  await expect(readTestnetNativeBalance(invalidChecksum, { fetch: vi.fn() })).resolves.toEqual({
    status: "failure",
    reason: TESTNET_BALANCE_FAILURE_REASONS.invalidAddress,
  });

  for (const balances of [
    [],
    [
      { asset_type: "native", balance: "1" },
      { asset_type: "native", balance: "2" },
    ],
  ]) {
    const { result } = await read(USER, [
      networkResponse(),
      jsonResponse({ account_id: USER, balances }),
    ]);
    expect(result).toEqual({
      status: "failure",
      reason: TESTNET_BALANCE_FAILURE_REASONS.malformedResponse,
    });
  }

  const mismatch = await read(USER, [networkResponse(), accountResponse(SIGNER, "1")]);
  expect(mismatch.result).toEqual({
    status: "failure",
    reason: TESTNET_BALANCE_FAILURE_REASONS.malformedResponse,
  });
});

test("uses the public default and accepts a trusted custom HTTPS Horizon root", async () => {
  const defaultRead = await read(USER, [networkResponse(), accountResponse(USER, "1")]);
  expect(defaultRead.result).toMatchObject({ status: "success" });
  expect(defaultRead.calls[0]?.input).toBe(`${DEFAULT_TESTNET_HORIZON_URL}/`);
  expect(defaultRead.calls[1]?.input).toContain(`${DEFAULT_TESTNET_HORIZON_URL}/accounts/`);

  const customRead = await read(USER, [networkResponse(), accountResponse(USER, "1")], {
    horizonUrl: "https://horizon.example.test/api/",
  });
  expect(customRead.result).toMatchObject({ status: "success" });
  expect(customRead.calls.map((call) => call.input)).toEqual([
    "https://horizon.example.test/api/",
    `https://horizon.example.test/api/accounts/${USER}`,
  ]);

  for (const horizonUrl of [
    "http://horizon.example.test",
    "https://user:password@horizon.example.test",
    "https://horizon.example.test?secret=1",
    "https://horizon.example.test#fragment",
    "not a URL",
  ]) {
    const { result } = await read(USER, [], { horizonUrl });
    expect(result).toEqual({
      status: "failure",
      reason: TESTNET_BALANCE_FAILURE_REASONS.invalidConfiguration,
    });
  }
});

test("verifies Testnet identity before the account request and disables redirects", async () => {
  const wrongNetwork = await read(USER, [networkResponse(Networks.PUBLIC)]);
  expect(wrongNetwork.result).toEqual({
    status: "failure",
    reason: TESTNET_BALANCE_FAILURE_REASONS.wrongNetwork,
  });
  expect(wrongNetwork.calls).toHaveLength(1);

  const successful = await read(USER, [networkResponse(), accountResponse(USER, "1")]);
  expect(successful.calls).toHaveLength(2);
  expect(successful.calls[0]?.init?.redirect).toBe("error");
  expect(successful.calls[1]?.init?.redirect).toBe("error");
  expect(successful.calls[0]?.init?.signal).toBe(successful.calls[1]?.init?.signal);

  const redirect = await read(USER, [new Error("redirect blocked")]);
  expect(redirect.result).toEqual({
    status: "failure",
    reason: TESTNET_BALANCE_FAILURE_REASONS.providerFailure,
  });
});

test("distinguishes account-not-found, provider failure, and malformed JSON", async () => {
  const notFound = await read(USER, [networkResponse(), new Response(null, { status: 404 })]);
  expect(notFound.result).toEqual({ status: "account_not_found", address: USER });

  const providerFailure = await read(USER, [
    networkResponse(),
    new Response(null, { status: 503 }),
  ]);
  expect(providerFailure.result).toEqual({
    status: "failure",
    reason: TESTNET_BALANCE_FAILURE_REASONS.providerFailure,
  });

  const malformed = await read(USER, [networkResponse(), new Response("not-json")]);
  expect(malformed.result).toEqual({
    status: "failure",
    reason: TESTNET_BALANCE_FAILURE_REASONS.malformedResponse,
  });
});

test("caps streamed response bodies and shares one deadline across fetch and body reads", async () => {
  const oversized = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(TESTNET_BALANCE_MAX_RESPONSE_BYTES + 1));
        controller.close();
      },
    }),
  );
  const oversizedResult = await read(USER, [oversized]);
  expect(oversizedResult.result).toEqual({
    status: "failure",
    reason: TESTNET_BALANCE_FAILURE_REASONS.malformedResponse,
  });

  vi.useFakeTimers();
  try {
    const stalledFetch = vi.fn(
      () => new Promise<Response>(() => undefined),
    ) as unknown as typeof fetch;
    const stalled = readTestnetNativeBalance(USER, { fetch: stalledFetch, timeoutMs: 10 });
    await vi.advanceTimersByTimeAsync(11);
    await expect(stalled).resolves.toEqual({
      status: "failure",
      reason: TESTNET_BALANCE_FAILURE_REASONS.timeout,
    });

    const stalledBodyFetcher = vi.fn(async (input: string) => {
      if (input.endsWith("/")) return networkResponse();
      return new Response(
        new ReadableStream<Uint8Array>({
          pull() {
            return new Promise<void>(() => undefined);
          },
        }),
      );
    }) as unknown as typeof fetch;
    const stalledBody = readTestnetNativeBalance(USER, {
      fetch: stalledBodyFetcher,
      timeoutMs: 10,
    });
    await vi.advanceTimersByTimeAsync(11);
    await expect(stalledBody).resolves.toEqual({
      status: "failure",
      reason: TESTNET_BALANCE_FAILURE_REASONS.timeout,
    });
  } finally {
    vi.useRealTimers();
  }
});

async function withOperatorEnvironment<T>(callback: () => Promise<T>): Promise<T> {
  const names = ["VELO_GAS_D2_OPERATOR_TOKEN", "VELO_GAS_D2_PROJECT_ID", "VELO_GAS_D2_HORIZON_URL"];
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  process.env.VELO_GAS_D2_OPERATOR_TOKEN = OPERATOR_TOKEN;
  delete process.env.VELO_GAS_D2_PROJECT_ID;
  delete process.env.VELO_GAS_D2_HORIZON_URL;
  try {
    return await callback();
  } finally {
    for (const name of names) {
      const value = previous.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function snapshotContext() {
  return {
    runQuery: vi.fn().mockResolvedValue({
      userPublicKey: USER,
      policy: { enabled: true, network: "testnet", allowedContractIds: [] },
      accounting: {
        accountingDayKey: "2026-09-15",
        outstandingHoldsStroops: "0",
        dailyConfirmedSpendStroops: "0",
      },
      execution: null,
      decision: null,
      reservedExposureStroops: "0",
    }),
    runAction: vi.fn().mockResolvedValue({ status: "ready", publicKey: SIGNER }),
  } as unknown as ActionCtx;
}

function snapshotRequest(): Request {
  return new Request(
    `https://velo.test/api/operator/d2/snapshot?projectId=${PROJECT_ID}&phase=preflight`,
    { headers: { authorization: `Bearer ${OPERATOR_TOKEN}` } },
  );
}

test("D2 snapshot preserves positive balance fields and keeps zero/failure generic", async () => {
  await withOperatorEnvironment(async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.endsWith("/")) return networkResponse();
      const address = input.endsWith(SIGNER) ? SIGNER : USER;
      return accountResponse(address, address === SIGNER ? "12.5" : "1");
    }) as unknown as typeof fetch;
    const previousFetch = globalThis.fetch;
    globalThis.fetch = fetcher;
    try {
      const response = await readOperatorSnapshot(snapshotRequest(), snapshotContext());
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        schemaVersion: 1,
        signer: {
          status: "ready",
          network: "testnet",
          publicKey: SIGNER,
          funded: true,
          balanceStroops: "125000000",
        },
        user: { publicKey: USER, funded: true, balanceStroops: "10000000" },
      });
      expect(fetcher).toHaveBeenCalledTimes(4);
    } finally {
      globalThis.fetch = previousFetch;
    }

    const zeroFetcher = vi.fn(async (input: string) => {
      if (input.endsWith("/")) return networkResponse();
      const address = input.endsWith(SIGNER) ? SIGNER : USER;
      return accountResponse(address, "0");
    }) as unknown as typeof fetch;
    globalThis.fetch = zeroFetcher;
    try {
      const zeroResponse = await readOperatorSnapshot(snapshotRequest(), snapshotContext());
      expect(zeroResponse.status).toBe(503);
      await expect(zeroResponse.json()).resolves.toEqual({
        error: "Operator snapshot unavailable",
      });
    } finally {
      globalThis.fetch = previousFetch;
    }

    const failedFetcher = vi.fn(async (input: string) => {
      if (input.endsWith("/")) return networkResponse();
      throw new Error("provider details stay private");
    }) as unknown as typeof fetch;
    globalThis.fetch = failedFetcher;
    try {
      const failedResponse = await readOperatorSnapshot(snapshotRequest(), snapshotContext());
      expect(failedResponse.status).toBe(503);
      await expect(failedResponse.json()).resolves.toEqual({
        error: "Operator snapshot unavailable",
      });
    } finally {
      globalThis.fetch = previousFetch;
    }

    const unauthorizedFetch = vi.fn() as unknown as typeof fetch;
    globalThis.fetch = unauthorizedFetch;
    try {
      const unauthorized = await readOperatorSnapshot(
        new Request(snapshotRequest().url),
        snapshotContext(),
      );
      expect(unauthorized.status).toBe(401);
      expect(unauthorizedFetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});
