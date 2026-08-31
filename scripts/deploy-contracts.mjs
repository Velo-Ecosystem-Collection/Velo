#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
export const MAINNET_PASSPHRASE = "Public Global Stellar Network ; September 2015";

const networkConfig = {
  testnet: {
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: TESTNET_PASSPHRASE,
  },
  mainnet: {
    rpcUrl: "https://mainnet.sorobanrpc.com",
    networkPassphrase: MAINNET_PASSPHRASE,
  },
};

const contracts = {
  registry: {
    manifest: "contracts/registry/Cargo.toml",
    wasm: "contracts/registry/target/wasm32v1-none/release/velo_registry.wasm",
  },
  payAccess: {
    manifest: "contracts/pay_access/Cargo.toml",
    wasm: "contracts/pay_access/target/wasm32v1-none/release/velo_pay_access.wasm",
  },
};

const usage = `Deploy all Velo smart contracts to Stellar Testnet or Mainnet.

Usage:
  node scripts/deploy-contracts.mjs --network <testnet|mainnet> --source <identity> --mirror-authority <G...> [options]

Required:
  --network <network>       Stellar network to deploy to
  --source <identity>       Stellar CLI identity name (never pass a secret key)
  --mirror-authority <G...> Dedicated external signer public key for display mirrors

Options:
  --rpc-url <url>           Override the public RPC URL; passphrase remains network-locked
  --output <path>           Deployment manifest path (default: deployments/<network>.json)
  --skip-tests              Skip local Rust contract tests
  --skip-build              Reuse existing optimized WASM artifacts
  --dry-run                 Print the deployment plan without executing it
  --confirm-mainnet         Confirm the mainnet readiness checklist is complete
  --help                    Show this help

Examples:
  pnpm contracts:deploy --network testnet --source deployer --mirror-authority G...
  pnpm contracts:deploy --network mainnet --source production-deployer --mirror-authority G... --confirm-mainnet
  pnpm contracts:deploy --network mainnet --mirror-authority G... --dry-run
`;

export function parseDeploymentArgs(values) {
  const parsed = {
    confirmMainnet: false,
    dryRun: false,
    help: false,
    network: undefined,
    mirrorAuthority: undefined,
    output: undefined,
    rpcUrl: undefined,
    skipBuild: false,
    skipTests: false,
    source: undefined,
  };

  const valueOptions = new Set(["network", "source", "mirror-authority", "rpc-url", "output"]);
  const booleanOptions = new Set([
    "confirm-mainnet",
    "dry-run",
    "help",
    "skip-build",
    "skip-tests",
  ]);

  for (let index = 0; index < values.length; index += 1) {
    const argument = values[index];
    if (!argument.startsWith("--")) throw new Error(`Unexpected argument: ${argument}`);
    const key = argument.slice(2);
    if (valueOptions.has(key)) {
      const value = values[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`--${key} requires a value`);
      index += 1;
      if (key === "rpc-url") parsed.rpcUrl = value;
      else parsed[toCamelCase(key)] = value;
      continue;
    }
    if (booleanOptions.has(key)) {
      parsed[toCamelCase(key)] = true;
      continue;
    }
    throw new Error(`Unknown option: --${key}`);
  }

  if (!parsed.help && !networkConfig[parsed.network]) {
    throw new Error("--network must be testnet or mainnet");
  }
  if (parsed.help) return parsed;

  const selectedNetwork = networkConfig[parsed.network];
  parsed.rpcUrl ??= selectedNetwork.rpcUrl;
  parsed.networkPassphrase = selectedNetwork.networkPassphrase;
  parsed.output ??= `deployments/${parsed.network}.json`;
  return parsed;
}

export function validateDeploymentOptions(options) {
  if (!networkConfig[options.network]) throw new Error("--network must be testnet or mainnet");
  if (!options.mirrorAuthority || !/^G[A-Z2-7]{55}$/.test(options.mirrorAuthority)) {
    throw new Error("--mirror-authority must be a valid Stellar G-address");
  }
  if (options.dryRun) return;
  if (!options.source) throw new Error("--source must name a configured Stellar CLI identity");
  if (
    /\s/.test(options.source) ||
    /^[SGM][A-Z2-7]{55}$/.test(options.source) ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(options.source)
  ) {
    throw new Error(
      "--source must be a Stellar CLI identity name; do not pass a secret key, seed phrase, or account address",
    );
  }
  if (options.network === "mainnet" && !options.confirmMainnet) {
    throw new Error(
      "Mainnet deployment is locked. Complete the mainnet readiness checklist, then pass --confirm-mainnet.",
    );
  }
}

