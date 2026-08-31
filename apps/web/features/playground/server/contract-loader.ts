import { ContractSpecError, normalizeContractSpec } from "@repo/stellar";
import { Contract, rpc, StrKey } from "@stellar/stellar-sdk";

import type { ContractSpecDocumentV1, PlaygroundNetwork } from "@repo/stellar";
import type { xdr } from "@stellar/stellar-sdk";

export const PLAYGROUND_RPC_TIMEOUT_MS = 8_000;
export const PLAYGROUND_SPEC_CACHE_TTL_MS = 5 * 60_000;
export const PLAYGROUND_SPEC_CACHE_MAX_ENTRIES = 100;
export const PLAYGROUND_MAX_WASM_BYTES = 1_048_576;
export const PLAYGROUND_MAX_SPEC_ENTRIES = 1_000;

export type ContractLoadRequest = {
  network: PlaygroundNetwork;
  contractId: string;
};
export type PlaygroundErrorEnvelope = {
  error: {
    code: string;
    stage: string;
    message: string;
    retryable: boolean;
    correlationId: string;
    diagnostics?: import("@repo/stellar").JsonSafeValue;
  };
};
export type PlaygroundContractSource = {
  resolveInstance(
    network: PlaygroundNetwork,
    contractId: string,
  ): Promise<{ wasmHash: string; latestLedger: number }>;
  fetchWasm(network: PlaygroundNetwork, wasmHash: string): Promise<Buffer>;
  parseSpec(wasm: Buffer): Promise<xdr.ScSpecEntry[]>;
};

type CacheEntry = {
  document: ContractSpecDocumentV1;
  expiresAt: number;
};

function correlationId() {
  return crypto.randomUUID();
}

export async function parsePlaygroundJson(request: Request, maxBytes = 512 * 1_024) {
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > maxBytes) {
      throw new ContractSpecError(
        "PAYLOAD_TOO_LARGE",
        "validate",
        "The Playground request payload is too large.",
      );
    }
    return JSON.parse(body);
  } catch (error) {
    if (error instanceof ContractSpecError) throw error;
    throw new ContractSpecError(
      "INVALID_REQUEST",
      "validate",
      "The request body must be valid JSON.",
      false,
      { cause: error },
    );
  }
}

export function assertContractLoadRequest(value: unknown): ContractLoadRequest {
  if (!value || typeof value !== "object") {
    throw new ContractSpecError("INVALID_REQUEST", "validate", "A JSON request body is required.");
  }
  const request = value as Record<string, unknown>;
  if (request.network !== "testnet" && request.network !== "mainnet") {
    throw new ContractSpecError(
      "INVALID_NETWORK",
      "validate",
      "Network must be testnet or mainnet.",
    );
  }
  const normalizedContractId =
    typeof request.contractId === "string" ? request.contractId.trim().toUpperCase() : "";
  if (!StrKey.isValidContract(normalizedContractId)) {
    throw new ContractSpecError(
      "INVALID_CONTRACT_ID",
      "validate",
      "Contract ID must be a valid Stellar contract StrKey.",
    );
  }
  return { network: request.network, contractId: normalizedContractId };
}

function publicError(error: unknown, id: string): PlaygroundErrorEnvelope {
  const safe =
    error instanceof ContractSpecError
      ? error
      : new ContractSpecError(
          "RPC_UPSTREAM",
          "resolve-instance",
          "The Stellar RPC request failed.",
          true,
        );
  return {
    error: {
      code: safe.code,
      stage: safe.stage,
      message: safe.message,
      retryable: safe.retryable,
      correlationId: id,
      ...(safe.diagnostics ? { diagnostics: safe.diagnostics } : {}),
    },
  };
}

export function playgroundErrorResponse(error: unknown, id = correlationId()) {
  const envelope = publicError(error, id);
  return Response.json(envelope, {
    status: contractLoadErrorStatus(envelope.error.code),
    headers: { "Cache-Control": "no-store", "X-Correlation-ID": id },
  });
}

