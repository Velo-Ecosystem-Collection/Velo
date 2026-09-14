import assert from "node:assert/strict";
import test from "node:test";

import { Velo } from "./client.ts";
import {
  VeloAPIError,
  VeloAuthError,
  VeloProviderError,
  VeloRateLimitError,
  VeloSubmissionUnknownError,
  VeloTimeoutError,
  VeloValidationError,
} from "./errors.ts";
import { HttpClient, resolveBaseUrl } from "./http.ts";

test("Velo constructor validates apiKey", () => {
  assert.throws(() => new Velo({ apiKey: "" }), /API key is required/);
  assert.throws(() => new Velo({ apiKey: "   " }), /API key is required/);
  assert.throws(() => new Velo({ apiKey: null as unknown as string }), /API key is required/);
});

test("resolveBaseUrl works as expected", () => {
  assert.equal(
    resolveBaseUrl({ apiKey: "key", baseUrl: "https://custom.velo.pay" }),
    "https://custom.velo.pay",
  );
  assert.equal(
    resolveBaseUrl({ apiKey: "key", environment: "production" }),
    "https://api.velo.pay",
  );
  assert.equal(
    resolveBaseUrl({ apiKey: "key", environment: "testnet" }),
    "https://api.testnet.velo.pay",
  );
  assert.equal(
    resolveBaseUrl({ apiKey: "key", environment: "development" }),
    "http://localhost:3000",
  );
  assert.equal(resolveBaseUrl({ apiKey: "key" }), "http://localhost:3000");
});

