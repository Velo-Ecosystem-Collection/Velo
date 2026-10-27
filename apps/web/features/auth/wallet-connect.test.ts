import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

import {
  testnetSessionAddress,
  walletConnectMetadata,
  walletErrorMessage,
  WalletRequestScope,
} from "../../core/wallet/wallet-connect-policy.ts";

const address = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const session = () => ({
  topic: "session",
  expiry: Math.floor(Date.now() / 1000) + 3600,
  namespaces: {
    stellar: { accounts: [`stellar:testnet:${address}`], methods: ["stellar_signXDR"] },
  },
});

test("WalletConnect metadata uses the app origin and existing logo", () => {
  assert.deepEqual(walletConnectMetadata("https://velo.example/path"), {
    name: "Velo",
    description: "Infrastructure for builders on Stellar",
    url: "https://velo.example",
    icons: ["https://velo.example/logo.png"],
  });
});

test("WalletConnect requires an unexpired Testnet account and sign-only capability", () => {
  assert.equal(testnetSessionAddress(session()), address);
  assert.throws(() => testnetSessionAddress({ ...session(), expiry: 1 }), /expired/);
  assert.throws(() => testnetSessionAddress(session(), "another-account"), /Testnet account/);
  const wrongChain = session();
  wrongChain.namespaces.stellar.accounts = [`stellar:pubnet:${address}`];
  assert.throws(() => testnetSessionAddress(wrongChain), /Testnet account/);
  const unsupported = session();
  unsupported.namespaces.stellar.methods = ["stellar_signAndSubmitXDR"];
  assert.throws(() => testnetSessionAddress(unsupported), /signing/);
});

test("request scopes invalidate late completions without invalidating newer requests", () => {
  const scope = new WalletRequestScope();
  const old = scope.capture();
  scope.invalidate();
  const current = scope.capture();
  assert.equal(old(), false);
  assert.equal(current(), true);
  assert.equal(walletErrorMessage({ code: -1, message: "User rejected" }), "User rejected");
});

function subject() {
  const listeners = new Set<() => void>();
  return {
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    next() {
      for (const fn of listeners) fn();
    },
  };
}