export function contractLoadErrorStatus(code: string) {
  if (code === "RATE_LIMITED") return 429;
  if (code === "PAYLOAD_TOO_LARGE") return 413;
  if (code === "RATE_LIMIT_UNAVAILABLE") return 503;
  if (
    code === "INVALID_REQUEST" ||
    code === "INVALID_NETWORK" ||
    code === "INVALID_CONTRACT_ID" ||
    code === "INVALID_ARGUMENT" ||
    code === "INVALID_SOURCE_ACCOUNT" ||
    code === "INVALID_TRANSACTION_HASH" ||
    code === "MALFORMED_ENVELOPE" ||
    code === "INVALID_SIMULATION_SETTINGS" ||
    code === "INVALID_FUNCTION"
  ) {
    return 400;
  }
  if (code === "CONTRACT_NOT_FOUND") return 404;
  if (code === "SOURCE_ACCOUNT_NOT_FOUND") return 404;
  if (code === "CONTRACT_CHANGED") return 409;
  if (code === "MAINNET_INVOCATION_DISABLED" || code === "CONTRACT_NOT_ALLOWLISTED") return 403;
  if (code === "FIXTURE_NOT_CONFIGURED") return 503;
  if (
    code === "ENVELOPE_OPERATION_MISMATCH" ||
    code === "ENVELOPE_CALL_MISMATCH" ||
    code === "ENVELOPE_HASH_MISMATCH" ||
    code === "MISSING_SIGNATURE" ||
    code === "INVALID_SIGNATURE" ||
    code === "FEE_BUMP_NOT_ALLOWED" ||
    code === "UNBOUNDED_TRANSACTION" ||
    code === "SIMULATION_EXPIRED" ||
    code === "SIMULATION_FAILED"
  ) {
    return 422;
  }
  if (
    code === "SPEC_TOO_LARGE" ||
    code === "MALFORMED_SPEC" ||
    code === "UNSUPPORTED_SPEC_ENTRY" ||
    code === "UNSUPPORTED_SPEC_TYPE"
  ) {
    return 422;
  }
  if (code === "RPC_TIMEOUT") return 504;
  return 502;
}

function rpcUrl(network: PlaygroundNetwork) {
  const configured =
    network === "testnet"
      ? (process.env.STELLAR_TESTNET_RPC_URL ?? process.env.NEXT_PUBLIC_STELLAR_RPC_URL)
      : process.env.STELLAR_MAINNET_RPC_URL;
  const value =
    configured ??
    (network === "testnet"
      ? "https://soroban-testnet.stellar.org"
      : "https://mainnet.sorobanrpc.com");
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new ContractSpecError(
      "RPC_CONFIGURATION_ERROR",
      "validate",
      "The configured Stellar RPC endpoint must use HTTPS.",
    );
  }
  return url.toString();
}

function rpcStatus(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { code?: unknown; response?: { status?: unknown } };
  const value = candidate.response?.status ?? candidate.code;
  return typeof value === "number" ? value : undefined;
}

export async function withRpcPolicy<T>(
  stage: "resolve-instance" | "fetch-wasm" | "simulate",
  operation: () => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const status = rpcStatus(error);
      if (
        stage === "simulate" &&
        error instanceof Error &&
        /account not found/i.test(error.message)
      ) {
        throw new ContractSpecError(
          "SOURCE_ACCOUNT_NOT_FOUND",
          "simulate",
          "The Testnet source account could not be loaded.",
        );
      }
      if (status === 404) {
        throw new ContractSpecError(
          "CONTRACT_NOT_FOUND",
          stage,
          "The contract or its Wasm code was not found.",
        );
      }
      const timeout = error instanceof Error && /timeout|timed out|abort/i.test(error.message);
      if (timeout) {
        throw new ContractSpecError(
          "RPC_TIMEOUT",
          stage,
          "The Stellar RPC request timed out.",
          true,
        );
      }
      const retryable = status === 429 || (status !== undefined && status >= 500);
      if (attempt === 0 && retryable) continue;
      throw new ContractSpecError(
        "RPC_UPSTREAM",
        stage,
        "The Stellar RPC request failed.",
        retryable,
      );
    }
  }
  throw new ContractSpecError("RPC_UPSTREAM", stage, "The Stellar RPC request failed.", true);
}

