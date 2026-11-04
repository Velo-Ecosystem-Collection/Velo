import type { VeloWalletClient, VeloWalletOption } from "./browser.js";

import { walletPalette, walletCssVariables } from "./appearance.js";
import darkVeloLogo from "./assets/brand/velo-logo-dark.png";
import lightVeloLogo from "./assets/brand/velo-logo-light.png";
import { DEFAULT_WALLET_CONFIG, normalizeWalletAppearance } from "./config.js";

const selectorStyles = `
  .velo-selector { position: fixed; inset: 0; width: min(440px, calc(100vw - 32px)); max-width: none; max-height: min(760px, calc(100dvh - 32px)); margin: auto; padding: 0; overflow: hidden; border: 1px solid var(--velo-wallet-border); border-radius: var(--velo-wallet-modal-radius); background: var(--velo-wallet-background); color: var(--velo-wallet-text); box-shadow: var(--velo-wallet-shadow); font: 400 16px/1.45 var(--velo-wallet-font-family); }
  .velo-selector::backdrop { background: rgb(12 15 23 / .58); backdrop-filter: blur(3px); }
  .velo-selector * { box-sizing: border-box; }
  .velo-selector__shell { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; max-height: min(760px, calc(100dvh - 32px)); }
  .velo-selector__header { position: relative; display: grid; justify-items: center; gap: 12px; padding: 28px 52px 20px; text-align: center; }
  .velo-selector__brand { display: block; width: 132px; max-height: 64px; height: auto; object-fit: contain; }
  .velo-selector__header h2 { margin: 0; font-size: 1.35rem; font-weight: 700; letter-spacing: -.02em; }
  .velo-selector__header p { margin: 4px 0 0; color: var(--velo-wallet-muted-text); font-size: .82rem; }
  .velo-selector__close { position: absolute; top: 14px; right: 14px; display: grid; width: 38px; height: 38px; place-items: center; border: 1px solid var(--velo-wallet-border); border-radius: 999px; background: var(--velo-wallet-surface); color: var(--velo-wallet-text); font: inherit; font-size: 1.4rem; cursor: pointer; }
  .velo-selector__content { min-height: 0; overflow: auto; padding: 0 22px 12px; }
  .velo-selector__eyebrow { margin: 0 8px 10px; color: var(--velo-wallet-muted-text); font-size: .76rem; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; }
  .velo-selector__list { display: grid; gap: 9px; }
  .velo-selector__row { display: flex; align-items: center; gap: 8px; min-height: 66px; padding: 5px 8px 5px 6px; border: 1px solid var(--velo-wallet-border); border-radius: 999px; background: var(--velo-wallet-surface); }
  .velo-selector__row:hover, .velo-selector__row:focus-within { border-color: var(--velo-wallet-accent); }
  .velo-selector__pick { display: flex; min-width: 0; flex: 1; align-items: center; gap: 12px; padding: 0; border: 0; background: transparent; color: inherit; text-align: left; font: inherit; cursor: pointer; }
  .velo-selector__pick:disabled { cursor: not-allowed; opacity: .72; }
  .velo-selector__icon { display: grid; width: 48px; height: 48px; flex: 0 0 auto; place-items: center; overflow: hidden; border: 1px solid var(--velo-wallet-border); border-radius: 50%; background: #fff; padding: 4px; }
  .velo-selector__icon img { display: block; width: 100%; height: 100%; object-fit: contain; }
  .velo-selector__name { display: block; overflow: hidden; font-size: .98rem; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
  .velo-selector__availability { display: block; margin-top: 2px; color: var(--velo-wallet-muted-text); font-size: .75rem; }
  .velo-selector__chevron { flex: 0 0 auto; margin: 0 8px; color: var(--velo-wallet-muted-text); font-size: 1.5rem; line-height: 1; }
  .velo-selector__install { flex: 0 0 auto; padding: 8px 10px; border-radius: 999px; color: var(--velo-wallet-accent); font-size: .78rem; font-weight: 650; text-decoration: none; }
  .velo-selector__install:hover { text-decoration: underline; }
  .velo-selector__details { padding: 6px 28px 18px; text-align: center; }
  .velo-selector__details h3 { margin: 0; font-size: .95rem; font-weight: 650; }
  .velo-selector__details p { max-width: 360px; margin: 5px auto 0; color: var(--velo-wallet-muted-text); font-size: .8rem; }
  .velo-selector__status { min-height: 1.4em; color: var(--velo-wallet-muted-text); font-size: .8rem !important; }
  .velo-selector__status[data-kind="error"] { color: var(--velo-wallet-danger); }
  .velo-selector__footer { border-top: 1px solid var(--velo-wallet-border); padding: 14px 20px; color: var(--velo-wallet-muted-text); font-size: .76rem; text-align: center; }
  .velo-selector__empty { padding: 14px 10px; color: var(--velo-wallet-muted-text); font-size: .9rem; text-align: center; }
  .velo-selector__retry { display: inline-flex; min-height: 40px; margin-top: 8px; padding: 0 14px; align-items: center; justify-content: center; border: 1px solid var(--velo-wallet-border); border-radius: 999px; background: var(--velo-wallet-surface); color: var(--velo-wallet-text); font: inherit; font-size: .82rem; cursor: pointer; }
  .velo-selector button:focus-visible, .velo-selector a:focus-visible { outline: 3px solid var(--velo-wallet-focus-ring); outline-offset: 3px; }
  @media (max-width: 480px) {
    .velo-selector { width: calc(100vw - 24px); max-height: calc(100dvh - 24px); }
    .velo-selector__shell { max-height: calc(100dvh - 24px); }
    .velo-selector__header { padding: 24px 46px 16px; }
    .velo-selector__brand { width: 112px; max-height: 56px; }
    .velo-selector__header h2 { font-size: 1.2rem; }
    .velo-selector__content { padding-right: 14px; padding-left: 14px; }
    .velo-selector__row { min-height: 60px; }
    .velo-selector__icon { width: 44px; height: 44px; }
    .velo-selector__details { padding-right: 18px; padding-left: 18px; }
    .velo-selector__footer { padding: 12px; }
  }
  @media (prefers-reduced-motion: no-preference) {
    .velo-selector__row { transition: background-color 120ms ease, border-color 120ms ease; }
  }
`;

