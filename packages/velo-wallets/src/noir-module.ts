import { type ModuleInterface, ModuleType } from "@creit-tech/stellar-wallets-kit/types";

import { VeloWalletError } from "./errors.js";

export const NOIR_ID = "noir";
export const NOIR_INSTALL_URL =
  "https://chromewebstore.google.com/detail/noir/gikfhchijjljpbhokmdmaadgmpbchmjl";

type NoirProviderError = { code: number; message: string; ext?: string[] };
type NoirProviderResponse<T> = T | { error: NoirProviderError };
type NoirSignOptions = { networkPassphrase?: string; address?: string };

export interface NoirStellarProvider {
  isNoir: true;
  isConnected(): Promise<NoirProviderResponse<{ isConnected: boolean }>>;
  isAllowed(): Promise<NoirProviderResponse<{ isAllowed: boolean }>>;
  requestAccess(): Promise<NoirProviderResponse<{ address: string }>>;
  getAddress(): Promise<NoirProviderResponse<{ address: string }>>;
  getNetwork(): Promise<NoirProviderResponse<{ network: string; networkPassphrase: string }>>;
  signTransaction(
    xdr: string,
    options?: NoirSignOptions,
  ): Promise<NoirProviderResponse<{ signedTxXdr: string; signerAddress: string }>>;
  signAuthEntry(
    authEntry: string,
    options?: NoirSignOptions,
  ): Promise<NoirProviderResponse<{ signedAuthEntry: string; signerAddress: string }>>;
  signMessage(
    message: string,
    options?: NoirSignOptions,
  ): Promise<NoirProviderResponse<{ signedMessage: string; signerAddress: string }>>;
}

declare global {
  interface Window {
    noir?: { stellar?: NoirStellarProvider };
  }
}

export function getNoirStellarProvider() {
  if (typeof window === "undefined") return null;
  const provider = window.noir?.stellar;
  return provider?.isNoir === true ? provider : null;
}

export class NoirModule implements ModuleInterface {
  readonly moduleType = ModuleType.HOT_WALLET;
  readonly productId = NOIR_ID;
  readonly productName = "Noir";
  readonly productUrl = NOIR_INSTALL_URL;
  readonly productIcon =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAD0AAABACAMAAACeAI/EAAAAeFBMVEVqY1d0ZlBcUT+CbEqpmHfIxLO1j0vMwarFoWTazK/f1sPAuqe8tKC8s5+Xe06soo2ZekSliFaxmm2bdjWOcD/CvK26rpaenJNxcGlPUlAvNj3OuJDXw5rSqmfCm1Tl2sXt49Dj07Tix5f07+Spgj2jfDoxOEHRp16jjzznAAAAG3RSTlMBLrxa9Lr++vn+/raw4KOa2OL8/Mf2+fT5+fyJotllAAAEQ0lEQVRIx52XDZeiIBSGUwuFtqZy0wwUqaz//w/3foAybbbT3nPmNAqP73v5ZrFYJGmy+DyylH+T5Sr7HF4tWTMTOk8/hFPTikAXUq0/cZ/9UqbzdCq61vabn7vPNr1rO5EFutO2l9ufsclW9rbtRrrruuLS9+or+VFz9X1vCqDTke5aBy9/4D41UM8ViDC9w3/Rew/u38sna9X3V/Qd6IRpgR/t7duuJ9fgu4voG8GicFSUZ+9dg0EhBCI7ogWyEK2lQjXjnlxT0lQb6CSmhe45XrqHTubQwtP7hIaah4WQvoL5a94k6VgmAi2YHsOnDu43z2F9iTvcxursPMTtprnS9VVQiS1uI03Ok31gh4G9X6+zuB6GEec23zGLdHlwszDiUpQTzmPt9wgPZXmYh69XeyhLwD3vxznTBA//pkn9FtOeLYU29g3tYEWZcB4V2W2CpXRv8nZSahHMl35lKoNrbaRzdh52Thp9GBjfMZ2ULNwag/SsONPGFIwHeudTNhJh5+ayRhpxdD8MYRlO2fVIvxa3LuCa3E+0aHVEuznfo7guxER7eKT7WWmgSRzwMI1TeGJpT7tZ6aANEbRXRn8z/krcuidcfvlVI6eOiGn5l7T8Rhvj3MbvRJL7UY7OjX4Wt3rC/bCQnPiaiYmWWj9nLrWJxLkar8gbLzgaB9o8GYdMI+/8u6K05dNbiS36fbQ7bNaR9r8GrW/d+PpY1fVyf1pikz4Z13p5Wi7ruspHD2g9GIfJJZvz+Xw/nxvATdxuPcJQgHFSY+etwTg7sria1gDfPR5bVx6GsnuFKyvT0GdbJP1qrU4gjfx9+a3VpV6efUnNNQGhPtsElDa4hhXOTWy911XDwuB7qmzVerFxEY3eKZo6GjDO+4bXx6guJp4W7WXibX1qmgZk9tXU6rKCjO5NczpVkfKlPWSwsjza9uIiPxJ6DirGdHOCnpJqUnGXtn2ktAs+Hg/g4wR6dZRumpz5UcWF1ukWJPnAlrYP5HVsAEfUNL9k/GmUBYKlcRNFuKUErIdxxvQTPfKWLLcYfk1dpPToDUAtRXBM49hQKKupGooVYWVKdvQ9/1o6hkfa0syFP+PrUL3pZJkVj0A/OjhAfHeONLY3nDk65AgW0dkkZbobjx8W3E+0o76CnX8QwvPxkTwRgYXTTDjfyJojPCMN+xd8YGqyxbSHM9xdokEPo+4U6MPgQwiRPV8zSg932o85BXPjfm5yxWPMHoYb02Wavbim7AnuWoadUjXOZ6UYd4LZ3cwlKElvgg/blmAlT+caf6nVpHjHMr+DXoHlQnEcl5JowK0WQ/k7+8cJPNsJ7WEnq6oiHB8Or9J9cZ7dMeDyCiPnJ/nTO1+yoqSB1Dl+QeKnvj64MpEwsFLmmtyvPrivZUeA85y2thz4fJN9dkdd41pEYap1+ulFNcm2G5iV0tTb7H/uyND7tVy9beo/BoQYdudAjWoAAAAASUVORK5CYII=";