export function getPlaygroundRpcServer(network: PlaygroundNetwork) {
  return new rpc.Server(rpcUrl(network), {
    allowHttp: false,
    timeout: PLAYGROUND_RPC_TIMEOUT_MS,
  });
}

export const stellarContractSource: PlaygroundContractSource = {
  async resolveInstance(network, contractId) {
    return withRpcPolicy("resolve-instance", async () => {
      const response = await getPlaygroundRpcServer(network).getLedgerEntries(
        new Contract(contractId).getFootprint(),
      );
      const instance = response.entries[0]?.val.contractData().val().instance();
      if (!instance || instance.executable().switch().name !== "contractExecutableWasm") {
        throw { code: 404 };
      }
      return {
        wasmHash: instance.executable().wasmHash().toString("hex"),
        latestLedger: response.latestLedger,
      };
    });
  },
  async fetchWasm(network, wasmHash) {
    return withRpcPolicy("fetch-wasm", () =>
      getPlaygroundRpcServer(network).getContractWasmByHash(wasmHash, "hex"),
    );
  },
  async parseSpec(wasm) {
    try {
      const { Spec } = await import("@stellar/stellar-sdk/contract");
      return (await Spec.fromWasm(wasm)).entries;
    } catch (error) {
      throw new ContractSpecError(
        "MALFORMED_SPEC",
        "parse",
        "The contract Wasm does not contain a valid specification.",
        false,
        { cause: error },
      );
    }
  },
};

export class ContractSpecLoader {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly pending = new Map<string, Promise<ContractSpecDocumentV1>>();
  private readonly source: PlaygroundContractSource;
  private readonly now: () => number;

  constructor(
    source: PlaygroundContractSource = stellarContractSource,
    now: () => number = Date.now,
  ) {
    this.source = source;
    this.now = now;
  }

  async load(input: unknown, requestCorrelationId = correlationId()) {
    const request = assertContractLoadRequest(input);
    const id = requestCorrelationId;
    const instance = await this.source.resolveInstance(request.network, request.contractId);
    const cacheKey = `${request.network}:${instance.wasmHash}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > this.now()) {
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, cached);
      return {
        ...cached.document,
        contractId: request.contractId,
        latestLedger: instance.latestLedger,
        loadedAt: new Date(this.now()).toISOString(),
        correlationId: id,
      };
    }

    let pending = this.pending.get(cacheKey);
    if (!pending) {
      pending = this.loadUncached(request, instance, id);
      this.pending.set(cacheKey, pending);
    }
    try {
      const document = await pending;
      return {
        ...document,
        contractId: request.contractId,
        latestLedger: instance.latestLedger,
        loadedAt: new Date(this.now()).toISOString(),
        correlationId: id,
      };
    } finally {
      if (this.pending.get(cacheKey) === pending) this.pending.delete(cacheKey);
    }
  }

  private async loadUncached(
    request: ContractLoadRequest,
    instance: { wasmHash: string; latestLedger: number },
    id: string,
  ) {
    const wasm = await this.source.fetchWasm(request.network, instance.wasmHash);
    if (wasm.byteLength > PLAYGROUND_MAX_WASM_BYTES) {
      throw new ContractSpecError(
        "SPEC_TOO_LARGE",
        "fetch-wasm",
        "The contract Wasm exceeds the Playground size limit.",
      );
    }
    const entries = await this.source.parseSpec(wasm);
    if (entries.length > PLAYGROUND_MAX_SPEC_ENTRIES) {
      throw new ContractSpecError(
        "SPEC_TOO_LARGE",
        "parse",
        "The contract specification has too many entries.",
      );
    }
    const document = normalizeContractSpec(entries, {
      network: request.network,
      contractId: request.contractId,
      wasmHash: instance.wasmHash,
      latestLedger: instance.latestLedger,
      loadedAt: new Date(this.now()).toISOString(),
      correlationId: id,
    });
    this.cache.set(`${request.network}:${instance.wasmHash}`, {
      document,
      expiresAt: this.now() + PLAYGROUND_SPEC_CACHE_TTL_MS,
    });
    while (this.cache.size > PLAYGROUND_SPEC_CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (!oldest) break;
      this.cache.delete(oldest);
    }
    return document;
  }
}

export const contractSpecLoader = new ContractSpecLoader();
