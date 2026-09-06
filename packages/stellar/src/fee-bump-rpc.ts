import {
  FeeBumpTransaction,
  Keypair,
  Networks,
  TransactionBuilder,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";

import {
  parseTestnetSorobanTransactionEnvelope,
  TESTNET_TRANSACTION_ENVELOPE_MAX_XDR_BYTES,
  TestnetTransactionEnvelopeError,
  type TestnetSorobanTransactionFacts,
} from "./transaction-envelope.ts";
import { assertValidPublicKey, assertValidTransactionHash } from "./validation.ts";

export const TESTNET_FEE_BUMP_RPC_DEFAULT_URL = "https://soroban-testnet.stellar.org";
export const TESTNET_FEE_BUMP_RPC_TIMEOUTS = Object.freeze({
  networkMs: 5_000,
  lookupMs: 5_000,
  sendMs: 10_000,
});

const MAX_SIGNED_INT64 = 2n ** 63n - 1n;

export type TestnetFeeBumpRpcConfiguration = Readonly<{
  /** A trusted backend-selected HTTPS Soroban RPC endpoint. */
  rpcUrl?: string;
  /** A deterministic transport seam for tests or a trusted backend adapter. */
  transport?: TestnetFeeBumpRpcTransport;
}>;

export type TestnetFeeBumpRpcTransport = Readonly<{
  getNetwork(): Promise<unknown>;
  sendTransaction(transaction: FeeBumpTransaction): Promise<unknown>;
  getTransaction(hash: string): Promise<unknown>;
}>;

export const TESTNET_FEE_BUMP_RPC_CONFIGURATION_ERROR_CODES = {
  invalidConfiguration: "invalid_configuration",
  invalidEndpoint: "invalid_endpoint",
  invalidTransport: "invalid_transport",
} as const;

export type TestnetFeeBumpRpcConfigurationErrorCode =
  (typeof TESTNET_FEE_BUMP_RPC_CONFIGURATION_ERROR_CODES)[keyof typeof TESTNET_FEE_BUMP_RPC_CONFIGURATION_ERROR_CODES];

const CONFIGURATION_ERROR_MESSAGES: Record<TestnetFeeBumpRpcConfigurationErrorCode, string> = {
  invalid_configuration: "Invalid Testnet RPC configuration",
  invalid_endpoint: "Invalid Testnet RPC endpoint",
  invalid_transport: "Invalid Testnet RPC transport",
};

export class TestnetFeeBumpRpcConfigurationError extends Error {
  readonly code: TestnetFeeBumpRpcConfigurationErrorCode;

  constructor(code: TestnetFeeBumpRpcConfigurationErrorCode) {
    super(CONFIGURATION_ERROR_MESSAGES[code]);
    this.name = "TestnetFeeBumpRpcConfigurationError";
    this.code = code;
  }
}

export type TestnetFeeBumpSendRequest = Readonly<{
  signedOuterXdr: string;
  expectedOuterHash: string;
  expectedInnerHash: string;
  feeSource: string;
  approvedFeeCeilingStroops: bigint;
}>;

export const TESTNET_FEE_BUMP_RPC_PREFLIGHT_ERROR_CODES = {
  invalidRequest: "invalid_request",
  invalidOuterHash: "invalid_outer_hash",
  invalidInnerHash: "invalid_inner_hash",
  invalidFeeSource: "invalid_fee_source",
  invalidFeeCeiling: "invalid_fee_ceiling",
  invalidSignature: "invalid_signature",
  wrongNetwork: "wrong_network",
  unsupportedTransaction: "unsupported_transaction",
  outerHashMismatch: "outer_hash_mismatch",
  innerHashMismatch: "inner_hash_mismatch",
  feeSourceMismatch: "fee_source_mismatch",
  feeCeilingExceeded: "fee_ceiling_exceeded",
  networkTimeout: "network_timeout",
  networkUnavailable: "network_unavailable",
  networkResponseMalformed: "network_response_malformed",
} as const;

export type TestnetFeeBumpRpcPreflightErrorCode =
  (typeof TESTNET_FEE_BUMP_RPC_PREFLIGHT_ERROR_CODES)[keyof typeof TESTNET_FEE_BUMP_RPC_PREFLIGHT_ERROR_CODES];

export type TestnetFeeBumpRpcSendUnknownReason =
  | "timeout"
  | "transport_failure"
  | "malformed_response"
  | "hash_mismatch";

type TestnetFeeBumpRpcPreflightFailure = Readonly<{
  status: "preflight_failed";
  code: TestnetFeeBumpRpcPreflightErrorCode;
}>;

type TestnetFeeBumpRpcSendNetworkOutcome = Readonly<{
  outerTransactionHash: string;
}>;

export type TestnetFeeBumpSendOutcome =
  | (TestnetFeeBumpRpcSendNetworkOutcome & { status: "pending" })
  | (TestnetFeeBumpRpcSendNetworkOutcome & { status: "duplicate" })
  | (TestnetFeeBumpRpcSendNetworkOutcome & { status: "retry_later" })
  | (TestnetFeeBumpRpcSendNetworkOutcome & {
      status: "rejected";
      resultCode?: string;
    })
  | (TestnetFeeBumpRpcSendNetworkOutcome & {
      status: "unknown";
      reason: TestnetFeeBumpRpcSendUnknownReason;
    })
  | TestnetFeeBumpRpcPreflightFailure;

export type TestnetFeeBumpLedgerEvidence = Readonly<{
  status: "found";
  outerTransactionHash: string;
  innerTransactionHash: string;
  feeSource: string;
  feeStroops: bigint;
  ledger: number;
  resultCode: string;
}>;

export type TestnetFeeBumpLookupOutcome =
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "unavailable" }>
  | Readonly<{ status: "malformed_response" }>
  | TestnetFeeBumpLedgerEvidence
  | TestnetFeeBumpRpcPreflightFailure;

