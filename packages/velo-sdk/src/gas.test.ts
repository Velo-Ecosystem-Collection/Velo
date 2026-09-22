import assert from "node:assert/strict";
import test from "node:test";

import type {
  GasExecutionIdentity,
  GasExecutionStatus,
  GasSponsorOptions,
  GasSponsorReservation,
  GasWaitOptions,
  GasSubmitParams,
  GasSubmitResult,
  RequestOptions,
} from "./index.ts";

import {
  Velo,
  VeloAPIError,
  VeloAuthError,
  VeloGasSubmissionUnknownError,
  VeloGasWaitError,
  VeloProviderError,
  VeloRateLimitError,
  VeloSubmissionUnknownError,
  VeloTimeoutError,
  VeloValidationError,
} from "./index.ts";

const BASE_URL = "https://api.example.com";
const SOURCE_WALLET = `G${"A".repeat(55)}`;
const CONTRACT_ID = `C${"A".repeat(55)}`;
const TRANSACTION_HASH = "a".repeat(64);
const OUTER_TRANSACTION_HASH = "b".repeat(64);
const TRACEPARENT = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
const MAX_TIMER_DURATION_MS = 2_147_483_647;

function validReservation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    object: "gas_sponsor_reservation",
    requestId: "gas-request-0001",
    replayed: false,
    decision: "reserved",
    transactionHash: TRANSACTION_HASH,
    sourceWallet: SOURCE_WALLET,
    targetContractIds: [CONTRACT_ID],
    innerMaxFeeStroops: "9223372036854775807",
    reservedStroops: "73813",
    expiresAt: "2026-09-14T00:00:00.000Z",
    ...overrides,
  };
}

function jsonResponse(payload: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(typeof payload === "string" ? payload : JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function defaultOptions(): GasSponsorOptions {
  return { idempotencyKey: "gas-operation-0001" };
}

function validSubmitResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    object: "gas_submit_result",
    requestId: "gas-request-0001",
    transactionHash: TRANSACTION_HASH,
    outerTransactionHash: OUTER_TRANSACTION_HASH,
    status: "submitted",
    reservedStroops: "9223372036854775807",
    actualFeeStroops: "73813",
    expiresAt: "2026-09-14T00:00:00.000Z",
    reconciliationRequired: true,
    ...overrides,
  };
}

class FakeClock {
  private now = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();
  private readonly originalDateNow = Date.now;
  private readonly originalSetTimeout = globalThis.setTimeout;
  private readonly originalClearTimeout = globalThis.clearTimeout;

  install(): void {
    Date.now = () => this.now;
    globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number) => {
      const id = this.nextId++;
      this.timers.set(id, { at: this.now + Math.max(0, delay ?? 0), callback: () => callback() });
      return id;
    }) as unknown as typeof setTimeout;
    globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout>) => {
      this.timers.delete(Number(timer));
    }) as typeof clearTimeout;
  }

  async advance(ms: number): Promise<void> {
    const target = this.now + ms;
    for (;;) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort(([, first], [, second]) => first.at - second.at)[0];
      if (!next) break;
      const [id, timer] = next;
      this.timers.delete(id);
      this.now = timer.at;
      timer.callback();
      await flushPromises();
    }
    this.now = target;
    await flushPromises();
  }

  pendingTimers(): number {
    return this.timers.size;
  }

  restore(): void {
    Date.now = this.originalDateNow;
    globalThis.setTimeout = this.originalSetTimeout;
    globalThis.clearTimeout = this.originalClearTimeout;
  }
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 8; index++) await Promise.resolve();
}

