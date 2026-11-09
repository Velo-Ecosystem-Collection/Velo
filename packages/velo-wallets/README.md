# @carts1024/velo-wallets

Hosted, project-configured multi-wallet integration for Stellar applications. Velo Wallets wraps Stellar Wallets Kit 2.3.0; it does not replace it.

## Release status

Version `1.0.0` is published to npm. The hosted HTML runtime is deployed separately at `https://www.velo-build.dev/wallets/v1/velo-wallet.js`; use the URL and `api-base` from the project's generated snippet when integrating.

## Installation and compatibility

Install the stable package without an alpha tag:

```sh
npm install @carts1024/velo-wallets
# or
pnpm add @carts1024/velo-wallets
```

The package is ESM and exposes these subpaths: `@carts1024/velo-wallets/config`, `/browser`, `/logos`, `/element`, and `/react`. React and React DOM are peer dependencies with a minimum version of 18. The wallet kit runtime is bundled, so consumers do not need a JSR registry configuration or a separate wallet-kit install.

The config, browser, logos, element, and React entry points can be imported during server rendering. Wallet access requires a browser. In Next.js App Router, mount the provider below a `"use client"` boundary. The custom element requires a browser with custom elements, Shadow DOM, and module-script support.

## HTML custom element

Load the hosted bundle and provide a public wallet project key:

```html
<script type="module" src="https://www.velo-build.dev/wallets/v1/velo-wallet.js"></script>
<velo-wallet
  project-key="vw_pk_00000000000000000000000000000000"
  api-base="https://www.velo-build.dev"
></velo-wallet>
```

Replace the example key with the project's `vw_pk_...` key. It is public configuration; do not use a private Velo API key here. The element provides `connect`, `disconnect`, `getAddress`, `signTransaction`, `signAuthEntry`, and `signMessage`, plus versioned `velo:wallet-*` DOM events.

The current Velo-hosted runtime supports every wallet ID offered in project configuration, including Noir. Use the generated snippet so its CDN URL and `api-base` match the deployed Velo environment. Custom hosts and older copied runtime bundles should be checked before publishing a configuration with a newly supported wallet.

Published light/dark palettes, typography, button shape, and modal styling are loaded with the project configuration. A consuming page can override palette variables before the element initializes:

```css
velo-wallet {
  --velo-wallet-accent: #6d28d9;
  --velo-wallet-accent-text: #ffffff;
}
```

For theme-specific overrides, prefix palette variables with `--velo-wallet-light-` or `--velo-wallet-dark-`. The component exposes `container`, `trigger`, `actions`, `copy-button`, `disconnect-button`, and `status` CSS parts.

## React and Next.js

```tsx
"use client";

import { VeloWalletProvider, WalletWidget } from "@carts1024/velo-wallets/react";

export function WalletControls() {
  return (
    <VeloWalletProvider projectKey="vw_pk_00000000000000000000000000000000">
      <WalletWidget />
    </VeloWalletProvider>
  );
}
```

`WalletWidget` includes connected-wallet identity, copy, disconnect, status, and error UI. `ConnectButton` is available for button-only integrations. Signing inputs and results remain in the consuming browser and are never sent to Velo.

```tsx
<VeloWalletProvider
  projectKey="vw_pk_00000000000000000000000000000000"
  appearance={{
    palettes: { light: { accent: "#6D28D9", accentText: "#FFFFFF" } },
    button: { size: "lg", radius: "pill" },
  }}
>
  <WalletWidget />
</VeloWalletProvider>
```

Local appearance values are merged over the published project configuration and validated before the wallet selector opens. A document may use only one project key and one local appearance override. `useVeloWallet().connect()` remains available for programmatic connections through Stellar Wallets Kit; passing a configured wallet ID selects that wallet before requesting access.

## Wallets and Noir

The selector lists the wallets enabled in the published configuration and shows availability and install links. It uses bundled wallet marks and can show Velo's logo, the current project logo, or no logo. Project logos come from the owner's Project Settings upload. `WALLET_LOGOS` is available from `@carts1024/velo-wallets/logos` for client-side presentation.

Noir is supported through its SEP-43 provider at `window.noir.stellar` for account access and transaction, Soroban authorization-entry, and message signing. Install the official [Noir browser extension](https://chromewebstore.google.com/detail/noir/gikfhchijjljpbhokmdmaadgmpbchmjl). The current Velo-hosted runtime supports Noir; custom hosts must serve a compatible runtime before an owner publishes a project configuration containing Noir. Velo disconnect clears the widget's local session; Noir site authorization remains until the user revokes it in the extension.

## Validation and release limits

Signing is performed by the selected wallet in the browser. Velo Wallets validates the published configuration, connected account, network state, and wallet responses; it does not verify or submit the resulting transaction. Version 1.0.0 is published to npm, and the separately deployed hosted runtime is available at `www.velo-build.dev/wallets/v1/velo-wallet.js`. Real browser-extension behavior, including Noir signing, still needs a separate real-wallet qualification.