export type TestnetFeeBumpRpcAdapter = Readonly<{
  send(request: TestnetFeeBumpSendRequest): Promise<TestnetFeeBumpSendOutcome>;
  lookup(outerTransactionHash: string): Promise<TestnetFeeBumpLookupOutcome>;
}>;

type ParsedFeeBump = Readonly<{
  transaction: FeeBumpTransaction;
  outerTransactionHash: string;
  innerTransactionHash: string;
  feeSource: string;
  feeStroops: bigint;
}>;

type RecordValue = Record<string, unknown>;

type BoundedResult<T> =
  | Readonly<{ status: "fulfilled"; value: T }>
  | Readonly<{ status: "timed_out" }>
  | Readonly<{ status: "rejected"; error: unknown }>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null;
}

function preflightFailure(
  code: TestnetFeeBumpRpcPreflightErrorCode,
): TestnetFeeBumpRpcPreflightFailure {
  return Object.freeze({ status: "preflight_failed", code });
}

function isCanonicalBase64(value: string): boolean {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return false;
  }

  return Buffer.from(value, "base64").toString("base64") === value;
}

function parseNonnegativeInt64(value: unknown): bigint | undefined {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) return undefined;

  try {
    const parsed = BigInt(value);
    return parsed <= MAX_SIGNED_INT64 ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function normalizedHash(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  try {
    return assertValidTransactionHash(value);
  } catch {
    return undefined;
  }
}

function normalizedPublicKey(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  try {
    return assertValidPublicKey(value);
  } catch {
    return undefined;
  }
}

function parseTransactionResult(
  value: unknown,
):
  | Readonly<{ status: "valid"; code: string; feeStroops: bigint }>
  | Readonly<{ status: "invalid" }> {
  let result = value;
  if (typeof result === "string") {
    try {
      result = xdr.TransactionResult.fromXDR(result, "base64");
    } catch {
      return { status: "invalid" };
    }
  }

  if (
    !isRecord(result) ||
    typeof result.result !== "function" ||
    typeof result.feeCharged !== "function"
  ) {
    return { status: "invalid" };
  }

  try {
    const transactionResult = result.result();
    if (!isRecord(transactionResult) || typeof transactionResult.switch !== "function") {
      return { status: "invalid" };
    }

    const resultType = transactionResult.switch();
    if (!isRecord(resultType) || typeof resultType.name !== "string") {
      return { status: "invalid" };
    }

    const feeStroops = parseNonnegativeInt64(result.feeCharged().toString());
    if (feeStroops === undefined) return { status: "invalid" };

    return { status: "valid", code: resultType.name, feeStroops };
  } catch {
    return { status: "invalid" };
  }
}

function toBase64Xdr(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!isRecord(value) || typeof value.toXDR !== "function") return undefined;

  try {
    const encoded = value.toXDR("base64");
    return typeof encoded === "string" ? encoded : undefined;
  } catch {
    return undefined;
  }
}

