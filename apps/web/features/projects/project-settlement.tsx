"use client";

import { Alert, AlertDescription, AlertTitle } from "@repo/ui/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/ui/card";
import { InfoIcon } from "lucide-react";

export function ProjectSettlement({ projectId }: { projectId: string }) {
  void projectId;

  return (
    <section className="mx-auto grid w-full max-w-3xl gap-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Settlement</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Provider-neutral settlement settings for this project.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Settlement integration unavailable</CardTitle>
          <CardDescription>
            Integration with a new payment provider for the Philippines is currently underway.
            Settlement is not available yet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <InfoIcon />
            <AlertTitle>In-house Stellar checkout remains available</AlertTitle>
            <AlertDescription>
              In-house payments continue to use Stellar ledger verification and merchant webhooks.
              Existing settlement history remains stored for authorized project owners. The new
              provider integration is not available yet.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </section>
  );
}
