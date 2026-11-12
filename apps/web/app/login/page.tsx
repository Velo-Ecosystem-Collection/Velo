"use client";

import { AppShell } from "@/core/app-shell";
import { useWallet } from "@/core/wallet/wallet-provider";
import { useUserProfile } from "@/features/onboarding/use-user-profile";
import { Alert, AlertDescription, AlertTitle } from "@repo/ui/components/ui/alert";
import { Button } from "@repo/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui/components/ui/dialog";
import { useConvexAuth } from "convex/react";
import { AlertCircleIcon, Loader2Icon, WalletIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function LoginPage() {
  const wallet = useWallet();
  const { isNewUser, isLoading } = useUserProfile(wallet.address);
  const { isAuthenticated: isConvexAuthenticated, isLoading: isConvexLoading } = useConvexAuth();
  const router = useRouter();
  const [passkeyDialogOpen, setPasskeyDialogOpen] = useState(false);

  // Redirect to dashboard or signup once authenticated
  useEffect(() => {
    if (wallet.status === "connected" && isConvexAuthenticated && !isConvexLoading && !isLoading) {
      if (isNewUser) {
        router.push("/signup");
      } else {
        router.push("/dashboard");
      }
    }
  }, [wallet.status, isConvexAuthenticated, isConvexLoading, isNewUser, isLoading, router]);

  const handleConnect = async () => {
    try {
      await wallet.connect();
    } catch {
      // Errors are handled in the wallet state context
    }
  };

  const isConnecting = wallet.status === "connecting" || wallet.status === "initializing";
  const isStartingSession = wallet.status === "connected" && isConvexLoading;
  const isBusy = isConnecting || isConvexLoading || isLoading;
  const buttonLabel = isConnecting
    ? "Connecting wallet…"
    : isStartingSession
      ? "Starting your Velo session…"
      : isLoading
        ? "Loading your Velo account…"
        : "Connect Wallet";

  return (
    <AppShell>
      <div className="flex flex-col items-center justify-center py-12 md:py-24">
        <div className="w-full max-w-md space-y-6">
          {/* Login Card */}
          <div className="rounded-lg border border-zinc-200 bg-white p-8 shadow-sm">
            <div className="mb-6 space-y-2">
              <h1 className="text-2xl font-semibold tracking-normal text-zinc-900">
                Connect to Console
              </h1>
              <p className="text-sm text-zinc-600">
                Log in to manage developer projects, verify smart contracts, and view real-time
                Stellar events.
              </p>
              <p className="pt-2 text-sm text-zinc-600">
                Classic wallets sign a short SEP-10 challenge. Passkeys create or reconnect a Velo
                smart account and sign a single-use SEP-45 challenge. Login verification has no
                transaction fee.
              </p>
            </div>

            {/* Wallet Error Alerts */}
            {wallet.error && (
              <Alert variant="destructive" className="mb-6">
                <AlertCircleIcon className="h-4 w-4" />
                <AlertTitle>Wallet Error</AlertTitle>
                <AlertDescription className="text-xs">{wallet.error}</AlertDescription>
              </Alert>
            )}

            {/* Action Button */}
            <Button
              onClick={handleConnect}
              disabled={
                isConnecting || wallet.status === "connected" || isConvexLoading || isLoading
              }
              className="flex w-full items-center justify-center gap-2"
            >
              {isBusy ? (
                <>
                  <Loader2Icon className="h-4 w-4 animate-spin" />
                  <span>{buttonLabel}</span>
                </>
              ) : (
                <>
                  <WalletIcon className="h-4 w-4" />
                  <span>Connect Wallet</span>
                </>
              )}
            </Button>

            {wallet.passkeyEnabled && (
              <div className="mt-3 grid gap-2">
                <Dialog open={passkeyDialogOpen} onOpenChange={setPasskeyDialogOpen}>
                  <DialogTrigger asChild>
                    <Button
                      variant="outline"
                      disabled={isBusy || wallet.status === "connected"}
                      className="w-full"
                    >
                      {wallet.status === "connecting"
                        ? "Waiting for passkey…"
                        : "Continue with Passkey"}
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Continue with a Velo passkey</DialogTitle>
                      <DialogDescription>
                        Choose how you want to use your passkey. Velo passkeys are separate from
                        passkeys used by other apps.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-3">
                      <div className="grid gap-1">
                        <Button
                          className="w-full"
                          disabled={isBusy}
                          onClick={() => {
                            setPasskeyDialogOpen(false);
                            void wallet.connectPasskey();
                          }}
                        >
                          Connect existing account
                        </Button>
                        <p className="px-1 text-xs text-zinc-500">
                          Use a Velo smart account you already created. If you have several, you can
                          choose which one to connect.
                        </p>
                      </div>
                      <div className="grid gap-1">
                        <Button
                          variant="outline"
                          className="w-full"
                          disabled={isBusy}
                          onClick={() => {
                            setPasskeyDialogOpen(false);
                            void wallet.createPasskeyAccount();
                          }}
                        >
                          Create a new account
                        </Button>
                        <p className="px-1 text-xs text-zinc-500">
                          Register a new passkey and deploy a smart account on Stellar Testnet.
                          Network fees may apply.
                        </p>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
                <p className="text-center text-xs text-zinc-500">
                  Smart accounts and supported owner actions run on Stellar Testnet. If no Velo
                  relayer is configured, submissions use the smart-account kit&apos;s funded Testnet
                  fee account and are not gasless.
                </p>
              </div>
            )}

            {wallet.passkeyAccounts.length > 1 && (
              <div className="mt-4 grid gap-2 rounded-md border border-zinc-200 p-3">
                <p className="text-sm font-medium text-zinc-900">Choose a Velo smart account</p>
                {wallet.passkeyAccounts.map((account) => (
                  <Button
                    key={account.contractId}
                    variant="outline"
                    disabled={isConnecting}
                    onClick={() => void wallet.selectPasskeyAccount(account.contractId)}
                  >
                    {account.contractId.slice(0, 8)}…{account.contractId.slice(-6)}
                  </Button>
                ))}
              </div>
            )}

            {isStartingSession && (
              <p role="status" className="mt-3 text-center text-sm text-zinc-600">
                Your wallet is connected. Velo is starting your session.
              </p>
            )}

            {wallet.status === "stale" && wallet.staleAddress && (
              <p className="mt-4 text-center font-mono text-xs text-zinc-500">
                Reconnecting to {wallet.staleAddress.slice(0, 6)}...{wallet.staleAddress.slice(-6)}
              </p>
            )}
          </div>

          {/* Back Link */}
          <div className="text-center">
            <Link href="/" className="text-xs text-zinc-500 transition-colors hover:text-zinc-700">
              ← Back to Landing Page
            </Link>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
