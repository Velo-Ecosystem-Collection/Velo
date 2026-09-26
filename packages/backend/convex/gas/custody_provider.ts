import { Keypair, type Transaction } from "@stellar/stellar-sdk";

import {
  decryptGasRelayerSecret,
  encryptGasRelayerSecret,
  GasCustodyCryptoError,
  type GasCustodyContext,
  type GasCustodyKeyring,
  type GasEncryptedSecret,
} from "./custody_crypto";

export type TestnetRelayerSigner = Readonly<{
  publicKey: string;
  sign(payload: Uint8Array): Uint8Array;
  signTransaction(transaction: Transaction): Transaction;
}>;

export type GasCustodyProvisionedSigner = Readonly<{
  publicKey: string;
  encrypted: GasEncryptedSecret;
}>;

/** Internal async seam for replacing the encrypted Convex custody provider later. */
export interface GasRelayerCustodyProvider {
  provision(
    context: Omit<GasCustodyContext, "publicKey" | "keyVersion">,
  ): Promise<GasCustodyProvisionedSigner>;
  withSigner<T>(
    context: Omit<GasCustodyContext, "keyVersion">,
    encrypted: GasEncryptedSecret,
    callback: (signer: TestnetRelayerSigner) => Promise<T> | T,
  ): Promise<T>;
  reencrypt(
    context: Omit<GasCustodyContext, "keyVersion">,
    encrypted: GasEncryptedSecret,
  ): Promise<GasEncryptedSecret>;
}

/** Convex deployment-keyring implementation of the internal custody seam. */
export class EncryptedConvexGasRelayerCustodyProvider implements GasRelayerCustodyProvider {
  constructor(private readonly keyring: GasCustodyKeyring) {}

  async provision(
    context: Omit<GasCustodyContext, "publicKey" | "keyVersion">,
  ): Promise<GasCustodyProvisionedSigner> {
    const keypair = Keypair.random();
    let secretKey: string | undefined = keypair.secret();
    try {
      const publicKey = keypair.publicKey();
      const encrypted = await encryptGasRelayerSecret(secretKey, this.keyring, {
        ...context,
        publicKey,
      });
      return { publicKey, encrypted };
    } finally {
      secretKey = undefined;
    }
  }

  async withSigner<T>(
    context: Omit<GasCustodyContext, "keyVersion">,
    encrypted: GasEncryptedSecret,
    callback: (signer: TestnetRelayerSigner) => Promise<T> | T,
  ): Promise<T> {
    let secretKey: string | undefined = await decryptGasRelayerSecret(
      encrypted,
      this.keyring,
      context,
    );
    try {
      let keypair: Keypair;
      try {
        keypair = Keypair.fromSecret(secretKey);
      } catch {
        throw new GasCustodyCryptoError("decryption_failed");
      }
      if (keypair.publicKey() !== context.publicKey) {
        throw new GasCustodyCryptoError("decryption_failed");
      }
      return await callback(createSigner(keypair));
    } finally {
      secretKey = undefined;
    }
  }

  async reencrypt(
    context: Omit<GasCustodyContext, "keyVersion">,
    encrypted: GasEncryptedSecret,
  ): Promise<GasEncryptedSecret> {
    let secretKey: string | undefined = await decryptGasRelayerSecret(
      encrypted,
      this.keyring,
      context,
    );
    try {
      if (Keypair.fromSecret(secretKey).publicKey() !== context.publicKey) {
        throw new Error("Relayer address mismatch");
      }
      return await encryptGasRelayerSecret(secretKey, this.keyring, context);
    } finally {
      secretKey = undefined;
    }
  }
}

export function createSigner(keypair: Keypair): TestnetRelayerSigner {
  const publicKey = keypair.publicKey();
  return Object.freeze({
    publicKey,
    sign(payload: Uint8Array): Uint8Array {
      if (!(payload instanceof Uint8Array)) throw new Error("Invalid relayer signing payload");
      return keypair.sign(Buffer.from(payload));
    },
    signTransaction(transaction: Transaction): Transaction {
      transaction.sign(keypair);
      return transaction;
    },
  });
}