test("gas.sponsor sends the exact server request and projects the reservation", async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = "";
  let calledOptions: RequestInit | undefined;

  globalThis.fetch = async (url, options) => {
    calledUrl = url.toString();
    calledOptions = options;
    return jsonResponse({ ...validReservation(), ignored: "not returned" });
  };

  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: BASE_URL });
    const result = await velo.gas.sponsor("  signed-xdr  ", {
      idempotencyKey: "  gas-operation-0001  ",
      correlationId: "gas-correlation-0001",
      traceparent: TRACEPARENT,
      maxRetries: 9,
      submission: true,
    });

    assert.deepEqual(result, {
      object: "gas_sponsor_reservation",
      requestId: "gas-request-0001",
      replayed: false,
      decision: "reserved",
      transactionHash: TRANSACTION_HASH,
      sourceWallet: SOURCE_WALLET,
      targetContractIds: [CONTRACT_ID],
      innerMaxFeeStroops: "9223372036854775807",
      reservedStroops: "73813",
      expiresAt: "2026-09-14T00:00:00.000Z",
    } satisfies GasSponsorReservation);
    assert.equal(calledUrl, `${BASE_URL}/api/gas/sponsor`);
    assert.equal(calledOptions?.method, "POST");
    assert.equal(calledOptions?.body, JSON.stringify({ transactionXdr: "signed-xdr" }));

    const headers = new Headers(calledOptions?.headers);
    assert.equal(headers.get("authorization"), "Bearer test-key");
    assert.equal(headers.get("content-type"), "application/json");
    assert.equal(headers.get("idempotency-key"), "gas-operation-0001");
    assert.equal(headers.get("x-correlation-id"), "gas-correlation-0001");
    assert.equal(headers.get("traceparent"), TRACEPARENT);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gas.sponsor preserves replay identity and exact amount strings", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return jsonResponse(
      validReservation({
        replayed: true,
        innerMaxFeeStroops: "0001",
        reservedStroops: "1",
      }),
    );
  };

  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: BASE_URL });
    await assert.rejects(
      () => velo.gas.sponsor("signed-xdr", defaultOptions()),
      (error: unknown) => error instanceof VeloAPIError && error.code === "invalid_response",
    );

    globalThis.fetch = async () => {
      calls++;
      return jsonResponse(
        validReservation({
          replayed: true,
          innerMaxFeeStroops: "1",
          reservedStroops: "0",
        }),
      );
    };
    const replay = await velo.gas.sponsor("signed-xdr", defaultOptions());
    assert.equal(replay.replayed, true);
    assert.equal(replay.requestId, "gas-request-0001");
    assert.equal(replay.innerMaxFeeStroops, "1");
    assert.equal(replay.reservedStroops, "0");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gas.sponsor rejects invalid inputs before fetch and enforces byte bounds", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return jsonResponse(validReservation());
  };

  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: BASE_URL });
    const invalidInputs: Array<() => Promise<unknown>> = [
      () => velo.gas.sponsor("", defaultOptions()),
      () => velo.gas.sponsor("   ", defaultOptions()),
      () => velo.gas.sponsor(42 as unknown as string, defaultOptions()),
      () => velo.gas.sponsor("signed-xdr", { idempotencyKey: "" }),
      () => velo.gas.sponsor("signed-xdr", { idempotencyKey: "   " }),
      () => velo.gas.sponsor("signed-xdr", { idempotencyKey: 42 as unknown as string }),
      () => velo.gas.sponsor("signed-xdr", { idempotencyKey: "x".repeat(256) }),
      () => velo.gas.sponsor("signed-xdr", { idempotencyKey: "é".repeat(128) }),
      () =>
        velo.gas.sponsor("signed-xdr", {
          idempotencyKey: "gas-operation-0001",
          correlationId: "bad\ncorrelation",
        }),
      () =>
        velo.gas.sponsor("signed-xdr", {
          idempotencyKey: "gas-operation-0001",
          traceparent: "invalid-traceparent",
        }),
      () => velo.gas.sponsor("signed-xdr", null as unknown as GasSponsorOptions),
    ];

    for (const invalidInput of invalidInputs) {
      await assert.rejects(invalidInput, (error: unknown) => {
        assert.equal(error instanceof VeloValidationError, true);
        assert.equal((error as Error).message.includes("signed-xdr"), false);
        return true;
      });
    }

    const bodyEmptyLength = new TextEncoder().encode(
      JSON.stringify({ transactionXdr: "" }),
    ).byteLength;
    const exactBodyXdr = "x".repeat(64 * 1_024 - bodyEmptyLength);
    await velo.gas.sponsor(exactBodyXdr, defaultOptions());
    assert.equal(
      new TextEncoder().encode(JSON.stringify({ transactionXdr: exactBodyXdr })).byteLength,
      64 * 1_024,
    );

    await assert.rejects(
      () => velo.gas.sponsor(`${exactBodyXdr}x`, defaultOptions()),
      (error: unknown) => error instanceof VeloValidationError,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gas.sponsor rejects malformed success payloads without leaking response data", async () => {
  const originalFetch = globalThis.fetch;
  const malformedPayloads: unknown[] = [
    "{not-json",
    { ...validReservation(), object: "wrong" },
    { ...validReservation(), requestId: "short" },
    { ...validReservation(), replayed: "false" },
    { ...validReservation(), decision: "accepted" },
    { ...validReservation(), transactionHash: "A".repeat(64) },
    { ...validReservation(), sourceWallet: `G${"A".repeat(54)}` },
    { ...validReservation(), targetContractIds: [] },
    { ...validReservation(), targetContractIds: [CONTRACT_ID, CONTRACT_ID] },
    { ...validReservation(), innerMaxFeeStroops: "01" },
    { ...validReservation(), reservedStroops: "-1" },
    { ...validReservation(), reservedStroops: "9223372036854775808" },
    { ...validReservation(), expiresAt: "2026-09-14T00:00:00Z" },
  ];

  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: BASE_URL });
    for (const payload of malformedPayloads) {
      globalThis.fetch = async () => jsonResponse(payload);
      await assert.rejects(
        () => velo.gas.sponsor("xdr-secret", defaultOptions()),
        (error: unknown) => {
          assert.equal(error instanceof VeloAPIError, true);
          assert.equal((error as VeloAPIError).code, "invalid_response");
          assert.equal((error as Error).message.includes("xdr-secret"), false);
          assert.equal((error as Error).message.includes("reservedStroops"), false);
          return true;
        },
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gas.sponsor preserves typed denials and retry hints without retrying", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: BASE_URL, maxRetries: 7 });
    globalThis.fetch = async () => {
      calls++;
      return jsonResponse(
        { error: { type: "rate_limit_error", code: "daily_cap_exceeded", message: "Denied" } },
        429,
        { "Retry-After": "7" },
      );
    };
    await assert.rejects(
      () => velo.gas.sponsor("signed-xdr", { ...defaultOptions(), maxRetries: 99 }),
      (error: unknown) => {
        assert.equal(error instanceof VeloRateLimitError, true);
        assert.equal((error as VeloRateLimitError).code, "daily_cap_exceeded");
        assert.equal((error as VeloRateLimitError).retryAfterMs, 7_000);
        return true;
      },
    );
    assert.equal(calls, 1);

    globalThis.fetch = async () => {
      calls++;
      return jsonResponse(
        { error: { type: "rate_limit_error", code: "wallet_rate_limited", message: "Denied" } },
        429,
        { "Retry-After": "7" },
      );
    };
    await assert.rejects(
      () => velo.gas.sponsor("signed-xdr", { ...defaultOptions(), maxRetries: 99 }),
      (error: unknown) =>
        error instanceof VeloRateLimitError && error.code === "wallet_rate_limited",
    );
    assert.equal(calls, 2);

    globalThis.fetch = async () => {
      calls++;
      return jsonResponse(
        { error: { type: "provider_error", code: "dependency_unavailable", message: "Retry" } },
        503,
      );
    };
    await assert.rejects(
      () => velo.gas.sponsor("signed-xdr", { ...defaultOptions(), maxRetries: 0 }),
      (error: unknown) => error instanceof VeloProviderError,
    );
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gas.sponsor retries transient failures with identical serialized requests", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ body: BodyInit | null | undefined; headers: Headers }> = [];
  let calls = 0;

  globalThis.fetch = async (_url, options) => {
    calls++;
    requests.push({ body: options?.body, headers: new Headers(options?.headers) });
    if (calls === 1) {
      return jsonResponse(
        { error: { type: "provider_error", code: "temporary_failure", message: "Retry" } },
        503,
      );
    }
    return jsonResponse(validReservation());
  };

  try {
    const velo = new Velo({
      apiKey: "test-key",
      baseUrl: BASE_URL,
      maxRetries: 2,
      retryBaseDelayMs: 0,
      retryMaxDelayMs: 0,
    });
    await velo.gas.sponsor(" signed-xdr ", {
      ...defaultOptions(),
      correlationId: "gas-correlation-0001",
      traceparent: TRACEPARENT,
    });
    assert.equal(calls, 2);
    assert.equal(requests[0]?.body, requests[1]?.body);
    assert.equal(requests[0]?.headers.get("idempotency-key"), "gas-operation-0001");
    assert.equal(
      requests[0]?.headers.get("idempotency-key"),
      requests[1]?.headers.get("idempotency-key"),
    );
    assert.equal(requests[0]?.headers.get("x-correlation-id"), "gas-correlation-0001");
    assert.equal(
      requests[0]?.headers.get("x-correlation-id"),
      requests[1]?.headers.get("x-correlation-id"),
    );
    assert.equal(requests[0]?.headers.get("traceparent"), TRACEPARENT);
    assert.equal(requests[0]?.headers.get("traceparent"), requests[1]?.headers.get("traceparent"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gas.sponsor exhausts configured retries and preserves retry-after metadata", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = async () => {
    calls++;
    return jsonResponse(
      { error: { type: "provider_error", code: "temporary_failure", message: "Retry" } },
      503,
      { "Retry-After": "0" },
    );
  };

  try {
    const velo = new Velo({
      apiKey: "test-key",
      baseUrl: BASE_URL,
      maxRetries: 2,
      retryBaseDelayMs: 0,
      retryMaxDelayMs: 0,
    });
    await assert.rejects(
      () => velo.gas.sponsor("signed-xdr", defaultOptions()),
      (error: unknown) => error instanceof VeloProviderError && error.retryAfterMs === 0,
    );
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gas HTTP errors retain authentication, policy, expiry, handoff, and provider distinctions", async () => {
  const originalFetch = globalThis.fetch;
  const cases = [
    { status: 401, type: "auth_error", code: "invalid_api_key", ctor: VeloAuthError },
    {
      status: 403,
      type: "validation_error",
      code: "contract_not_whitelisted",
      ctor: VeloValidationError,
    },
    {
      status: 429,
      type: "rate_limit_error",
      code: "wallet_rate_limited",
      ctor: VeloRateLimitError,
    },
    {
      status: 409,
      type: "validation_error",
      code: "reservation_expired",
      ctor: VeloValidationError,
    },
    {
      status: 409,
      type: "validation_error",
      code: "handoff_unavailable",
      ctor: VeloValidationError,
    },
    {
      status: 503,
      type: "provider_error",
      code: "dependency_unavailable",
      ctor: VeloProviderError,
    },
  ] as const;

  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: BASE_URL, maxRetries: 0 });
    for (const testCase of cases) {
      globalThis.fetch = async () =>
        jsonResponse(
          { error: { type: testCase.type, code: testCase.code, message: "Safe error" } },
          testCase.status,
        );
      await assert.rejects(
        () => velo.gas.sponsor("signed-xdr", defaultOptions()),
        (error: unknown) => {
          assert.equal(error instanceof testCase.ctor, true);
          assert.equal((error as VeloAPIError).code, testCase.code);
          assert.equal((error as Error).message.includes("Safe error"), false);
          assert.equal((error as Error).message.includes("xdr-secret"), false);
          return true;
        },
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gas.sponsor uses existing cancellation and deadline transport behavior", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const callerReason = new DOMException("caller stopped waiting", "AbortError");
  controller.abort(callerReason);
  let calls = 0;

  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: BASE_URL });
    globalThis.fetch = async () => {
      calls++;
      return jsonResponse(validReservation());
    };
    await assert.rejects(
      () => velo.gas.sponsor("signed-xdr", { ...defaultOptions(), signal: controller.signal }),
      (error: unknown) => error === callerReason,
    );
    assert.equal(calls, 0);

    globalThis.fetch = async (_url, options) => {
      calls++;
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("The operation was aborted.", "AbortError")),
          { once: true },
        );
      });
    };
    await assert.rejects(
      () => velo.gas.sponsor("signed-xdr", { ...defaultOptions(), timeoutMs: 50 }),
      (error: unknown) => error instanceof VeloTimeoutError,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gas.submit sends the bounded handoff with normalized identity and headers", async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = "";
  let calledOptions: RequestInit | undefined;

  globalThis.fetch = async (url, options) => {
    calledUrl = url.toString();
    calledOptions = options;
    return jsonResponse({ ...validSubmitResult(), ignored: "not returned" }, 202);
  };

  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: BASE_URL, maxRetries: 7 });
    const params = {
      requestId: "  gas-request-0001  ",
      transactionHash: TRANSACTION_HASH.toUpperCase(),
      transactionXdr: "  signed-xdr  ",
      ignored: "do-not-send",
    } as GasSubmitParams & { ignored: string };
    const result = await velo.gas.submit(params, {
      idempotencyKey: "  optional-submit-key  ",
      correlationId: "gas-correlation-0001",
      traceparent: TRACEPARENT,
      maxRetries: 99,
      submission: false,
    });

    assert.deepEqual(result, validSubmitResult());
    assert.equal(calledUrl, `${BASE_URL}/api/gas/submit`);
    assert.equal(calledOptions?.method, "POST");
    assert.equal(
      calledOptions?.body,
      JSON.stringify({
        requestId: "gas-request-0001",
        transactionHash: TRANSACTION_HASH,
        transactionXdr: "signed-xdr",
      }),
    );

    const headers = new Headers(calledOptions?.headers);
    assert.equal(headers.get("authorization"), "Bearer test-key");
    assert.equal(headers.get("content-type"), "application/json");
    assert.equal(headers.get("idempotency-key"), "optional-submit-key");
    assert.equal(headers.get("x-correlation-id"), "gas-correlation-0001");
    assert.equal(headers.get("traceparent"), TRACEPARENT);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gas.getStatus posts only the safe replay identity", async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = "";
  let calledOptions: RequestInit | undefined;

  globalThis.fetch = async (url, options) => {
    calledUrl = url.toString();
    calledOptions = options;
    return jsonResponse(
      validSubmitResult({
        status: "failed",
        outerTransactionHash: null,
        actualFeeStroops: null,
        reconciliationRequired: false,
      }),
      200,
    );
  };

  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: BASE_URL });
    const identity = {
      requestId: " gas-request-0001 ",
      transactionHash: TRANSACTION_HASH.toUpperCase(),
      transactionXdr: "signed-xdr-secret",
      outerTransactionHash: OUTER_TRANSACTION_HASH,
    } as GasExecutionIdentity & Record<string, string>;
    const result = await velo.gas.getStatus(identity, {
      maxRetries: 99,
      submission: true,
    });

    assert.equal(result.status, "failed");
    assert.equal(result.outerTransactionHash, null);
    assert.equal(result.actualFeeStroops, null);
    assert.equal(calledUrl, `${BASE_URL}/api/gas/submit`);
    assert.deepEqual(JSON.parse(calledOptions?.body as string), {
      requestId: "gas-request-0001",
      transactionHash: TRANSACTION_HASH,
    });
    const statusBody = calledOptions?.body;
    assert.equal(typeof statusBody, "string");
    if (typeof statusBody !== "string") throw new Error("Expected a serialized status body.");
    assert.equal(statusBody.includes("signed-xdr-secret"), false);
    assert.equal(new Headers(calledOptions?.headers).get("idempotency-key"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gas submission preserves all running and terminal statuses", async () => {
  const originalFetch = globalThis.fetch;
  const statuses: GasExecutionStatus[] = [
    "claimed",
    "submission_unknown",
    "submitted",
    "succeeded",
    "failed",
    "cancelled",
  ];
  let calls = 0;

  globalThis.fetch = async () => {
    const status = statuses[calls++];
    const terminal = status === "succeeded" || status === "failed" || status === "cancelled";
    return jsonResponse(validSubmitResult({ status }), terminal ? 200 : 202);
  };

  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: BASE_URL });
    for (const status of statuses) {
      const result = await velo.gas.getStatus({
        requestId: "gas-request-0001",
        transactionHash: TRANSACTION_HASH,
      });
      assert.equal(result.status, status);
    }
    assert.equal(calls, statuses.length);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gas.submit validates identity, UTF-8 limits, and the request body before fetch", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return jsonResponse(validSubmitResult());
  };

  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: BASE_URL });
    const invalidInputs: Array<() => Promise<unknown>> = [
      () => velo.gas.submit(null as unknown as GasSubmitParams),
      () =>
        velo.gas.submit({
          requestId: "short",
          transactionHash: TRANSACTION_HASH,
          transactionXdr: "x",
        }),
      () =>
        velo.gas.submit({
          requestId: "gas-request-0001",
          transactionHash: "z".repeat(64),
          transactionXdr: "x",
        }),
      () =>
        velo.gas.submit({
          requestId: "gas-request-0001",
          transactionHash: TRANSACTION_HASH,
          transactionXdr: "x".repeat(64 * 1_024 + 1),
        }),
      () =>
        velo.gas.submit({
          requestId: "r".repeat(129),
          transactionHash: TRANSACTION_HASH,
          transactionXdr: "x",
        }),
      () =>
        velo.gas.submit(
          {
            requestId: "gas-request-0001",
            transactionHash: TRANSACTION_HASH,
            transactionXdr: "x",
          },
          null as unknown as RequestOptions,
        ),
    ];

    for (const invalidInput of invalidInputs) {
      await assert.rejects(invalidInput, (error: unknown) => {
        assert.equal(error instanceof VeloValidationError, true);
        assert.equal((error as Error).message.includes("signed-xdr-secret"), false);
        return true;
      });
    }

    const emptyXdrBodyBytes = new TextEncoder().encode(
      JSON.stringify({
        requestId: "gas-request-0001",
        transactionHash: TRANSACTION_HASH,
        transactionXdr: "",
      }),
    ).byteLength;
    const remainingXdrBytes = 64 * 1_024 - emptyXdrBodyBytes;
    const exactBodyXdr = "x".repeat(remainingXdrBytes);
    await velo.gas.submit({
      requestId: "gas-request-0001",
      transactionHash: TRANSACTION_HASH,
      transactionXdr: exactBodyXdr,
    });
    assert.equal(calls, 1);

    await assert.rejects(
      () =>
        velo.gas.submit({
          requestId: "gas-request-0001",
          transactionHash: TRANSACTION_HASH,
          transactionXdr: `${"x".repeat(remainingXdrBytes - 1)}é`,
        }),
      (error: unknown) => error instanceof VeloValidationError,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gas submission rejects malformed or mismatched responses without redaction leaks", async () => {
  const originalFetch = globalThis.fetch;
  const malformedPayloads: unknown[] = [
    "{not-json",
    { ...validSubmitResult(), object: "wrong" },
    { ...validSubmitResult(), requestId: "gas-request-0002" },
    { ...validSubmitResult(), transactionHash: OUTER_TRANSACTION_HASH },
    { ...validSubmitResult(), outerTransactionHash: "A".repeat(64) },
    { ...validSubmitResult(), status: "unknown" },
    { ...validSubmitResult(), reservedStroops: "01" },
    { ...validSubmitResult(), reservedStroops: "9223372036854775808" },
    { ...validSubmitResult(), actualFeeStroops: "-1" },
    { ...validSubmitResult(), expiresAt: "2026-09-14T00:00:00Z" },
    { ...validSubmitResult(), reconciliationRequired: "true" },
  ];

  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: BASE_URL });
    for (const payload of malformedPayloads) {
      globalThis.fetch = async () =>
        jsonResponse({ ...((payload as Record<string, unknown>) ?? {}), rawXdr: "xdr-secret" });
      await assert.rejects(
        () =>
          velo.gas.getStatus({
            requestId: "gas-request-0001",
            transactionHash: TRANSACTION_HASH,
          }),
        (error: unknown) => {
          assert.equal(error instanceof VeloAPIError, true);
          assert.equal((error as VeloAPIError).code, "invalid_response");
          assert.equal((error as Error).message.includes("xdr-secret"), false);
          assert.equal((error as Error).message.includes("rawXdr"), false);
          return true;
        },
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gas.submit turns an invalid dispatched success response into safe recovery uncertainty", async () => {
  const originalFetch = globalThis.fetch;
  const identity: GasExecutionIdentity = {
    requestId: "gas-request-0001",
    transactionHash: TRANSACTION_HASH,
  };

  globalThis.fetch = async () =>
    jsonResponse({
      ...validSubmitResult({ requestId: "gas-request-0002" }),
      rawXdr: "xdr-secret",
      apiKey: "key-secret",
    });

  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: BASE_URL });
    await assert.rejects(
      () => velo.gas.submit({ ...identity, transactionXdr: "xdr-secret" }),
      (error: unknown) => {
        assert.equal(error instanceof VeloGasSubmissionUnknownError, true);
        const unknown = error as VeloGasSubmissionUnknownError;
        assert.equal(unknown instanceof VeloSubmissionUnknownError, true);
        assert.equal(unknown.code, "submission_unknown");
        assert.equal(unknown.reason, "invalid_response");
        assert.deepEqual(unknown.recovery, identity);
        assert.equal(unknown.message.includes("xdr-secret"), false);
        assert.equal(unknown.message.includes("key-secret"), false);
        assert.equal("cause" in unknown, false);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gas submit and status force one attempt while preserving transport semantics", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: BASE_URL, maxRetries: 9 });
    globalThis.fetch = async () => {
      calls++;
      return jsonResponse(
        { error: { type: "provider_error", code: "dependency_unavailable", message: "Retry" } },
        503,
      );
    };
    await assert.rejects(
      () =>
        velo.gas.submit(
          {
            requestId: "gas-request-0001",
            transactionHash: TRANSACTION_HASH,
            transactionXdr: "signed-xdr",
          },
          { maxRetries: 99 },
        ),
      (error: unknown) => error instanceof VeloProviderError,
    );
    assert.equal(calls, 1);

    globalThis.fetch = async () => {
      calls++;
      throw new TypeError("fetch failed");
    };
    await assert.rejects(
      () =>
        velo.gas.getStatus(
          { requestId: "gas-request-0001", transactionHash: TRANSACTION_HASH },
          { maxRetries: 99 },
        ),
      (error: unknown) => error instanceof TypeError,
    );
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gas submit timeout is unknown, status timeout is bounded, and cancellation is caller-owned", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const identity: GasExecutionIdentity = {
    requestId: "gas-request-0001",
    transactionHash: TRANSACTION_HASH,
  };

  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: BASE_URL });
    const controller = new AbortController();
    const callerReason = new DOMException("caller stopped waiting", "AbortError");
    controller.abort(callerReason);
    globalThis.fetch = async () => {
      calls++;
      return jsonResponse(validSubmitResult());
    };
    await assert.rejects(
      () =>
        velo.gas.submit(
          { ...identity, transactionXdr: "signed-xdr" },
          { signal: controller.signal },
        ),
      (error: unknown) => error === callerReason,
    );
    assert.equal(calls, 0);

    globalThis.fetch = async (_url, options) => {
      calls++;
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("The operation was aborted.", "AbortError")),
          { once: true },
        );
      });
    };
    await assert.rejects(
      () => velo.gas.submit({ ...identity, transactionXdr: "signed-xdr" }, { timeoutMs: 20 }),
      (error: unknown) => {
        assert.equal(error instanceof VeloGasSubmissionUnknownError, true);
        const unknown = error as VeloGasSubmissionUnknownError;
        assert.equal(unknown.reason, "timeout");
        assert.deepEqual(unknown.recovery, identity);
        return true;
      },
    );
    await assert.rejects(
      () => velo.gas.getStatus(identity, { timeoutMs: 20 }),
      (error: unknown) => error instanceof VeloTimeoutError,
    );
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gas.submit reports post-dispatch disconnect and cancellation without unsafe context", async () => {
  const originalFetch = globalThis.fetch;
  const identity: GasExecutionIdentity = {
    requestId: "gas-request-0001",
    transactionHash: TRANSACTION_HASH,
  };

  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: BASE_URL });
    globalThis.fetch = async () => {
      throw new TypeError("network secret xdr-secret");
    };
    await assert.rejects(
      () => velo.gas.submit({ ...identity, transactionXdr: "xdr-secret" }),
      (error: unknown) => {
        assert.equal(error instanceof VeloGasSubmissionUnknownError, true);
        const unknown = error as VeloGasSubmissionUnknownError;
        assert.equal(unknown.reason, "network_error");
        assert.deepEqual(unknown.recovery, identity);
        assert.equal(unknown.message.includes("xdr-secret"), false);
        assert.equal(unknown.message.includes("network secret"), false);
        return true;
      },
    );

    const controller = new AbortController();
    const callerReason = new DOMException("caller secret", "AbortError");
    globalThis.fetch = async (_url, options) => {
      setTimeout(() => controller.abort(callerReason), 0);
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("The operation was aborted.", "AbortError")),
          { once: true },
        );
      });
    };
    await assert.rejects(
      () =>
        velo.gas.submit(
          { ...identity, transactionXdr: "xdr-secret" },
          { signal: controller.signal },
        ),
      (error: unknown) => {
        assert.equal(error instanceof VeloGasSubmissionUnknownError, true);
        const unknown = error as VeloGasSubmissionUnknownError;
        assert.equal(unknown.reason, "cancelled");
        assert.deepEqual(unknown.recovery, identity);
        assert.equal(unknown.message.includes("caller secret"), false);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gas.sponsor cancels retry backoff and prevents another dispatch", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const callerReason = new DOMException("caller stopped waiting", "AbortError");
  let calls = 0;

  globalThis.fetch = async () => {
    calls++;
    setTimeout(() => controller.abort(callerReason), 5);
    return jsonResponse(
      { error: { type: "provider_error", code: "temporary_failure", message: "Retry" } },
      503,
      { "Retry-After": "100" },
    );
  };

  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: BASE_URL });
    await assert.rejects(
      () => velo.gas.sponsor("signed-xdr", { ...defaultOptions(), signal: controller.signal }),
      (error: unknown) => error === callerReason,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gas.sponsor allows zero-delay retries and stops before a deadline dispatch", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) {
      return jsonResponse(
        { error: { type: "provider_error", code: "temporary_failure", message: "Retry" } },
        503,
        { "Retry-After": "0" },
      );
    }
    return jsonResponse(validReservation());
  };

  try {
    const velo = new Velo({
      apiKey: "test-key",
      baseUrl: BASE_URL,
      maxRetries: 1,
      retryBaseDelayMs: 0,
      retryMaxDelayMs: 0,
    });
    await velo.gas.sponsor("signed-xdr", defaultOptions());
    assert.equal(calls, 2);

    calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return jsonResponse(
        { error: { type: "provider_error", code: "temporary_failure", message: "Retry" } },
        503,
        { "Retry-After": "100" },
      );
    };
    await assert.rejects(
      () => velo.gas.sponsor("signed-xdr", { ...defaultOptions(), timeoutMs: 20 }),
      (error: unknown) => error instanceof VeloTimeoutError,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("public entry-point types expose gas.sponsor with required idempotency", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse(validReservation());

  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: BASE_URL });
    const options: GasSponsorOptions = { idempotencyKey: "gas-operation-0001" };
    const sponsor: Velo["gas"]["sponsor"] = velo.gas.sponsor;
    const reservation: GasSponsorReservation = await sponsor("signed-xdr", options);
    assert.equal(reservation.object, "gas_sponsor_reservation");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("public entry-point types expose Gas submission and status methods", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse(validSubmitResult());

  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: BASE_URL });
    const identity: GasExecutionIdentity = {
      requestId: "gas-request-0001",
      transactionHash: TRANSACTION_HASH,
    };
    const params: GasSubmitParams = { ...identity, transactionXdr: "signed-xdr" };
    const status: GasExecutionStatus = "submitted";
    const submit: Velo["gas"]["submit"] = velo.gas.submit;
    const getStatus: Velo["gas"]["getStatus"] = velo.gas.getStatus;
    const submitted: GasSubmitResult = await submit(params);
    const current: GasSubmitResult = await getStatus(identity);
    assert.equal(submitted.status, status);
    assert.equal(current.requestId, identity.requestId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gas.waitForResult returns every execution state and stops at terminal results", async () => {
  const originalFetch = globalThis.fetch;
  const statuses: GasExecutionStatus[] = [
    "claimed",
    "submission_unknown",
    "submitted",
    "succeeded",
    "failed",
    "cancelled",
  ];
  let calls = 0;

  globalThis.fetch = async () => {
    const status = statuses[calls++];
    return jsonResponse(validSubmitResult({ status }), status === "claimed" ? 202 : 200);
  };

  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: BASE_URL });
    for (const status of statuses) {
      const result = await velo.gas.waitForResult(
        { requestId: "gas-request-0001", transactionHash: TRANSACTION_HASH },
        { maxAttempts: 1, timeoutMs: 1_000, initialDelayMs: 1, maxDelayMs: 1 },
      );
      assert.equal(result.status, status);
    }
    assert.equal(calls, statuses.length);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gas.waitForResult polls with bounded exponential delays", async () => {
  const originalFetch = globalThis.fetch;
  const clock = new FakeClock();
  const returnedStatuses: GasExecutionStatus[] = ["claimed", "submitted", "succeeded"];
  let calls = 0;
  globalThis.fetch = async () =>
    jsonResponse(validSubmitResult({ status: returnedStatuses[calls++] }), 202);

  clock.install();
  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: BASE_URL });
    const waiting = velo.gas.waitForResult(
      { requestId: "gas-request-0001", transactionHash: TRANSACTION_HASH },
      { timeoutMs: 2_000, maxAttempts: 5, initialDelayMs: 500, maxDelayMs: 1_000 },
    );
    await flushPromises();
    await clock.advance(0);
    assert.equal(calls, 1);
    assert.equal(clock.pendingTimers(), 1);

    await clock.advance(499);
    assert.equal(calls, 1);
    await clock.advance(1);
    assert.equal(calls, 2);
    await clock.advance(999);
    assert.equal(calls, 2);
    await clock.advance(1);
    assert.equal(calls, 3);
    assert.equal((await waiting).status, "succeeded");
    assert.equal(clock.pendingTimers(), 0);
  } finally {
    clock.restore();
    globalThis.fetch = originalFetch;
  }
});

