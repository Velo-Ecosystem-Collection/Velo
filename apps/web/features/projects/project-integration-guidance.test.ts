import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import ts from "typescript";

import type { GasExecutionStatus, GasSubmitResult } from "@carts1024/velo-sdk";

import { gasIntegrationSnippets } from "./project-integration-guidance.ts";

const REQUEST_ID = "gas-operation-0001";
const TRANSACTION_HASH = "a".repeat(64);
const OUTER_TRANSACTION_HASH = "b".repeat(64);
const SOURCE_WALLET = `G${"A".repeat(55)}`;
const CONTRACT_ID = `C${"A".repeat(55)}`;
const EXPIRY = "2030-01-01T00:00:00.000Z";

type CapturedRequest = {
  url: string;
  body: string;
  headers: Headers;
};

type GuidanceModule = {
  sponsorAndSubmitGas: (
    operationId: string,
    signedTransactionXdr: string,
  ) => Promise<{ operationId: string; result: GasSubmitResult }>;
  recoverGasStatus: (
    operationId: string,
    identity: { requestId: string; transactionHash: string },
    observeUntilTerminal?: boolean,
  ) => Promise<{ operationId: string; result: GasSubmitResult }>;
};

function reservation() {
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
    expiresAt: EXPIRY,
  };
}