function parseFeeBumpXdr(value: unknown): FeeBumpTransaction | undefined {
  const encoded = toBase64Xdr(value);
  if (
    encoded === undefined ||
    new TextEncoder().encode(encoded).byteLength > TESTNET_TRANSACTION_ENVELOPE_MAX_XDR_BYTES ||
    !isCanonicalBase64(encoded)
  ) {
    return undefined;
  }

  try {
    const parsed = TransactionBuilder.fromXDR(encoded, Networks.TESTNET);
    return parsed instanceof FeeBumpTransaction ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function hasValidFeeBumpSignature(transaction: FeeBumpTransaction, feeSource: string): boolean {
  if (transaction.signatures.length !== 1) return false;

  try {
    const keypair = Keypair.fromPublicKey(feeSource);
    const [signature] = transaction.signatures;
    if (!signature || !Buffer.from(signature.hint()).equals(keypair.signatureHint())) {
      return false;
    }

    const decoratedSignature = Buffer.from(signature.signature());
    return (
      decoratedSignature.length === 64 && keypair.verify(transaction.hash(), decoratedSignature)
    );
  } catch {
    return false;
  }
}

function parseSignedFeeBump(
  request: TestnetFeeBumpSendRequest,
): Readonly<{ status: "valid"; value: ParsedFeeBump }> | TestnetFeeBumpRpcPreflightFailure {
  if (!isRecord(request) || typeof request.signedOuterXdr !== "string") {
    return preflightFailure("invalid_request");
  }

  const signedOuterXdr = request.signedOuterXdr;
  if (signedOuterXdr.trim() !== signedOuterXdr || signedOuterXdr === "") {
    return preflightFailure("invalid_request");
  }
  if (
    new TextEncoder().encode(signedOuterXdr).byteLength >
      TESTNET_TRANSACTION_ENVELOPE_MAX_XDR_BYTES ||
    !isCanonicalBase64(signedOuterXdr)
  ) {
    return preflightFailure("invalid_request");
  }

  const expectedOuterHash = normalizedHash(request.expectedOuterHash);
  if (expectedOuterHash === undefined) return preflightFailure("invalid_outer_hash");

  const expectedInnerHash = normalizedHash(request.expectedInnerHash);
  if (expectedInnerHash === undefined) return preflightFailure("invalid_inner_hash");

  const expectedFeeSource = normalizedPublicKey(request.feeSource);
  if (expectedFeeSource === undefined) return preflightFailure("invalid_fee_source");

  const approvedFeeCeilingStroops =
    typeof request.approvedFeeCeilingStroops === "bigint" &&
    request.approvedFeeCeilingStroops >= 0n &&
    request.approvedFeeCeilingStroops <= MAX_SIGNED_INT64
      ? request.approvedFeeCeilingStroops
      : undefined;
  if (approvedFeeCeilingStroops === undefined) {
    return preflightFailure("invalid_fee_ceiling");
  }

  let transaction: FeeBumpTransaction;
  try {
    const parsed = TransactionBuilder.fromXDR(signedOuterXdr, Networks.TESTNET);
    if (!(parsed instanceof FeeBumpTransaction)) {
      return preflightFailure("unsupported_transaction");
    }
    if (parsed.toXDR() !== signedOuterXdr) return preflightFailure("invalid_request");
    transaction = parsed;
  } catch {
    return preflightFailure("invalid_request");
  }

  const outerTransactionHash = normalizedHash(transaction.hash().toString("hex"));
  if (outerTransactionHash === undefined) return preflightFailure("invalid_request");
  if (outerTransactionHash !== expectedOuterHash) {
    return preflightFailure("outer_hash_mismatch");
  }

  const feeSource = normalizedPublicKey(transaction.feeSource);
  if (feeSource === undefined) return preflightFailure("invalid_request");
  if (feeSource !== expectedFeeSource) return preflightFailure("fee_source_mismatch");
  if (!hasValidFeeBumpSignature(transaction, feeSource)) {
    return preflightFailure("invalid_signature");
  }

  const feeStroops = parseNonnegativeInt64(transaction.fee);
  if (feeStroops === undefined) return preflightFailure("invalid_request");
  if (feeStroops > approvedFeeCeilingStroops) {
    return preflightFailure("fee_ceiling_exceeded");
  }

  let innerFacts: TestnetSorobanTransactionFacts;
  try {
    innerFacts = parseTestnetSorobanTransactionEnvelope(transaction.innerTransaction.toXDR());
  } catch (error) {
    if (error instanceof TestnetTransactionEnvelopeError) {
      return preflightFailure(error.code);
    }
    return preflightFailure("invalid_request");
  }

  const innerTransactionHash = normalizedHash(innerFacts.transactionHash);
  if (innerTransactionHash === undefined) return preflightFailure("invalid_request");
  if (innerTransactionHash !== expectedInnerHash) {
    return preflightFailure("inner_hash_mismatch");
  }

  return Object.freeze({
    status: "valid",
    value: Object.freeze({
      transaction,
      outerTransactionHash,
      innerTransactionHash,
      feeSource,
      feeStroops,
    }),
  });
}

async function withDeadline<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
): Promise<BoundedResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const operationResult = Promise.resolve()
    .then(operation)
    .then(
      (value): BoundedResult<T> => ({ status: "fulfilled", value }),
      (error): BoundedResult<T> => ({ status: "rejected", error }),
    );
  const timeoutResult = new Promise<BoundedResult<T>>((resolve) => {
    timer = setTimeout(() => resolve({ status: "timed_out" }), timeoutMs);
  });

  const result = await Promise.race([operationResult, timeoutResult]);
  if (timer !== undefined) clearTimeout(timer);
  return result;
}