let activeSelector: Promise<string | null> | null = null;

function applyAppearance(
  dialog: HTMLDialogElement,
  appearance: ReturnType<typeof normalizeWalletAppearance>,
) {
  const systemDark =
    appearance.theme === "system" &&
    Boolean(window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  const palette = walletPalette(appearance, systemDark);
  Object.entries(walletCssVariables(appearance, palette)).forEach(([key, value]) =>
    dialog.style.setProperty(key, value),
  );
  const fontFamilies = {
    system: "ui-sans-serif, system-ui, sans-serif",
    serif: "ui-serif, Georgia, Cambria, serif",
    mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  } as const;
  dialog.style.setProperty("--velo-wallet-font-family", fontFamilies[appearance.fontFamily]);
  dialog.dataset.theme = systemDark || appearance.theme === "dark" ? "dark" : "light";
}

/** Opens the shared, branded selector and resolves after a wallet connects or the user closes it. */
export function openWalletSelector(client: VeloWalletClient): Promise<string | null> {
  if (activeSelector) return activeSelector;
  activeSelector = openWalletSelectorOnce(client).finally(() => {
    activeSelector = null;
  });
  return activeSelector;
}

function openWalletSelectorOnce(client: VeloWalletClient): Promise<string | null> {
  const config = client.getConfig();
  const appearance = config?.appearance ?? normalizeWalletAppearance(DEFAULT_WALLET_CONFIG);
  const dialog = document.createElement("dialog");
  dialog.className = "velo-selector";
  dialog.setAttribute("aria-labelledby", "velo-selector-title");
  applyAppearance(dialog, appearance);
  dialog.innerHTML = `
    <style>${selectorStyles}</style>
    <div class="velo-selector__shell">
      <header class="velo-selector__header">
        <img class="velo-selector__brand" alt="Velo" width="132" height="64" hidden>
        <div><h2 id="velo-selector-title">Connect your wallet</h2><p data-network></p></div>
        <button class="velo-selector__close" type="button" aria-label="Close wallet selector">×</button>
      </header>
      <div class="velo-selector__content">
        <section aria-label="Wallet options">
          <h3 class="velo-selector__eyebrow">Choose a wallet</h3>
          <div class="velo-selector__list" role="list" aria-live="polite"></div>
        </section>
        <section class="velo-selector__details" aria-label="Connection status" aria-live="polite" aria-atomic="true">
          <h3 data-detail-title>Your Stellar wallet</h3>
          <p data-detail-message>Connect securely with a wallet enabled by this app.</p>
          <p class="velo-selector__status" role="status" data-status>Loading available wallets…</p>
          <button class="velo-selector__retry" type="button" data-retry hidden>Try again</button>
        </section>
      </div>
      <footer class="velo-selector__footer">Powered by Velo Wallets</footer>
    </div>
  `;

  return new Promise((resolve) => {
    let settled = false;
    let connecting = false;
    let activeConfig = config;
    let selectedWallet: VeloWalletOption | null = null;
    const brand = dialog.querySelector<HTMLImageElement>(".velo-selector__brand");
    const list = dialog.querySelector<HTMLElement>(".velo-selector__list")!;
    const detailTitle = dialog.querySelector<HTMLElement>("[data-detail-title]")!;
    const detailMessage = dialog.querySelector<HTMLElement>("[data-detail-message]")!;
    const status = dialog.querySelector<HTMLElement>("[data-status]")!;
    const retryButton = dialog.querySelector<HTMLButtonElement>("[data-retry]")!;
    const networkLabel = config?.network === "public" ? "Stellar Mainnet" : "Stellar Testnet";
    dialog.querySelector("[data-network]")!.textContent = networkLabel;

    function renderBrand() {
      if (!brand) return;
      const selectorLogo = activeConfig?.selectorLogo ?? "velo";
      const projectLogoUrl = activeConfig?.projectLogoUrl;

      if (selectorLogo === "none" || (selectorLogo === "project" && !projectLogoUrl)) {
        brand.hidden = true;
        brand.removeAttribute("src");
        brand.alt = "";
        return;
      }

      brand.hidden = false;
      if (selectorLogo === "project" && projectLogoUrl) {
        brand.src = projectLogoUrl;
        brand.alt = "Project logo";
        return;
      }

      brand.src = dialog.dataset.theme === "dark" ? darkVeloLogo : lightVeloLogo;
      brand.alt = "Velo";
    }

    renderBrand();

    function finish(walletId: string | null) {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(walletId);
    }

    function renderWallets(wallets: VeloWalletOption[]) {
      list.replaceChildren();
      if (wallets.length === 0) {
        const empty = document.createElement("p");
        empty.className = "velo-selector__empty";
        empty.textContent = "No available wallets are enabled for this app.";
        list.append(empty);
        return;
      }

      wallets.forEach((wallet) => {
        const row = document.createElement("div");
        row.className = "velo-selector__row";
        row.setAttribute("role", "listitem");
        const button = document.createElement("button");
        button.className = "velo-selector__pick";
        button.type = "button";
        button.disabled = !wallet.isAvailable || connecting;
        button.setAttribute(
          "aria-label",
          `${wallet.name}${wallet.isAvailable ? ", available" : ", unavailable"}`,
        );
        const icon = document.createElement("span");
        icon.className = "velo-selector__icon";
        if (wallet.logo) {
          const image = document.createElement("img");
          image.src = wallet.logo;
          image.alt = "";
          image.width = 44;
          image.height = 44;
          icon.append(image);
        } else {
          icon.textContent = wallet.name.slice(0, 1).toUpperCase();
        }
        const name = document.createElement("span");
        name.className = "velo-selector__name";
        name.textContent = wallet.name;
        const availability = document.createElement("span");
        availability.className = "velo-selector__availability";
        availability.textContent =
          connecting && selectedWallet?.id === wallet.id
            ? "Opening wallet…"
            : wallet.isAvailable
              ? "Available"
              : "Not detected";
        const labels = document.createElement("span");
        labels.append(name, availability);
        button.append(icon, labels);
        if (wallet.isAvailable) {
          const chevron = document.createElement("span");
          chevron.className = "velo-selector__chevron";
          chevron.setAttribute("aria-hidden", "true");
          chevron.textContent = "›";
          button.append(chevron);
        }
        button.addEventListener("click", () => void connect(wallet));
        row.append(button);

        if (!wallet.isAvailable && activeConfig?.modal.showInstallLabel && wallet.installUrl) {
          const install = document.createElement("a");
          install.className = "velo-selector__install";
          install.href = wallet.installUrl;
          install.target = "_blank";
          install.rel = "noopener noreferrer";
          install.textContent = "Install";
          install.setAttribute("aria-label", `Install ${wallet.name} (opens in a new tab)`);
          row.append(install);
        }
        list.append(row);
      });
    }

    async function connect(wallet: VeloWalletOption) {
      if (connecting || !wallet.isAvailable) return;
      connecting = true;
      selectedWallet = wallet;
      retryButton.hidden = true;
      detailTitle.textContent = `Opening ${wallet.name}`;
      detailMessage.textContent = "Approve the connection request in your wallet.";
      status.textContent = `Waiting for ${wallet.name}…`;
      status.dataset.kind = "pending";
      renderWallets(options);
      try {
        await client.connect(wallet.id);
        finish(wallet.id);
      } catch (error) {
        connecting = false;
        detailTitle.textContent = "Connection didn’t complete";
        detailMessage.textContent =
          error instanceof Error
            ? error.message
            : "The wallet could not connect. Choose it to try again.";
        status.textContent = "Choose a wallet to try again.";
        status.dataset.kind = "error";
        renderWallets(options);
      }
    }

    let options: VeloWalletOption[] = [];
    async function loadWallets() {
      retryButton.hidden = true;
      delete status.dataset.kind;
      status.textContent = "Loading available wallets…";
      detailTitle.textContent = "Your Stellar wallet";
      detailMessage.textContent = "Connect securely with a wallet enabled by this app.";
      try {
        options = await client.listWallets();
        activeConfig = client.getConfig() ?? activeConfig;
        if (activeConfig?.appearance) {
          applyAppearance(dialog, activeConfig.appearance);
        }
        renderBrand();
        const currentNetwork =
          activeConfig?.network === "public" ? "Stellar Mainnet" : "Stellar Testnet";
        dialog.querySelector("[data-network]")!.textContent = currentNetwork;
        renderWallets(options);
        status.textContent = options.length
          ? "Choose a wallet to continue."
          : "No wallet is currently available.";
      } catch (error) {
        list.replaceChildren();
        const empty = document.createElement("p");
        empty.className = "velo-selector__empty";
        empty.textContent = "Wallet options could not be loaded.";
        list.append(empty);
        detailTitle.textContent = "Couldn’t load wallets";
        detailMessage.textContent =
          error instanceof Error ? error.message : "Try loading the wallet list again.";
        status.textContent = "Check your connection, then retry.";
        status.dataset.kind = "error";
        retryButton.hidden = false;
      }
    }

    dialog.querySelector(".velo-selector__close")!.addEventListener("click", () => finish(null));
    retryButton.addEventListener("click", () => void loadWallets());
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(null);
    });
    dialog.addEventListener("close", () => finish(null));
    document.body.append(dialog);
    dialog.showModal();
    void loadWallets();
  });
}
