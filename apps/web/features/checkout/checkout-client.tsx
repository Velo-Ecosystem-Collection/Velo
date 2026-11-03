"use client";

import { env } from "@/core/config/env";
import { stellarConfig, STELLAR_TESTNET_NETWORK_PASSPHRASE } from "@/core/config/stellar";
import { useWallet } from "@/core/wallet/wallet-provider";
import { api } from "@repo/backend/convex/_generated/api";
import {
  buildCheckoutPaymentTransaction,
  getTransactionHash,
  submitCheckoutTransaction,
} from "@repo/stellar";
import { Badge } from "@repo/ui/components/ui-customs/badge";
import { Alert, AlertDescription, AlertTitle } from "@repo/ui/components/ui/alert";
import { Button } from "@repo/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/ui/card";
import { Skeleton } from "@repo/ui/components/ui/skeleton";
import { Spinner } from "@repo/ui/components/ui/spinner";
import { useMutation, useQuery } from "convex/react";
import {
  AlertCircleIcon,
  ClockIcon,
  CreditCardIcon,
  ShieldCheckIcon,
  WalletIcon,
  XCircleIcon,
  WifiOffIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import type { Id } from "@repo/backend/convex/_generated/dataModel";

import { emitCheckoutBenchmarkMarker } from "./benchmark-markers";
import { formatAmount, formatAsset } from "./format";

type CheckoutClientProps = {
  paymentIntentId: string;
};

type PaymentStep = "connect" | "review" | "submitting" | "submitted";

function isTerminalSubmissionFailure(message: string) {
  return /rejected|tx_|op_|malformed|underfunded|no_trust|line_full|too_late|too_early|bad_seq/i.test(
    message,
  );
}

function useTimeRemaining(expiresAt: number | undefined) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!expiresAt) return;

    const update = () => {
      const diff = expiresAt - Date.now();
      setRemaining(Math.max(0, diff));
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  if (remaining === null) return null;

  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  return { remaining, minutes, seconds, expired: remaining <= 0 };
}