export async function deployContracts(options, dependencies = {}) {
  validateDeploymentOptions(options);
  const log = dependencies.log ?? console.log;
  if (options.dryRun) {
    const commands = createDryRunCommands(options);
    for (const command of commands) log(command);
    return { commands, dryRun: true, network: options.network };
  }

  const exec = dependencies.exec ?? execute;
  const run = async (command, args) => {
    log(`> ${formatCommand(command, args)}`);
    const result = await exec(command, args);
    return result?.stdout?.trim() ?? "";
  };

  const stellarCliVersion = await run("stellar", ["--version"]);
  const deployerPublicKey = parsePublicKey(
    await run("stellar", ["keys", "public-key", options.source]),
  );

  if (!options.skipTests) {
    for (const contract of Object.values(contracts)) {
      await run("cargo", ["test", "--manifest-path", contract.manifest, "--locked"]);
    }
  }
  if (!options.skipBuild) {
    for (const contract of Object.values(contracts)) {
      await run("stellar", [
        "contract",
        "build",
        "--manifest-path",
        contract.manifest,
        "--locked",
        "--optimize",
      ]);
    }
  }

  const registryWasmHash = parseWasmHash(
    await run("stellar", createUploadArgs(contracts.registry.wasm, options)),
    "registry",
  );
  const registryContractId = parseContractId(
    await run("stellar", createDeployArgs(registryWasmHash, options)),
    "registry",
  );
  log(`Registry contract: ${registryContractId}`);

  const payAccessWasmHash = parseWasmHash(
    await run("stellar", createUploadArgs(contracts.payAccess.wasm, options)),
    "pay access",
  );
  const payAccessContractId = parseContractId(
    await run("stellar", createDeployArgs(payAccessWasmHash, options)),
    "pay access",
  );
  log(`Pay access contract: ${payAccessContractId}`);

  await run(
    "stellar",
    createInvokeArgs(payAccessContractId, options, [
      "initialize",
      "--registry_contract",
      registryContractId,
      "--mirror_authority",
      options.mirrorAuthority,
    ]),
  );
  await run(
    "stellar",
    createInvokeArgs(registryContractId, options, ["get_project", "--project_id", "0"], true),
  );
  await run(
    "stellar",
    createInvokeArgs(
      payAccessContractId,
      options,
      ["get_payment_access_status", "--project_id", "0"],
      true,
    ),
  );

  let commitSha = "unknown";
  try {
    commitSha = await run("git", ["rev-parse", "HEAD"]);
  } catch (error) {
    log(`Warning: could not record the Git commit: ${error.message}`);
  }

  const now = dependencies.now ?? (() => new Date());
  const manifest = {
    schemaVersion: 2,
    deployedAt: now().toISOString(),
    network: options.network,
    rpcUrl: options.rpcUrl,
    networkPassphrase: options.networkPassphrase,
    stellarCliVersion,
    commitSha,
    deployerPublicKey,
    contracts: {
      registry: {
        contractId: registryContractId,
        wasmHash: registryWasmHash,
        wasm: contracts.registry.wasm,
      },
      payAccess: {
        contractId: payAccessContractId,
        wasmHash: payAccessWasmHash,
        wasm: contracts.payAccess.wasm,
        registryContractId,
        mirrorAuthority: options.mirrorAuthority,
      },
    },
  };
  const writeManifest = dependencies.writeManifest ?? writeDeploymentManifest;
  await writeManifest(options.output, manifest);
  log(`Deployment manifest: ${options.output}`);
  log(`NEXT_PUBLIC_VELO_REGISTRY_CONTRACT_ID=${registryContractId}`);
  log(`NEXT_PUBLIC_VELO_PAY_ACCESS_CONTRACT_ID=${payAccessContractId}`);
  log(`VELO_PAY_ACCESS_CONTRACT_ID=${payAccessContractId}`);
  log(`VELO_PAY_ACCESS_MIRROR_AUTHORITY=${options.mirrorAuthority}`);

  return {
    manifest,
    network: options.network,
    registry: manifest.contracts.registry,
    payAccess: manifest.contracts.payAccess,
  };
}