test("gas.waitForResult returns the last DTO on exhaustion or deadline", async () => {
  const originalFetch = globalThis.fetch;
  const clock = new FakeClock();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return jsonResponse(validSubmitResult({ status: "submitted", actualFeeStroops: null }), 202);
  };

  clock.install();
  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: BASE_URL });
    const exhausted = velo.gas.waitForResult(
      { requestId: "gas-request-0001", transactionHash: TRANSACTION_HASH },
      { maxAttempts: 3, timeoutMs: 1_000, initialDelayMs: 10, maxDelayMs: 20 },
    );
    await flushPromises();
    await clock.advance(10);
    await clock.advance(20);
    assert.equal((await exhausted).actualFeeStroops, null);
    assert.equal(calls, 3);

    calls = 0;
    const deadlineResult = velo.gas.waitForResult(
      { requestId: "gas-request-0001", transactionHash: TRANSACTION_HASH },
      { maxAttempts: 10, timeoutMs: 10, initialDelayMs: 100, maxDelayMs: 100 },
    );
    await flushPromises();
    await clock.advance(10);
    const result = await deadlineResult;
    assert.equal(result.status, "submitted");
    assert.equal(result.actualFeeStroops, null);
    assert.equal(calls, 1);
    assert.equal(clock.pendingTimers(), 0);
  } finally {
    clock.restore();
    globalThis.fetch = originalFetch;
  }
});

