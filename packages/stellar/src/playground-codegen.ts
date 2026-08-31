import { Networks } from "@stellar/stellar-sdk";

import type { CanonicalArgumentValue } from "./contract-arguments.ts";
import type { ContractSpecDocumentV1, PlaygroundNetwork } from "./contract-spec.ts";

import { encodeFunctionArguments } from "./contract-arguments.ts";

export type PlaygroundCodegenRequest = {
  network: PlaygroundNetwork;
  contract: ContractSpecDocumentV1;
  functionName: string;
  arguments: Record<string, CanonicalArgumentValue>;
};

export type GeneratedPlaygroundCode = {
  typescript: string;
  cli: string;
  versions: {
    stellarSdk: "14.2.0";
    stellarCli: "25.2.0";
  };
};

const SECRET_FIELD = /(?:^|[_-])(secret|seed|private(?:[_-]?key)?|mnemonic|password)(?:$|[_-])/i;

function containsSecret(value: unknown, key = ""): boolean {
  if (SECRET_FIELD.test(key)) return true;
  if (typeof value === "string") {
    return /^S[A-Z2-7]{55}$/.test(value) || /bearer\s+\S{16,}/i.test(value);
  }
  if (Array.isArray(value)) return value.some((item) => containsSecret(item, key));
  if (value && typeof value === "object") {
    return Object.entries(value).some(([childKey, child]) => containsSecret(child, childKey));
  }
  return false;
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function cliValue(value: CanonicalArgumentValue): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (
    !Array.isArray(value) &&
    value.encoding === "base64" &&
    typeof value.value === "string" &&
    Object.keys(value).length === 2
  ) {
    const bytes = Uint8Array.from(globalThis.atob(value.value), (character) =>
      character.charCodeAt(0),
    );
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return JSON.stringify(value);
}

export function generatePlaygroundCode(request: PlaygroundCodegenRequest): GeneratedPlaygroundCode {
  if (containsSecret(request.arguments)) {
    throw new Error("Code generation is disabled because an argument may contain a private value.");
  }
  if (request.network !== request.contract.network) {
    throw new Error("Code generation network must match the loaded contract.");
  }
  const functionSpec = request.contract.functions.find(
    (candidate) => candidate.name === request.functionName,
  );
  if (!functionSpec) throw new Error(`Unknown contract function ${request.functionName}.`);
  const encoded = encodeFunctionArguments(functionSpec, request.arguments, request.contract).map(
    (value) => value.toXDR("base64"),
  );
  const passphrase = request.network === "testnet" ? Networks.TESTNET : Networks.PUBLIC;
  const rpcUrl =
    request.network === "testnet"
      ? "https://soroban-testnet.stellar.org"
      : "https://mainnet.sorobanrpc.com";
  const argumentXdr = JSON.stringify(encoded, null, 2);
  const typescript = `// @stellar/stellar-sdk 14.2.0
import {
  BASE_FEE,
  Contract,
  TransactionBuilder,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";

const RPC_URL = ${JSON.stringify(rpcUrl)};
const NETWORK_PASSPHRASE = ${JSON.stringify(passphrase)};
const CONTRACT_ID = ${JSON.stringify(request.contract.contractId)};
const FUNCTION_NAME = ${JSON.stringify(request.functionName)};
const SOURCE_ACCOUNT = process.env.STELLAR_SOURCE_ACCOUNT!;
const argumentXdr = ${argumentXdr};

// Connect this callback to your wallet or signing service. Never embed a secret key.
declare function signTransaction(unsignedXdr: string): Promise<string>;

const server = new rpc.Server(RPC_URL);
const source = await server.getAccount(SOURCE_ACCOUNT);
const contract = new Contract(CONTRACT_ID);
const args = argumentXdr.map((value) => xdr.ScVal.fromXDR(value, "base64"));
const transaction = new TransactionBuilder(source, {
  fee: BASE_FEE,
  networkPassphrase: NETWORK_PASSPHRASE,
})
  .addOperation(contract.call(FUNCTION_NAME, ...args))
  .setTimeout(300)
  .build();

// 1. Simulate and assemble the exact Soroban transaction.
const simulation = await server.simulateTransaction(transaction);
if (!rpc.Api.isSimulationSuccess(simulation)) throw new Error("Simulation failed");
const prepared = rpc.assembleTransaction(transaction, simulation).build();

// 2. Review and sign outside this snippet.
const signedXdr = await signTransaction(prepared.toXDR());
const signed = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);

// 3. Submit only after review and signing.
const submitted = await server.sendTransaction(signed);
console.log(submitted.hash);
`;
  const cliArguments = functionSpec.parameters
    .map((parameter) => {
      const value = request.arguments[parameter.name];
      return `  --${parameter.name} ${shellQuote(cliValue(value!))}`;
    })
    .join(" \\\n");
  const common = `stellar contract invoke \\
  --network ${request.network} \\
  --id ${request.contract.contractId} \\
  --source-account "$STELLAR_IDENTITY"`;
  const cli = `# Stellar CLI 25.2.0
# STELLAR_IDENTITY must be a configured identity or public account; never paste a seed here.

# 1. Simulate without signing or submission.
${common} \\
  --send=no \\
  -- ${request.functionName}${cliArguments ? " \\\n" + cliArguments : ""}

# 2. After reviewing the simulation, sign with the configured identity and submit.
${common} \\
  --send=yes \\
  -- ${request.functionName}${cliArguments ? " \\\n" + cliArguments : ""}
`;
  return {
    typescript,
    cli,
    versions: { stellarSdk: "14.2.0", stellarCli: "25.2.0" },
  };
}
