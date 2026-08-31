"use client";

import { shortenAddress } from "@/core/wallet/format";
import { useWallet } from "@/core/wallet/wallet-provider";
import { api } from "@repo/backend/convex/_generated/api";
import { Badge } from "@repo/ui/components/ui-customs/badge";
import { Alert, AlertDescription, AlertTitle } from "@repo/ui/components/ui/alert";
import { Button } from "@repo/ui/components/ui/button";
import { Checkbox } from "@repo/ui/components/ui/checkbox";
import { Input } from "@repo/ui/components/ui/input";
import { Label } from "@repo/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@repo/ui/components/ui/sheet";
import { Skeleton } from "@repo/ui/components/ui/skeleton";
import { Switch } from "@repo/ui/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/ui/table";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  CheckIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  FlaskConicalIcon,
  LoaderCircleIcon,
  LockKeyholeIcon,
  RefreshCwIcon,
  SaveIcon,
  SendIcon,
  WalletIcon,
  WebhookIcon,
  WifiOffIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { Doc, Id } from "@repo/backend/convex/_generated/dataModel";

const eventTypes = [
  "contract.event",
  "transaction.succeeded",
  "transaction.failed",
  "project.registered",
  "project.updated",
  "payment.created",
  "payment.succeeded",
  "payment.failed",
  "payment_access.activated",
  "settlement.quote.created",
  "settlement.trade.executed",
  "settlement.withdrawal.pending",
  "settlement.withdrawal.succeeded",
  "settlement.withdrawal.failed",
  "provider.pdax.event.received",
] as const;

type EventType = (typeof eventTypes)[number];

const deliveryVariant = {
  pending: "warning",
  success: "success",
  failed: "error",
} as const;

function formatTimestamp(value?: number) {
  return value ? new Date(value).toLocaleString() : "No deliveries";
}

function displayJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function DeliveryDetail({ delivery }: { delivery: Doc<"webhookDeliveries"> }) {
  return (
    <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
      <SheetHeader>
        <SheetTitle>{delivery.eventType}</SheetTitle>
        <SheetDescription>
          Attempted {formatTimestamp(delivery.lastAttemptAt)} to {delivery.destinationHost}
        </SheetDescription>
      </SheetHeader>
      <div className="grid gap-5 px-4 pb-6">
        <div className="grid gap-2 text-sm">
          <span className="text-xs font-medium text-zinc-500 uppercase">Status</span>
          <Badge variant={deliveryVariant[delivery.status]} className="w-fit">
            {delivery.status}
          </Badge>
          <span className="text-xs font-medium text-zinc-500 uppercase">HTTP status</span>
          <span>{delivery.httpStatus ?? "No response"}</span>
          <span className="text-xs font-medium text-zinc-500 uppercase">Latency</span>
          <span>{delivery.responseTimeMs ? `${delivery.responseTimeMs} ms` : "N/A"}</span>
          {delivery.payloadSummary?.paymentIntentId && (
            <>
              <span className="text-xs font-medium text-zinc-500 uppercase">Payment Intent ID</span>
              <span className="font-mono text-xs text-zinc-700 bg-zinc-100 px-1 py-0.5 w-fit">
                {delivery.payloadSummary.paymentIntentId}
              </span>
            </>
          )}
          <span className="text-xs font-medium text-zinc-500 uppercase">Failure reason</span>
          <span>{delivery.errorMessage ?? "None"}</span>
        </div>

        <div className="grid gap-2 border border-zinc-200 p-3 bg-zinc-50 rounded text-xs text-zinc-600">
          <span className="font-semibold text-zinc-700">Webhook Signature Security</span>
          <p>
            Payloads are signed using HMAC-SHA256. The request contains the following signature
            header value:
          </p>
          <code className="block bg-zinc-100 p-2 font-mono text-[10px] break-all border border-zinc-200">
            x-velo-signature: t={Math.floor((delivery.lastAttemptAt || delivery.createdAt) / 1000)}
            ,v1=...
          </code>
        </div>

        <div className="grid gap-2">
          <h3 className="text-sm font-semibold">Payload summary</h3>
          <pre className="max-h-96 overflow-auto bg-zinc-950 p-3 text-xs text-zinc-100">
            {displayJson(delivery.payloadSummary)}
          </pre>
        </div>
      </div>
    </SheetContent>
  );
}

