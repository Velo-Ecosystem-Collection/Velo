import assert from "node:assert/strict";
import test from "node:test";

import { FeeBumpTransaction, Networks, xdr } from "@stellar/stellar-sdk";

import {
  createTestnetFeeBumpRpcAdapter,
  TESTNET_FEE_BUMP_RPC_DEFAULT_URL,
  TESTNET_FEE_BUMP_RPC_PREFLIGHT_ERROR_CODES,
  TESTNET_FEE_BUMP_RPC_TIMEOUTS,
  TestnetFeeBumpRpcConfigurationError,
  type TestnetFeeBumpRpcAuthorizationHook,
  type TestnetFeeBumpRpcTransport,
} from "./fee-bump-rpc.ts";
import { buildTestnetFeeBumpTransaction, type TestnetFeeBumpResult } from "./fee-bump.ts";
import {
  buildGasTestEnvelope,
  GAS_TEST_RELAYER_KEYPAIR,
  GAS_TEST_SOURCE_KEYPAIR,
} from "./test-fixtures.ts";
import { TESTNET_TRANSACTION_ENVELOPE_MAX_XDR_BYTES } from "./transaction-envelope.ts";

const INNER_XDR = buildGasTestEnvelope();
const FEE_BUMP: TestnetFeeBumpResult = buildTestnetFeeBumpTransaction(INNER_XDR, 100n, 200n, {
  publicKey: GAS_TEST_RELAYER_KEYPAIR.publicKey(),
  sign: (payload) => GAS_TEST_RELAYER_KEYPAIR.sign(Buffer.from(payload)),
});
const OUTER = new FeeBumpTransaction(FEE_BUMP.signedOuterXdr, Networks.TESTNET);

function successResult(): xdr.TransactionResult {
  return new xdr.TransactionResult({
    feeCharged: new xdr.Int64("187"),
    result: xdr.TransactionResultResult.txSuccess([]),
    ext: new xdr.TransactionResultExt(0),
  });
}

function failedResult(): xdr.TransactionResult {
  return new xdr.TransactionResult({
    feeCharged: new xdr.Int64("187"),
    result: xdr.TransactionResultResult.txBadSeq(),
    ext: new xdr.TransactionResultExt(0),
  });
}

function rejectedResult(): xdr.TransactionResult {
  return new xdr.TransactionResult({
    feeCharged: new xdr.Int64("0"),
    result: xdr.TransactionResultResult.txInsufficientFee(),
    ext: new xdr.TransactionResultExt(0),
  });
}

function request(
  overrides: Partial<Parameters<ReturnType<typeof createTestnetFeeBumpRpcAdapter>["send"]>[0]> = {},
) {
  return {
    signedOuterXdr: FEE_BUMP.signedOuterXdr,
    expectedOuterHash: FEE_BUMP.outerTransactionHash,
    expectedInnerHash: FEE_BUMP.innerTransactionHash,
    feeSource: FEE_BUMP.feeSource,
    approvedFeeCeilingStroops: 200n,
    ...overrides,
  };
}

function transport(
  overrides: Partial<{
    getNetwork: TestnetFeeBumpRpcTransport["getNetwork"];
    sendTransaction: TestnetFeeBumpRpcTransport["sendTransaction"];
    getTransaction: TestnetFeeBumpRpcTransport["getTransaction"];
  }> = {},
): TestnetFeeBumpRpcTransport {
  return {
    getNetwork:
      overrides.getNetwork ??
      (async () => ({
        passphrase: Networks.TESTNET,
      })),
    sendTransaction:
      overrides.sendTransaction ??
      (async (transaction) => ({
        status: "PENDING",
        hash: transaction.hash().toString("hex"),
        latestLedger: 99,
        latestLedgerCloseTime: 1_000,
      })),
    getTransaction:
      overrides.getTransaction ??
      (async (hash) => ({
        status: "NOT_FOUND",
        txHash: hash,
        latestLedger: 99,
        latestLedgerCloseTime: 1_000,
        oldestLedger: 1,
        oldestLedgerCloseTime: 1,
      })),
  };
}

