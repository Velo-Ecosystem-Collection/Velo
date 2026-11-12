import { assertValidContractId } from "@repo/stellar/validation";

import { env } from "../config/env";
import { stellarConfig } from "../config/stellar";
import { isPasskeyBrowserSupported } from "./passkey-browser-support";

export const SMART_ACCOUNT_WASM_HASH =
  "3e51f5b222dec74650f0b33367acb42a41ce497f72639230463070e666abba2c";
export const WEBAUTHN_VERIFIER_CONTRACT_ID =
  "CATPTBRWVMH5ZCIKO5HN2F4FMPXVZEXC56RKGHRXCM7EEZGGXK7PICEH";
export const SMART_ACCOUNT_RELAYER_PROXY_PATH = "/api/smart-account/relayer";

export class PasskeyConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasskeyConfigurationError";
  }
}

export type SmartAccountConfig = {
  rpcUrl: string;
  network: string;
  networkPassphrase: string;
  accountWasmHash: string;
  webauthnVerifierAddress: string;
  rpId: string;
  rpName: string;
  relayerUrl: string;
};

export function isPasskeyFeatureEnabled() {
  return env.NEXT_PUBLIC_ENABLE_PASSKEYS;
}

export function getSmartAccountConfig(): SmartAccountConfig {
  if (!isPasskeyFeatureEnabled()) {
    throw new PasskeyConfigurationError(
      "Passkey login is disabled by NEXT_PUBLIC_ENABLE_PASSKEYS.",
    );
  }
  if (stellarConfig.network !== "testnet") {
    throw new PasskeyConfigurationError(
      "Velo passkey smart accounts are configured for Testnet only.",
    );
  }

  let appUrl: URL;
  try {
    appUrl = new URL(env.NEXT_PUBLIC_APP_URL);
  } catch {
    throw new PasskeyConfigurationError("NEXT_PUBLIC_APP_URL must be a valid relying-party URL.");
  }

  const accountWasmHash = (env.NEXT_PUBLIC_SMART_ACCOUNT_WASM_HASH ?? SMART_ACCOUNT_WASM_HASH)
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(accountWasmHash)) {
    throw new PasskeyConfigurationError(
      "NEXT_PUBLIC_SMART_ACCOUNT_WASM_HASH must be a 32-byte hash.",
    );
  }

  let webauthnVerifierAddress: string;
  try {
    webauthnVerifierAddress = assertValidContractId(
      env.NEXT_PUBLIC_WEBAUTHN_VERIFIER_CONTRACT_ID ?? WEBAUTHN_VERIFIER_CONTRACT_ID,
    );
  } catch {
    throw new PasskeyConfigurationError("NEXT_PUBLIC_WEBAUTHN_VERIFIER_CONTRACT_ID is invalid.");
  }

  return {
    rpcUrl: stellarConfig.rpcUrl,
    network: stellarConfig.network,
    networkPassphrase: stellarConfig.networkPassphrase,
    accountWasmHash,
    webauthnVerifierAddress,
    rpId: appUrl.hostname.toLowerCase(),
    rpName: env.NEXT_PUBLIC_PASSKEY_RP_NAME ?? "Velo",
    relayerUrl: SMART_ACCOUNT_RELAYER_PROXY_PATH,
  };
}

export function assertPasskeyBrowserConfiguration(config = getSmartAccountConfig()) {
  if (typeof window === "undefined") {
    throw new PasskeyConfigurationError("Passkeys can only be used in a browser.");
  }
  const currentHostname = window.location.hostname.toLowerCase();
  const rpId = config.rpId.toLowerCase();
  if (!(currentHostname === rpId || currentHostname.endsWith(`.${rpId}`))) {
    throw new PasskeyConfigurationError(
      `The configured passkey RP ID "${rpId}" does not match "${currentHostname}". Set NEXT_PUBLIC_APP_URL to Velo's active domain and reload.`,
    );
  }
  if (/^\d+(\.\d+){3}$/.test(rpId)) {
    throw new PasskeyConfigurationError(
      "Passkeys require localhost or a DNS domain. Configure Velo with a browser-supported RP ID.",
    );
  }
}

export { isPasskeyBrowserSupported };
