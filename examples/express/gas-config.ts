export type GasExampleEnvironment = {
  VELO_GAS_API_KEY?: string;
  VELO_GAS_DEMO_TOKEN?: string;
  VELO_GAS_BASE_URL?: string;
  VELO_GAS_ENV?: string;
};

export type GasExampleConfig = {
  apiKey: string;
  demoToken: string;
  baseUrl?: string;
  environment: "testnet" | "development";
};

export class GasExampleConfigurationError extends Error {
  constructor() {
    super("Gas example server configuration is invalid.");
    this.name = "GasExampleConfigurationError";
  }
}

const ASCII_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const GAS_TESTNET_API_KEY = /^tg_test_[a-f0-9]{32}$/;
const MAX_DEMO_TOKEN_BYTES = 256;

export function isAsciiToken(value: string): boolean {
  return ASCII_TOKEN.test(value);
}

function safeBaseUrl(rawBaseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawBaseUrl);
  } catch {
    throw new GasExampleConfigurationError();
  }

  if (parsed.username || parsed.password) throw new GasExampleConfigurationError();

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isLoopbackHttp =
    parsed.protocol === "http:" &&
    (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1");
  if (parsed.protocol !== "https:" && !isLoopbackHttp) {
    throw new GasExampleConfigurationError();
  }

  return parsed.toString().replace(/\/+$/, "");
}

function environmentBaseUrl(
  environment: GasExampleConfig["environment"],
  rawBaseUrl: string | undefined,
): string | undefined {
  if (!rawBaseUrl) return undefined;
  const baseUrl = safeBaseUrl(rawBaseUrl);
  const parsed = new URL(baseUrl);
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (environment === "development") {
    if (hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "::1") {
      throw new GasExampleConfigurationError();
    }
    return baseUrl;
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.origin !== "https://api.testnet.velo.pay" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new GasExampleConfigurationError();
  }
  return baseUrl;
}

export function getGasExampleConfig(
  env: GasExampleEnvironment = {
    VELO_GAS_API_KEY: process.env.VELO_GAS_API_KEY,
    VELO_GAS_DEMO_TOKEN: process.env.VELO_GAS_DEMO_TOKEN,
    VELO_GAS_BASE_URL: process.env.VELO_GAS_BASE_URL,
    VELO_GAS_ENV: process.env.VELO_GAS_ENV,
  },
): GasExampleConfig {
  const apiKey = env.VELO_GAS_API_KEY?.trim();
  const demoToken = env.VELO_GAS_DEMO_TOKEN?.trim();
  const rawBaseUrl = env.VELO_GAS_BASE_URL?.trim();
  const environment = env.VELO_GAS_ENV?.trim() || "testnet";

  if (
    !apiKey ||
    !GAS_TESTNET_API_KEY.test(apiKey) ||
    !demoToken ||
    apiKey === demoToken ||
    (environment !== "testnet" && environment !== "development") ||
    !isAsciiToken(demoToken) ||
    new TextEncoder().encode(demoToken).byteLength > MAX_DEMO_TOKEN_BYTES
  ) {
    throw new GasExampleConfigurationError();
  }

  return {
    apiKey,
    demoToken,
    baseUrl: environmentBaseUrl(environment, rawBaseUrl),
    environment,
  };
}