function adapter(overrides: Parameters<typeof transport>[0] = {}) {
  return createTestnetFeeBumpRpcAdapter(
    { rpcUrl: TESTNET_FEE_BUMP_RPC_DEFAULT_URL },
    transport(overrides),
  );
}

function lookupResponse(
  hash: string,
  status: "SUCCESS" | "FAILED" = "SUCCESS",
  resultXdr: xdr.TransactionResult = successResult(),
) {
  return {
    status,
    txHash: hash,
    latestLedger: 99,
    latestLedgerCloseTime: 1_000,
    oldestLedger: 1,
    oldestLedgerCloseTime: 1,
    ledger: 42,
    createdAt: 1_000,
    applicationOrder: 1,
    feeBump: true,
    envelopeXdr: OUTER.toEnvelope(),
    resultXdr,
    resultMetaXdr: OUTER.toEnvelope(),
    events: {
      transactionEventsXdr: [],
      contractEventsXdr: [],
    },
  };
}

function tamperedOuterXdr(): string {
  const bytes = Buffer.from(FEE_BUMP.signedOuterXdr, "base64");
  const lastByte = bytes.length - 1;
  bytes[lastByte] = (bytes[lastByte] ?? 0) ^ 1;
  return bytes.toString("base64");
}

function safeJson(value: unknown): string {
  return JSON.stringify(value, (_key, nestedValue: unknown) =>
    typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue,
  );
}

test("uses the default endpoint only at factory construction and rejects unsafe configured endpoints", () => {
  assert.equal(TESTNET_FEE_BUMP_RPC_DEFAULT_URL, "https://soroban-testnet.stellar.org");

  for (const rpcUrl of [
    "not a URL",
    "http://operator.example/rpc",
    "https://user:password@operator.example/rpc",
    "https://operator.example/rpc#fragment",
  ]) {
    assert.throws(
      () => createTestnetFeeBumpRpcAdapter({ rpcUrl }, transport()),
      (error: unknown) =>
        error instanceof TestnetFeeBumpRpcConfigurationError &&
        error.code === "invalid_endpoint" &&
        !String(error).includes(rpcUrl),
    );
  }

  assert.doesNotThrow(() => createTestnetFeeBumpRpcAdapter({}, transport()));
});

test("classifies pending, duplicate, retry-later, and rejection responses with only the outer hash", async () => {
  for (const [status, expected] of [
    ["PENDING", "pending"],
    ["DUPLICATE", "duplicate"],
    ["TRY_AGAIN_LATER", "retry_later"],
  ] as const) {
    const result = await adapter({
      sendTransaction: async (transaction) => ({
        status,
        hash: transaction.hash().toString("hex").toUpperCase(),
        latestLedger: 99,
        latestLedgerCloseTime: 1_000,
        diagnosticEventsXdr: ["must-not-return"],
      }),
    }).send(request());
    assert.deepEqual(result, {
      status: expected,
      outerTransactionHash: FEE_BUMP.outerTransactionHash,
    });
  }

  const validRejection = await adapter({
    sendTransaction: async () => ({
      status: "ERROR",
      hash: FEE_BUMP.outerTransactionHash,
      latestLedger: 99,
      latestLedgerCloseTime: 1_000,
      errorResult: rejectedResult(),
      diagnosticEventsXdr: ["must-not-return"],
    }),
  }).send(request());
  assert.deepEqual(validRejection, {
    status: "rejected",
    outerTransactionHash: FEE_BUMP.outerTransactionHash,
    resultCode: "txInsufficientFee",
  });

  const badSequence = await adapter({
    sendTransaction: async () => ({
      status: "ERROR",
      hash: FEE_BUMP.outerTransactionHash,
      latestLedger: 99,
      latestLedgerCloseTime: 1_000,
      errorResult: failedResult(),
    }),
  }).send(request());
  assert.deepEqual(badSequence, {
    status: "rejected",
    outerTransactionHash: FEE_BUMP.outerTransactionHash,
    resultCode: "txBadSeq",
  });
});