test("gas.waitForResult throws a safe waiting error without a validated DTO", async () => {
  const originalFetch = globalThis.fetch;
  const clock = new FakeClock();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new TypeError("network secret and xdr-secret");
  };

  clock.install();
  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: BASE_URL });
    const waiting = velo.gas.waitForResult(
      { requestId: " gas-request-0001 ", transactionHash: TRANSACTION_HASH.toUpperCase() },
      { maxAttempts: 2, timeoutMs: 1_000, initialDelayMs: 5, maxDelayMs: 5 },
    );
    await flushPromises();
    await clock.advance(5);
    await assert.rejects(waiting, (error: unknown) => {
      assert.equal(error instanceof VeloGasWaitError, true);
      const waitError = error as VeloGasWaitError;
      assert.equal(waitError.reason, "attempts_exhausted");
      assert.deepEqual(waitError.recovery, {
        requestId: "gas-request-0001",
        transactionHash: TRANSACTION_HASH,
      });
      assert.equal(waitError.message.includes("network secret"), false);
      assert.equal(waitError.message.includes("xdr-secret"), false);
      assert.equal("cause" in waitError, false);
      return true;
    });
    assert.equal(calls, 2);
    assert.equal(clock.pendingTimers(), 0);
  } finally {
    clock.restore();
    globalThis.fetch = originalFetch;
  }
});