function isTimeoutError(error: unknown): boolean {
  if (!isRecord(error)) return false;
  return (
    error.name === "TimeoutError" ||
    error.code === "ETIMEDOUT" ||
    error.code === "ECONNABORTED" ||
    error.code === "ERR_CANCELED"
  );
}

async function verifyTestnetNetwork(
  transport: TestnetFeeBumpRpcTransport,
): Promise<Readonly<{ status: "ok" }> | TestnetFeeBumpRpcPreflightFailure> {
  const result = await withDeadline(
    () => transport.getNetwork(),
    TESTNET_FEE_BUMP_RPC_TIMEOUTS.networkMs,
  );
  if (result.status === "timed_out") return preflightFailure("network_timeout");
  if (result.status === "rejected") {
    return preflightFailure(
      isTimeoutError(result.error) ? "network_timeout" : "network_unavailable",
    );
  }

  if (!isRecord(result.value) || typeof result.value.passphrase !== "string") {
    return preflightFailure("network_response_malformed");
  }
  if (result.value.passphrase !== Networks.TESTNET) return preflightFailure("wrong_network");

  return { status: "ok" };
}

function sendUnknown(
  outerTransactionHash: string,
  reason: TestnetFeeBumpRpcSendUnknownReason,
): TestnetFeeBumpSendOutcome {
  return Object.freeze({ status: "unknown", outerTransactionHash, reason });
}

function normalizeSendResponse(
  response: unknown,
  expectedOuterHash: string,
): TestnetFeeBumpSendOutcome {
  if (!isRecord(response)) return sendUnknown(expectedOuterHash, "malformed_response");

  const responseHash = normalizedHash(response.hash);
  if (responseHash === undefined) return sendUnknown(expectedOuterHash, "malformed_response");
  if (responseHash !== expectedOuterHash) return sendUnknown(expectedOuterHash, "hash_mismatch");
  if (!validLedger(response.latestLedger) || !validTimestamp(response.latestLedgerCloseTime)) {
    return sendUnknown(expectedOuterHash, "malformed_response");
  }

  const outcome = { outerTransactionHash: expectedOuterHash };
  switch (response.status) {
    case "PENDING":
      return Object.freeze({ ...outcome, status: "pending" });
    case "DUPLICATE":
      return Object.freeze({ ...outcome, status: "duplicate" });
    case "TRY_AGAIN_LATER":
      return Object.freeze({ ...outcome, status: "retry_later" });
    case "ERROR": {
      const resultValue = response.errorResult ?? response.errorResultXdr;
      let resultCode: string | undefined;
      if (resultValue !== undefined) {
        const parsedResult = parseTransactionResult(resultValue);
        if (parsedResult.status === "invalid" || parsedResult.code === "txSuccess") {
          return sendUnknown(expectedOuterHash, "malformed_response");
        }
        resultCode = parsedResult.code;
      }
      return Object.freeze({
        ...outcome,
        status: "rejected",
        ...(resultCode ? { resultCode } : {}),
      });
    }
    default:
      return sendUnknown(expectedOuterHash, "malformed_response");
  }
}

