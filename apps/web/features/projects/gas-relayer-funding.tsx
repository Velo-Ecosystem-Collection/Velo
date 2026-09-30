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

import { formatStroopsAsXlm, parseXlmToStroops, type GasPolicyRole } from "./gas-ui";

type GasRelayerFundingProps = {
  projectId: Id<"projects">;
  role: GasPolicyRole;
};

function resultMessage(status: string): string {
  switch (status) {
    case "verified":
      return "Funding is verified on Stellar Testnet.";
    case "already_verified":
      return "This exact funding transaction was already verified.";
    case "submission_unknown":
      return "The result is uncertain. Check the original transaction hash; retry only with the same signed transaction.";
    case "failed":
      return "The transaction was not confirmed. Prepare a new funding transaction after checking the wallet balance.";
    case "invalid_signature":
      return "The wallet signature could not be verified for this funding transaction.";
    case "intent_mismatch":
      return "The signed transaction does not match the prepared amount and destination.";
    case "expired":
      return "This funding preparation expired. Prepare a new transaction.";
    case "relayer_changed":
      return "The relayer changed after preparation. Refresh the page before funding.";
    case "source_account_not_found":
      return "The connected owner wallet needs Testnet XLM before it can fund the relayer.";
    case "invalid_amount":
      return "Enter a valid positive amount. Creating a new Stellar account requires at least 1 XLM.";
    case "missing_relayer":
      return "The project has no relayer address to fund yet.";
    case "relayer_disabled":
      return "The relayer is paused. Resume it before funding.";
    case "unauthorized":
      return "Only the authenticated project owner can fund this relayer.";
    default:
      return "Funding could not be completed. The relayer balance was not changed by this page.";
  }
}

