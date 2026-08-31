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
import { AlertCircleIcon, ArrowLeftIcon, ClockIcon } from "lucide-react";
import Link from "next/link";

import type { Id } from "@repo/backend/convex/_generated/dataModel";

export function ProjectPlaygroundLog({
  projectId,
  journeyCorrelationId,
}: {
  projectId: string;
  journeyCorrelationId: string;
}) {
  const log = useQuery(api.playground_projects.queries.getLog, {
    projectId: projectId as Id<"projects">,
    journeyCorrelationId,
  });

  if (log === undefined) {
    return <p className="text-sm text-muted-foreground">Loading correlated evidence…</p>;
  }

  return (
    <section className="grid gap-6">
      <div>
        <Button asChild variant="ghost" className="mb-3">
          <Link href={`/projects/${projectId}/playground`}>
            <ArrowLeftIcon /> Project Playground
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-semibold">Velo Logs</h1>
          <Badge variant="info">30-day retention</Badge>
        </div>
        <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
          {journeyCorrelationId}
        </p>
      </div>

      {log === null ? (
        <Alert>
          <ClockIcon />
          <AlertTitle>Evidence unavailable</AlertTitle>
          <AlertDescription>
            This correlation chain is missing, expired, or belongs to another project.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Execution timeline</CardTitle>
              <CardDescription>
                Sanitized project evidence. Signatures, XDR, authorization payloads, and raw RPC
                bodies are never stored here.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {log.executions.map((execution) => (
                <div key={execution._id} className="grid gap-2 rounded-lg border p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={execution.status === "success" ? "success" : "gray"}>
                      {execution.status}
                    </Badge>
                    <span className="font-medium">{execution.kind}</span>
                    <span className="text-sm text-muted-foreground">
                      {new Date(execution.startedAt).toLocaleString()}
                    </span>
                  </div>
                  <dl className="grid gap-2 text-sm sm:grid-cols-2">
                    <LogValue label="Network" value={execution.network} />
                    <LogValue label="Function" value={execution.functionName} />
                    <LogValue label="Contract" value={execution.contractId} />
                    <LogValue label="Source account" value={execution.sourceAccount} />
                    <LogValue label="Transaction" value={execution.transactionHash ?? "—"} />
                    <LogValue label="Fee" value={execution.fee ?? "—"} />
                    <LogValue label="Wasm hash" value={execution.wasmHash} />
                    <LogValue label="Request ID" value={execution.requestCorrelationId} />
                  </dl>
                  {execution.eventSummaries?.length ? (
                    <div className="grid gap-2">
                      <p className="text-sm font-medium">Emitted events</p>
                      {execution.eventSummaries.map((event, index) => (
                        <div
                          key={`${execution._id}-${index}`}
                          className="flex flex-wrap items-center gap-2 rounded-md bg-muted/30 p-2 text-xs"
                        >
                          <code className="min-w-0 flex-1 break-all">{JSON.stringify(event)}</code>
                          <Button size="sm" variant="outline" asChild>
                            <Link
                              href={`/projects/${projectId}/webhooks?sourceExecutionId=${execution._id}&eventIndex=${index}`}
                            >
                              Create webhook filter
                            </Link>
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Journey stages</CardTitle>
                <CardDescription>
                  Available lifecycle stages; missing or expired stages are reported explicitly.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                {log.stages.length ? (
                  log.stages.map((stage) => (
                    <div
                      key={stage._id}
                      className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm"
                    >
                      <Badge variant={stage.outcome === "success" ? "success" : "gray"}>
                        {stage.outcome}
                      </Badge>
                      <span className="font-medium">{stage.name}</span>
                      <span className="text-muted-foreground">
                        {new Date(stage.at).toLocaleString()}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No retained RPC or delivery stages are available for this journey.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Observed contract events</CardTitle>
                <CardDescription>
                  Project-owned events matched through the invocation transaction hash.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                {log.events.length ? (
                  log.events.map((event) => (
                    <div key={event._id} className="grid gap-1 rounded-md border p-3 text-xs">
                      <code className="break-all">{event.contractId}</code>
                      <span>
                        Ledger {event.ledger} · {event.topic}
                      </span>
                      <code className="break-all">{JSON.stringify(event.topics)}</code>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No retained contract event is associated with this transaction.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Webhook deliveries</CardTitle>
              <CardDescription>Delivery evidence sharing this journey identifier.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {log.deliveries.length ? (
                log.deliveries.map((delivery) => (
                  <div key={delivery._id} className="flex flex-wrap items-center gap-2 border p-3">
                    <Badge variant={delivery.status === "success" ? "success" : "gray"}>
                      {delivery.status}
                    </Badge>
                    <span>{delivery.eventType}</span>
                    <span className="text-sm text-muted-foreground">
                      {delivery.destinationHost} · {delivery.attemptCount} attempt(s)
                    </span>
                  </div>
                ))
              ) : (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <AlertCircleIcon className="size-4" /> No correlated webhook delivery recorded.
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </section>
  );
}

function LogValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono break-all">{value}</dd>
    </div>
  );
}
