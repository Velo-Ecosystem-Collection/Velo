"use client";

import { api } from "@repo/backend/convex/_generated/api";
import { Alert, AlertDescription, AlertTitle } from "@repo/ui/components/ui/alert";
import { Button } from "@repo/ui/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@repo/ui/components/ui/card";
import { useMutation, useQuery } from "convex/react";
import { AlertCircleIcon, CheckCircle2Icon, InfoIcon } from "lucide-react";
import { useState } from "react";

import type { Id } from "@repo/backend/convex/_generated/dataModel";

import { formatStroopsAsXlm, MAX_ALLOWED_CONTRACT_IDS } from "./gas-ui";

export function GasManagedActivation({ projectId }: { projectId: Id<"projects"> }) {
  const review = useQuery(api.gas.queries.getManagedActivationReview, { projectId });
  const activate = useMutation(api.gas.mutations.activateManagedSponsorship);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const unallowlistedContractIds = review
    ? review.activeContractIds.filter(
        (contractId) => !review.allowedContractIds.includes(contractId),
      )
    : [];
  const allowlistWouldExceedLimit = review
    ? new Set([...review.allowedContractIds, ...review.activeContractIds]).size >
      MAX_ALLOWED_CONTRACT_IDS
    : false;

  async function handleActivate() {
    if (
      !review ||
      review.activeContractIds.length === 0 ||
      busy ||
      (review.policyEnabled && unallowlistedContractIds.length === 0)
    ) {
      return;
    }
    const updatingExistingPolicy = review.policyEnabled;
    setBusy(true);
    setMessage(null);
    setFailed(false);
    try {
      await activate({ projectId });
      setMessage(
        updatingExistingPolicy
          ? "The active linked contracts were added to the sponsorship allowlist. Existing allowed contracts were preserved."
          : "Sponsorship is enabled with the reviewed limits and active linked contracts.",
      );
    } catch {
      setFailed(true);
      setMessage("The sponsorship settings were not applied. Refresh the review and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <h3 className="text-base font-semibold">Review sponsorship settings</h3>
        <CardDescription>
          Review the Testnet limits and linked contracts. Enabling or syncing adds linked contracts
          to the saved allowlist; remove addresses in Policy controls to revoke them.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {review === undefined ? (
          <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
            Loading activation review…
          </p>
        ) : (
          <>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1">
                <dt className="text-xs text-muted-foreground">Daily sponsorship cap</dt>
                <dd className="font-medium">{formatStroopsAsXlm(review.dailyCapStroops)}</dd>
              </div>
              <div className="grid gap-1">
                <dt className="text-xs text-muted-foreground">Per-wallet limit</dt>
                <dd className="font-medium">{review.walletHourlyLimit} requests per UTC hour</dd>
              </div>
            </dl>
            <div className="grid gap-2">
              <p className="text-sm font-medium">
                Active linked contracts ({review.activeContractIds.length})
              </p>
              {review.activeContractIds.length > 0 ? (
                <ul className="grid gap-1">
                  {review.activeContractIds.map((contractId) => (
                    <li key={contractId}>
                      <code className="font-mono text-xs break-all">{contractId}</code>
                    </li>
                  ))}
                </ul>
              ) : (
                <Alert>
                  <InfoIcon />
                  <AlertTitle>No active contracts are linked</AlertTitle>
                  <AlertDescription>
                    Sponsorship remains disabled until an owner links an active contract.
                  </AlertDescription>
                </Alert>
              )}
            </div>
            {review.policyEnabled ? (
              <Alert>
                <CheckCircle2Icon />
                <AlertTitle>Sponsorship is enabled</AlertTitle>
                <AlertDescription>
                  {unallowlistedContractIds.length > 0
                    ? `${unallowlistedContractIds.length} active linked contract(s) are missing from the saved allowlist.`
                    : "All active linked contracts are in the saved allowlist."}{" "}
                  You can pause sponsorship from the managed relayer controls.
                </AlertDescription>
              </Alert>
            ) : null}
            {allowlistWouldExceedLimit ? (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertTitle>Allowlist limit reached</AlertTitle>
                <AlertDescription>
                  The policy supports up to {MAX_ALLOWED_CONTRACT_IDS} contracts. Remove manually
                  allowed IDs in Policy controls before syncing the linked contracts.
                </AlertDescription>
              </Alert>
            ) : null}
            {review.policyEnabled && unallowlistedContractIds.length > 0 ? (
              <Button
                type="button"
                onClick={() => void handleActivate()}
                disabled={busy || allowlistWouldExceedLimit}
              >
                {busy ? "Updating allowlist…" : "Update sponsorship allowlist"}
              </Button>
            ) : !review.policyEnabled && review.activeContractIds.length > 0 ? (
              <Button
                type="button"
                onClick={() => void handleActivate()}
                disabled={busy || allowlistWouldExceedLimit}
              >
                {busy ? "Enabling sponsorship…" : "Enable sponsorship with these settings"}
              </Button>
            ) : null}
          </>
        )}
        {message ? (
          <Alert variant={failed ? "destructive" : undefined} aria-live="polite">
            {failed ? <AlertCircleIcon /> : <CheckCircle2Icon />}
            <AlertTitle>Activation status</AlertTitle>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}
