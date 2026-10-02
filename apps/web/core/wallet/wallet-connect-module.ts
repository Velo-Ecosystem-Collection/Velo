import {
  WalletConnectModule,
  WalletConnectAllowedMethods,
  WalletConnectTargetChain,
} from "@creit-tech/stellar-wallets-kit/modules/wallet-connect";
import {
  activeAddress,
  activeModule,
  closeEvent,
  disconnectEvent,
  resetWalletState,
  wcSessionPaths,
} from "@creit-tech/stellar-wallets-kit/state";
import { assertValidPublicKey } from "@repo/stellar";

import { testnetSessionAddress } from "./wallet-connect-policy.ts";

/** Kit 2.3 adapter: cancellable pairing and non-recursive session cleanup. */
export class VeloWalletConnectModule extends WalletConnectModule {
  private cancelPairing: (() => void) | undefined;
  private listening = false;
  private closingTopics = new Set<string>();

  // A bridge needs no extension installation. getAddress waits for client readiness.
  override async isAvailable() {
    return true;
  }

  private async ready() {
    const deadline = Date.now() + 10_000;
    while (!(await super.isAvailable())) {
      if (Date.now() >= deadline) throw new Error("WalletConnect is unavailable. Please retry.");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!this.listening) {
      this.listening = true;
      this.signClient.on("session_expire", ({ topic }) => {
        void this.closeSession(topic);
      });
      // Account/permission updates require explicit reconnection and fresh auth.
      this.signClient.on("session_update", ({ topic }) => {
        void this.closeSession(topic);
      });
    }
  }

  override async getAddress(): Promise<{ address: string }> {
    this.cancelPairing?.();
    let cancelled = false;
    let rejectCancellation: (reason: Error) => void = () => {};
    const cancellation = new Promise<never>((_, reject) => {
      rejectCancellation = reject;
    });
    const cancel = () => {
      cancelled = true;
      rejectCancellation(new Error("WalletConnect request cancelled."));
    };
    this.cancelPairing = cancel;
    let opened = false;
    const unsubscribeModal = this.modal.subscribeState(({ open }) => {
      if (open) opened = true;
      else if (opened) cancel();
    });
    const unsubscribeKit = closeEvent.subscribe(cancel);
    const timeout = setTimeout(cancel, 120_000);
    const connect = async () => {
      await this.ready();
      if (cancelled) throw new Error("WalletConnect request cancelled.");
      const { uri, approval } = await this.signClient.connect({
        requiredNamespaces: {
          stellar: {
            methods: [WalletConnectAllowedMethods.SIGN],
            chains: [WalletConnectTargetChain.TESTNET],
            events: [],
          },
        },
      });
      // Always observe approval, including after cancellation, to retire late sessions.
      const approved = approval().then(async (session) => {
        try {
          if (cancelled) throw new Error("WalletConnect request cancelled.");
          const address = assertValidPublicKey(testnetSessionAddress(session));
          const previousTopics = wcSessionPaths.value.map((path) => path.topic);
          wcSessionPaths.value = [{ publicKey: address, topic: session.topic }];
          await Promise.all(
            previousTopics
              .filter((topic) => topic !== session.topic)
              .map((topic) => this.closeSession(topic)),
          );
          if (cancelled) throw new Error("WalletConnect request cancelled.");
          return { address };
        } catch (error) {
          await this.closeSession(session.topic);
          throw error;
        }
      });
      if (uri && !cancelled) void this.modal.open({ uri });
      return approved;
    };
    try {
      return await Promise.race([connect(), cancellation]);
    } finally {
      clearTimeout(timeout);
      unsubscribeModal();
      unsubscribeKit();
      if (this.cancelPairing === cancel) {
        this.cancelPairing = undefined;
        void this.modal.close();
      }
    }
  }

  override async signTransaction(
    xdr: string,
    opts?: { networkPassphrase?: string; address?: string; path?: string },
  ) {
    await this.ready();
    const address = opts?.address ?? activeAddress.value ?? undefined;
    const path = wcSessionPaths.value.find((entry) => entry.publicKey === address);
    const session = this.signClient.session.values.find((entry) => entry.topic === path?.topic);
    if (!session || !address)
      throw new Error("WalletConnect session expired. Reconnect your wallet.");
    testnetSessionAddress(session, address);
    return super.signTransaction(xdr, opts);
  }

  override async closeSession(topic: string, reason = "Session closed") {
    if (this.closingTopics.has(topic)) return;
    this.closingTopics.add(topic);
    try {
      const isActive =
        activeModule.value === this &&
        wcSessionPaths.value.some(
          (path) => path.topic === topic && path.publicKey === activeAddress.value,
        );
      wcSessionPaths.value = wcSessionPaths.value.filter((path) => path.topic !== topic);
      if (isActive) {
        resetWalletState();
        disconnectEvent.next();
        closeEvent.next();
      }
      // session_delete may arrive after the client has already removed the session.
      if (this.signClient?.session.values.some((session) => session.topic === topic)) {
        await this.signClient
          .disconnect({ topic, reason: { code: 6000, message: reason } })
          .catch(() => {});
      }
    } finally {
      this.closingTopics.delete(topic);
    }
  }

  override async disconnect() {
    this.cancelPairing?.();
    void this.modal.close();
    const sessions = this.signClient?.session.values ?? [];
    await Promise.all(sessions.map((session) => this.closeSession(session.topic)));
  }
}
