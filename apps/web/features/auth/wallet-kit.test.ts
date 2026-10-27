import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

test("Kit initializes once and registers WalletConnect only when configured", async () => {
  const calls: Array<{ modules: unknown[]; network: string }> = [];
  const configurations: unknown[] = [];
  const env = {
    NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: undefined as string | undefined,
    NEXT_PUBLIC_APP_URL: "https://velo.example",
  };
  const fixture = {
    env,
    kit: {
      Networks: { TESTNET: "Test SDF Network ; September 2015" },
      StellarWalletsKit: {
        init(params: { modules: unknown[]; network: string }) {
          calls.push(params);
        },
      },
    },
    WalletConnectModule: class {
      constructor(params: unknown) {
        configurations.push(params);
      }
    },
  };
  Object.assign(globalThis, { __veloKitUnitFixture: fixture });
  const sources: Record<string, string> = {
    "../config/env": "export const env = fixture.env;",
    "@creit-tech/stellar-wallets-kit":
      "export const { Networks, StellarWalletsKit } = fixture.kit;",
    "@creit-tech/stellar-wallets-kit/modules/utils":
      "export function defaultModules() { return ['existing-wallet']; }",
    "./wallet-connect-module":
      "export const VeloWalletConnectModule = fixture.WalletConnectModule;",
    "@creit-tech/stellar-wallets-kit/modules/wallet-connect":
      "export const WalletConnectTargetChain = { TESTNET: 'stellar:testnet' };",
  };
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (specifier in sources) return { url: `velo-kit-test:${specifier}`, shortCircuit: true };
      return next(specifier, context);
    },
    load(url, context, next) {
      if (!url.startsWith("velo-kit-test:")) return next(url, context);
      return {
        format: "module",
        source: `const fixture = globalThis.__veloKitUnitFixture; ${sources[url.slice("velo-kit-test:".length)]}`,
        shortCircuit: true,
      };
    },
  });
  try {
    // Separate module instances represent separate build-time environment configurations.
    const load = (variant: string) => import(`../../core/wallet/wallet-kit.ts?${variant}`);
    const absent = await load("absent");
    await Promise.all([absent.initializeWalletKit(), absent.initializeWalletKit()]);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.modules, ["existing-wallet"]);
    assert.equal(configurations.length, 0);
    env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID = "public-project-id";
    const configured = await load("configured");
    await Promise.all([configured.initializeWalletKit(), configured.initializeWalletKit()]);
    assert.equal(calls.length, 2);
    assert.equal(calls[1]?.modules.length, 2);
    assert.equal(calls[1]?.modules[0], "existing-wallet");
    assert.deepEqual(configurations, [
      {
        projectId: "public-project-id",
        metadata: {
          name: "Velo",
          description: "Infrastructure for builders on Stellar",
          url: "https://velo.example",
          icons: ["https://velo.example/logo.png"],
        },
        allowedChains: ["stellar:testnet"],
      },
    ]);
  } finally {
    hooks.deregister();
    Reflect.deleteProperty(globalThis, "__veloKitUnitFixture");
  }
});