function createUploadArgs(wasm, options) {
  return [
    "contract",
    "upload",
    "--wasm",
    wasm,
    "--source-account",
    options.source,
    ...networkArgs(options),
  ];
}

function createDeployArgs(wasmHash, options) {
  return [
    "contract",
    "deploy",
    "--wasm-hash",
    wasmHash,
    "--source-account",
    options.source,
    ...networkArgs(options),
  ];
}

function createInvokeArgs(contractId, options, contractArguments, readOnly = false) {
  return [
    "contract",
    "invoke",
    "--id",
    contractId,
    "--source-account",
    options.source,
    ...networkArgs(options),
    ...(readOnly ? ["--send", "no"] : []),
    "--",
    ...contractArguments,
  ];
}

function networkArgs(options) {
  return ["--rpc-url", options.rpcUrl, "--network-passphrase", options.networkPassphrase];
}

function createDryRunCommands(options) {
  const dryOptions = {
    ...options,
    source: options.source ?? "<stellar-cli-identity>",
    mirrorAuthority: options.mirrorAuthority ?? "<mirror-authority-public-key>",
  };
  const commands = [];
  if (!options.skipTests) {
    for (const contract of Object.values(contracts)) {
      commands.push(
        formatCommand("cargo", ["test", "--manifest-path", contract.manifest, "--locked"]),
      );
    }
  }
  if (!options.skipBuild) {
    for (const contract of Object.values(contracts)) {
      commands.push(
        formatCommand("stellar", [
          "contract",
          "build",
          "--manifest-path",
          contract.manifest,
          "--locked",
          "--optimize",
        ]),
      );
    }
  }
  commands.push(formatCommand("stellar", createUploadArgs(contracts.registry.wasm, dryOptions)));
  commands.push(formatCommand("stellar", createDeployArgs("<registry-wasm-hash>", dryOptions)));
  commands.push(formatCommand("stellar", createUploadArgs(contracts.payAccess.wasm, dryOptions)));
  commands.push(formatCommand("stellar", createDeployArgs("<pay-access-wasm-hash>", dryOptions)));
  commands.push(
    formatCommand(
      "stellar",
      createInvokeArgs("<pay-access-contract-id>", dryOptions, [
        "initialize",
        "--registry_contract",
        "<registry-contract-id>",
        "--mirror_authority",
        dryOptions.mirrorAuthority,
      ]),
    ),
  );
  commands.push(
    formatCommand(
      "stellar",
      createInvokeArgs(
        "<registry-contract-id>",
        dryOptions,
        ["get_project", "--project_id", "0"],
        true,
      ),
    ),
  );
  commands.push(
    formatCommand(
      "stellar",
      createInvokeArgs(
        "<pay-access-contract-id>",
        dryOptions,
        ["get_payment_access_status", "--project_id", "0"],
        true,
      ),
    ),
  );
  return commands;
}

function parseWasmHash(output, label) {
  const matches = output.match(/\b[0-9a-fA-F]{64}\b/g);
  if (!matches?.length) throw new Error(`Stellar CLI did not return a ${label} WASM hash`);
  return matches.at(-1).toLowerCase();
}

function parseContractId(output, label) {
  const matches = output.match(/\bC[A-Z2-7]{55}\b/g);
  if (!matches?.length) throw new Error(`Stellar CLI did not return a ${label} contract ID`);
  return matches.at(-1);
}

function parsePublicKey(output) {
  const matches = output.match(/\bG[A-Z2-7]{55}\b/g);
  if (!matches?.length) throw new Error("Stellar CLI could not resolve the deployer public key");
  return matches.at(-1);
}

async function writeDeploymentManifest(path, manifest) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function execute(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["inherit", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else {
        const detail = stderr.trim() || stdout.trim() || `exit code ${code}`;
        reject(new Error(`${command} failed: ${detail}`));
      }
    });
  });
}

function formatCommand(command, args) {
  return [command, ...args].map(quoteArgument).join(" ");
}

function quoteArgument(value) {
  if (/^[A-Za-z0-9_./:=<>-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

async function main() {
  try {
    const options = parseDeploymentArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage);
      return;
    }
    await deployContracts(options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Contract deployment failed");
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
