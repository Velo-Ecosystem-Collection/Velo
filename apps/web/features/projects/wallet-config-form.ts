import {
  normalizeWalletAppearance,
  type WalletAppearanceStyle,
} from "@carts1024/velo-wallets/config";

import type { WalletDraftConfig } from "@carts1024/velo-wallets/config";

export function parseOriginLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function walletIntegrationSnippets(options: {
  projectKey: string;
  cdnBaseUrl: string;
  apiBaseUrl: string;
}) {
  const cdnBaseUrl = options.cdnBaseUrl.replace(/\/$/, "");
  const apiBaseUrl = options.apiBaseUrl.replace(/\/$/, "");
  return {
    html: `<script type="module" src="${cdnBaseUrl}/v1/velo-wallet.js"></script>\n\n<velo-wallet\n  id="stellar-wallet"\n  project-key="${options.projectKey}"\n  api-base="${apiBaseUrl}"\n></velo-wallet>\n\n<script>\n  const wallet = document.querySelector("#stellar-wallet");\n\n  wallet.addEventListener("velo:wallet-connected", (event) => {\n    console.log("Connected", event.detail.address);\n  });\n\n  wallet.addEventListener("velo:wallet-error", (event) => {\n    console.error("Wallet error", event.detail.error);\n  });\n</script>`,
    react: `"use client";\n\nimport { VeloWalletProvider, WalletWidget } from "@carts1024/velo-wallets/react";\n\nexport function WalletControls() {\n  return (\n    <VeloWalletProvider projectKey="${options.projectKey}" apiBaseUrl="${apiBaseUrl}">\n      <WalletWidget />\n    </VeloWalletProvider>\n  );\n}`,
    install: "pnpm add @carts1024/velo-wallets@alpha",
    csp: `script-src 'self' ${new URL(cdnBaseUrl).origin}; connect-src 'self' ${new URL(apiBaseUrl).origin}`,
  };
}

export function draftFromDocument(document: {
  network: WalletDraftConfig["network"];
  walletIds: string[];
  theme: WalletDraftConfig["theme"];
  buttonLabel: string;
  appearance?: WalletAppearanceStyle;
  showInstallLabel: boolean;
  hideUnsupportedWallets: boolean;
  persistSession: boolean;
  allowedOrigins: string[];
}): WalletDraftConfig {
  const normalizedAppearance = normalizeWalletAppearance(document);
  const { theme: _theme, buttonLabel: _buttonLabel, ...appearance } = normalizedAppearance;
  return {
    network: document.network,
    walletIds: [...document.walletIds],
    theme: document.theme,
    buttonLabel: document.buttonLabel,
    appearance,
    showInstallLabel: document.showInstallLabel,
    hideUnsupportedWallets: document.hideUnsupportedWallets,
    persistSession: document.persistSession,
    allowedOrigins: [...document.allowedOrigins],
  };
}
