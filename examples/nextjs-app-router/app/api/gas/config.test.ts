import assert from "node:assert/strict";
import test from "node:test";

import { GasExampleConfigurationError, getGasExampleConfig } from "./config.ts";

const validEnvironment = {
  VELO_GAS_API_KEY: `tg_test_${"a".repeat(32)}`,
  VELO_GAS_BASE_URL: "https://api.testnet.velo.pay/",
  VELO_GAS_ENV: "testnet",
  VELO_BASE_URL: "http://localhost:3000/",
  VELO_GAS_DEMO_TOKEN: "terminal-demo-token",
};

test("gas configuration requires all three server-only values", () => {
  for (const key of ["VELO_GAS_API_KEY", "VELO_GAS_BASE_URL", "VELO_GAS_DEMO_TOKEN"] as const) {
    const environment = { ...validEnvironment };
    delete environment[key];
    assert.throws(() => getGasExampleConfig(environment), GasExampleConfigurationError);
  }
});

test("gas configuration accepts HTTPS and loopback HTTP without URL credentials", () => {
  assert.deepEqual(getGasExampleConfig(validEnvironment), {
    apiKey: `tg_test_${"a".repeat(32)}`,
    baseUrl: "https://api.testnet.velo.pay",
    demoToken: "terminal-demo-token",
    environment: "testnet",
  });
  assert.equal(
    getGasExampleConfig({
      ...validEnvironment,
      VELO_GAS_ENV: "development",
      VELO_GAS_BASE_URL: "http://localhost:3000/",
    }).baseUrl,
    "http://localhost:3000",
  );
  assert.equal(
    getGasExampleConfig({
      ...validEnvironment,
      VELO_GAS_ENV: "development",
      VELO_GAS_BASE_URL: "http://127.0.0.1:3000",
    }).baseUrl,
    "http://127.0.0.1:3000",
  );
  assert.equal(getGasExampleConfig(validEnvironment).baseUrl, "https://api.testnet.velo.pay");
});

test("gas configuration rejects non-Testnet endpoints outside loopback development", () => {
  for (const VELO_GAS_BASE_URL of [
    "http://api.example.test",
    "https://user:password@api.testnet.velo.pay",
    "https://api.example.test",
    "https://api.velo.pay",
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
    () => getGasExampleConfig({ ...validEnvironment, VELO_GAS_ENV: "production" }),
    GasExampleConfigurationError,
  );
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

test("gas config rejects general and malformed API keys", () => {
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

test("gas demo tokens are bounded ASCII token values", () => {
  assert.throws(
    () => getGasExampleConfig({ ...validEnvironment, VELO_GAS_DEMO_TOKEN: "token with spaces" }),
    GasExampleConfigurationError,
  );
  assert.throws(
    () => getGasExampleConfig({ ...validEnvironment, VELO_GAS_DEMO_TOKEN: "x".repeat(257) }),
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
