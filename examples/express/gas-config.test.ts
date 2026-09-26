import assert from "node:assert/strict";
import test from "node:test";

import { GasExampleConfigurationError, getGasExampleConfig } from "./gas-config.ts";

const validEnvironment = {
  VELO_GAS_API_KEY: `tg_test_${"a".repeat(32)}`,
  VELO_GAS_DEMO_TOKEN: "terminal-demo-token",
  VELO_ENV: "development",
  VELO_BASE_URL: "http://localhost:3000",
  VELO_GAS_ENV: "testnet",
};

test("Gas config is independent from Checkout and requires its own key and caller token", () => {
  assert.deepEqual(getGasExampleConfig(validEnvironment), {
    apiKey: `tg_test_${"a".repeat(32)}`,
    demoToken: "terminal-demo-token",
    baseUrl: undefined,
    environment: "testnet",
  });
  assert.throws(
    () => getGasExampleConfig({ ...validEnvironment, VELO_GAS_API_KEY: undefined }),
    GasExampleConfigurationError,
  );
  assert.throws(
    () => getGasExampleConfig({ ...validEnvironment, VELO_GAS_DEMO_TOKEN: undefined }),
    GasExampleConfigurationError,
  );
  assert.throws(
    () =>
      getGasExampleConfig({
        ...validEnvironment,
        VELO_GAS_DEMO_TOKEN: validEnvironment.VELO_GAS_API_KEY,
      }),
    GasExampleConfigurationError,
  );
});

test("Gas config rejects general, malformed, and non-Testnet API keys", () => {
  for (const VELO_GAS_API_KEY of [
    `tk_live_${"a".repeat(32)}`,
    `tk_test_${"a".repeat(32)}`,
    "server-gas-api-key",
    `tg_test_${"A".repeat(32)}`,
    `tg_test_${"a".repeat(31)}`,
  ]) {
    assert.throws(
      () => getGasExampleConfig({ ...validEnvironment, VELO_GAS_API_KEY }),
      GasExampleConfigurationError,
    );
  }
});

test("Gas config allows Testnet and development but blocks production", () => {
  assert.equal(
    getGasExampleConfig({ ...validEnvironment, VELO_GAS_ENV: "development" }).environment,
    "development",
  );
  assert.throws(
    () => getGasExampleConfig({ ...validEnvironment, VELO_GAS_ENV: "production" }),
    GasExampleConfigurationError,
  );
});

test("Gas config accepts HTTPS or loopback HTTP and rejects unsafe endpoints", () => {
  assert.equal(
    getGasExampleConfig({
      ...validEnvironment,
      VELO_GAS_BASE_URL: "https://api.testnet.velo.pay/",
    }).baseUrl,
    "https://api.testnet.velo.pay",
  );
  assert.equal(
    getGasExampleConfig({
      ...validEnvironment,
      VELO_GAS_ENV: "development",
      VELO_GAS_BASE_URL: "http://localhost:3000/",
    }).baseUrl,
    "http://localhost:3000",
  );
  for (const VELO_GAS_BASE_URL of [
    "http://api.example.test",
    "https://user:password@api.example.test",
    "file:///tmp/velo",
    "https://api.velo.pay",
    "https://api.example.test",
    "https://api.testnet.velo.pay:8443",
    "https://api.testnet.velo.pay/proxy",
    "https://api.testnet.velo.pay?target=other",
    "https://api.testnet.velo.pay#fragment",
  ]) {
    assert.throws(
      () => getGasExampleConfig({ ...validEnvironment, VELO_GAS_BASE_URL }),
      GasExampleConfigurationError,
    );
  }
  assert.throws(
    () =>
      getGasExampleConfig({
        ...validEnvironment,
        VELO_GAS_ENV: "development",
        VELO_GAS_BASE_URL: "https://api.testnet.velo.pay",
      }),
    GasExampleConfigurationError,
  );
});

test("Gas caller tokens are bounded printable ASCII values", () => {
  for (const VELO_GAS_DEMO_TOKEN of ["token with spaces", "x".repeat(257), "é-token"]) {
    assert.throws(
      () => getGasExampleConfig({ ...validEnvironment, VELO_GAS_DEMO_TOKEN }),
      GasExampleConfigurationError,
    );
  }
});
