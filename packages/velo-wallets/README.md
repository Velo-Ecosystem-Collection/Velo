# @carts1024/velo-wallets

Hosted, project-configured multi-wallet integration for Stellar applications. Velo Wallets wraps Stellar Wallets Kit 2.3.0; it does not replace it.

The npm package bundles its pinned Wallets Kit runtime, so consumers do not need a JSR registry configuration.

The React widget and custom element open Velo's responsive Stellar wallet selector. It lists configured wallets with bundled logos and availability; unavailable choices include an install link when the published settings allow it. Selecting an available wallet requests access through its existing Stellar Wallets Kit module. Velo's wordmark and wallet logos ship with the package and CDN bundle, so the selector does not load marks from a third-party image host. Wallet marks identify connection choices and come from the corresponding Stellar Wallets Kit icon sources, OneKey's official asset host, and the Noir image already used by Velo's Noir module.

Noir is supported by the `0.1.0-alpha.4` workspace release candidate. Once that version is published, install the `alpha` dist-tag (`pnpm add @carts1024/velo-wallets@alpha`) before an owner publishes a project configuration containing Noir. Older runtimes reject the unknown wallet ID. Install the official [Noir browser extension](https://chromewebstore.google.com/detail/noir/gikfhchijjljpbhokmdmaadgmpbchmjl) as well.

The Noir connection uses its SEP-43 provider at `window.noir.stellar` for address access and transaction, Soroban authorization-entry, and message signing. Velo's disconnect clears the widget's local session; Noir site authorization remains until the user revokes it in the extension.

## HTML

```html
<script type="module" src="https://wallets.velo.dev/v1/velo-wallet.js"></script>
<velo-wallet project-key="vw_pk_example"></velo-wallet>
```

The element provides `connect`, `disconnect`, `getAddress`, `signTransaction`, `signAuthEntry`, and `signMessage`, plus the versioned `velo:wallet-*` DOM events.

Published Light/Dark palettes, typography, button shape, and modal styling are loaded with the project configuration. A consuming page can make a local override with validated CSS variables before the element initializes:

```css
velo-wallet {
  --velo-wallet-accent: #6d28d9;
  --velo-wallet-accent-text: #ffffff;
}
```

For theme-specific overrides, prefix palette variables with `--velo-wallet-light-` or `--velo-wallet-dark-`. The component exposes the `container`, `trigger`, `actions`, `copy-button`, `disconnect-button`, and `status` CSS parts.

## React / Next.js

```tsx
"use client";

import { VeloWalletProvider, WalletWidget } from "@carts1024/velo-wallets/react";

export function WalletControls() {
  return (
    <VeloWalletProvider projectKey="vw_pk_example">
      <WalletWidget />
    </VeloWalletProvider>
  );
}
```

Mount the provider only at the client boundary that needs wallet state. Package entry imports are server-safe. Signing inputs and results remain in the consuming browser and are never sent to Velo.

`WalletWidget` includes connected-wallet identity, copy, disconnect, status, and error UI. `ConnectButton` remains available for button-only integrations. Published styling is the default; local React overrides can be supplied at the provider:

```tsx
<VeloWalletProvider
  projectKey="vw_pk_example"
  appearance={{
    palettes: { light: { accent: "#6D28D9", accentText: "#FFFFFF" } },
    button: { size: "lg", radius: "pill" },
  }}
>
  <WalletWidget />
</VeloWalletProvider>
```

Local appearance values are merged over the published project configuration and validated before the wallet selector opens. A document may use only one project key and one local appearance override.

The `useVeloWallet().connect()` method remains available for programmatic connections through Stellar Wallets Kit. Passing a configured wallet ID selects that wallet directly before requesting access. Consumers that render `ConnectButton` or `WalletWidget` get Velo's styled selector automatically.

Wallet marks are also available as data URLs from `@carts1024/velo-wallets/logos` via the `WALLET_LOGOS` map, keyed by the published wallet IDs. This entry is intended for client-side presentation such as the project configuration preview.
