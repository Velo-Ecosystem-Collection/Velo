import { Networks } from "@stellar/stellar-sdk";

import { env } from "../_generated/server";
import { assertValidStroopValue, normalizeWalletAddress } from "./validation";

export const DEFAULT_TESTNET_HORIZON_URL = "https://horizon-testnet.stellar.org";
export const TESTNET_BALANCE_READ_TIMEOUT_MS = 8_000;
export const TESTNET_BALANCE_MAX_RESPONSE_BYTES = 64 * 1024;

export const TESTNET_BALANCE_FAILURE_REASONS = {
  invalidAddress: "invalid_address",
  invalidConfiguration: "invalid_configuration",
  wrongNetwork: "wrong_network",
  timeout: "timeout",
  providerFailure: "provider_failure",
  malformedResponse: "malformed_response",
} as const;

export type TestnetBalanceFailureReason =
  (typeof TESTNET_BALANCE_FAILURE_REASONS)[keyof typeof TESTNET_BALANCE_FAILURE_REASONS];

export type TestnetNativeBalanceResult =
  | {
      status: "success";
      address: string;
      balanceStroops: string;
    }
  | {
      status: "account_not_found";
      address: string;
    }
  | {
      status: "failure";
      reason: TestnetBalanceFailureReason;
    };

export type TestnetBalanceReaderOptions = Readonly<{
  /** Injectable for deterministic tests; production callers use global fetch. */
  fetch?: typeof fetch;
  /** Optional trusted endpoint override; production callers use the Convex env value. */
  horizonUrl?: string;
  /** Test-only deadline override; the production default is always eight seconds. */
  timeoutMs?: number;
}>;

type Deadline = Readonly<{
  controller: AbortController;
  signal: AbortSignal;
  timedOut(): boolean;
  clear(): void;
}>;

type BodyResult =
  | { status: "ok"; value: unknown }
  | { status: "timeout" }
  | { status: "overflow" }
  | { status: "provider_failure" }
  | { status: "malformed" };

const BODY_TIMEOUT = Symbol("horizon-body-timeout");

function failure(reason: TestnetBalanceFailureReason): TestnetNativeBalanceResult {
  return { status: "failure", reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function configuredHorizonRoot(horizonUrl: string | undefined): string | null {
  const configured = (horizonUrl ?? env.VELO_GAS_D2_HORIZON_URL)?.trim() ?? "";
  if (configured === "") return DEFAULT_TESTNET_HORIZON_URL;
  if (configured.includes("?") || configured.includes("#")) return null;

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    return null;
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.hostname === "" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    return null;
  }

  return parsed.toString().replace(/\/+$/, "");
}

function createDeadline(timeoutMs: number): Deadline {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return {
    controller,
    signal: controller.signal,
    timedOut: () => timedOut,
    clear: () => clearTimeout(timer),
  };
}

function cancelBody(body: ReadableStream<Uint8Array> | null): void {
  if (body === null) return;
  void body.cancel().catch(() => undefined);
}

async function readJsonBody(response: Response, deadline: Deadline): Promise<BodyResult> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (
      Number.isSafeInteger(declaredLength) &&
      declaredLength > TESTNET_BALANCE_MAX_RESPONSE_BYTES
    ) {
      deadline.controller.abort();
      cancelBody(response.body);
      return { status: "overflow" };
    }
  }

  if (response.body === null) return { status: "malformed" };

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let removeAbortListener: (() => void) | undefined;
  let abortedForOverflow = false;

  const abortPromise = new Promise<never>((_, reject) => {
    const onAbort = () => reject(deadline.timedOut() ? BODY_TIMEOUT : new Error("aborted"));
    if (deadline.signal.aborted) {
      onAbort();
      return;
    }
    deadline.signal.addEventListener("abort", onAbort, { once: true });
    removeAbortListener = () => deadline.signal.removeEventListener("abort", onAbort);
  });

  try {
    while (true) {
      const readPromise = reader.read();
      const next = await Promise.race([readPromise, abortPromise]);
      if (next.done) break;

      const chunk = next.value;
      if (!(chunk instanceof Uint8Array)) {
        void reader.cancel().catch(() => undefined);
        return { status: "provider_failure" };
      }
      totalBytes += chunk.byteLength;
      if (totalBytes > TESTNET_BALANCE_MAX_RESPONSE_BYTES) {
        abortedForOverflow = true;
        deadline.controller.abort();
        void reader.cancel().catch(() => undefined);
        return { status: "overflow" };
      }
      chunks.push(chunk);
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    if (error === BODY_TIMEOUT || deadline.timedOut()) return { status: "timeout" };
    if (abortedForOverflow) return { status: "overflow" };
    return { status: "provider_failure" };
  } finally {
    removeAbortListener?.();
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { status: "malformed" };
  }

  try {
    return { status: "ok", value: JSON.parse(text) as unknown };
  } catch {
    return { status: "malformed" };
  }
}

async function fetchJson(
  fetcher: typeof fetch,
  endpoint: string,
  deadline: Deadline,
): Promise<
  { status: "ok"; response: Response } | { status: "timeout" } | { status: "provider_failure" }