function result(status: GasExecutionStatus, actualFeeStroops: string | null = "900") {
  return {
    object: "gas_submit_result",
    requestId: REQUEST_ID,
    transactionHash: TRANSACTION_HASH,
    outerTransactionHash: status === "succeeded" ? OUTER_TRANSACTION_HASH : null,
    status,
    reservedStroops: "1100",
    actualFeeStroops: status === "succeeded" ? actualFeeStroops : null,
    expiresAt: EXPIRY,
    reconciliationRequired: status !== "succeeded",
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createMockFetch(
  responses: Array<Response | Error>,
  requests: CapturedRequest[],
): typeof fetch {
  let call = 0;
  return async (input, init) => {
    requests.push({
      url: String(input),
      body: String(init?.body ?? ""),
      headers: new Headers(init?.headers),
    });

    const response = responses[call];
    call += 1;
    if (!response) throw new Error(`Unexpected mocked request ${call}.`);
    if (response instanceof Error) throw response;
    return response;
  };
}

async function compileAndLoad(snippet: string, exportName: keyof GuidanceModule) {
  const directory = await mkdtemp(join(process.cwd(), ".velo-gas-guidance-"));
  const filename = join(directory, "snippet.ts");

  try {
    await writeFile(filename, snippet, "utf8");
    const program = ts.createProgram([filename], {
      allowImportingTsExtensions: true,
      lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      skipLibCheck: true,
      strict: true,
      target: ts.ScriptTarget.ES2022,
      types: ["node"],
    });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    assert.equal(
      diagnostics.length,
      0,
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (value) => value,
        getCurrentDirectory: () => process.cwd(),
        getNewLine: () => "\n",
      }),
    );

    const loadedModule = (await import(
      `${pathToFileURL(filename).href}?${Date.now()}`
    )) as GuidanceModule;
    assert.equal(typeof loadedModule[exportName], "function");
    return { directory, module: loadedModule };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function withServerEnvironment<T>(callback: () => Promise<T>): Promise<T> {
  const originalApiKey = process.env.VELO_GAS_API_KEY;
  const originalBaseUrl = process.env.VELO_BASE_URL;
  process.env.VELO_GAS_API_KEY = "workspace-guidance-test-key";
  process.env.VELO_BASE_URL = "http://127.0.0.1:3000";

  try {
    return await callback();
  } finally {
    if (originalApiKey === undefined) delete process.env.VELO_GAS_API_KEY;
    else process.env.VELO_GAS_API_KEY = originalApiKey;
    if (originalBaseUrl === undefined) delete process.env.VELO_BASE_URL;
    else process.env.VELO_BASE_URL = originalBaseUrl;
  }
}

test("Gas guidance snippets are configuration-only and use the public SDK entry point", () => {
  for (const snippet of Object.values(gasIntegrationSnippets)) {
    assert.match(snippet, /from "@carts1024\/velo-sdk"/);
    assert.match(snippet, /process\.env\.VELO_GAS_API_KEY/);
    assert.match(snippet, /process\.env\.VELO_BASE_URL/);
    assert.doesNotMatch(snippet, /apiKeyPlaceholder|selectedKey|projectId|tk_(?:live|test)_/);
    assert.doesNotMatch(snippet, /window\.|document\.|navigator\./);
  }
});

test("displayed sponsor snippet compiles and preserves one handoff per stable operation", async () => {
  const loaded = await compileAndLoad(
    gasIntegrationSnippets.sponsorAndSubmit,
    "sponsorAndSubmitGas",
  );
  const originalFetch = globalThis.fetch;
  const requests: CapturedRequest[] = [];
  globalThis.fetch = createMockFetch(
    [jsonResponse(reservation()), jsonResponse(result("succeeded"))],
    requests,
  );

  try {
    await withServerEnvironment(async () => {
      const response = await loaded.module.sponsorAndSubmitGas("operation-001", "signed-xdr");
      assert.equal(response.operationId, "operation-001");
      assert.equal(response.result.status, "succeeded");
      assert.equal(requests.length, 2);
      assert.equal(requests[0]?.headers.get("Idempotency-Key"), "my-app-gas:operation-001");
      assert.equal(requests[1]?.headers.get("Idempotency-Key"), "my-app-gas:operation-001");
      assert.deepEqual(JSON.parse(requests[1]?.body ?? ""), {
        requestId: REQUEST_ID,
        transactionHash: TRANSACTION_HASH,
        transactionXdr: "signed-xdr",
      });
    });
  } finally {
    globalThis.fetch = originalFetch;
    await rm(loaded.directory, { recursive: true, force: true });
  }
});

test("displayed sponsor snippet recovers an unknown handoff with identity-only status", async () => {
  const loaded = await compileAndLoad(
    gasIntegrationSnippets.sponsorAndSubmit,
    "sponsorAndSubmitGas",
  );
  const originalFetch = globalThis.fetch;
  const requests: CapturedRequest[] = [];
  globalThis.fetch = createMockFetch(
    [jsonResponse(reservation()), new TypeError("fetch failed"), jsonResponse(result("submitted"))],
    requests,
  );

  try {
    await withServerEnvironment(async () => {
      const response = await loaded.module.sponsorAndSubmitGas("operation-002", "signed-xdr");
      assert.equal(response.operationId, "operation-002");
      assert.equal(response.result.status, "submitted");
      assert.equal(requests.length, 3);
      assert.deepEqual(JSON.parse(requests[2]?.body ?? ""), {
        requestId: REQUEST_ID,
        transactionHash: TRANSACTION_HASH,
      });
      assert.equal(requests[2]?.body.includes("signed-xdr"), false);
      assert.equal(requests[2]?.headers.get("Idempotency-Key"), null);
    });
  } finally {
    globalThis.fetch = originalFetch;
    await rm(loaded.directory, { recursive: true, force: true });
  }
});

test("displayed status snippet preserves unresolved and terminal non-success results", async () => {
  const loaded = await compileAndLoad(gasIntegrationSnippets.statusRecovery, "recoverGasStatus");
  const originalFetch = globalThis.fetch;
  const requests: CapturedRequest[] = [];
  globalThis.fetch = createMockFetch(
    [
      jsonResponse(result("submitted")),
      jsonResponse(result("failed")),
      jsonResponse(result("cancelled")),
    ],
    requests,
  );

  try {
    await withServerEnvironment(async () => {
      const identity = { requestId: REQUEST_ID, transactionHash: TRANSACTION_HASH };
      const unresolved = await loaded.module.recoverGasStatus("operation-003", identity);
      const failed = await loaded.module.recoverGasStatus("operation-003", identity);
      const cancelled = await loaded.module.recoverGasStatus("operation-003", identity, true);
      assert.equal(unresolved.result.status, "submitted");
      assert.equal(failed.result.status, "failed");
      assert.equal(failed.result.actualFeeStroops, null);
      assert.equal(cancelled.result.status, "cancelled");
      assert.equal(requests.length, 3);
      for (const request of requests) {
        assert.deepEqual(JSON.parse(request.body), identity);
        assert.equal(request.body.includes("signed-xdr"), false);
      }
    });
  } finally {
    globalThis.fetch = originalFetch;
    await rm(loaded.directory, { recursive: true, force: true });
  }
});