test("Kit adapter handles pairing, cancellation, late approval, retry and remote disconnect", async () => {
  const state = {
    activeAddress: { value: null as string | null },
    activeModule: { value: null as unknown },
    wcSessionPaths: { value: [] as Array<{ publicKey: string; topic: string }> },
    closeEvent: subject(),
    disconnectEvent: subject(),
    resetWalletState() {
      state.activeAddress.value = null;
      state.wcSessionPaths.value = [];
    },
  };
  let approve: (value: ReturnType<typeof session>) => void = () => {};
  let opened = false;
  let available = false;
  let rejectSignature = false;
  const modalListeners = new Set<(value: { open: boolean }) => void>();
  const sessions: ReturnType<typeof session>[] = [];
  let proposal: unknown;
  const events = new Map<string, (value: { topic: string }) => void>();
  class BaseModule {
    modal = {
      subscribeState(fn: (value: { open: boolean }) => void) {
        modalListeners.add(fn);
        return () => {
          modalListeners.delete(fn);
        };
      },
      open() {
        opened = true;
        for (const fn of modalListeners) fn({ open: true });
      },
      close() {
        opened = false;
        for (const fn of modalListeners) fn({ open: false });
      },
    };
    signClient = {
      session: { values: sessions },
      on(event: string, fn: (value: { topic: string }) => void) {
        events.set(event, fn);
      },
      async connect(params: unknown) {
        proposal = params;
        const pending = new Promise<ReturnType<typeof session>>((resolve) => {
          approve = (value) => {
            sessions.push(value);
            resolve(value);
          };
        });
        return { uri: "wc:test", approval: () => pending };
      },
      async disconnect({ topic }: { topic: string }) {
        events.get("session_delete")?.({ topic });
        const index = sessions.findIndex((s) => s.topic === topic);
        if (index >= 0) sessions.splice(index, 1);
      },
    };
    async isAvailable() {
      return available;
    }
    async signTransaction(xdr: string) {
      if (rejectSignature) throw { code: 4001, message: "User rejected signing" };
      return { signedTxXdr: xdr };
    }
  }
  const fixture = { state, BaseModule };
  Object.assign(globalThis, { __veloWalletConnectUnitFixture: fixture });
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (
        [
          "@creit-tech/stellar-wallets-kit/modules/wallet-connect",
          "@creit-tech/stellar-wallets-kit/state",
          "@repo/stellar",
        ].includes(specifier)
      )
        return { url: `velo-test:${specifier}`, shortCircuit: true };
      return next(specifier, context);
    },
    load(url, context, next) {
      if (!url.startsWith("velo-test:")) return next(url, context);
      const prefix = "const fixture = globalThis.__veloWalletConnectUnitFixture;";
      const source = url.endsWith("/state")
        ? `${prefix} export const { activeAddress, activeModule, wcSessionPaths, closeEvent, disconnectEvent, resetWalletState } = fixture.state;`
        : url.endsWith("@repo/stellar")
          ? "export function assertValidPublicKey(value) { if (!/^G[A-Z2-7]{55}$/.test(value)) throw Error('Invalid public key'); return value; }"
          : `${prefix} export const WalletConnectModule = fixture.BaseModule; export const WalletConnectAllowedMethods = { SIGN: 'stellar_signXDR' }; export const WalletConnectTargetChain = { TESTNET: 'stellar:testnet' };`;
      return { format: "module", source, shortCircuit: true };
    },
  });
  try {
    const { VeloWalletConnectModule } = await import("../../core/wallet/wallet-connect-module.ts");
    const walletModule = new VeloWalletConnectModule({
      projectId: "test",
      metadata: walletConnectMetadata("https://velo.example"),
    });
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    const pending = walletModule.getAddress();
    await tick();
    assert.equal(opened, false, "pairing waits for asynchronous client readiness");
    available = true;
    for (let attempt = 0; attempt < 20 && !opened; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(opened, true);
    assert.deepEqual(proposal, {
      requiredNamespaces: {
        stellar: { methods: ["stellar_signXDR"], chains: ["stellar:testnet"], events: [] },
      },
    });
    const rejected = assert.rejects(pending, /cancelled/);
    void walletModule.modal.close();
    await rejected;
    approve(session());
    await tick();
    assert.equal(sessions.length, 0, "late approval must be disconnected");
    assert.deepEqual(state.wcSessionPaths.value, []);
    const retry = walletModule.getAddress();
    await tick();
    approve(session());
    assert.deepEqual(await retry, { address });
    assert.deepEqual(await walletModule.signTransaction("signed-xdr", { address }), {
      signedTxXdr: "signed-xdr",
    });
    rejectSignature = true;
    await assert.rejects(walletModule.signTransaction("xdr", { address }), {
      message: "User rejected signing",
    });
    rejectSignature = false;
    events.set("session_delete", ({ topic }) => {
      void walletModule.closeSession(topic);
    });
    state.activeModule.value = walletModule;
    state.activeAddress.value = address;
    let disconnects = 0;
    state.disconnectEvent.subscribe(() => {
      disconnects++;
    });
    events.get("session_update")?.({ topic: "session" });
    await tick();
    assert.equal(state.activeAddress.value, null);
    assert.equal(disconnects, 1);
    assert.equal(sessions.length, 0);
    await assert.rejects(walletModule.signTransaction("xdr", { address }), /expired/);
    const invalid = walletModule.getAddress();
    await tick();
    const wrongChain = session();
    wrongChain.namespaces.stellar.accounts = [`stellar:pubnet:${address}`];
    const invalidRejection = assert.rejects(invalid, /Testnet account/);
    approve(wrongChain);
    await invalidRejection;
    assert.equal(sessions.length, 0);
    assert.deepEqual(state.wcSessionPaths.value, []);
  } finally {
    hooks.deregister();
    Reflect.deleteProperty(globalThis, "__veloWalletConnectUnitFixture");
  }
});