test("returns sanitized unknown outcomes for malformed, mismatched, timeout, and transport failures", async () => {
  const malformed = await adapter({
    sendTransaction: async () => ({ status: "PENDING", hash: "not-a-hash", body: INNER_XDR }),
  }).send(request());
  assert.deepEqual(malformed, {
    status: "unknown",
    outerTransactionHash: FEE_BUMP.outerTransactionHash,
    reason: "malformed_response",
  });

  const mismatched = await adapter({
    sendTransaction: async () => ({ status: "PENDING", hash: "a".repeat(64) }),
  }).send(request());
  assert.deepEqual(mismatched, {
    status: "unknown",
    outerTransactionHash: FEE_BUMP.outerTransactionHash,
    reason: "hash_mismatch",
  });

  const timeout = await adapter({
    sendTransaction: async () => {
      throw Object.assign(new Error("provider secret"), { name: "TimeoutError" });
    },
  }).send(request());
  assert.deepEqual(timeout, {
    status: "unknown",
    outerTransactionHash: FEE_BUMP.outerTransactionHash,
    reason: "timeout",
  });

  const transportFailure = await adapter({
    sendTransaction: async () => {
      throw new Error(`provider body=${INNER_XDR}`);
    },
  }).send(request());
  assert.deepEqual(transportFailure, {
    status: "unknown",
    outerTransactionHash: FEE_BUMP.outerTransactionHash,
    reason: "transport_failure",
  });
  assert.equal(safeJson(transportFailure).includes(INNER_XDR), false);
});

test("validates the FeeBump, signatures, matching hashes, source, and fee ceiling before send", async () => {
  let sendCalls = 0;
  const send = adapter({
    sendTransaction: async () => {
      sendCalls += 1;
      return {
        status: "PENDING",
        hash: FEE_BUMP.outerTransactionHash,
        latestLedger: 99,
        latestLedgerCloseTime: 1_000,
      };
    },
  }).send;

  const oversized = await send(
    request({ signedOuterXdr: "A".repeat(TESTNET_TRANSACTION_ENVELOPE_MAX_XDR_BYTES + 1) }),
  );
  assert.deepEqual(oversized, { status: "preflight_failed", code: "invalid_request" });

  const tampered = await send(request({ signedOuterXdr: tamperedOuterXdr() }));
  assert.deepEqual(tampered, {
    status: "preflight_failed",
    code: TESTNET_FEE_BUMP_RPC_PREFLIGHT_ERROR_CODES.invalidSignature,
  });

  const wrongInnerHash = await send(request({ expectedInnerHash: "b".repeat(64) }));
  assert.deepEqual(wrongInnerHash, {
    status: "preflight_failed",
    code: TESTNET_FEE_BUMP_RPC_PREFLIGHT_ERROR_CODES.innerHashMismatch,
  });

  const wrongOuterHash = await send(request({ expectedOuterHash: "c".repeat(64) }));
  assert.deepEqual(wrongOuterHash, {
    status: "preflight_failed",
    code: TESTNET_FEE_BUMP_RPC_PREFLIGHT_ERROR_CODES.outerHashMismatch,
  });

  const wrongSource = await send(request({ feeSource: GAS_TEST_SOURCE_KEYPAIR.publicKey() }));
  assert.deepEqual(wrongSource, {
    status: "preflight_failed",
    code: TESTNET_FEE_BUMP_RPC_PREFLIGHT_ERROR_CODES.feeSourceMismatch,
  });

  const overCeiling = await send(request({ approvedFeeCeilingStroops: 199n }));
  assert.deepEqual(overCeiling, {
    status: "preflight_failed",
    code: TESTNET_FEE_BUMP_RPC_PREFLIGHT_ERROR_CODES.feeCeilingExceeded,
  });
  assert.equal(sendCalls, 0);
});

