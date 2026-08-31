import assert from "node:assert/strict";
import test from "node:test";

import {
  MAINNET_PASSPHRASE,
  TESTNET_PASSPHRASE,
  deployContracts,
  parseDeploymentArgs,
  validateDeploymentOptions,
} from "./deploy-contracts.mjs";

const registryId = `C${"A".repeat(55)}`;
const payAccessId = `C${"B".repeat(55)}`;
const deployerPublicKey = `G${"C".repeat(55)}`;

test("parses a testnet deployment with safe defaults", () => {
  const options = parseDeploymentArgs([
    "--network",
    "testnet",
    "--source",
    "deployer",
    "--mirror-authority",
    deployerPublicKey,
  ]);

  assert.deepEqual(options, {
    confirmMainnet: false,
    dryRun: false,
    help: false,
    network: "testnet",
    mirrorAuthority: deployerPublicKey,
    networkPassphrase: TESTNET_PASSPHRASE,
    output: "deployments/testnet.json",
    rpcUrl: "https://soroban-testnet.stellar.org",
    skipBuild: false,
    skipTests: false,
    source: "deployer",
  });
});

test("rejects unsupported networks and secret keys passed on the command line", () => {
  assert.throws(
    () => parseDeploymentArgs(["--network", "futurenet", "--source", "deployer"]),
    /network must be testnet or mainnet/,
  );
  assert.throws(
    () =>
      validateDeploymentOptions({
        ...parseDeploymentArgs([
          "--network",
          "testnet",
          "--mirror-authority",
          deployerPublicKey,
          "--dry-run",
        ]),
        dryRun: false,
        source: `S${"A".repeat(55)}`,
      }),
    /Stellar CLI identity name/,
  );
});

test("requires an explicit mainnet readiness confirmation for live deployments", () => {
  const options = parseDeploymentArgs([
    "--network",
    "mainnet",
    "--source",
    "production-deployer",
    "--mirror-authority",
    deployerPublicKey,
  ]);

  assert.equal(options.networkPassphrase, MAINNET_PASSPHRASE);
  assert.throws(() => validateDeploymentOptions(options), /--confirm-mainnet/);
  assert.doesNotThrow(() => validateDeploymentOptions({ ...options, confirmMainnet: true }));
});

test("requires the dedicated mirror authority for live and dry-run plans", () => {
  assert.throws(
    () =>
      validateDeploymentOptions(
        parseDeploymentArgs(["--network", "testnet", "--source", "deployer"]),
      ),
    /mirror-authority/,
  );
  assert.throws(
    () => validateDeploymentOptions(parseDeploymentArgs(["--network", "testnet", "--dry-run"])),
    /mirror-authority/,
  );
});

test("tests, builds, uploads, deploys, initializes, verifies, and records both contracts", async () => {
  const calls = [];
  let writtenManifest;
  const exec = async (command, args) => {
    calls.push([command, ...args]);
    const joined = [command, ...args].join(" ");
    if (joined === "stellar --version") return { stdout: "stellar 25.2.0\n" };
    if (joined === "stellar keys public-key deployer") {
      return { stdout: `${deployerPublicKey}\n` };
    }
    if (joined === "git rev-parse HEAD") return { stdout: `${"d".repeat(40)}\n` };
    if (joined.includes("contract upload") && joined.includes("velo_registry.wasm")) {
      return { stdout: `${"1".repeat(64)}\n` };
    }
    if (joined.includes("contract upload") && joined.includes("velo_pay_access.wasm")) {
      return { stdout: `${"2".repeat(64)}\n` };
    }
    if (joined.includes("contract deploy") && joined.includes("1".repeat(64))) {
      return { stdout: `${registryId}\n` };
    }
    if (joined.includes("contract deploy") && joined.includes("2".repeat(64))) {
      return { stdout: `${payAccessId}\n` };
    }
    return { stdout: "\n" };
  };

  const result = await deployContracts(
    parseDeploymentArgs([
      "--network",
      "testnet",
      "--source",
      "deployer",
      "--mirror-authority",
      deployerPublicKey,
    ]),
    {
      exec,
      now: () => new Date("2026-07-15T00:00:00.000Z"),
      writeManifest: async (_path, manifest) => {
        writtenManifest = manifest;
      },
    },
  );

  assert.equal(result.registry.contractId, registryId);
  assert.equal(result.payAccess.contractId, payAccessId);
  assert.equal(writtenManifest.network, "testnet");
  assert.equal(writtenManifest.deployerPublicKey, deployerPublicKey);
  assert.equal(writtenManifest.contracts.registry.wasmHash, "1".repeat(64));
  assert.equal(writtenManifest.contracts.payAccess.wasmHash, "2".repeat(64));
  assert.equal(writtenManifest.contracts.payAccess.mirrorAuthority, deployerPublicKey);

  assert.deepEqual(calls.slice(0, 7), [
    ["stellar", "--version"],
    ["stellar", "keys", "public-key", "deployer"],
    ["cargo", "test", "--manifest-path", "contracts/registry/Cargo.toml", "--locked"],
    ["cargo", "test", "--manifest-path", "contracts/pay_access/Cargo.toml", "--locked"],
    [
      "stellar",
      "contract",
      "build",
      "--manifest-path",
      "contracts/registry/Cargo.toml",
      "--locked",
      "--optimize",
    ],
    [
      "stellar",
      "contract",
      "build",
      "--manifest-path",
      "contracts/pay_access/Cargo.toml",
      "--locked",
      "--optimize",
    ],
    [
      "stellar",
      "contract",
      "upload",
      "--wasm",
      "contracts/registry/target/wasm32v1-none/release/velo_registry.wasm",
      "--source-account",
      "deployer",
      "--rpc-url",
      "https://soroban-testnet.stellar.org",
      "--network-passphrase",
      TESTNET_PASSPHRASE,
    ],
  ]);

  const initialize = calls.find(
    (call) => call[1] === "contract" && call[2] === "invoke" && call.includes("initialize"),
  );
  assert.ok(initialize);
  assert.ok(initialize.includes(payAccessId));
  assert.ok(initialize.includes(registryId));
  assert.ok(initialize.includes("--mirror_authority"));
  assert.ok(initialize.includes(deployerPublicKey));

  const verificationCalls = calls.filter(
    (call) => call[1] === "contract" && call[2] === "invoke" && call.includes("--send"),
  );
  assert.equal(verificationCalls.length, 2);
  for (const call of calls.filter((entry) => entry[0] === "stellar")) {
    if (call.includes("--network-passphrase")) {
      assert.ok(call.includes(TESTNET_PASSPHRASE));
      assert.ok(!call.includes(MAINNET_PASSPHRASE));
    }
  }
});

test("dry-run performs no external commands or writes", async () => {
  let executions = 0;
  let writes = 0;
  const result = await deployContracts(
    parseDeploymentArgs([
      "--network",
      "mainnet",
      "--mirror-authority",
      deployerPublicKey,
      "--dry-run",
    ]),
    {
      exec: async () => {
        executions += 1;
        return { stdout: "" };
      },
      log: () => {},
      writeManifest: async () => {
        writes += 1;
      },
    },
  );

  assert.equal(result.dryRun, true);
  assert.equal(executions, 0);
  assert.equal(writes, 0);
  assert.ok(result.commands.some((command) => command.includes(MAINNET_PASSPHRASE)));
});
