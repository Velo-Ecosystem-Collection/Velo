"use client";

import { api } from "@repo/backend/convex/_generated/api";
import { Badge } from "@repo/ui/components/ui-customs/badge";
import { Alert, AlertDescription, AlertTitle } from "@repo/ui/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader } from "@repo/ui/components/ui/card";
import { Skeleton } from "@repo/ui/components/ui/skeleton";
import { useQuery } from "convex/react";
import { AlertCircleIcon, InfoIcon } from "lucide-react";

import type { Id } from "@repo/backend/convex/_generated/dataModel";

import { GasRelayerWithdrawal } from "./gas-relayer-withdrawal";
import { formatStroopsAsXlm, isValidGasRelayerTimestamp } from "./gas-ui";

export function ProjectGasFunds({ projectId }: { projectId: string }) {
  const typedProjectId = projectId as Id<"projects">;
  const funds = useQuery(api.gas.queries.getRelayerFundsForOwner, { projectId: typedProjectId });

  if (funds === undefined) {
    return (
      <section className="grid gap-4" aria-busy="true">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-48 w-full" />
      </section>
    );
  }

  return (
    <section className="grid gap-5" aria-labelledby="gas-funds-title">
      <header className="grid gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 id="gas-funds-title" className="text-3xl font-semibold tracking-normal">
            Relayer funds
          </h1>
          {funds.retired ? <Badge variant="gray">Retired project</Badge> : null}
        </div>
        <p className="text-sm text-muted-foreground">
          Owner access to the Testnet relayer account for {funds.projectName}.
        </p>
      </header>
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Testnet account</h2>
          <CardDescription>
            Withdrawal access remains available after project retirement. A completed withdrawal
            leaves sponsorship paused.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {funds.publicKey ? (
            <>
              <dl className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1 sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">Relayer address</dt>
                  <dd className="font-mono text-xs break-all">{funds.publicKey}</dd>
                </div>
                <div className="grid gap-1">
                  <dt className="text-xs text-muted-foreground">Observed native XLM balance</dt>
                  <dd className="font-medium">
                    {funds.balanceStroops === null
                      ? "Not verified"
                      : `${formatStroopsAsXlm(funds.balanceStroops)} XLM`}
                  </dd>
                </div>
                <div className="grid gap-1">
                  <dt className="text-xs text-muted-foreground">Last verification</dt>
                  <dd>
                    {funds.balanceUpdatedAt === null ||
                    !isValidGasRelayerTimestamp(funds.balanceUpdatedAt)
                      ? "Unavailable"
                      : new Date(funds.balanceUpdatedAt).toLocaleString()}
                  </dd>
                </div>
              </dl>
              {funds.managed ? (
                <>
                  <Alert>
                    <InfoIcon />
                    <AlertTitle>Velo managed Testnet custody</AlertTitle>
                    <AlertDescription>
                      Velo can decrypt this signer inside its trusted backend. Withdrawal remains
                      owner authorized and is limited to your authenticated wallet.
                    </AlertDescription>
                  </Alert>
                  <GasRelayerWithdrawal projectId={typedProjectId} />
                </>
              ) : (
                <Alert>
                  <AlertCircleIcon />
                  <AlertTitle>Manually configured relayer</AlertTitle>
                  <AlertDescription>
                    This address has no Velo custody record. Use the wallet that controls its signer
                    to move funds.
                  </AlertDescription>
                </Alert>
              )}
            </>
          ) : (
            <Alert>
              <AlertCircleIcon />
              <AlertTitle>No relayer account is available</AlertTitle>
              <AlertDescription>
                No Testnet relayer address is attached to this project. Encrypted custody records
                are retained; an operator can restore access if the account was provisioned.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