test("requires Testnet identity and transmits the unchanged signed outer envelope", async () => {
  let transmittedXdr: string | undefined;
  let sendCalls = 0;
  const result = await createTestnetFeeBumpRpcAdapter(
    {},
    transport({
      getNetwork: async () => ({ passphrase: Networks.PUBLIC }),
      sendTransaction: async (transaction) => {
        sendCalls += 1;
        transmittedXdr = transaction.toXDR();
        return {
          status: "PENDING",
          hash: FEE_BUMP.outerTransactionHash,
          latestLedger: 99,
          latestLedgerCloseTime: 1_000,
        };
      },
    }),
  ).send(request());
  assert.deepEqual(result, { status: "preflight_failed", code: "wrong_network" });
  assert.equal(sendCalls, 0);
  assert.equal(transmittedXdr, undefined);

  const sent = await adapter({
    sendTransaction: async (transaction) => {
      transmittedXdr = transaction.toXDR();
      return {
        status: "PENDING",
        hash: FEE_BUMP.outerTransactionHash,
        latestLedger: 99,
        latestLedgerCloseTime: 1_000,
      };
    },
  }).send(request());
  assert.equal(sent.status, "pending");
  assert.equal(transmittedXdr, FEE_BUMP.signedOuterXdr);
});

test("runs optional send authorization after network preflight and before transport", async () => {
  const events: string[] = [];
  let sendCalls = 0;
  const result = await createTestnetFeeBumpRpcAdapter(
    {
      authorizeSend: async (sendRequest) => {
        events.push(`authorize:${sendRequest.expectedOuterHash}`);
        return true;
      },
    },
    transport({
      getNetwork: async () => {
        events.push("network");
        return { passphrase: Networks.TESTNET };
      },
      sendTransaction: async (transaction) => {
        events.push("send");
        sendCalls += 1;
        return {
          status: "PENDING",
          hash: transaction.hash().toString("hex"),
          latestLedger: 99,
          latestLedgerCloseTime: 1_000,
        };
      },
    }),
  ).send(request());

  assert.deepEqual(result, {
    status: "pending",
    outerTransactionHash: FEE_BUMP.outerTransactionHash,
  });
  assert.deepEqual(events, ["network", `authorize:${FEE_BUMP.outerTransactionHash}`, "send"]);
  assert.equal(sendCalls, 1);
});

test("a denied or throwing send authorization hook prevents transport submission", async () => {
  let sendCalls = 0;
  const send = (authorizeSend: TestnetFeeBumpRpcAuthorizationHook) =>
    createTestnetFeeBumpRpcAdapter(
      { authorizeSend },
      transport({
        sendTransaction: async () => {
          sendCalls += 1;
          return {
            status: "PENDING",
            hash: FEE_BUMP.outerTransactionHash,
            latestLedger: 99,
            latestLedgerCloseTime: 1_000,
          };
        },
      }),
    ).send(request());

  const denied = await send(async () => false);
  assert.deepEqual(denied, {
    status: "preflight_failed",
    code: "send_authorization_denied",
  });
  const throwing = await send(async () => {
    throw new Error("must not escape");
  });
  assert.deepEqual(throwing, {
    status: "preflight_failed",
    code: "send_authorization_unavailable",
  });
  assert.equal(sendCalls, 0);
});

test("does not continue from a timed-out network preflight into a late send", async () => {
  let sendCalls = 0;
  const adapterWithLateNetwork = createTestnetFeeBumpRpcAdapter(
    {},
    transport({
      getNetwork: () =>
        new Promise((resolve) => {
          setTimeout(
            () => resolve({ passphrase: Networks.TESTNET }),
            TESTNET_FEE_BUMP_RPC_TIMEOUTS.networkMs + 50,
          );
        }),
      sendTransaction: async () => {
        sendCalls += 1;
        return { status: "PENDING", hash: FEE_BUMP.outerTransactionHash };
      },
    }),
  );

  const result = await adapterWithLateNetwork.send(request());
  assert.deepEqual(result, { status: "preflight_failed", code: "network_timeout" });
  await new Promise((resolve) => setTimeout(resolve, 75));
  assert.equal(sendCalls, 0);
});