> {
  if (deadline.signal.aborted) return { status: "timeout" };

  let removeAbortListener: (() => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    const onAbort = () => reject(BODY_TIMEOUT);
    deadline.signal.addEventListener("abort", onAbort, { once: true });
    removeAbortListener = () => deadline.signal.removeEventListener("abort", onAbort);
  });
  const responsePromise = Promise.resolve().then(() =>
    fetcher(endpoint, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: deadline.signal,
    }),
  );
  void responsePromise.then(
    (response) => {
      if (deadline.signal.aborted) cancelBody(response.body);
    },
    () => undefined,
  );

  try {
    const response = await Promise.race([responsePromise, abortPromise]);
    return { status: "ok", response };
  } catch {
    return deadline.timedOut() ? { status: "timeout" } : { status: "provider_failure" };
  } finally {
    removeAbortListener?.();
  }
}

function bodyFailure(body: Exclude<BodyResult, { status: "ok" }>): TestnetBalanceFailureReason {
  if (body.status === "timeout") return TESTNET_BALANCE_FAILURE_REASONS.timeout;
  if (body.status === "malformed" || body.status === "overflow") {
    return TESTNET_BALANCE_FAILURE_REASONS.malformedResponse;
  }
  return TESTNET_BALANCE_FAILURE_REASONS.providerFailure;
}

function decimalXlmToStroops(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,7})?$/.test(value)) return null;

  const [whole = "", fraction = ""] = value.split(".");
  const stroopDigits = `${whole}${fraction.padEnd(7, "0")}`.replace(/^0+(?=\d)/, "");
  try {
    return assertValidStroopValue(BigInt(stroopDigits)).toString();
  } catch {
    return null;
  }
}

function readNativeBalance(value: unknown, address: string): TestnetNativeBalanceResult {
  if (!isRecord(value) || value.account_id !== address || !Array.isArray(value.balances)) {
    return failure(TESTNET_BALANCE_FAILURE_REASONS.malformedResponse);
  }

  const nativeBalances = value.balances.filter(
    (balance): balance is Record<string, unknown> =>
      isRecord(balance) && balance.asset_type === "native",
  );
  if (nativeBalances.length !== 1) {
    return failure(TESTNET_BALANCE_FAILURE_REASONS.malformedResponse);
  }

  const balanceStroops = decimalXlmToStroops(nativeBalances[0]?.balance);
  if (balanceStroops === null) {
    return failure(TESTNET_BALANCE_FAILURE_REASONS.malformedResponse);
  }

  return { status: "success", address, balanceStroops };
}

/** Read one canonical Testnet native balance without exposing provider details. */
export async function readTestnetNativeBalance(
  requestedAddress: string,
  options: TestnetBalanceReaderOptions = {},
): Promise<TestnetNativeBalanceResult> {
  let address: string;
  try {
    address = normalizeWalletAddress(requestedAddress);
  } catch {
    return failure(TESTNET_BALANCE_FAILURE_REASONS.invalidAddress);
  }

  const horizonRoot = configuredHorizonRoot(options.horizonUrl);
  if (horizonRoot === null) {
    return failure(TESTNET_BALANCE_FAILURE_REASONS.invalidConfiguration);
  }

  const timeoutMs = options.timeoutMs ?? TESTNET_BALANCE_READ_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    return failure(TESTNET_BALANCE_FAILURE_REASONS.invalidConfiguration);
  }

  const fetcher = options.fetch ?? globalThis.fetch;
  const deadline = createDeadline(timeoutMs);
  try {
    const networkFetch = await fetchJson(fetcher, `${horizonRoot}/`, deadline);
    if (networkFetch.status !== "ok") {
      return failure(
        networkFetch.status === "timeout"
          ? TESTNET_BALANCE_FAILURE_REASONS.timeout
          : TESTNET_BALANCE_FAILURE_REASONS.providerFailure,
      );
    }
    if (!networkFetch.response.ok) {
      cancelBody(networkFetch.response.body);
      return failure(TESTNET_BALANCE_FAILURE_REASONS.providerFailure);
    }

    const networkBody = await readJsonBody(networkFetch.response, deadline);
    if (networkBody.status !== "ok") return failure(bodyFailure(networkBody));
    if (!isRecord(networkBody.value) || typeof networkBody.value.network_passphrase !== "string") {
      return failure(TESTNET_BALANCE_FAILURE_REASONS.malformedResponse);
    }
    if (networkBody.value.network_passphrase !== Networks.TESTNET) {
      return failure(TESTNET_BALANCE_FAILURE_REASONS.wrongNetwork);
    }

    const accountFetch = await fetchJson(
      fetcher,
      `${horizonRoot}/accounts/${encodeURIComponent(address)}`,
      deadline,
    );
    if (accountFetch.status !== "ok") {
      return failure(
        accountFetch.status === "timeout"
          ? TESTNET_BALANCE_FAILURE_REASONS.timeout
          : TESTNET_BALANCE_FAILURE_REASONS.providerFailure,
      );
    }
    if (accountFetch.response.status === 404) {
      cancelBody(accountFetch.response.body);
      return { status: "account_not_found", address };
    }
    if (!accountFetch.response.ok) {
      cancelBody(accountFetch.response.body);
      return failure(TESTNET_BALANCE_FAILURE_REASONS.providerFailure);
    }

    const accountBody = await readJsonBody(accountFetch.response, deadline);
    if (accountBody.status !== "ok") return failure(bodyFailure(accountBody));
    return readNativeBalance(accountBody.value, address);
  } finally {
    deadline.clear();
  }
}