test("gas.waitForResult retries transient status failures and honors Retry-After", async () => {
  const originalFetch = globalThis.fetch;
  const clock = new FakeClock();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) {
      return jsonResponse({ error: { type: "provider_error", code: "temporary_failure" } }, 503, {
        "Retry-After": "2",
      });
    }
    return jsonResponse(
      validSubmitResult({ status: calls === 2 ? "submitted" : "succeeded" }),
      202,
    );
  };

  clock.install();
  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: BASE_URL });
    const waiting = velo.gas.waitForResult(
      { requestId: "gas-request-0001", transactionHash: TRANSACTION_HASH },
      { maxAttempts: 3, timeoutMs: 5_000, initialDelayMs: 500, maxDelayMs: 1_000 },
    );
    await flushPromises();
    await clock.advance(0);
    assert.equal(calls, 1);
    await clock.advance(1_999);
    assert.equal(calls, 1);
    await clock.advance(1);
    assert.equal(calls, 2);
    await clock.advance(999);
    assert.equal(calls, 2);
    await clock.advance(1);
    assert.equal(calls, 3);
    assert.equal((await waiting).status, "succeeded");
  } finally {
    clock.restore();
    globalThis.fetch = originalFetch;
  }
});

test("gas.waitForResult retries network, timeout, 408, 429, and 5xx failures", async () => {
  const originalFetch = globalThis.fetch;
  const clock = new FakeClock();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) {
      return jsonResponse({ error: { code: "request_timeout" } }, 408);
    }
    if (calls === 2) {
      return jsonResponse({ error: { code: "temporary_rate_limit" } }, 429, {
        "Retry-After": "0",
      });
    }
    if (calls === 3) {
      return jsonResponse({ error: { code: "temporary_failure" } }, 500);
    }
    if (calls === 4) throw new TypeError("fetch failed");
    return jsonResponse(validSubmitResult({ status: "succeeded" }));
  };

  clock.install();
  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: BASE_URL });
    const waiting = velo.gas.waitForResult(
      { requestId: "gas-request-0001", transactionHash: TRANSACTION_HASH },
      { maxAttempts: 5, timeoutMs: 5_000, initialDelayMs: 10, maxDelayMs: 20 },
    );
    await flushPromises();
    await clock.advance(10);
    assert.equal(calls, 2);
    await clock.advance(20);
    assert.equal(calls, 3);
    await clock.advance(20);
    assert.equal(calls, 4);
    await clock.advance(20);
    assert.equal(calls, 5);
    assert.equal((await waiting).status, "succeeded");
    assert.equal(clock.pendingTimers(), 0);
  } finally {
    clock.restore();
    globalThis.fetch = originalFetch;
  }
});