test("normalizes found success and bad-sequence lookup evidence", async () => {
  const success = await adapter({
    getTransaction: async (hash) => lookupResponse(hash),
  }).lookup(FEE_BUMP.outerTransactionHash.toUpperCase());
  assert.deepEqual(success, {
    status: "found",
    outerTransactionHash: FEE_BUMP.outerTransactionHash,
    innerTransactionHash: FEE_BUMP.innerTransactionHash,
    feeSource: FEE_BUMP.feeSource,
    feeStroops: 187n,
    ledger: 42,
    resultCode: "txSuccess",
  });

  const badSequence = await adapter({
    getTransaction: async (hash) => lookupResponse(hash, "FAILED", failedResult()),
  }).lookup(FEE_BUMP.outerTransactionHash);
  assert.deepEqual(badSequence, {
    status: "found",
    outerTransactionHash: FEE_BUMP.outerTransactionHash,
    innerTransactionHash: FEE_BUMP.innerTransactionHash,
    feeSource: FEE_BUMP.feeSource,
    feeStroops: 187n,
    ledger: 42,
    resultCode: "txBadSeq",
  });
});

test("classifies not-found, unavailable, malformed, mismatched, and inconsistent lookup responses", async () => {
  const notFound = await adapter().lookup(FEE_BUMP.outerTransactionHash);
  assert.deepEqual(notFound, { status: "not_found" });

  const unavailable = await adapter({
    getTransaction: async () => {
      throw new Error("provider body");
    },
  }).lookup(FEE_BUMP.outerTransactionHash);
  assert.deepEqual(unavailable, { status: "unavailable" });

  const malformed = await adapter({
    getTransaction: async () => ({ status: "SUCCESS", txHash: FEE_BUMP.outerTransactionHash }),
  }).lookup(FEE_BUMP.outerTransactionHash);
  assert.deepEqual(malformed, { status: "malformed_response" });

  const mismatched = await adapter({
    getTransaction: async () => lookupResponse("a".repeat(64)),
  }).lookup(FEE_BUMP.outerTransactionHash);
  assert.deepEqual(mismatched, { status: "malformed_response" });

  const inconsistent = await adapter({
    getTransaction: async (hash) => lookupResponse(hash, "SUCCESS", failedResult()),
  }).lookup(FEE_BUMP.outerTransactionHash);
  assert.deepEqual(inconsistent, { status: "malformed_response" });

  const invalidInput = await adapter().lookup("not-a-hash");
  assert.deepEqual(invalidInput, { status: "preflight_failed", code: "invalid_outer_hash" });
});

test("never returns XDR, diagnostics, provider bodies, endpoint URLs, or exception messages", async () => {
  const sendResult = await adapter({
    sendTransaction: async () => ({
      status: "ERROR",
      hash: FEE_BUMP.outerTransactionHash,
      latestLedger: 99,
      latestLedgerCloseTime: 1_000,
      errorResult: rejectedResult(),
      errorResultXdr: INNER_XDR,
      diagnosticEventsXdr: [INNER_XDR],
      endpoint: TESTNET_FEE_BUMP_RPC_DEFAULT_URL,
      message: "secret provider response",
    }),
  }).send(request());
  assert.equal(safeJson(sendResult).includes(INNER_XDR), false);
  assert.equal(safeJson(sendResult).includes(TESTNET_FEE_BUMP_RPC_DEFAULT_URL), false);
  assert.equal(safeJson(sendResult).includes("secret provider response"), false);

  const lookupResult = await adapter({
    getTransaction: async (hash) => ({
      ...lookupResponse(hash),
      rawXdr: INNER_XDR,
      providerBody: "secret provider response",
      endpoint: TESTNET_FEE_BUMP_RPC_DEFAULT_URL,
    }),
  }).lookup(FEE_BUMP.outerTransactionHash);
  assert.equal(safeJson(lookupResult).includes(INNER_XDR), false);
  assert.equal(safeJson(lookupResult).includes(TESTNET_FEE_BUMP_RPC_DEFAULT_URL), false);
  assert.equal(safeJson(lookupResult).includes("secret provider response"), false);
});