test("HttpClient sets correct authorization and custom headers", async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = "";
  let calledOptions: RequestInit | undefined;

  globalThis.fetch = async (url, options) => {
    calledUrl = url.toString();
    calledOptions = options;
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const client = new HttpClient({ apiKey: "test-key", baseUrl: "https://api.example.com" });
    const res = await client.request(
      "POST",
      "/test",
      { foo: "bar" },
      {
        idempotencyKey: "idem-123",
        correlationId: "request-00000001",
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      },
    );

    assert.deepEqual(res, { success: true });
    assert.equal(calledUrl, "https://api.example.com/test");
    assert.equal(calledOptions?.method, "POST");

    const headers = calledOptions?.headers as Record<string, string>;
    assert.equal(headers["Authorization"], "Bearer test-key");
    assert.equal(headers["Content-Type"], "application/json");
    assert.equal(headers["Idempotency-Key"], "idem-123");
    assert.equal(headers["X-Correlation-Id"], "request-00000001");
    assert.equal(headers.traceparent, "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01");
    assert.equal(calledOptions?.body, JSON.stringify({ foo: "bar" }));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HttpClient timeout behavior throws error", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, options) => {
    const signal = options?.signal;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        resolve(new Response(JSON.stringify({}), { status: 200 }));
      }, 100);

      if (signal) {
        if (signal.aborted) {
          clearTimeout(timer);
          reject(new DOMException("The operation was aborted.", "AbortError"));
          return;
        }
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      }
    });
  };

  try {
    const client = new HttpClient({ apiKey: "test-key", timeoutMs: 10 });
    await assert.rejects(
      () => client.request("GET", "/test"),
      (err: unknown) => {
        assert.equal(err instanceof VeloAPIError, true);
        assert.equal(err instanceof VeloTimeoutError, true);
        const error = err as VeloAPIError;
        assert.equal(error.status, 408);
        assert.match(error.message, /timed out/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HttpClient preserves caller AbortSignal cancellation reason", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const callerReason = new DOMException("caller stopped waiting", "AbortError");

  globalThis.fetch = async (_url, options) => {
    setTimeout(() => controller.abort(callerReason), 5);
    await new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), {
        once: true,
      });
    });
    throw new Error("unreachable");
  };

  try {
    const client = new HttpClient({ apiKey: "test-key", timeoutMs: 1000 });
    await assert.rejects(
      () => client.request("GET", "/test", undefined, { signal: controller.signal }),
      {
        name: "AbortError",
        message: "caller stopped waiting",
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HttpClient maps REST error responses correctly", async () => {
  const originalFetch = globalThis.fetch;

  const mockErrorResponse = (
    status: number,
    type: string,
    message: string,
    code: string,
    param?: string,
  ) => {
    return async () => {
      const responseBody = JSON.stringify({
        error: { type, message, code, param },
      });
      return new Response(responseBody, {
        status,
        headers: {
          "Content-Type": "application/json",
          "x-request-id": "req-id-123",
        },
      });
    };
  };

  try {
    const client = new HttpClient({ apiKey: "test-key" });

    // 401 Unauthorized -> VeloAuthError
    globalThis.fetch = mockErrorResponse(401, "auth_error", "Invalid API key", "invalid_api_key");
    await assert.rejects(
      () => client.request("GET", "/test"),
      (err: unknown) => {
        assert.equal(err instanceof VeloAuthError, true);
        const error = err as VeloAuthError;
        assert.equal(error.status, 401);
        assert.equal(error.code, "invalid_api_key");
        assert.equal(error.requestId, "req-id-123");
        return true;
      },
    );

    // 400 Bad Request -> VeloValidationError
    globalThis.fetch = mockErrorResponse(
      400,
      "validation_error",
      "Invalid amount",
      "invalid_request",
      "amount",
    );
    await assert.rejects(
      () => client.request("GET", "/test"),
      (err: unknown) => {
        assert.equal(err instanceof VeloValidationError, true);
        const error = err as VeloValidationError;
        assert.equal(error.status, 400);
        assert.equal(error.code, "invalid_request");
        assert.equal(error.param, "amount");
        assert.equal(error.requestId, "req-id-123");
        return true;
      },
    );

    // 429 Too Many Requests -> VeloRateLimitError
    globalThis.fetch = mockErrorResponse(
      429,
      "rate_limit_error",
      "Rate limit exceeded",
      "rate_limit_exceeded",
    );
    await assert.rejects(
      () => client.request("GET", "/test"),
      (err: unknown) => {
        assert.equal(err instanceof VeloRateLimitError, true);
        const error = err as VeloRateLimitError;
        assert.equal(error.status, 429);
        assert.equal(error.code, "rate_limit_exceeded");
        assert.equal(error.requestId, "req-id-123");
        return true;
      },
    );

    // 500 Internal Error -> VeloAPIError
    globalThis.fetch = mockErrorResponse(500, "api_error", "Internal error", "internal_error");
    await assert.rejects(
      () => client.request("GET", "/test"),
      (err: unknown) => {
        assert.equal(err instanceof VeloAPIError, true);
        const error = err as VeloAPIError;
        assert.equal(error.status, 500);
        assert.equal(error.code, "internal_error");
        assert.equal(error.requestId, "req-id-123");
        return true;
      },
    );

    // 503 Provider Error -> VeloProviderError
    globalThis.fetch = mockErrorResponse(
      503,
      "provider_error",
      "Provider unavailable",
      "provider_unavailable",
    );
    await assert.rejects(
      () => client.request("POST", "/test"),
      (err: unknown) => {
        assert.equal(err instanceof VeloProviderError, true);
        const error = err as VeloProviderError;
        assert.equal(error.status, 503);
        assert.equal(error.code, "provider_unavailable");
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Velo checkout.sessions.create and paymentIntents.create construct correct requests", async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = "";
  let calledOptions: RequestInit | undefined;

  globalThis.fetch = async (url, options) => {
    calledUrl = url.toString();
    calledOptions = options;
    return new Response(JSON.stringify({ id: "pi_123", object: "payment_intent" }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: "https://api.example.com" });
    const res1 = await velo.checkout.sessions.create({ amount: "10.00", asset: "USDC" });
    assert.deepEqual(res1, { id: "pi_123", object: "payment_intent" });
    assert.equal(calledUrl, "https://api.example.com/api/v2/payment-intents");
    assert.equal(calledOptions?.method, "POST");
    assert.equal(calledOptions?.body, JSON.stringify({ amount: "10.00", asset: "USDC" }));

    const res2 = await velo.paymentIntents.create({ amount: "20.00", asset: "USDC" });
    assert.deepEqual(res2, { id: "pi_123", object: "payment_intent" });
    assert.equal(calledUrl, "https://api.example.com/api/v2/payment-intents");
    assert.equal(calledOptions?.method, "POST");
    assert.equal(calledOptions?.body, JSON.stringify({ amount: "20.00", asset: "USDC" }));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Velo paymentIntents.retrieve retrieves payment intent by id with encoding", async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = "";

  globalThis.fetch = async (url) => {
    calledUrl = url.toString();
    return new Response(JSON.stringify({ id: "pi_123", object: "payment_intent" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: "https://api.example.com" });
    const res = await velo.paymentIntents.retrieve("pi/123");
    assert.deepEqual(res, { id: "pi_123", object: "payment_intent" });
    assert.equal(calledUrl, "https://api.example.com/api/v2/payment-intents/pi%2F123");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Velo paymentIntents.retrieve validates that ID is present", async () => {
  const velo = new Velo({ apiKey: "test-key" });
  await assert.rejects(() => velo.paymentIntents.retrieve(""), /Payment intent ID is required/);
  await assert.rejects(() => velo.paymentIntents.retrieve("   "), /Payment intent ID is required/);
});

test("Velo paymentIntents.list parses query parameters correctly", async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = "";

  globalThis.fetch = async (url) => {
    calledUrl = url.toString();
    return new Response(
      JSON.stringify({ object: "list", data: [], hasMore: false, nextCursor: null }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };

  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: "https://api.example.com" });
    const res = await velo.paymentIntents.list({ status: "paid", limit: 50, cursor: "abc" });
    assert.deepEqual(res, { object: "list", data: [], hasMore: false, nextCursor: null });
    assert.equal(
      calledUrl,
      "https://api.example.com/api/v2/payment-intents?status=paid&limit=50&cursor=abc",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GET request retries on 500 then succeeds", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = async (_url, _options) => {
    calls++;
    if (calls === 1) {
      return new Response(
        JSON.stringify({ error: { type: "api_error", message: "Server error", code: "internal" } }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ id: "pi_123", object: "payment_intent" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: "https://api.example.com" });
    const res = await velo.paymentIntents.retrieve("pi_123");
    assert.deepEqual(res, { id: "pi_123", object: "payment_intent" });
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("POST without idempotency key does not retry on 500", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = async (_url, _options) => {
    calls++;
    return new Response(
      JSON.stringify({ error: { type: "api_error", message: "Server error", code: "internal" } }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: "https://api.example.com" });
    await assert.rejects(
      () => velo.checkout.sessions.create({ amount: "10.00" }),
      (err: unknown) => {
        assert.equal(err instanceof VeloAPIError, true);
        return true;
      },
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("POST with idempotency key retries on 500", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = async (_url, _options) => {
    calls++;
    if (calls === 1) {
      return new Response(
        JSON.stringify({ error: { type: "api_error", message: "Server error", code: "internal" } }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ id: "pi_123", object: "payment_intent" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: "https://api.example.com" });
    const res = await velo.checkout.sessions.create(
      { amount: "10.00" },
      { idempotencyKey: "idem-1" },
    );
    assert.deepEqual(res, { id: "pi_123", object: "payment_intent" });
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HttpClient sends correlation header and honors Retry-After on retryable responses", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const propagated: Array<{
    correlation: string | null;
    traceparent: string | null;
    idempotency: string | null;
  }> = [];
  const startedAt = Date.now();

  globalThis.fetch = async (_url, options) => {
    calls++;
    const headers = new Headers(options?.headers);
    propagated.push({
      correlation: headers.get("x-correlation-id"),
      traceparent: headers.get("traceparent"),
      idempotency: headers.get("idempotency-key"),
    });
    if (calls === 1) {
      return new Response(
        JSON.stringify({
          error: { type: "rate_limit_error", message: "Slow down", code: "rate_limit" },
        }),
        {
          status: 429,
          headers: { "Content-Type": "application/json", "Retry-After": "0.02" },
        },
      );
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const client = new HttpClient({ apiKey: "test-key", baseUrl: "https://api.example.com" });
    const res = await client.request("GET", "/test", undefined, {
      correlationId: "pay-2026-sdk-0001",
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      idempotencyKey: "retry-idempotency-1",
    });
    assert.deepEqual(res, { ok: true });
    assert.deepEqual(propagated, [
      {
        correlation: "pay-2026-sdk-0001",
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        idempotency: "retry-idempotency-1",
      },
      {
        correlation: "pay-2026-sdk-0001",
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        idempotency: "retry-idempotency-1",
      },
    ]);
    assert.equal(calls, 2);
    assert.ok(Date.now() - startedAt >= 15);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HttpClient parses HTTP-date Retry-After without delaying when retries are disabled", async () => {
  const originalFetch = globalThis.fetch;
  const retryAfter = new Date(Date.now() + 10_000).toUTCString();

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { type: "provider_error", code: "temporary" } }), {
      status: 503,
      headers: { "Content-Type": "application/json", "Retry-After": retryAfter },
    });

  try {
    const client = new HttpClient({ apiKey: "test-key", baseUrl: "https://api.example.com" });
    await assert.rejects(
      () => client.request("GET", "/test", undefined, { maxRetries: 0 }),
      (error: unknown) => {
        assert.equal(error instanceof VeloProviderError, true);
        const retryAfterMs = (error as VeloProviderError).retryAfterMs;
        assert.equal(typeof retryAfterMs, "number");
        assert.ok((retryAfterMs ?? 0) > 8_000);
        assert.ok((retryAfterMs ?? 0) <= 10_000);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("submission requests are not retried and network uncertainty is typed", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = async () => {
    calls++;
    throw new TypeError("fetch failed");
  };

  try {
    const client = new HttpClient({ apiKey: "test-key", baseUrl: "https://api.example.com" });
    await assert.rejects(
      () =>
        client.request(
          "POST",
          "/submit",
          { xdr: "AAAA" },
          {
            idempotencyKey: "submit-1",
            submission: true,
          },
        ),
      (err: unknown) => {
        assert.equal(err instanceof VeloSubmissionUnknownError, true);
        return true;
      },
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Velo checkout.sessions.create serializes anchor parameter", async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = "";
  let calledOptions: RequestInit | undefined;

  globalThis.fetch = async (url, options) => {
    calledUrl = url.toString();
    calledOptions = options;
    return new Response(JSON.stringify({ id: "pi_123", object: "payment_intent" }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: "https://api.example.com" });
    await velo.checkout.sessions.create({ amount: "10.00", asset: "USDC", anchor: "pdax" });
    assert.equal(calledUrl, "https://api.example.com/api/v2/payment-intents");
    const body = JSON.parse(calledOptions?.body as string);
    assert.equal(body.anchor, "pdax");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Velo paymentIntents.retrieve returns V2 fields", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({
        id: "pi_123",
        object: "payment_intent",
        paymentIntentId: "pi_123",
        status: "created",
        amount: "10.00",
        asset: "native",
        description: null,
        checkoutUrl: "http://localhost:3000/pay/pi_123",
        successUrl: null,
        cancelUrl: null,
        anchor: "pdax",
        receiverAddress: "G-DEPOSIT",
        receiverMemo: "12345",
        anchorDepositCurrency: "XLM",
        payerAddress: "G-PAYER",
        expiresAt: "2026-07-01T00:30:00.000Z",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const velo = new Velo({ apiKey: "test-key", baseUrl: "https://api.example.com" });
    const res = await velo.paymentIntents.retrieve("pi_123");
    assert.equal(res.anchor, "pdax");
    assert.equal(res.receiverAddress, "G-DEPOSIT");
    assert.equal(res.receiverMemo, "12345");
    assert.equal(res.anchorDepositCurrency, "XLM");
    assert.equal(res.payerAddress, "G-PAYER");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
