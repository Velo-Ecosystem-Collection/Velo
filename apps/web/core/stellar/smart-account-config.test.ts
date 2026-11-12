import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { after, test } from "node:test";

const VALID_VERIFIER = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";

const fixture = {
  env: {} as Record<string, unknown>,
  stellar: {} as Record<string, unknown>,
};
Object.assign(globalThis, { __veloPasskeyConfigFixture: fixture });

const sources: Record<string, string> = {
  "../config/env": "export const env = fixture.env;",
  "../config/stellar": "export const stellarConfig = fixture.stellar;",
  "@repo/stellar/validation": `
    export function assertValidContractId(value) {
      if (value !== ${JSON.stringify(VALID_VERIFIER)}) throw new Error("Invalid contract ID");
      return value;
    }
  `,
};

const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier in sources) {
      const variant = context.parentURL?.split("?")[1] ?? "default";
      return { url: `velo-passkey-config:${specifier}?${variant}`, shortCircuit: true };
    }
    if (specifier === "./passkey-browser-support") {
      return next("./passkey-browser-support.ts", context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (!url.startsWith("velo-passkey-config:")) return next(url, context);
    return {
      format: "module",
      source: `const fixture = globalThis.__veloPasskeyConfigFixture; ${sources[url.slice("velo-passkey-config:".length).split("?")[0] ?? ""]}`,
      shortCircuit: true,
    };
  },
});

const baseEnv = {
  NEXT_PUBLIC_ENABLE_PASSKEYS: true,
  NEXT_PUBLIC_APP_URL: "https://app.velo.example",
  NEXT_PUBLIC_SMART_ACCOUNT_WASM_HASH: undefined,
  NEXT_PUBLIC_WEBAUTHN_VERIFIER_CONTRACT_ID: VALID_VERIFIER,
  NEXT_PUBLIC_PASSKEY_RP_NAME: undefined,
};
const baseStellar = {
  network: "testnet",
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
};

function loadConfig(
  variant: string,
  envOverrides: Record<string, unknown> = {},
  network = "testnet",
) {
  fixture.env = { ...baseEnv, ...envOverrides };
  fixture.stellar = { ...baseStellar, network };
  return import(`./smart-account-config.ts?${variant}`);
}

test("passkey configuration derives the Velo RP and isolates Testnet kit settings", async () => {
  const { getSmartAccountConfig } = await loadConfig("defaults");
  assert.deepEqual(getSmartAccountConfig(), {
    rpcUrl: baseStellar.rpcUrl,
    network: "testnet",
    networkPassphrase: baseStellar.networkPassphrase,
    accountWasmHash: "3e51f5b222dec74650f0b33367acb42a41ce497f72639230463070e666abba2c",
    webauthnVerifierAddress: VALID_VERIFIER,
    rpId: "app.velo.example",
    rpName: "Velo",
    relayerUrl: "/api/smart-account/relayer",
  });
});

test("passkey configuration fails closed for disabled, wrong-network, and malformed settings", async () => {
  const disabled = await loadConfig("disabled", { NEXT_PUBLIC_ENABLE_PASSKEYS: false });
  assert.throws(disabled.getSmartAccountConfig, /disabled/);

  const wrongNetwork = await loadConfig("wrong-network", {}, "mainnet");
  assert.throws(wrongNetwork.getSmartAccountConfig, /Testnet only/);

  const invalidUrl = await loadConfig("invalid-url", { NEXT_PUBLIC_APP_URL: "not a URL" });
  assert.throws(invalidUrl.getSmartAccountConfig, /valid relying-party URL/);

  const invalidHash = await loadConfig("invalid-hash", {
    NEXT_PUBLIC_SMART_ACCOUNT_WASM_HASH: "abc",
  });
  assert.throws(invalidHash.getSmartAccountConfig, /32-byte hash/);

  const invalidVerifier = await loadConfig("invalid-verifier", {
    NEXT_PUBLIC_WEBAUTHN_VERIFIER_CONTRACT_ID: "not-a-contract",
  });
  assert.throws(invalidVerifier.getSmartAccountConfig, /WEBAUTHN_VERIFIER_CONTRACT_ID is invalid/);
});

test("passkey RP configuration must match the active browser hostname", async () => {
  const { assertPasskeyBrowserConfiguration, getSmartAccountConfig } = await loadConfig("rp-host");
  Object.assign(globalThis, { window: { location: { hostname: "other.example" } } });
  try {
    assert.throws(
      () => assertPasskeyBrowserConfiguration(getSmartAccountConfig()),
      /does not match/,
    );
  } finally {
    Reflect.deleteProperty(globalThis, "window");
  }
});

after(() => {
  hooks.deregister();
  Reflect.deleteProperty(globalThis, "__veloPasskeyConfigFixture");
});