export function ProjectWebhooks({
  projectId,
  sourceExecutionId,
  eventIndex,
}: {
  projectId: string;
  sourceExecutionId?: string;
  eventIndex?: number;
}) {
  const wallet = useWallet();
  const typedProjectId = projectId as Id<"projects">;
  const project = useQuery(
    api.projects.query.getById,
    wallet.address ? { id: typedProjectId } : "skip",
  );
  const access = useQuery(
    api.playground_projects.queries.getMyAccess,
    wallet.address ? { projectId: typedProjectId } : "skip",
  );
  const sourceExecution = useQuery(
    api.playground_projects.queries.getExecution,
    wallet.address && sourceExecutionId
      ? { executionId: sourceExecutionId as Id<"playgroundExecutions"> }
      : "skip",
  );
  const webhookFilters = useQuery(
    api.playground_projects.queries.listWebhookFilters,
    wallet.address ? { projectId: typedProjectId } : "skip",
  );
  const settings = useQuery(
    api.webhook_endpoints.query.getSettings,
    wallet.address ? { projectId: typedProjectId } : "skip",
  );
  const deliveries = useQuery(
    api.webhook_deliveries.query.listByProject,
    wallet.address ? { projectId: typedProjectId, limit: 50 } : "skip",
  );
  const activity = useQuery(
    api.contract_events.query.listByProject,
    wallet.address ? { projectId: typedProjectId, limit: 1 } : "skip",
  );
  const saveSettings = useMutation(api.webhook_endpoints.mutation.saveSettings);
  const saveWebhookFilter = useMutation(api.playground_projects.mutations.saveWebhookFilter);
  const rotateSecret = useMutation(api.webhook_endpoints.mutation.rotateSecret);
  const sendTest = useAction(api.webhookDelivery.sendTest);
  const connection = useQuery(
    api.provider_connections.query.getByProject,
    wallet.address ? { projectId: typedProjectId } : "skip",
  );
  const registerWebhookAction = useAction(api.settlement.actions.registerWebhook);
  const loadedSettingsId = useRef<string | null>(null);
  const [url, setUrl] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [selectedTypes, setSelectedTypes] = useState<EventType[]>([...eventTypes]);
  const [testEventType, setTestEventType] = useState<EventType>("contract.event");
  const [useObservedEvent, setUseObservedEvent] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [isConfirmingRotation, setIsConfirmingRotation] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [filterTopicsJson, setFilterTopicsJson] = useState("[]");
  const [filterDataJson, setFilterDataJson] = useState("");
  const [isSavingFilter, setIsSavingFilter] = useState(false);

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

  useEffect(() => {
    if (!settings || loadedSettingsId.current === settings._id) {
      return;
    }

    loadedSettingsId.current = settings._id;
    setUrl(settings.url);
    setEnabled(settings.enabled);
    setSelectedTypes(settings.eventTypes as EventType[]);
    const firstType = settings.eventTypes[0] as EventType | undefined;
    if (firstType) {
      setTestEventType(firstType);
    }
  }, [settings]);

  useEffect(() => {
    if (!selectedTypes.includes(testEventType) && selectedTypes[0]) {
      setTestEventType(selectedTypes[0]);
    }
  }, [selectedTypes, testEventType]);

  const selectedSourceEvent = sourceExecution?.eventSummaries?.[Math.max(0, eventIndex ?? 0)] as
    | { contractId?: string; topics?: unknown[] }
    | undefined;

  useEffect(() => {
    if (!selectedSourceEvent) return;
    setFilterTopicsJson(JSON.stringify(selectedSourceEvent.topics ?? [], null, 2));
  }, [selectedSourceEvent]);

  if (!wallet.address) {
    return (
      <section className="grid gap-4">
        <h1 className="text-3xl font-semibold">Webhooks</h1>
        <Alert>
          <WalletIcon />
          <AlertTitle>Connect the owner wallet</AlertTitle>
          <AlertDescription>
            Private webhook settings and delivery logs load only after ownership is verified.
          </AlertDescription>
        </Alert>
        <Button onClick={wallet.connect} className="w-fit">
          <WalletIcon />
          Connect wallet
        </Button>
      </section>
    );
  }

  if (project === undefined) {
    return (
      <section className="grid gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-64 w-full" />
      </section>
    );
  }

  if (project === null) {
    return (
      <section className="grid gap-4">
        <h1 className="text-3xl font-semibold">Project unavailable</h1>
        <p className="text-sm text-zinc-600">
          The project does not exist or the connected wallet is not its owner.
        </p>
        <Button asChild className="w-fit">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </section>
    );
  }

  const canManage = access?.role === "owner" || access?.role === "editor";
  const latestEvent = activity?.events[0];
  const succeeded = deliveries?.filter((delivery) => delivery.status === "success").length ?? 0;
  const failed = deliveries?.filter((delivery) => delivery.status === "failed").length ?? 0;
  const finished = succeeded + failed;
  const successRate = finished ? Math.round((succeeded / finished) * 100) : 0;
  const privateDataLoading =
    canManage && (settings === undefined || deliveries === undefined || activity === undefined);

  async function saveEventFilter() {
    if (!settings || !selectedSourceEvent?.contractId || !sourceExecution) return;
    setIsSavingFilter(true);
    setNotice(null);
    try {
      const topics = JSON.parse(filterTopicsJson) as unknown[];
      const data = filterDataJson.trim() ? (JSON.parse(filterDataJson) as unknown) : undefined;
      await saveWebhookFilter({
        projectId: typedProjectId,
        endpointId: settings._id,
        network: sourceExecution.network,
        contractId: selectedSourceEvent.contractId,
        topics,
        data,
        sourceExecutionId: sourceExecution._id,
        enabled: true,
      });
      setNotice({
        type: "success",
        message: "Reviewed contract-event filter saved. Future deliveries must match it.",
      });
    } catch (error) {
      setNotice({
        type: "error",
        message: error instanceof Error ? error.message : "Webhook filter could not be saved",
      });
    } finally {
      setIsSavingFilter(false);
    }
  }

  function toggleEventType(eventType: EventType, checked: boolean) {
    setSelectedTypes((current) =>
      checked
        ? Array.from(new Set([...current, eventType]))
        : current.filter((v) => v !== eventType),
    );
  }

  function useTemporaryTester() {
    if (["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)) {
      setNotice({
        type: "error",
        message:
          "Hosted Convex cannot call localhost. Deploy this web app or expose port 3000 through an HTTPS tunnel, then use that public URL.",
      });
      return;
    }

    setUrl(`${window.location.origin}/api/webhook-tester`);
    setNotice({
      type: "success",
      message: "Public temporary tester URL filled.",
    });
  }

  async function save() {
    if (!wallet.address) {
      return;
    }

    setIsSaving(true);
    setNotice(null);
    try {
      await saveSettings({
        projectId: typedProjectId,
        url,
        enabled,
        eventTypes: selectedTypes,
      });

      // Auto-register PDAX webhook if PDAX is connected
      if (connection && connection.status === "connected") {
        try {
          const isLocalhost = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
          if (!isLocalhost) {
            await registerWebhookAction({ projectId: typedProjectId });
          } else {
            console.log("Localhost detected. Skipping PDAX webhook registration.");
          }
        } catch (pdaxErr) {
          console.error("Auto-registering PDAX webhook failed on save:", pdaxErr);
        }
      }

      setNotice({ type: "success", message: "Webhook settings saved." });
    } catch (error) {
      setNotice({
        type: "error",
        message: error instanceof Error ? error.message : "Webhook settings could not be saved",
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function rotate() {
    if (!wallet.address) {
      return;
    }

    setIsRotating(true);
    setNotice(null);
    try {
      await rotateSecret({
        projectId: typedProjectId,
      });
      setNotice({ type: "success", message: "Webhook signing secret rotated." });
      setIsConfirmingRotation(false);
    } catch (error) {
      setNotice({
        type: "error",
        message: error instanceof Error ? error.message : "Webhook secret could not be rotated",
      });
    } finally {
      setIsRotating(false);
    }
  }

  async function send() {
    if (!wallet.address) {
      return;
    }

    setIsSending(true);
    setNotice(null);
    try {
      const result = await sendTest({
        projectId: typedProjectId,
        eventType: testEventType,
        contractEventId:
          testEventType === "contract.event" && useObservedEvent ? latestEvent?._id : undefined,
      });
      setNotice({
        type: result.status === "success" ? "success" : "error",
        message:
          result.status === "success"
            ? "Webhook delivered successfully."
            : "Webhook attempt failed. Open the latest delivery for details.",
      });
    } catch (error) {
      setNotice({
        type: "error",
        message: error instanceof Error ? error.message : "Webhook test could not be sent",
      });
    } finally {
      setIsSending(false);
    }
  }

  return (
    <section className="grid min-w-0 gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-semibold">Webhooks</h1>
            <Badge variant={settings?.enabled ? "success" : settings ? "warning" : "gray"}>
              {settings?.enabled ? "Enabled" : settings ? "Disabled" : "Not configured"}
            </Badge>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-zinc-600">
            Deliver project activity to a private developer endpoint and inspect every attempt.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/dashboard">Dashboard</Link>
        </Button>
      </div>

      {!wallet.address ? (
        <Alert>
          <WalletIcon />
          <AlertTitle>Project wallet required</AlertTitle>
          <AlertDescription>
            Connect {shortenAddress(project.ownerAddress)} to manage private webhook settings.
          </AlertDescription>
        </Alert>
      ) : !canManage ? (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Editor access required</AlertTitle>
          <AlertDescription>
            Viewers can inspect project evidence but cannot change webhook configuration.
          </AlertDescription>
        </Alert>
      ) : null}

      <Alert>
        <LockKeyholeIcon />
        <AlertTitle>Private endpoint</AlertTitle>
        <AlertDescription>
          Webhook URLs and delivery logs are never returned by public project queries or pages.
        </AlertDescription>
      </Alert>

      {isOffline ? (
        <Alert className="border-amber-500/30 bg-amber-50">
          <WifiOffIcon />
          <AlertTitle>Live delivery view paused</AlertTitle>
          <AlertDescription>
            Convex will reconcile this narrow delivery subscription after reconnect. The last
            rendered delivery remains visible until the authoritative update arrives.
          </AlertDescription>
        </Alert>
      ) : null}

      {notice ? (
        <Alert variant={notice.type === "error" ? "destructive" : "default"} aria-live="polite">
          {notice.type === "error" ? <AlertCircleIcon /> : <CheckCircle2Icon />}
          <AlertTitle>
            {notice.type === "error" ? "Webhook needs attention" : "Webhook ready"}
          </AlertTitle>
          <AlertDescription>{notice.message}</AlertDescription>
        </Alert>
      ) : null}

      {sourceExecutionId ? (
        <div className="grid gap-4 border border-blue-200 bg-blue-50 p-5">
          <div>
            <h2 className="font-semibold">Review event-derived filter</h2>
            <p className="mt-1 text-sm text-zinc-600">
              The source execution only pre-populates this draft. Nothing is persisted until you
              review and save it.
            </p>
          </div>
          {!sourceExecution || !selectedSourceEvent?.contractId ? (
            <Alert>
              <AlertCircleIcon />
              <AlertTitle>Source event unavailable</AlertTitle>
              <AlertDescription>
                The execution expired, the event index is invalid, or it belongs to another project.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <Label>Network</Label>
                  <Input value={sourceExecution.network} readOnly />
                </div>
                <div>
                  <Label>Contract ID</Label>
                  <Input value={selectedSourceEvent.contractId} readOnly className="font-mono" />
                </div>
              </div>
              <Label className="grid gap-2">
                Topic prefix JSON
                <textarea
                  aria-label="Webhook topic prefix JSON"
                  value={filterTopicsJson}
                  onChange={(event) => setFilterTopicsJson(event.target.value)}
                  className="min-h-28 border bg-white p-3 font-mono text-xs"
                />
              </Label>
              <Label className="grid gap-2">
                Optional exact decoded data JSON
                <textarea
                  aria-label="Webhook decoded data JSON"
                  value={filterDataJson}
                  onChange={(event) => setFilterDataJson(event.target.value)}
                  placeholder="Leave empty to match any data"
                  className="min-h-24 border bg-white p-3 font-mono text-xs"
                />
              </Label>
              <Button
                className="w-fit"
                onClick={() => void saveEventFilter()}
                disabled={!canManage || !settings || isSavingFilter}
              >
                <SaveIcon />
                {isSavingFilter ? "Saving filter…" : "Save reviewed filter"}
              </Button>
            </>
          )}
        </div>
      ) : null}

      {webhookFilters?.length ? (
        <div className="grid gap-2 border border-zinc-200 bg-white p-5 text-sm">
          <h2 className="font-semibold">Contract event filters</h2>
          {webhookFilters.map((filter) => (
            <div key={filter._id} className="flex flex-wrap items-center gap-2 border p-2">
              <Badge variant={filter.enabled ? "success" : "gray"}>
                {filter.enabled ? "Enabled" : "Disabled"}
              </Badge>
              <code className="min-w-0 flex-1 break-all">
                {filter.network}:{filter.contractId} · topics {JSON.stringify(filter.topics)}
              </code>
            </div>
          ))}
        </div>
      ) : null}

      {privateDataLoading ? (
        <div className="grid gap-3" aria-label="Loading private webhook data">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : null}

      <div className="grid gap-5 border border-zinc-200 bg-white p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="grid flex-1 gap-2">
            <Label htmlFor="webhook-url">Webhook URL</Label>
            <Input
              id="webhook-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://api.example.com/webhooks/velo"
              disabled={!canManage}
            />
          </div>
          <Button variant="outline" onClick={useTemporaryTester} disabled={!canManage}>
            <FlaskConicalIcon />
            Use temporary tester
          </Button>
        </div>

        {settings?.signingSecret && (
          <div className="grid gap-2 border-t border-zinc-100 pt-3">
            <Label htmlFor="webhook-secret">Signing secret</Label>
            <div className="flex min-w-0 items-center gap-2">
              <Input
                id="webhook-secret"
                type={showSecret ? "text" : "password"}
                value={settings.signingSecret}
                readOnly
                className="min-w-0 flex-1 bg-zinc-50 font-mono text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setShowSecret(!showSecret)}
                title={showSecret ? "Hide secret" : "Show secret"}
              >
                {showSecret ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => {
                  navigator.clipboard.writeText(settings.signingSecret!);
                  setCopiedSecret(true);
                  setTimeout(() => setCopiedSecret(false), 2000);
                }}
                title="Copy secret"
              >
                {copiedSecret ? (
                  <CheckIcon className="h-4 w-4 text-green-600" />
                ) : (
                  <CopyIcon className="h-4 w-4" />
                )}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              {!isConfirmingRotation ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsConfirmingRotation(true)}
                  disabled={!canManage || isRotating}
                >
                  <RefreshCwIcon className="h-3 w-3 mr-1" />
                  Rotate secret
                </Button>
              ) : (
                <div className="flex flex-col items-stretch gap-2 rounded border border-red-200 bg-red-50 p-2 text-xs sm:flex-row sm:items-center">
                  <span className="text-red-700 font-medium">
                    Are you sure? Old secret will immediately stop working.
                  </span>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => void rotate()}
                    disabled={isRotating}
                  >
                    {isRotating ? "Rotating..." : "Yes, rotate"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsConfirmingRotation(false)}
                    disabled={isRotating}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </div>
            <p className="text-xs text-zinc-500">
              Payloads are signed using this secret in HMAC-SHA256. Verify signatures to confirm
              request authenticity.
            </p>
          </div>
        )}

        <div className="flex items-center justify-between gap-4 border border-zinc-200 p-3">
          <div>
            <Label htmlFor="webhook-enabled">Endpoint enabled</Label>
            <p className="mt-1 text-xs text-zinc-500">
              Disabled endpoints keep their settings but reject delivery attempts.
            </p>
          </div>
          <Switch
            id="webhook-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={!canManage}
          />
        </div>

        <fieldset className="grid gap-3">
          <legend className="text-sm font-medium">Event types</legend>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {eventTypes.map((eventType) => (
              <Label key={eventType} className="border border-zinc-200 p-3">
                <Checkbox
                  checked={selectedTypes.includes(eventType)}
                  onCheckedChange={(checked) => toggleEventType(eventType, checked === true)}
                  disabled={!canManage}
                />
                <span className="font-mono text-xs">{eventType}</span>
              </Label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => void save()}
            disabled={!canManage || isSaving || selectedTypes.length === 0}
          >
            {isSaving ? <LoaderCircleIcon className="animate-spin" /> : <SaveIcon />}
            {isSaving ? "Saving..." : "Save webhook"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 border border-zinc-200 bg-white p-5">
        <div>
          <h2 className="font-semibold">Test delivery</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Send a generated payload, or use the latest observed event for contract.event.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-center">
          <Select
            value={testEventType}
            onValueChange={(value) => setTestEventType(value as EventType)}
            disabled={!canManage}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {selectedTypes.map((eventType) => (
                <SelectItem key={eventType} value={eventType}>
                  {eventType}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Label className="border border-zinc-200 p-3">
            <Checkbox
              checked={useObservedEvent}
              onCheckedChange={(checked) => setUseObservedEvent(checked === true)}
              disabled={testEventType !== "contract.event" || !latestEvent || !canManage}
            />
            Latest observed event
          </Label>
          <Button
            onClick={() => void send()}
            disabled={
              !canManage || isSending || !settings || !selectedTypes.includes(testEventType)
            }
          >
            {isSending ? <LoaderCircleIcon className="animate-spin" /> : <SendIcon />}
            {isSending ? "Sending..." : "Send test event"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="border border-zinc-200 bg-white p-4">
          <p className="text-xs font-medium text-zinc-500 uppercase">Last delivery</p>
          <p className="mt-2 text-sm">{formatTimestamp(deliveries?.[0]?.lastAttemptAt)}</p>
        </div>
        <div className="border border-zinc-200 bg-white p-4">
          <p className="text-xs font-medium text-zinc-500 uppercase">Recent success rate</p>
          <p className="mt-2 text-2xl font-semibold">{successRate}%</p>
        </div>
        <div className="border border-zinc-200 bg-white p-4">
          <p className="text-xs font-medium text-zinc-500 uppercase">Failed attempts</p>
          <p className="mt-2 text-2xl font-semibold">{failed}</p>
        </div>
      </div>

      <div className="border border-zinc-200 bg-white">
        <div className="border-b border-zinc-200 px-4 py-3">
          <h2 className="font-semibold">Delivery logs</h2>
          <p className="text-xs text-zinc-500">Showing the latest 50 bounded attempts.</p>
        </div>
        <div className="overflow-x-auto w-full">
          <Table className="table-fixed sm:table-auto">
            <TableHeader>
              <TableRow>
                <TableHead className="hidden sm:table-cell">Time</TableHead>
                <TableHead>Event type</TableHead>
                <TableHead className="hidden md:table-cell">Destination</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">HTTP</TableHead>
                <TableHead className="hidden lg:table-cell">Latency</TableHead>
                <TableHead className="hidden lg:table-cell">Attempts</TableHead>
                <TableHead className="text-right">Payload</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!deliveries?.length ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-sm text-zinc-600">
                    {wallet.address
                      ? "No webhook delivery attempts yet."
                      : "Connect the owner wallet to view private delivery logs."}
                  </TableCell>
                </TableRow>
              ) : (
                deliveries.map((delivery) => (
                  <TableRow key={delivery._id}>
                    <TableCell className="hidden text-sm sm:table-cell">
                      {formatTimestamp(delivery.lastAttemptAt)}
                    </TableCell>
                    <TableCell className="max-w-36 whitespace-normal break-words font-mono text-xs">
                      {delivery.eventType}
                    </TableCell>
                    <TableCell className="hidden md:table-cell max-w-64 font-mono text-xs truncate break-all">
                      <span title={delivery.destinationHost}>{delivery.destinationHost}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={deliveryVariant[delivery.status]}>{delivery.status}</Badge>
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs md:table-cell">
                      {delivery.httpStatus ?? "-"}
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs lg:table-cell">
                      {delivery.responseTimeMs ? `${delivery.responseTimeMs} ms` : "-"}
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs lg:table-cell">
                      {delivery.attemptCount}
                    </TableCell>
                    <TableCell className="text-right">
                      <Sheet>
                        <SheetTrigger asChild>
                          <Button variant="outline" size="sm">
                            View
                          </Button>
                        </SheetTrigger>
                        <DeliveryDetail delivery={delivery} />
                      </Sheet>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Alert>
        <WebhookIcon />
        <AlertTitle>Temporary tester behavior</AlertTitle>
        <AlertDescription>
          On a deployed app or HTTPS tunnel, <code>/api/webhook-tester</code> returns HTTP 200. Add{" "}
          <code>?status=500</code> to demonstrate failure. Hosted Convex cannot call a localhost
          URL.
        </AlertDescription>
      </Alert>
    </section>
  );
}
