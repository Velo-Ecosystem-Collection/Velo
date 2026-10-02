// Development-only browser fixture. No real wallet or backend credentials.
const address = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
export const KitEventType = {
  STATE_UPDATED: "state",
  WALLET_SELECTED: "selected",
  DISCONNECT: "disconnect",
};
const listeners = new Map<string, Set<(event: { payload: Record<string, string> }) => void>>();
let close: (() => void) | undefined;
export const StellarWalletsKit = {
  selectedModule: { productId: "wallet_connect" },
  async refreshSupportedWallets() {
    return [{ id: "wallet_connect", name: "WalletConnect", isAvailable: true }];
  },
  on(event: string, fn: (event: { payload: Record<string, string> }) => void) {
    const set = listeners.get(event) ?? new Set();
    listeners.set(event, set);
    set.add(fn);
    return () => {
      set.delete(fn);
    };
  },
  authModal(): Promise<{ address: string }> {
    return new Promise((resolve, reject) => {
      const dialog = document.createElement("div");
      dialog.setAttribute("role", "dialog");
      const pair = document.createElement("button");
      pair.textContent = "Approve simulated pairing";
      const cancel = document.createElement("button");
      cancel.textContent = "Cancel simulated pairing";
      close = () => {
        dialog.remove();
        close = undefined;
        reject({ code: -1, message: "The user closed the modal." });
      };
      pair.onclick = () => {
        dialog.remove();
        close = undefined;
        resolve({ address });
      };
      cancel.onclick = () => close?.();
      dialog.append(pair, cancel);
      document.body.append(dialog);
    });
  },
  async signTransaction() {
    if (window.sessionStorage.getItem("reject-signature"))
      throw { code: 4001, message: "User rejected signing" };
    return { signedTxXdr: "simulated-signed-challenge" };
  },
  async signMessage() {
    return { signedMessage: "simulated" };
  },
  async disconnect() {
    close?.();
    for (const fn of listeners.get(KitEventType.DISCONNECT) ?? []) fn({ payload: {} });
  },
};
export async function initializeWalletKit() {
  return { StellarWalletsKit, KitEventType };
}
