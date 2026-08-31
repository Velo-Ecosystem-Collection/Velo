import assert from "node:assert/strict";
import test from "node:test";

import type { ContractSpecDocumentV1 } from "./contract-spec.ts";

import { generatePlaygroundCode } from "./playground-codegen.ts";

const contract: ContractSpecDocumentV1 = {
  schemaVersion: 1,
  network: "testnet",
  contractId: "CA7QYNF7SOWQ3LLQ6ZMPD6PTQVVBYV3R6DR2ICR6UBZMWRXZPPTD3FVO",
  wasmHash: "a".repeat(64),
  specHash: "b".repeat(64),
  latestLedger: 1,
  loadedAt: "2026-07-27T00:00:00.000Z",
  correlationId: "codegen-test",
  functions: [
    {
      name: "hello",
      documentation: "",
      parameters: [{ name: "to", documentation: "", type: { kind: "symbol" } }],
      outputs: [],
      source: { index: 0, xdr: "" },
    },
  ],
  customTypes: [],
  errors: [],
  events: [],
  rawEntries: [],
};

test("codegen produces deterministic SDK and CLI output from canonical arguments", () => {
  const generated = generatePlaygroundCode({
    network: "testnet",
    contract,
    functionName: "hello",
    arguments: { to: "world" },
  });
  assert.match(generated.typescript, /@stellar\/stellar-sdk 14\.2\.0/);
  assert.match(generated.typescript, /ScVal\.fromXDR/);
  assert.match(generated.typescript, /signTransaction/);
  assert.match(generated.cli, /Stellar CLI 25\.2\.0/);
  assert.match(generated.cli, /--send=no/);
  assert.match(generated.cli, /--send=yes/);
  assert.match(generated.cli, /--to 'world'/);
  assert.doesNotMatch(generated.typescript + generated.cli, /secret key\s*[:=]/i);
  assert.deepEqual(
    generatePlaygroundCode({
      network: "testnet",
      contract,
      functionName: "hello",
      arguments: { to: "world" },
    }),
    generated,
  );
});

test("codegen rejects network drift and secret-looking arguments", () => {
  assert.throws(
    () =>
      generatePlaygroundCode({
        network: "mainnet",
        contract,
        functionName: "hello",
        arguments: { to: "world" },
      }),
    /network/,
  );
  assert.throws(
    () =>
      generatePlaygroundCode({
        network: "testnet",
        contract,
        functionName: "hello",
        arguments: { private_key: "hidden", to: "world" },
      }),
    /private value/,
  );
});
