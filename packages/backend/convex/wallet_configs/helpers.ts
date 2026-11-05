import {
  DEFAULT_WALLET_CONFIG,
  normalizeAllowedOrigin,
  normalizeWalletAppearance,
  validateWalletDraft,
  type WalletDraftConfig,
} from "@carts1024/velo-wallets/config";

import type { MutationCtx } from "../_generated/server";

const BASE64_URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function normalizedDraft(config: WalletDraftConfig): WalletDraftConfig {
  const normalizedAppearance = normalizeWalletAppearance(config);
  const { theme: _theme, buttonLabel: _buttonLabel, ...appearance } = normalizedAppearance;
  const normalized = {
    ...config,
    theme: normalizedAppearance.theme,
    buttonLabel: normalizedAppearance.buttonLabel,
    selectorLogo: config.selectorLogo ?? DEFAULT_WALLET_CONFIG.selectorLogo,
    appearance,
    allowedOrigins: config.allowedOrigins.map(normalizeAllowedOrigin),
  };
  const errors = validateWalletDraft(normalized);
  if (errors.length > 0) throw new Error(errors.join(" "));
  return normalized;
}

function randomPublicKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let encoded = "";
  let buffer = 0;
  let bitCount = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bitCount += 8;
    while (bitCount >= 6) {
      bitCount -= 6;
      encoded += BASE64_URL_ALPHABET[(buffer >> bitCount) & 63];
    }
  }
  if (bitCount > 0) encoded += BASE64_URL_ALPHABET[(buffer << (6 - bitCount)) & 63];
  return `vw_pk_${encoded}`;
}

export async function uniquePublicKey(ctx: MutationCtx) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const publicKey = randomPublicKey();
    const existing = await ctx.db
      .query("walletConfigs")
      .withIndex("by_public_key", (q) => q.eq("publicKey", publicKey))
      .unique();
    if (!existing) return publicKey;
  }
  throw new Error("Could not generate a unique wallet project key");
}
