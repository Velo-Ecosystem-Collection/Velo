"use client";

import { api } from "@repo/backend/convex/_generated/api";
import { Badge } from "@repo/ui/components/ui-customs/badge";
import { Alert, AlertDescription, AlertTitle } from "@repo/ui/components/ui/alert";
import { Button } from "@repo/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/ui/card";
import { useQuery } from "convex/react";
import { AlertCircleIcon, PlayIcon } from "lucide-react";
import Link from "next/link";

import type { PlaygroundShareSnapshotV1 } from "@repo/stellar";

export function SharedPlaygroundRequest({ token }: { token: string }) {
  const share = useQuery(api.playground_projects.queries.getPublicShare, { token });

  if (share === undefined) {
    return <p className="text-sm text-muted-foreground">Loading shared request…</p>;
  }
  if (share === null) {
    return (
      <Alert variant="destructive">
        <AlertCircleIcon />
        <AlertTitle>Share unavailable</AlertTitle>
        <AlertDescription>This link is invalid, revoked, or expired.</AlertDescription>
      </Alert>
    );
  }

  const snapshot = share.snapshot as PlaygroundShareSnapshotV1;
  const query = new URLSearchParams({
    network: snapshot.network,
    contractId: snapshot.contractId,
  });

  return (
    <section className="grid gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-3xl font-semibold">Shared Playground request</h1>
        <Badge variant="info">Read-only snapshot</Badge>
        <Badge variant={snapshot.network === "mainnet" ? "warning" : "gray"}>
          {snapshot.network}
        </Badge>
      </div>
      <Alert>
        <AlertCircleIcon />
        <AlertTitle>Fresh simulation required</AlertTitle>
        <AlertDescription>
          This immutable snapshot cannot be invoked directly. Load the current contract, review any
          Wasm change, and simulate again before signing.
        </AlertDescription>
      </Alert>
      <Card>
        <CardHeader>
          <CardTitle className="font-mono">{snapshot.functionName}</CardTitle>
          <CardDescription className="font-mono break-all">{snapshot.contractId}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Snapshot Wasm hash</p>
            <code className="break-all">{snapshot.wasmHash}</code>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Arguments</p>
            {share.includeArguments && snapshot.argumentTemplate ? (
              <pre className="max-h-72 overflow-auto bg-zinc-950 p-3 text-xs text-zinc-100">
                {JSON.stringify(snapshot.argumentTemplate, null, 2)}
              </pre>
            ) : (
              <p>Arguments were excluded by the sender.</p>
            )}
          </div>
          <Button asChild className="w-fit">
            <Link href={`/playground?${query.toString()}`}>
              <PlayIcon /> Load and re-simulate
            </Link>
          </Button>
          {share.expiresAt ? (
            <p className="text-xs text-muted-foreground">
              Expires {new Date(share.expiresAt).toLocaleString()}.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
