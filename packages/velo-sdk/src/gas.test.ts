import assert from "node:assert/strict";
import test from "node:test";

import type { GasSponsorOptions, GasSponsorReservation } from "./index.ts";

import {
  Velo,
  VeloAPIError,
  VeloProviderError,
  VeloRateLimitError,
  VeloTimeoutError,
  VeloValidationError,
} from "./index.ts";

const BASE_URL = "https://api.example.com";
const SOURCE_WALLET = `G${"A".repeat(55)}`;
const CONTRACT_ID = `C${"A".repeat(55)}`;
const TRANSACTION_HASH = "a".repeat(64);
const TRACEPARENT = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

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
        { error: { type: "provider_error", code: "dependency_unavailable", message: "Retry" } },
        503,
      );
    };
    await assert.rejects(
      () => velo.gas.sponsor("signed-xdr", { ...defaultOptions(), maxRetries: 99 }),
      (error: unknown) => error instanceof VeloProviderError,
    );
    assert.equal(calls, 2);
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