export function GasRelayerFunding({ projectId, role }: GasRelayerFundingProps) {
  const wallet = useWallet();
  const prepareFunding = useAction(api.gas.balance_action.prepareRelayerFunding);
  const submitFunding = useAction(api.gas.balance_action.submitRelayerFunding);
  const requestFaucet = useAction(api.gas.balance_action.requestTestnetRelayerFunds);
  const checkFaucet = useAction(api.gas.balance_action.checkTestnetRelayerFunds);
  const [amount, setAmount] = useState("10");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [unsignedXdr, setUnsignedXdr] = useState<string | null>(null);
  const [signedXdr, setSignedXdr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [faucetRequestId, setFaucetRequestId] = useState<string | null>(null);
  const [faucetBusy, setFaucetBusy] = useState(false);
  const [faucetMessage, setFaucetMessage] = useState<string | null>(null);
  const faucetStatus = useQuery(
    api.gas.queries.getFaucetStatus,
    role === "owner" && faucetRequestId ? { projectId, requestId: faucetRequestId } : "skip",
  );
  const status = useQuery(
    api.gas.queries.getFundingStatus,
    role === "owner" && requestId ? { projectId, requestId } : "skip",
  );

  async function handlePrepare() {
    if (role !== "owner" || busy || !wallet.address) {
      setMessage("Connect the project owner wallet to prepare funding.");
      return;
    }
    let amountStroops: string;
    try {
      amountStroops = parseXlmToStroops(amount);
      if (amountStroops === "0") throw new Error("Amount must be positive");
    } catch {
      setMessage("Enter a valid positive XLM amount with up to seven decimal places.");
      return;
    }

    setBusy(true);
    setMessage("Preparing a Testnet transaction for the current relayer address.");
    setRequestId(null);
    setUnsignedXdr(null);
    setSignedXdr(null);
    try {
      const result = await prepareFunding({ projectId, amountStroops });
      if (result.status !== "prepared") {
        setMessage(resultMessage(result.status));
        return;
      }
      setRequestId(result.requestId);
      setUnsignedXdr(result.transactionXdr);
      setMessage(
        `${result.operation === "create_account" ? "Create the Testnet relayer account" : "Send native XLM to the existing relayer"} for ${formatStroopsAsXlm(result.amountStroops)}. Review the destination in your wallet before signing.`,
      );
    } catch {
      setMessage(resultMessage("dependency_unavailable"));
    } finally {
      setBusy(false);
    }
  }

  async function submitSignedFunding(signedTransactionXdr: string) {
    if (!requestId) return;
    const result = await submitFunding({
      projectId,
      requestId,
      transactionXdr: signedTransactionXdr,
    });
    setMessage(resultMessage(result.status));
    if (
      result.status === "verified" ||
      result.status === "already_verified" ||
      result.status === "failed"
    ) {
      setSignedXdr(null);
      setUnsignedXdr(null);
    }
  }

  async function handleSignAndSubmit() {
    if (!unsignedXdr || role !== "owner" || busy) return;
    setBusy(true);
    try {
      const signed = await wallet.signTransaction(unsignedXdr);
      setSignedXdr(signed);
      setUnsignedXdr(null);
      await submitSignedFunding(signed);
    } catch {
      setMessage(
        "Wallet signing or Testnet submission did not complete. Review the transaction and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleRetrySameTransaction() {
    if (!signedXdr || busy) return;
    setBusy(true);
    try {
      await submitSignedFunding(signedXdr);
    } catch {
      setMessage(resultMessage("submission_unknown"));
    } finally {
      setBusy(false);
    }
  }

  function faucetResultMessage(status: string): string {
    switch (status) {
      case "funded":
        return "Testnet funds are visible in the relayer account.";
      case "account_exists":
        return "The relayer account already exists. Use wallet funding to add more XLM.";
      case "uncertain":
        return "The faucet response was uncertain. Check the account state before any further request.";
      case "cooldown":
        return "The project faucet request is cooling down. Check the displayed request status.";
      case "in_progress":
        return "A faucet request is already being checked.";
      case "missing_relayer":
        return "Provision a relayer before requesting Testnet funds.";
      case "unauthorized":
        return "Only the authenticated project owner can request Testnet funds.";
      default:
        return "The Testnet faucet could not be checked. No second request was sent.";
    }
  }

  async function handleFaucetRequest(checkOnly = false) {
    if (role !== "owner" || faucetBusy) return;
    if (checkOnly && !faucetRequestId) return;
    setFaucetBusy(true);
    setFaucetMessage(null);
    try {
      const outcome = checkOnly
        ? await checkFaucet({ projectId, requestId: faucetRequestId! })
        : await requestFaucet({ projectId });
      if ("requestId" in outcome) setFaucetRequestId(outcome.requestId);
      setFaucetMessage(faucetResultMessage(outcome.status));
    } catch {
      setFaucetMessage(faucetResultMessage("dependency_unavailable"));
    } finally {
      setFaucetBusy(false);
    }
  }

  if (role !== "owner") {
    return (
      <Alert>
        <InfoIcon />
        <AlertTitle>Owner funding controls</AlertTitle>
        <AlertDescription>
          Only the project owner can prepare and sign a relayer funding transaction. The public
          address and verified balance remain visible to project members.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="grid gap-3 rounded-lg border border-border/70 p-4">
      <div className="grid gap-1">
        <h3 className="text-sm font-semibold">Fund with wallet</h3>
        <p className="text-sm text-muted-foreground">
          Funding creates the account when it is absent or sends native XLM when it already exists.
          Your wallet signs the exact prepared Testnet transaction.
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`gas-funding-amount-${projectId}`}>Amount (XLM)</Label>
        <Input
          id={`gas-funding-amount-${projectId}`}
          inputMode="decimal"
          type="text"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          disabled={busy}
          aria-describedby={`gas-funding-help-${projectId}`}
        />
        <p id={`gas-funding-help-${projectId}`} className="text-xs text-muted-foreground">
          Account creation requires at least 1 XLM. The owner wallet pays the network fee.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => void handlePrepare()}
          disabled={busy || !wallet.address}
        >
          {busy && !unsignedXdr && !signedXdr ? "Preparing…" : "Prepare funding"}
        </Button>
        {unsignedXdr ? (
          <Button type="button" onClick={() => void handleSignAndSubmit()} disabled={busy}>
            <WalletIcon />
            {busy ? "Waiting for wallet…" : "Sign and fund"}
          </Button>
        ) : null}
        {signedXdr && status?.status === "submission_unknown" ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleRetrySameTransaction()}
            disabled={busy}
          >
            Retry same transaction
          </Button>
        ) : null}
      </div>
      <div className="grid gap-2 border-t border-border/70 pt-3">
        <div className="grid gap-1">
          <h4 className="text-sm font-semibold">Get Testnet funds</h4>
          <p className="text-xs text-muted-foreground">
            Requests funds from Stellar&apos;s fixed Testnet Friendbot endpoint. The project can
            make one request every 24 hours. Velo checks the account after uncertain responses
            before allowing another request.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleFaucetRequest()}
            disabled={faucetBusy}
          >
            {faucetBusy ? "Checking faucet…" : "Get Testnet funds"}
          </Button>
          {faucetRequestId &&
          (faucetStatus?.status === "uncertain" || faucetStatus?.status === "pending") ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleFaucetRequest(true)}
              disabled={faucetBusy}
            >
              Check account again
            </Button>
          ) : null}
        </div>
        {faucetMessage ? (
          <Alert aria-live="polite">
            {faucetStatus?.status === "funded" || faucetStatus?.status === "account_exists" ? (
              <CheckCircle2Icon />
            ) : (
              <InfoIcon />
            )}
            <AlertTitle>Testnet faucet status</AlertTitle>
            <AlertDescription>
              <p>{faucetMessage}</p>
              {faucetStatus ? (
                <p className="mt-1 text-xs">
                  {faucetStatus.status.replaceAll("_", " ")}. Cooldown ends{" "}
                  {new Date(faucetStatus.cooldownUntil).toLocaleString()}.
                </p>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}
      </div>
      {message ? (
        <Alert variant={status?.status === "failed" ? "destructive" : undefined}>
          {status?.status === "verified" ? <CheckCircle2Icon /> : <AlertCircleIcon />}
          <AlertTitle>Funding status</AlertTitle>
          <AlertDescription>
            <p>{message}</p>
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
