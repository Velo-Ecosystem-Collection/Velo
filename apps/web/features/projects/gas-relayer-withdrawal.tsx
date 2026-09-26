"use client";

import { useWallet } from "@/core/wallet/wallet-provider";
import { api } from "@repo/backend/convex/_generated/api";
import { Alert, AlertDescription, AlertTitle } from "@repo/ui/components/ui/alert";
import { Button } from "@repo/ui/components/ui/button";
import { Input } from "@repo/ui/components/ui/input";
import { Label } from "@repo/ui/components/ui/label";
import { useAction, useQuery } from "convex/react";
import { AlertCircleIcon, CheckCircle2Icon, InfoIcon, WalletIcon } from "lucide-react";
import { useState } from "react";

import type { Id } from "@repo/backend/convex/_generated/dataModel";

import { formatStroopsAsXlm, parseXlmToStroops } from "./gas-ui";

type GasRelayerWithdrawalProps = {
  projectId: Id<"projects">;
};

function withdrawalMessage(status: string): string {
  switch (status) {
    case "prepared":
      return "Review and sign the owner consent in your wallet. The consent transaction is never submitted to Stellar.";
    case "waiting_exposure":
      return "Sponsorship is paused. The withdrawal will wait until outstanding Gas commitments and uncertain executions resolve.";
    case "verified":
      return "The withdrawal is verified on Stellar Testnet. Sponsorship remains paused until you resume it.";
    case "submission_unknown":
      return "The payment result is uncertain. Check the original transaction hash; Velo will only recover using that exact transaction.";
    case "failed":
      return "The withdrawal was included but failed. Sponsorship remains paused; prepare a new owner consent after reviewing the account.";
    case "insufficient_available_balance":
      return "The relayer does not have enough spendable XLM after its reserve, liabilities, Gas commitments, and withdrawal fee.";
    case "expired":
      return "This withdrawal consent expired. Prepare a new withdrawal and sign a fresh consent.";
    case "maintenance_active":
      return "Another account maintenance operation is active for this project.";
    case "managed_relayer_required":
      return "Only a Velo managed relayer can be withdrawn through this console.";
    case "unauthorized":
      return "Only the authenticated project owner can prepare or confirm a withdrawal.";
    default:
      return "The withdrawal could not be completed. Review its status before taking another action.";
  }
}