test("gas.waitForResult gives each status request only the remaining wait budget", async () => {
  const originalFetch = globalThis.fetch;
  const clock = new FakeClock();
  const abortTimes: number[] = [];
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    if (calls === 1) {
      return new Promise((resolve) => {
        setTimeout(() => resolve(jsonResponse({ error: { code: "temporary_failure" } }, 503)), 60);
      });
    }
    return new Promise((_resolve, reject) => {
      options?.signal?.addEventListener(
        "abort",
        () => {
          abortTimes.push(Date.now());
          reject(new DOMException("request timeout", "AbortError"));
        },
        { once: true },
      );
    });
  };

  clock.install();
  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: BASE_URL });
    const waiting = velo.gas.waitForResult(
      { requestId: "gas-request-0001", transactionHash: TRANSACTION_HASH },
      { maxAttempts: 3, timeoutMs: 100, initialDelayMs: 10, maxDelayMs: 10 },
    );
    await flushPromises();
    await clock.advance(60);
    assert.equal(calls, 1);
    await clock.advance(10);
    assert.equal(calls, 2);
    await clock.advance(29);
    assert.deepEqual(abortTimes, []);
    await clock.advance(1);
    await assert.rejects(
      waiting,
      (error: unknown) => error instanceof VeloGasWaitError && error.reason === "timeout",
    );
    assert.deepEqual(abortTimes, [100]);
    assert.equal(clock.pendingTimers(), 0);
  } finally {
    clock.restore();
    globalThis.fetch = originalFetch;
  }
});

test("gas.waitForResult propagates permanent and malformed status errors", async () => {
  const originalFetch = globalThis.fetch;
  const cases = [
    {
      response: jsonResponse({ error: { type: "auth_error", code: "invalid_api_key" } }, 401),
      expected: VeloAuthError,
    },
    {
      response: jsonResponse(
        { error: { type: "rate_limit_error", code: "daily_cap_exceeded" } },
        429,
      ),
      expected: VeloRateLimitError,
    },
    {
      response: jsonResponse(
        { error: { type: "rate_limit_error", code: "wallet_rate_limited" } },
        429,
      ),
      expected: VeloRateLimitError,
    },
    {
      response: jsonResponse({ ...validSubmitResult(), status: "not-a-status" }),
      expected: VeloAPIError,
    },
    {
      response: jsonResponse({ ...validSubmitResult(), requestId: "gas-request-0002" }),
      expected: VeloAPIError,
    },
  ] as const;

  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: BASE_URL });
    for (const testCase of cases) {
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        return testCase.response;
      };
      await assert.rejects(
        () =>
          velo.gas.waitForResult(
            { requestId: "gas-request-0001", transactionHash: TRANSACTION_HASH },
            { maxAttempts: 10, timeoutMs: 1_000, initialDelayMs: 1, maxDelayMs: 1 },
          ),
        (error: unknown) => error instanceof testCase.expected,
      );
      assert.equal(calls, 1);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gas.waitForResult wraps cancellation and supports safe resume", async () => {
  const originalFetch = globalThis.fetch;
  const clock = new FakeClock();
  const controller = new AbortController();
  const callerReason = new DOMException("caller secret", "AbortError");
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return jsonResponse(validSubmitResult({ status: "submitted" }), 202);
  };

  clock.install();
  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: BASE_URL });
    const waiting = velo.gas.waitForResult(
      { requestId: " gas-request-0001 ", transactionHash: TRANSACTION_HASH.toUpperCase() },
      {
        signal: controller.signal,
        timeoutMs: 1_000,
        maxAttempts: 10,
        initialDelayMs: 500,
        maxDelayMs: 500,
      },
    );
    await flushPromises();
    controller.abort(callerReason);
    await assert.rejects(waiting, (error: unknown) => {
      assert.equal(error instanceof VeloGasWaitError, true);
      const waitError = error as VeloGasWaitError;
      assert.equal(waitError.reason, "cancelled");
      assert.deepEqual(waitError.recovery, {
        requestId: "gas-request-0001",
        transactionHash: TRANSACTION_HASH,
      });
      assert.equal(waitError.message.includes("caller secret"), false);
      return true;
    });
    assert.equal(calls, 1);
    assert.equal(clock.pendingTimers(), 0);

    globalThis.fetch = async (_url, options) => {
      calls++;
      const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
      assert.deepEqual(body, {
        requestId: "gas-request-0001",
        transactionHash: TRANSACTION_HASH,
      });
      return jsonResponse(validSubmitResult({ status: "succeeded" }));
    };
    const resumed = await velo.gas.waitForResult(
      {
        requestId: "gas-request-0001",
        transactionHash: TRANSACTION_HASH,
      },
      { maxAttempts: 1, timeoutMs: 1_000, initialDelayMs: 1, maxDelayMs: 1 },
    );
    assert.equal(resumed.status, "succeeded");
    assert.equal(calls, 2);
  } finally {
    clock.restore();
    globalThis.fetch = originalFetch;
  }
});