export function CheckoutClient({ paymentIntentId }: CheckoutClientProps) {
  const router = useRouter();
  const wallet = useWallet();
  const [step, setStep] = useState<PaymentStep>("connect");
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);

  const intentId = paymentIntentId as Id<"paymentIntents">;
  const intent = useQuery(api.payment_intents.queries.getPaymentIntent, {
    paymentIntentId: intentId,
  });

  const updateStatus = useMutation(api.payment_intents.mutations.updateStatus);
  const reportSubmitted = useMutation(api.transactions.mutation.reportSubmitted);
  const timer = useTimeRemaining(intent?.expiresAt);

  useEffect(() => {
    emitCheckoutBenchmarkMarker(
      env.NEXT_PUBLIC_VELO_BENCHMARK_MARKERS,
      "velo:checkout-start",
      {
        entityId: paymentIntentId,
        state: "loading",
        version: 0,
      },
      {
        now: () => performance.timeOrigin,
        monotonicNow: () => 0,
      },
    );
  }, [paymentIntentId]);

  useEffect(() => {
    if (!intent) return;
    const common = {
      entityId: paymentIntentId,
      state: intent.status,
      version: intent.updatedAt,
      correlationId: intent.correlationId,
    };
    if (intent.status === "created" && intent.receiverAddress) {
      emitCheckoutBenchmarkMarker(env.NEXT_PUBLIC_VELO_BENCHMARK_MARKERS, "velo:checkout-ready", {
        ...common,
        serverEventAt: intent.stageTimestamps?.routeReady ?? intent.updatedAt,
      });
    } else if (intent.status === "pending") {
      emitCheckoutBenchmarkMarker(
        env.NEXT_PUBLIC_VELO_BENCHMARK_MARKERS,
        "velo:payment-submitted-rendered",
        {
          ...common,
          serverEventAt:
            intent.stageTimestamps?.submissionReported ??
            intent.stageTimestamps?.submitted ??
            intent.updatedAt,
        },
      );
    } else if (intent.status === "paid") {
      emitCheckoutBenchmarkMarker(
        env.NEXT_PUBLIC_VELO_BENCHMARK_MARKERS,
        "velo:payment-verified-rendered",
        {
          ...common,
          serverEventAt: intent.stageTimestamps?.confirmed ?? intent.updatedAt,
        },
      );
    }
  }, [intent, paymentIntentId]);

  useEffect(() => {
    const update = () => setIsOffline(!window.navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  // Auto-reconnect from stored platform session (stale = previous session in localStorage)
  useEffect(() => {
    if (wallet.status === "stale") {
      wallet.connect().catch(() => {
        // silent — user can manually connect if auto-reconnect fails
      });
    }
  }, [wallet.status, wallet.connect]);

  // Auto-advance step when wallet connects
  useEffect(() => {
    if (wallet.status === "connected" && step === "connect") {
      setStep("review");
    }
  }, [wallet.status, step]);

  // Check if already paid/cancelled/failed to redirect to proper landing screen
  useEffect(() => {
    if (!intent) return;
    if (intent.status === "paid") {
      router.replace(`/pay/${paymentIntentId}/success`);
    } else if (intent.status === "cancelled") {
      router.replace(`/pay/${paymentIntentId}/cancel`);
    } else if (intent.status === "failed") {
      router.replace(`/pay/${paymentIntentId}/failed`);
    }
  }, [intent, paymentIntentId, router]);

  const handlePay = useCallback(async () => {
    if (!intent || !wallet.address) return;
    if (intent.anchor === "pdax") {
      setError("This legacy PDAX checkout is unavailable. Request a new in-house checkout.");
      return;
    }

    setError(null);
    setStep("submitting");
    let markedPending = false;
    let txHash = "";
    let startedSigningAt = 0;
    let signedAt = 0;
    let submittedAt = 0;

    try {
      if (!intent.receiverAddress || intent.status !== "created") {
        throw new Error("Payment route is not ready yet.");
      }
      startedSigningAt = Date.now();

      // 1. Build the payment transaction and fail early before changing intent state.
      const unsignedXdr = await buildCheckoutPaymentTransaction({
        payerAddress: wallet.address,
        receiverAddress: intent.receiverAddress,
        amount: intent.amount,
        asset: intent.asset,
        networkPassphrase: STELLAR_TESTNET_NETWORK_PASSPHRASE,
        horizonUrl: stellarConfig.horizonUrl,
        ...(intent.receiverMemo ? { memo: intent.receiverMemo } : {}),
      });

      // 2. Request signature from connected wallet
      const signedXdr = await wallet.signTransaction(unsignedXdr);
      signedAt = Date.now();

      // Deterministically extract the transaction hash
      txHash = getTransactionHash(signedXdr);

      // 3. Submit signed XDR directly to Stellar network
      submittedAt = Date.now();
      const result = await submitCheckoutTransaction({
        signedXdr,
        horizonUrl: stellarConfig.horizonUrl,
      });

      // 4. Horizon accepted the transaction; backend scanner confirms settlement. Update backend in a single combined call.
      if (result.successful) {
        try {
          await reportSubmitted({
            hash: txHash,
            paymentIntentId: intentId,
            payerAddress: wallet.address,
            stageTimestamps: {
              startedSigning: startedSigningAt,
              signed: signedAt,
              submitted: submittedAt,
            },
          });
          markedPending = true;
        } catch (err) {
          console.error("Failed to report transaction submission:", err);
        }
        setStep("submitted");
      } else {
        await updateStatus({
          paymentIntentId: intentId,
          status: "failed",
        });
        router.push(`/pay/${paymentIntentId}/failed`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Payment failed";

      // If user rejected the signing, go back to review step
      if (/reject|denied|cancel/i.test(message)) {
        setStep("review");
        setError("Transaction signing was rejected.");
        return;
      }

      setError(message);
      setStep("review");

      if (markedPending) {
        return;
      }

      if (!isTerminalSubmissionFailure(message)) {
        // For non-terminal failures, report as submitted/pending so watcher can verify it on-chain
        if (txHash) {
          try {
            await reportSubmitted({
              hash: txHash,
              paymentIntentId: intentId,
              payerAddress: wallet.address,
              stageTimestamps: {
                startedSigning: startedSigningAt,
                signed: signedAt,
                submitted: submittedAt,
              },
            });
            markedPending = true;
            setStep("submitted");
          } catch (reportErr) {
            console.error("Failed to report non-terminal submission:", reportErr);
          }
        } else {
          setStep("submitted");
        }
        return;
      }

      // Update intent status to failed only for terminal Horizon rejections.
      try {
        await updateStatus({
          paymentIntentId: intentId,
          status: "failed",
        });
        router.push(`/pay/${paymentIntentId}/failed`);
      } catch {
        // ignore status update failures
      }
    }
  }, [intent, wallet, intentId, updateStatus, reportSubmitted, paymentIntentId, router]);

  const handleCancelClick = useCallback(async () => {
    try {
      await updateStatus({
        paymentIntentId: intentId,
        status: "cancelled",
      });
      router.push(`/pay/${paymentIntentId}/cancel`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel payment");
    }
  }, [intentId, updateStatus, paymentIntentId, router]);

  // ─── Loading state ───
  if (intent === undefined) {
    return <CheckoutSkeleton />;
  }

  // ─── Not found ───
  if (intent === null) {
    return (
      <CheckoutShell>
        <Card className="w-full max-w-md border-destructive/30 bg-card/90 backdrop-blur-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
              <XCircleIcon className="h-7 w-7 text-destructive" />
            </div>
            <CardTitle className="text-xl font-bold">Payment Not Found</CardTitle>
            <CardDescription>This payment link is invalid or has been removed.</CardDescription>
          </CardHeader>
        </Card>
      </CheckoutShell>
    );
  }

  // ─── Expired ───
  if (
    intent.status === "expired" ||
    (timer?.expired && step !== "submitting" && step !== "submitted")
  ) {
    return (
      <CheckoutShell>
        <Card className="w-full max-w-md border-muted bg-card/90 backdrop-blur-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
              <ClockIcon className="h-7 w-7 text-muted-foreground" />
            </div>
            <CardTitle className="text-xl font-bold">Payment Expired</CardTitle>
            <CardDescription>
              This payment link has expired. Please request a new one from the merchant.
            </CardDescription>
          </CardHeader>
        </Card>
      </CheckoutShell>
    );
  }

  // ─── Pending / Processing ───
  if (intent.anchor === "pdax" && intent.status !== "pending") {
    return (
      <CheckoutShell>
        <Card className="w-full max-w-md border border-white/10 bg-card/85 shadow-2xl backdrop-blur-lg">
          <CardHeader className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-amber-500/20 bg-amber-500/10">
              <AlertCircleIcon className="h-6 w-6 text-amber-500" />
            </div>
            <CardTitle className="text-xl font-bold">Checkout Unavailable</CardTitle>
            <CardDescription>
              This legacy PDAX checkout cannot accept a new Stellar transaction. Request a new
              in-house checkout from the merchant.
            </CardDescription>
          </CardHeader>
        </Card>
      </CheckoutShell>
    );
  }

  if (intent.status === "awaiting_route") {
    return (
      <CheckoutShell>
        <Card className="w-full max-w-md border border-white/10 bg-card/85 shadow-2xl backdrop-blur-lg">
          <CardHeader className="text-center">
            <CardTitle className="text-xl font-bold">Checkout Unavailable</CardTitle>
            <CardDescription>
              This payment route is unavailable. Request a new in-house checkout from the merchant.
            </CardDescription>
          </CardHeader>
        </Card>
      </CheckoutShell>
    );
  }

  if (intent.status === "pending") {
    return (
      <CheckoutShell>
        <Card className="w-full max-w-md animate-in border border-white/10 bg-card/85 shadow-2xl backdrop-blur-lg duration-300 zoom-in-95 fade-in">
          <CardHeader className="border-b border-border/50 pb-4 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-primary/20 bg-primary/10">
              <Spinner className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text text-xl font-bold">
              Payment Processing
            </CardTitle>
            <CardDescription className="mt-1 text-sm text-muted-foreground">
              We are verifying your transaction on the Stellar network.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pt-6">
            <div className="space-y-3 rounded-xl border border-border/50 bg-muted/20 p-4">
              <div className="flex items-center justify-between text-xs sm:text-sm">
                <span className="font-medium text-muted-foreground">Merchant</span>
                <span className="font-semibold text-zinc-950 dark:text-zinc-100">
                  {intent.merchantName}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs sm:text-sm">
                <span className="font-medium text-muted-foreground">Amount</span>
                <span className="font-semibold text-zinc-950 dark:text-zinc-100">
                  {Number.parseFloat(intent.amount).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 7,
                  })}{" "}
                  {formatAsset(intent.asset)}
                </span>
              </div>
              {intent.txHash && (
                <div className="flex flex-col gap-1 text-xs">
                  <span className="text-left font-medium text-muted-foreground">
                    Transaction Hash
                  </span>
                  <span className="rounded border border-border/30 bg-muted/40 p-2 font-mono text-[10px] break-all text-zinc-700 select-all dark:text-zinc-300">
                    {intent.txHash}
                  </span>
                </div>
              )}
            </div>
            <p className="text-center text-xs leading-relaxed text-muted-foreground">
              Please do not close this window or navigate away. This page will update automatically
              once confirmed.
            </p>
          </CardContent>
          <CardFooter className="justify-center border-t border-border/50 pt-4">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <ShieldCheckIcon className="h-3.5 w-3.5 animate-pulse text-green-500" />
              <span>Verifying transaction status...</span>
            </div>
          </CardFooter>
        </Card>
      </CheckoutShell>
    );
  }

  const isSubmitting = step === "submitting";
  const canPay =
    step === "review" &&
    wallet.status === "connected" &&
    !isSubmitting &&
    !timer?.expired &&
    intent.anchor !== "pdax" &&
    Boolean(intent.receiverAddress);
  const assetLabel = formatAsset(intent.asset);

  return (
    <CheckoutShell>
      <Card className="w-full max-w-md border border-white/10 bg-card/80 shadow-2xl backdrop-blur-lg">
        {/* Merchant header */}
        <CardHeader className="border-b border-border/50 pb-4 text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full border border-primary/20 bg-primary/10">
            <CreditCardIcon className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text text-xl font-bold">
            {intent.merchantName}
          </CardTitle>
          {intent.description && (
            <CardDescription className="mt-1 text-sm text-muted-foreground">
              {intent.description}
            </CardDescription>
          )}
        </CardHeader>

        <CardContent className="space-y-6 pt-6">
          {/* Amount display */}
          <div className="text-center">
            <p className="mb-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              Amount due
            </p>
            <p className="bg-gradient-to-b from-foreground to-foreground/90 bg-clip-text text-4xl font-extrabold tracking-tight">
              {Number.parseFloat(intent.amount).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 7,
              })}
            </p>
            <Badge
              variant="secondary"
              className="mt-2 rounded-full px-2.5 py-0.5 text-xs font-bold"
            >
              {assetLabel}
            </Badge>
          </div>

          {/* Expiry Timer */}
          {timer && !timer.expired && (
            <div className="mx-auto flex w-fit items-center justify-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-500">
              <ClockIcon className="h-3.5 w-3.5 animate-pulse" />
              <span>
                Expires in {timer.minutes}:{timer.seconds.toString().padStart(2, "0")}
              </span>
            </div>
          )}

          {/* Payment details */}
          <div className="space-y-3 rounded-xl border border-border/50 bg-muted/20 p-4">
            <div className="flex items-center justify-between text-xs sm:text-sm">
              <span className="font-medium text-muted-foreground">Network</span>
              <span className="font-semibold text-foreground">{stellarConfig.networkLabel}</span>
            </div>
            <div className="flex items-center justify-between text-xs sm:text-sm">
              <span className="font-medium text-muted-foreground">Asset</span>
              <span className="font-semibold text-foreground">{assetLabel}</span>
            </div>
            <div className="flex items-center justify-between text-xs sm:text-sm">
              <span className="font-medium text-muted-foreground">Recipient Address</span>
              <span className="rounded bg-muted/40 px-1.5 py-0.5 font-mono text-xs text-foreground">
                {intent.receiverAddress
                  ? `${intent.receiverAddress.slice(0, 6)}...${intent.receiverAddress.slice(-6)}`
                  : "Route unavailable"}
              </span>
            </div>
            {wallet.address && (
              <div className="flex items-center justify-between text-xs sm:text-sm">
                <span className="font-medium text-muted-foreground">Your Wallet</span>
                <span className="rounded bg-muted/40 px-1.5 py-0.5 font-mono text-xs text-foreground">
                  {wallet.address.slice(0, 6)}...{wallet.address.slice(-6)}
                </span>
              </div>
            )}
          </div>

          {/* Error display */}
          {error && (
            <Alert variant="destructive" className="border-destructive/30 bg-destructive/10">
              <AlertCircleIcon className="h-4 w-4" />
              <AlertTitle className="font-bold">Payment Error</AlertTitle>
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          )}

          {isOffline && (
            <Alert className="border-amber-500/30 bg-amber-500/10">
              <WifiOffIcon className="h-4 w-4" />
              <AlertTitle>Connection interrupted</AlertTitle>
              <AlertDescription className="text-xs">
                Checkout status will reconcile automatically when this device reconnects. Keep this
                page open and do not submit again until the authoritative status returns.
              </AlertDescription>
            </Alert>
          )}

          {/* Wallet connection / Pay button */}
          {wallet.status !== "connected" ? (
            <Button
              id="checkout-connect-wallet"
              className="h-12 w-full cursor-pointer rounded-xl bg-primary text-base font-bold text-primary-foreground shadow-lg transition-all duration-200 hover:bg-primary/90 hover:shadow-xl"
              onClick={wallet.connect}
              disabled={
                wallet.status === "connecting" ||
                wallet.status === "initializing" ||
                wallet.status === "stale"
              }
            >
              {wallet.status === "connecting" || wallet.status === "stale" ? (
                <>
                  <Spinner className="mr-2" />
                  {wallet.status === "stale" ? "Reconnecting Wallet..." : "Connecting Wallet..."}
                </>
              ) : (
                <>
                  <WalletIcon className="mr-2 h-5 w-5" />
                  Connect Stellar Wallet
                </>
              )}
            </Button>
          ) : (
            <Button
              id="checkout-pay-now"
              className="h-12 w-full cursor-pointer rounded-xl bg-primary text-base font-bold text-primary-foreground shadow-lg transition-all duration-200 hover:bg-primary/95 hover:shadow-xl"
              onClick={handlePay}
              disabled={!canPay}
            >
              {isSubmitting ? (
                <>
                  <Spinner className="mr-2 text-primary-foreground" />
                  Processing Payment...
                </>
              ) : (
                <>
                  <ShieldCheckIcon className="mr-2 h-5 w-5" />
                  Pay {formatAmount(intent.amount, intent.asset)}
                </>
              )}
            </Button>
          )}
        </CardContent>

        {/* Footer with immediate cancel option */}
        <CardFooter className="flex-col gap-3 border-t border-border/50 pt-4">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <ShieldCheckIcon className="h-3.5 w-3.5 text-green-500" />
            <span>Secured by Velo Pay</span>
          </div>
          <button
            onClick={handleCancelClick}
            className="cursor-pointer text-xs text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
          >
            Cancel and return to merchant
          </button>
        </CardFooter>
      </Card>
    </CheckoutShell>
  );
}

function CheckoutShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      id="velo-checkout-root"
      data-velo-checkout-root="true"
      className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background/95 to-slate-900/50 p-4"
    >
      <div className="w-full max-w-md animate-in duration-500 fade-in slide-in-from-bottom-6">
        {children}
      </div>
    </div>
  );
}

function CheckoutSkeleton() {
  return (
    <CheckoutShell>
      <Card className="w-full max-w-md border border-border/50 bg-card/85">
        <CardHeader className="text-center">
          <Skeleton className="mx-auto h-12 w-12 rounded-full" />
          <Skeleton className="mx-auto mt-3 h-6 w-36" />
          <Skeleton className="mx-auto mt-2 h-4 w-48" />
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2 text-center">
            <Skeleton className="mx-auto h-10 w-36" />
            <Skeleton className="mx-auto h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
        </CardContent>
      </Card>
    </CheckoutShell>
  );
}
