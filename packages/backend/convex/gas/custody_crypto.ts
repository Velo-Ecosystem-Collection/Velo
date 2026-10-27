const AES_GCM_NONCE_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const AES_256_KEY_BYTES = 32;
const MAX_KEYRING_BYTES = 16 * 1024;
const MAX_KEY_VERSIONS = 16;

export type GasCustodyContext = Readonly<{
  deploymentId: string;
  projectId: string;
  network: "testnet";
  publicKey: string;
  keyVersion: string;
}>;

export type GasEncryptedSecret = Readonly<{
  keyVersion: string;
  nonce: string;
  ciphertext: string;
  authTag: string;
}>;

export type GasCustodyKeyring = Readonly<{
  activeVersion: string;
  keys: ReadonlyMap<string, Uint8Array>;
}>;

export class GasCustodyCryptoError extends Error {
  constructor(
    readonly code: "configuration_unavailable" | "configuration_invalid" | "decryption_failed",
  ) {
    super(`Gas custody crypto failed: ${code}`);
    this.name = "GasCustodyCryptoError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeBase64(value: string): Uint8Array | null {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return null;
  }
  try {
    const decoded = atob(value);
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index += 1) {
      bytes[index] = decoded.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function isKeyVersion(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,32}$/.test(value);
}

/** Parse and validate the deployment-only, versioned AES-256 keyring. */
export function parseGasCustodyKeyring(raw: string | undefined): GasCustodyKeyring {
  if (raw === undefined || raw.trim() === "") {
    throw new GasCustodyCryptoError("configuration_unavailable");
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_KEYRING_BYTES) {
    throw new GasCustodyCryptoError("configuration_invalid");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new GasCustodyCryptoError("configuration_invalid");
  }
  if (
    !isRecord(parsed) ||
    Object.keys(parsed).sort().join(",") !== "activeVersion,keys" ||
    !isKeyVersion(parsed.activeVersion) ||
    !isRecord(parsed.keys)
  ) {
    throw new GasCustodyCryptoError("configuration_invalid");
  }

  const versions = Object.entries(parsed.keys);
  if (versions.length === 0 || versions.length > MAX_KEY_VERSIONS) {
    throw new GasCustodyCryptoError("configuration_invalid");
  }

  const keys = new Map<string, Uint8Array>();
  for (const [version, encodedKey] of versions) {
    const decoded = typeof encodedKey === "string" ? decodeBase64(encodedKey) : null;
    if (!isKeyVersion(version) || decoded?.byteLength !== AES_256_KEY_BYTES) {
      throw new GasCustodyCryptoError("configuration_invalid");
    }
    keys.set(version, decoded);
  }
  if (!keys.has(parsed.activeVersion)) throw new GasCustodyCryptoError("configuration_invalid");

  return { activeVersion: parsed.activeVersion, keys };
}

function associatedData(context: GasCustodyContext): Uint8Array {
  if (
    context.network !== "testnet" ||
    context.deploymentId.trim() === "" ||
    context.projectId.trim() === "" ||
    context.publicKey.trim() === "" ||
    !isKeyVersion(context.keyVersion)
  ) {
    throw new GasCustodyCryptoError("configuration_invalid");
  }
  return new TextEncoder().encode(
    JSON.stringify({
      deploymentId: context.deploymentId,
      projectId: context.projectId,
      network: context.network,
      publicKey: context.publicKey,
      keyVersion: context.keyVersion,
    }),
  );
}

async function importAesKey(keyBytes: Uint8Array): Promise<CryptoKey> {
  return await globalThis.crypto.subtle.importKey(
    "raw",
    toArrayBuffer(keyBytes),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/** Encrypt a Stellar secret with a fresh nonce and context-bound AES-256-GCM. */
export async function encryptGasRelayerSecret(
  secretKey: string,
  keyring: GasCustodyKeyring,
  context: Omit<GasCustodyContext, "keyVersion">,
): Promise<GasEncryptedSecret> {
  const keyVersion = keyring.activeVersion;
  const keyBytes = keyring.keys.get(keyVersion);
  if (!keyBytes) throw new GasCustodyCryptoError("configuration_invalid");
  const fullContext: GasCustodyContext = { ...context, keyVersion };
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(AES_GCM_NONCE_BYTES));
  const plaintext = new TextEncoder().encode(secretKey);
  try {
    const encrypted = new Uint8Array(
      await globalThis.crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: toArrayBuffer(nonce),
          additionalData: toArrayBuffer(associatedData(fullContext)),
          tagLength: 128,
        },
        await importAesKey(keyBytes),
        toArrayBuffer(plaintext),
      ),
    );
    const splitAt = encrypted.byteLength - AES_GCM_TAG_BYTES;
    return {
      keyVersion,
      nonce: encodeBase64(nonce),
      ciphertext: encodeBase64(encrypted.slice(0, splitAt)),
      authTag: encodeBase64(encrypted.slice(splitAt)),
    };
  } finally {
    plaintext.fill(0);
  }
}

/** Decrypt only with the recorded version and the complete original context. */
export async function decryptGasRelayerSecret(
  encrypted: GasEncryptedSecret,
  keyring: GasCustodyKeyring,
  context: Omit<GasCustodyContext, "keyVersion">,
): Promise<string> {
  const keyBytes = keyring.keys.get(encrypted.keyVersion);
  const nonce = decodeBase64(encrypted.nonce);
  const ciphertext = decodeBase64(encrypted.ciphertext);
  const authTag = decodeBase64(encrypted.authTag);
  if (
    !keyBytes ||
    nonce?.byteLength !== AES_GCM_NONCE_BYTES ||
    !ciphertext ||
    ciphertext.byteLength === 0 ||
    authTag?.byteLength !== AES_GCM_TAG_BYTES
  ) {
    throw new GasCustodyCryptoError("decryption_failed");
  }

  const fullContext: GasCustodyContext = { ...context, keyVersion: encrypted.keyVersion };
  const combined = new Uint8Array(ciphertext.byteLength + authTag.byteLength);
  combined.set(ciphertext);
  combined.set(authTag, ciphertext.byteLength);
  try {
    const plaintext = new Uint8Array(
      await globalThis.crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: toArrayBuffer(nonce),
          additionalData: toArrayBuffer(associatedData(fullContext)),
          tagLength: 128,
        },
        await importAesKey(keyBytes),
        toArrayBuffer(combined),
      ),
    );
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
    } finally {
      plaintext.fill(0);
    }
  } catch {
    throw new GasCustodyCryptoError("decryption_failed");
  } finally {
    combined.fill(0);
  }
}