test("gas.waitForResult wraps cancellation before dispatch and during a request", async () => {
  const originalFetch = globalThis.fetch;
  const identity: GasExecutionIdentity = {
    requestId: "gas-request-0001",
    transactionHash: TRANSACTION_HASH,
  };
  try {
    const before = new AbortController();
    before.abort(new DOMException("before dispatch secret", "AbortError"));
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return jsonResponse(validSubmitResult({ status: "succeeded" }));
    };
    const velo = new Velo({ apiKey: "test-key", baseUrl: BASE_URL });
    await assert.rejects(
      () => velo.gas.waitForResult(identity, { signal: before.signal }),
      (error: unknown) => error instanceof VeloGasWaitError && error.reason === "cancelled",
    );
    assert.equal(calls, 0);

    const during = new AbortController();
    globalThis.fetch = async (_url, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("transport abort secret", "AbortError")),
          { once: true },
        );
        during.abort(new DOMException("during request secret", "AbortError"));
      });
    await assert.rejects(
      () => velo.gas.waitForResult(identity, { signal: during.signal, timeoutMs: 1_000 }),
      (error: unknown) => error instanceof VeloGasWaitError && error.reason === "cancelled",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gas.waitForResult snapshots identity and options and never sends XDR", async () => {
  const originalFetch = globalThis.fetch;
  const clock = new FakeClock();
  const identity = {
    requestId: " gas-request-0001 ",
    transactionHash: TRANSACTION_HASH.toUpperCase(),
    transactionXdr: "xdr-secret",
  } as GasExecutionIdentity & { transactionXdr: string };
  const options: GasWaitOptions = {
    correlationId: "gas-correlation-0001",
    timeoutMs: 2_000,
    maxAttempts: 2,
    initialDelayMs: 500,
    maxDelayMs: 500,
  };
  const requests: Array<{ body: string; correlationId: string | null }> = [];
  let calls = 0;
  globalThis.fetch = async (_url, request) => {
    requests.push({
      body: String(request?.body),
      correlationId: new Headers(request?.headers).get("x-correlation-id"),
    });
    calls++;
    return jsonResponse(
      validSubmitResult({ status: calls === 1 ? "submitted" : "succeeded" }),
      202,
    );
  };

  clock.install();
  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: BASE_URL });
    const waiting = velo.gas.waitForResult(identity, options);
    identity.requestId = "gas-request-mutated";
    identity.transactionHash = OUTER_TRANSACTION_HASH;
    options.correlationId = "gas-correlation-mutated";
    await flushPromises();
    await clock.advance(500);
    assert.equal((await waiting).status, "succeeded");
    assert.deepEqual(requests, [
      {
        body: JSON.stringify({ requestId: "gas-request-0001", transactionHash: TRANSACTION_HASH }),
        correlationId: "gas-correlation-0001",
      },
      {
        body: JSON.stringify({ requestId: "gas-request-0001", transactionHash: TRANSACTION_HASH }),
        correlationId: "gas-correlation-0001",
      },
    ]);
    assert.equal(
      requests.some((request) => request.body.includes("xdr-secret")),
      false,
    );
    assert.equal(clock.pendingTimers(), 0);
  } finally {
    clock.restore();
    globalThis.fetch = originalFetch;
  }
});

test("gas.waitForResult validates limits and exposes its public types", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return jsonResponse(validSubmitResult({ status: "succeeded" }));
  };

  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: BASE_URL });
    const identity: GasExecutionIdentity = {
      requestId: "gas-request-0001",
      transactionHash: TRANSACTION_HASH,
    };
    const invalidOptions: GasWaitOptions[] = [
      { maxAttempts: 0 },
      { maxAttempts: 1.5 },
      { maxAttempts: Number.MAX_SAFE_INTEGER + 1 },
      { initialDelayMs: 0 },
      { initialDelayMs: MAX_TIMER_DURATION_MS + 1 },
      { maxDelayMs: 0 },
      { initialDelayMs: 500, maxDelayMs: 499 },
      { timeoutMs: 0 },
      { timeoutMs: MAX_TIMER_DURATION_MS + 1 },
    ];
    for (const options of invalidOptions) {
      await assert.rejects(
        () => velo.gas.waitForResult(identity, options),
        (error: unknown) => error instanceof VeloValidationError,
      );
    }
    assert.equal(calls, 0);

    const options: GasWaitOptions = {
      correlationId: "gas-correlation-0001",
      maxAttempts: 1,
      initialDelayMs: 1,
      maxDelayMs: 1,
    };
    const wait: Velo["gas"]["waitForResult"] = velo.gas.waitForResult;
    const result: GasSubmitResult = await wait(identity, options);
    assert.equal(result.status, "succeeded");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gas.sponsorAndSubmit composes ordered calls with stable normalized input and headers", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; body: string; headers: Headers }> = [];
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    requests.push({
      url: url.toString(),
      body: String(options?.body),
      headers: new Headers(options?.headers),
    });
    return calls % 2 === 1
      ? jsonResponse(validReservation())
      : jsonResponse(validSubmitResult({ actualFeeStroops: null }), 202);
  };

  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: BASE_URL });
    const options = {
      ...defaultOptions(),
      correlationId: "gas-correlation-0001",
      traceparent: TRACEPARENT,
      maxRetries: 99,
      submission: true,
    };

    const first = await velo.gas.sponsorAndSubmit("  signed-xdr  ", options);
    const second = await velo.gas.sponsorAndSubmit(" signed-xdr ", options);

    assert.deepEqual(first, {
      object: "gas_submit_result",
      requestId: "gas-request-0001",
      transactionHash: TRANSACTION_HASH,
      outerTransactionHash: OUTER_TRANSACTION_HASH,
      status: "submitted",
      reservedStroops: "9223372036854775807",
      actualFeeStroops: null,
      expiresAt: "2026-09-14T00:00:00.000Z",
      reconciliationRequired: true,
    } satisfies GasSubmitResult);
    assert.deepEqual(second, first);
    assert.equal(calls, 4);
    assert.deepEqual(
      requests.map((request) => request.url),
      [
        `${BASE_URL}/api/gas/sponsor`,
        `${BASE_URL}/api/gas/submit`,
        `${BASE_URL}/api/gas/sponsor`,
        `${BASE_URL}/api/gas/submit`,
      ],
    );
    assert.equal(requests[0]?.body, JSON.stringify({ transactionXdr: "signed-xdr" }));
    assert.equal(
      requests[1]?.body,
      JSON.stringify({
        requestId: "gas-request-0001",
        transactionHash: TRANSACTION_HASH,
        transactionXdr: "signed-xdr",
      }),
    );
    for (const request of requests) {
      assert.equal(request.headers.get("idempotency-key"), "gas-operation-0001");
      assert.equal(request.headers.get("x-correlation-id"), "gas-correlation-0001");
      assert.equal(request.headers.get("traceparent"), TRACEPARENT);
    }
    assert.equal(requests[0]?.body.includes("signed-xdr"), true);
    assert.equal(requests[1]?.body.includes("signed-xdr"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gas.sponsorAndSubmit preserves every validated execution status and projection", async () => {
  const originalFetch = globalThis.fetch;
  const statuses: GasExecutionStatus[] = [
    "claimed",
    "submission_unknown",
    "submitted",
    "succeeded",
    "failed",
    "cancelled",
  ];
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls % 2 === 1) return jsonResponse(validReservation());
    const status = statuses[(calls - 2) / 2];
    const terminal = status === "succeeded" || status === "failed" || status === "cancelled";
    return jsonResponse(
      {
        ...validSubmitResult({
          status,
          outerTransactionHash: status === "claimed" ? null : OUTER_TRANSACTION_HASH,
          actualFeeStroops: status === "succeeded" ? "73813" : null,
        }),
        ignored: "not returned",
      },
      terminal ? 200 : 202,
    );
  };

  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: BASE_URL });
    for (const status of statuses) {
      const result = await velo.gas.sponsorAndSubmit("signed-xdr", defaultOptions());
      assert.equal(result.status, status);
      assert.equal(result.object, "gas_submit_result");
      assert.equal(result.requestId, "gas-request-0001");
      assert.equal(result.transactionHash, TRANSACTION_HASH);
      assert.equal(result.actualFeeStroops, status === "succeeded" ? "73813" : null);
      assert.equal(result.status === "succeeded", status === "succeeded");
      assert.equal("ignored" in result, false);
    }
    assert.equal(calls, statuses.length * 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gas.sponsorAndSubmit validates before dispatch and stops on sponsor denial or malformed reservation", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return jsonResponse(validReservation());
  };

  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: BASE_URL });
    await assert.rejects(
      () => velo.gas.sponsorAndSubmit("", defaultOptions()),
      (error: unknown) => error instanceof VeloValidationError,
    );
    await assert.rejects(
      () => velo.gas.sponsorAndSubmit("signed-xdr", null as unknown as GasSponsorOptions),
      (error: unknown) => error instanceof VeloValidationError,
    );
    assert.equal(calls, 0);

    globalThis.fetch = async () => {
      calls++;
      return jsonResponse(
        { error: { type: "validation_error", code: "contract_not_whitelisted" } },
        403,
      );
    };
    await assert.rejects(
      () => velo.gas.sponsorAndSubmit("signed-xdr", defaultOptions()),
      (error: unknown) => error instanceof VeloValidationError,
    );
    assert.equal(calls, 1);

    globalThis.fetch = async () => {
      calls++;
      return jsonResponse(validReservation({ requestId: "short" }));
    };
    await assert.rejects(
      () => velo.gas.sponsorAndSubmit("signed-xdr", defaultOptions()),
      (error: unknown) => error instanceof VeloAPIError && error.code === "invalid_response",
    );
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gas.sponsorAndSubmit shares configured and overridden deadlines across sponsor retries", async () => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let now = 0;
  Date.now = () => now;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) {
      now = 60;
      return jsonResponse({ error: { type: "provider_error", code: "temporary_failure" } }, 503, {
        "Retry-After": "0",
      });
    }
    return calls === 2 ? jsonResponse(validReservation()) : jsonResponse(validSubmitResult());
  };

  try {
    const velo = new Velo({
      apiKey: "test-key",
      baseUrl: BASE_URL,
      timeoutMs: 100,
      maxRetries: 1,
      retryBaseDelayMs: 0,
      retryMaxDelayMs: 0,
    });
    await velo.gas.sponsorAndSubmit("signed-xdr", defaultOptions());
    assert.equal(calls, 3);

    now = 0;
    calls = 0;
    globalThis.fetch = async () => {
      calls++;
      if (calls === 1) {
        now = 60;
        return jsonResponse(validReservation());
      }
      return jsonResponse(validSubmitResult());
    };
    await assert.rejects(
      () => velo.gas.sponsorAndSubmit("signed-xdr", { ...defaultOptions(), timeoutMs: 50 }),
      (error: unknown) => error instanceof VeloTimeoutError,
    );
    assert.equal(calls, 1);
  } finally {
    Date.now = originalNow;
    globalThis.fetch = originalFetch;
  }
});