export function GasRelayerWithdrawal({ projectId }: GasRelayerWithdrawalProps) {
  const wallet = useWallet();
  const prepare = useAction(api.gas.balance_action.prepareRelayerWithdrawal);
  const confirm = useAction(api.gas.balance_action.confirmRelayerWithdrawal);
  const continueWithdrawal = useAction(api.gas.balance_action.continueRelayerWithdrawal);
  const cancel = useAction(api.gas.balance_action.cancelRelayerWithdrawal);
  const [amount, setAmount] = useState("10");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [consentXdr, setConsentXdr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const status = useQuery(
    api.gas.queries.getWithdrawalStatus,
    requestId ? { projectId, requestId } : "skip",
  );

  async function handlePrepare() {
    if (!wallet.address || busy) {
      setMessage("Connect the project owner wallet before preparing a withdrawal.");
      return;
    }
    let amountStroops: string;
    try {
      amountStroops = parseXlmToStroops(amount);
      if (amountStroops === "0") throw new Error("positive amount required");
    } catch {
      setMessage("Enter a positive XLM amount with up to seven decimal places.");
      return;
    }
    setBusy(true);
    setMessage("Preparing an expiring owner consent for this exact Testnet withdrawal.");
    setConsentXdr(null);
    try {
      const result = await prepare({ projectId, amountStroops });
      if (result.status !== "prepared") {
        setMessage(withdrawalMessage(result.status));
        return;
      }
      setRequestId(result.requestId);
      setConsentXdr(result.transactionXdr);
      setMessage(
        `Review a withdrawal of ${formatStroopsAsXlm(result.amountStroops)} XLM from ${result.relayerPublicKey} to your owner wallet ${result.ownerWallet}. Consent expires ${new Date(result.expiresAt).toLocaleString()}.`,
      );
    } catch {
      setMessage(withdrawalMessage("dependency_unavailable"));
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm() {
    if (!consentXdr || !requestId || busy) return;
    setBusy(true);
    try {
      const signedConsent = await wallet.signTransaction(consentXdr);
      setConsentXdr(null);
      const outcome = await confirm({
        projectId,
        requestId,
        consentTransactionXdr: signedConsent,
      });
      setMessage(withdrawalMessage(outcome.status));
    } catch {
      setMessage(
        "Wallet consent or withdrawal confirmation did not complete. Check the stored status before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleContinue() {
    if (!requestId || busy) return;
    setBusy(true);
    try {
      const outcome = await continueWithdrawal({ projectId, requestId });
      setMessage(withdrawalMessage(outcome.status));
    } catch {
      setMessage(withdrawalMessage("dependency_unavailable"));
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (!requestId || busy) return;
    setBusy(true);
    try {
      const result = await cancel({ projectId, requestId });
      setMessage(
        result === "cancelled"
          ? "The unsent withdrawal was cancelled. Sponsorship remains paused."
          : "This withdrawal can no longer be cancelled safely.",
      );
      setConsentXdr(null);
    } catch {
      setMessage(
        "The withdrawal could not be cancelled. Refresh its status before taking another action.",
      );
    } finally {
      setBusy(false);
    }
  }

  const canContinue =
    status?.status === "waiting_exposure" ||
    status?.status === "ready_to_send" ||
    status?.status === "sending" ||
    status?.status === "submission_unknown";
  const canCancel =
    status !== undefined &&
    status !== null &&
    status.transactionHash === null &&
    ["prepared", "waiting_exposure", "ready_to_send"].includes(status.status);

  return (
    <div className="grid gap-3 rounded-lg border border-border/70 p-4">
      <div className="grid gap-1">
        <h3 className="text-sm font-semibold">Withdraw to owner wallet</h3>
        <p className="text-sm text-muted-foreground">
          Withdrawals go only to the authenticated project owner wallet. Velo pauses sponsorship,
          waits for Gas commitments, and preserves the Stellar account reserve and network fee.
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`gas-withdrawal-amount-${projectId}`}>Amount (XLM)</Label>
        <Input
          id={`gas-withdrawal-amount-${projectId}`}
          inputMode="decimal"
          type="text"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          disabled={busy}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => void handlePrepare()}
          disabled={busy}
        >
          {busy && !consentXdr ? "Preparing…" : "Prepare withdrawal"}
        </Button>
        {consentXdr ? (
          <Button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={busy || !wallet.address}
          >
            <WalletIcon />
            {busy ? "Waiting for wallet…" : "Review and authorize"}
          </Button>
        ) : null}
        {requestId && canContinue ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleContinue()}
            disabled={busy}
          >
            {status?.status === "submission_unknown" || status?.status === "sending"
              ? "Check original transaction"
              : "Check and continue withdrawal"}
          </Button>
        ) : null}
        {requestId && canCancel ? (
          <Button
            type="button"
            variant="destructive"
            onClick={() => void handleCancel()}
            disabled={busy}
          >
            Cancel unsent withdrawal
          </Button>
        ) : null}
      </div>
      {message ? (
        <Alert aria-live="polite">
          {status?.status === "verified" ? (
            <CheckCircle2Icon />
          ) : status?.status === "failed" ? (
            <AlertCircleIcon />
          ) : (
            <InfoIcon />
          )}
          <AlertTitle>Withdrawal status</AlertTitle>
          <AlertDescription>
            <p>{message}</p>
            {status?.errorCode === "insufficient_available_balance" ? (
              <p className="mt-1">
                Available after reserves and fee:{" "}
                {formatStroopsAsXlm(status.availableBalanceStroops ?? "0")} XLM. Refresh the account
                balance or cancel this withdrawal.
              </p>
            ) : null}
            {status?.transactionHash ? (
              <p className="mt-1 font-mono text-xs break-all">
                Transaction: {status.transactionHash}
              </p>
            ) : null}
            {status?.verifiedLedger !== null && status?.verifiedLedger !== undefined ? (
              <p className="mt-1">Verified at ledger {status.verifiedLedger}.</p>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