  async isAvailable() {
    return getNoirStellarProvider() !== null;
  }

  async getAddress(params?: { path?: string; skipRequestAccess?: boolean }) {
    const provider = this.requireProvider();
    const result = params?.skipRequestAccess
      ? await provider.getAddress()
      : await provider.requestAccess();
    return { address: requireString(unwrap(result).address, "address") };
  }

  async signTransaction(xdr: string, options?: NoirSignOptions) {
    const result = unwrap(await this.requireProvider().signTransaction(xdr, options));
    return {
      signedTxXdr: requireString(result.signedTxXdr, "signed transaction"),
      signerAddress: requireString(result.signerAddress, "signer address"),
    };
  }

  async signAuthEntry(authEntry: string, options?: NoirSignOptions) {
    const result = unwrap(await this.requireProvider().signAuthEntry(authEntry, options));
    return {
      signedAuthEntry: requireString(result.signedAuthEntry, "signed authorization entry"),
      signerAddress: requireString(result.signerAddress, "signer address"),
    };
  }

  async signMessage(message: string, options?: NoirSignOptions) {
    const result = unwrap(await this.requireProvider().signMessage(message, options));
    return {
      signedMessage: requireString(result.signedMessage, "signed message"),
      signerAddress: requireString(result.signerAddress, "signer address"),
    };
  }

  async getNetwork() {
    const result = unwrap(await this.requireProvider().getNetwork());
    return {
      network: requireString(result.network, "network"),
      networkPassphrase: requireString(result.networkPassphrase, "network passphrase"),
    };
  }

  async hasMatchingSession(address: string, expectedNetworkPassphrase: string) {
    const provider = this.requireProvider();
    const { isAllowed } = unwrap(await provider.isAllowed());
    if (!isAllowed) return false;

    const current = unwrap(await provider.getAddress());
    if (current.address !== address) return false;

    const network = unwrap(await provider.getNetwork());
    if (network.networkPassphrase !== expectedNetworkPassphrase) {
      throw new VeloWalletError(
        "NETWORK_MISMATCH",
        `Switch Noir to ${expectedNetworkPassphrase === "Public Global Stellar Network ; September 2015" ? "Mainnet" : "Testnet"}.`,
      );
    }
    return true;
  }

  private requireProvider() {
    const provider = getNoirStellarProvider();
    if (!provider) {
      throw new VeloWalletError(
        "WALLET_UNAVAILABLE",
        "Noir Wallet is not available. Install or enable the Noir browser extension.",
      );
    }
    return provider;
  }
}

function unwrap<T>(response: NoirProviderResponse<T>): T {
  if (typeof response === "object" && response !== null && "error" in response) {
    const { code, message, ext } = response.error;
    if (code === -3 && /network/i.test(message)) {
      throw new VeloWalletError("NETWORK_MISMATCH", message, response.error);
    }
    throw { code, message, ext: ext?.join(", ") };
  }
  return response as T;
}

function requireString(value: unknown, label: string) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Noir did not return a valid ${label}.`);
  }
  return value;
}