function validLedger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function validTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function normalizeLookupResponse(
  response: unknown,
  expectedOuterHash: string,
): TestnetFeeBumpLookupOutcome {
  if (!isRecord(response)) return { status: "malformed_response" };

  const responseHash = normalizedHash(response.txHash);
  if (responseHash === undefined || responseHash !== expectedOuterHash) {
    return { status: "malformed_response" };
  }
  if (
    !validLedger(response.latestLedger) ||
    !validLedger(response.oldestLedger) ||
    !validTimestamp(response.latestLedgerCloseTime) ||
    !validTimestamp(response.oldestLedgerCloseTime)
  ) {
    return { status: "malformed_response" };
  }

  if (response.status === "NOT_FOUND") return { status: "not_found" };
  if (response.status !== "SUCCESS" && response.status !== "FAILED") {
    return { status: "malformed_response" };
  }
  if (response.feeBump !== true || !validLedger(response.ledger)) {
    return { status: "malformed_response" };
  }

  const transaction = parseFeeBumpXdr(response.envelopeXdr);
  if (
    transaction === undefined ||
    transaction.toEnvelope().switch().name !== "envelopeTypeTxFeeBump"
  ) {
    return { status: "malformed_response" };
  }

  const outerTransactionHash = normalizedHash(transaction.hash().toString("hex"));
  const feeSource = normalizedPublicKey(transaction.feeSource);
  const feeStroops = parseNonnegativeInt64(transaction.fee);
  if (
    outerTransactionHash === undefined ||
    outerTransactionHash !== expectedOuterHash ||
    feeSource === undefined ||
    feeStroops === undefined ||
    !hasValidFeeBumpSignature(transaction, feeSource)
  ) {
    return { status: "malformed_response" };
  }

  let innerFacts: TestnetSorobanTransactionFacts;
  try {
    innerFacts = parseTestnetSorobanTransactionEnvelope(transaction.innerTransaction.toXDR());
  } catch {
    return { status: "malformed_response" };
  }

  const innerTransactionHash = normalizedHash(innerFacts.transactionHash);
  if (innerTransactionHash === undefined) return { status: "malformed_response" };

  const parsedResult = parseTransactionResult(response.resultXdr);
  if (parsedResult.status === "invalid") return { status: "malformed_response" };
  if (
    (response.status === "SUCCESS" && parsedResult.code !== "txSuccess") ||
    (response.status === "FAILED" && parsedResult.code === "txSuccess") ||
    parsedResult.feeStroops > feeStroops
  ) {
    return { status: "malformed_response" };
  }

  return Object.freeze({
    status: "found",
    outerTransactionHash,
    innerTransactionHash,
    feeSource,
    feeStroops: parsedResult.feeStroops,
    ledger: response.ledger,
    resultCode: parsedResult.code,
  });
}

function endpointFromConfiguration(
  configuration: TestnetFeeBumpRpcConfiguration | undefined,
): string {
  if (configuration === undefined) return TESTNET_FEE_BUMP_RPC_DEFAULT_URL;
  if (!isRecord(configuration))
    throw new TestnetFeeBumpRpcConfigurationError("invalid_configuration");

  const configuredUrl = configuration.rpcUrl;
  if (configuredUrl === undefined) return TESTNET_FEE_BUMP_RPC_DEFAULT_URL;
  if (
    typeof configuredUrl !== "string" ||
    configuredUrl.trim() === "" ||
    configuredUrl.trim() !== configuredUrl ||
    configuredUrl.includes("#")
  ) {
    throw new TestnetFeeBumpRpcConfigurationError("invalid_endpoint");
  }

  let endpoint: URL;
  try {
    endpoint = new URL(configuredUrl);
  } catch {
    throw new TestnetFeeBumpRpcConfigurationError("invalid_endpoint");
  }

  if (
    endpoint.protocol !== "https:" ||
    endpoint.hostname === "" ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    endpoint.hash !== ""
  ) {
    throw new TestnetFeeBumpRpcConfigurationError("invalid_endpoint");
  }

  return endpoint.toString();
}