test("gas.sponsorAndSubmit rejects an exhausted handoff budget before submission", async () => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let now = 0;
  let calls = 0;
  Date.now = () => now;
  globalThis.fetch = async () => {
    calls++;
    now = 101;
    return jsonResponse(validReservation());
  };

  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: BASE_URL, timeoutMs: 100 });
    await assert.rejects(
      () => velo.gas.sponsorAndSubmit("signed-xdr", defaultOptions()),
      (error: unknown) => error instanceof VeloTimeoutError,
    );
    assert.equal(calls, 1);
  } finally {
    Date.now = originalNow;
    globalThis.fetch = originalFetch;
  }
});

test("gas.sponsorAndSubmit honors cancellation before dispatch and between stages", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const reason = new DOMException("caller stopped", "AbortError");
  controller.abort(reason);
  let calls = 0;

  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: BASE_URL });
    globalThis.fetch = async () => {
      calls++;
      return jsonResponse(validReservation());
    };
    await assert.rejects(
      () =>
        velo.gas.sponsorAndSubmit("signed-xdr", { ...defaultOptions(), signal: controller.signal }),
      (error: unknown) => error === reason,
    );
    assert.equal(calls, 0);

    const betweenStages = new AbortController();
    const betweenReason = new DOMException("caller stopped between stages", "AbortError");
    globalThis.fetch = async () => {
      calls++;
      betweenStages.abort(betweenReason);
      return jsonResponse(validReservation());
    };
    await assert.rejects(
      () =>
        velo.gas.sponsorAndSubmit("signed-xdr", {
          ...defaultOptions(),
          signal: betweenStages.signal,
        }),
      (error: unknown) => error === betweenReason,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gas.sponsorAndSubmit preserves unknown submission recovery and never retries XDR handoff", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    requests.push(`${url.toString()} ${String(options?.body)}`);
    if (calls === 1) return jsonResponse(validReservation());
    throw new TypeError("network failure");
  };

  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: BASE_URL, maxRetries: 99 });
    await assert.rejects(
      () => velo.gas.sponsorAndSubmit("signed-xdr", { ...defaultOptions(), maxRetries: 99 }),
      (error: unknown) => {
        assert.equal(error instanceof VeloGasSubmissionUnknownError, true);
        assert.deepEqual((error as VeloGasSubmissionUnknownError).recovery, {
          requestId: "gas-request-0001",
          transactionHash: TRANSACTION_HASH,
        });
        return true;
      },
    );
    assert.equal(calls, 2);
    assert.equal(requests[1]?.includes('"transactionXdr":"signed-xdr"'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gas.sponsorAndSubmit never automatically retries submission with conflicting retry options", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) {
      return jsonResponse(
        { error: { type: "provider_error", code: "dependency_unavailable" } },
        503,
      );
    }
    if (calls === 2) return jsonResponse(validReservation());
    return jsonResponse({ error: { type: "provider_error", code: "dependency_unavailable" } }, 503);
  };

  try {
    const velo = new Velo({
      apiKey: "test-key",
      baseUrl: BASE_URL,
      maxRetries: 9,
      retryBaseDelayMs: 0,
      retryMaxDelayMs: 0,
    });
    await assert.rejects(
      () => velo.gas.sponsorAndSubmit("signed-xdr", { ...defaultOptions(), maxRetries: 99 }),
      (error: unknown) => error instanceof VeloProviderError,
    );
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("public entry-point types expose gas.sponsorAndSubmit", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) =>
    url.toString().endsWith("/sponsor")
      ? jsonResponse(validReservation())
      : jsonResponse(validSubmitResult());

  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: BASE_URL });
    const sponsorAndSubmit: Velo["gas"]["sponsorAndSubmit"] = velo.gas.sponsorAndSubmit;
    const result: GasSubmitResult = await sponsorAndSubmit("signed-xdr", defaultOptions());
    assert.equal(result.status, "submitted");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