function isValidTransport(value: unknown): value is TestnetFeeBumpRpcTransport {
  return (
    isRecord(value) &&
    typeof value.getNetwork === "function" &&
    typeof value.sendTransaction === "function" &&
    typeof value.getTransaction === "function"
  );
}

function sdkTransport(endpoint: string): TestnetFeeBumpRpcTransport {
  try {
    const networkServer = new rpc.Server(endpoint, {
      allowHttp: false,
      timeout: TESTNET_FEE_BUMP_RPC_TIMEOUTS.networkMs,
    });
    const lookupServer = new rpc.Server(endpoint, {
      allowHttp: false,
      timeout: TESTNET_FEE_BUMP_RPC_TIMEOUTS.lookupMs,
    });
    const sendServer = new rpc.Server(endpoint, {
      allowHttp: false,
      timeout: TESTNET_FEE_BUMP_RPC_TIMEOUTS.sendMs,
    });

    return Object.freeze({
      getNetwork: () => networkServer.getNetwork(),
      sendTransaction: (transaction: FeeBumpTransaction) => sendServer.sendTransaction(transaction),
      getTransaction: (hash: string) => lookupServer.getTransaction(hash),
    });
  } catch {
    throw new TestnetFeeBumpRpcConfigurationError("invalid_endpoint");
  }
}

/**
 * Create the single-call Testnet FeeBump send and lookup boundary.
 * Endpoint and network selection are intentionally factory-only concerns.
 */
export function createTestnetFeeBumpRpcAdapter(
  configuration: TestnetFeeBumpRpcConfiguration = {},
  injectedTransport?: TestnetFeeBumpRpcTransport,
): TestnetFeeBumpRpcAdapter {
  const endpoint = endpointFromConfiguration(configuration);
  const transport = injectedTransport ?? configuration.transport;
  if (transport !== undefined && !isValidTransport(transport)) {
    throw new TestnetFeeBumpRpcConfigurationError("invalid_transport");
  }

  const selectedTransport = transport ?? sdkTransport(endpoint);

  return Object.freeze({
    async send(request: TestnetFeeBumpSendRequest): Promise<TestnetFeeBumpSendOutcome> {
      const preflight = parseSignedFeeBump(request);
      if (preflight.status !== "valid") return preflight;

      const network = await verifyTestnetNetwork(selectedTransport);
      if (network.status !== "ok") return network;

      const result = await withDeadline(
        () => selectedTransport.sendTransaction(preflight.value.transaction),
        TESTNET_FEE_BUMP_RPC_TIMEOUTS.sendMs,
      );
      if (result.status === "timed_out") {
        return sendUnknown(preflight.value.outerTransactionHash, "timeout");
      }
      if (result.status === "rejected") {
        return sendUnknown(
          preflight.value.outerTransactionHash,
          isTimeoutError(result.error) ? "timeout" : "transport_failure",
        );
      }

      return normalizeSendResponse(result.value, preflight.value.outerTransactionHash);
    },

    async lookup(outerTransactionHash: string): Promise<TestnetFeeBumpLookupOutcome> {
      const normalizedOuterHash = normalizedHash(outerTransactionHash);
      if (normalizedOuterHash === undefined) return preflightFailure("invalid_outer_hash");

      const network = await verifyTestnetNetwork(selectedTransport);
      if (network.status !== "ok") return network;

      const result = await withDeadline(
        () => selectedTransport.getTransaction(normalizedOuterHash),
        TESTNET_FEE_BUMP_RPC_TIMEOUTS.lookupMs,
      );
      if (result.status === "timed_out") return { status: "unavailable" };
      if (result.status === "rejected") return { status: "unavailable" };

      return normalizeLookupResponse(result.value, normalizedOuterHash);
    },
  });
}
