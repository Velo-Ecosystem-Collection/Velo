"use client";

import { api } from "@repo/backend/convex/_generated/api";
import { Badge } from "@repo/ui/components/ui-customs/badge";
import { Alert, AlertDescription, AlertTitle } from "@repo/ui/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/ui/card";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
  XAxis,
  YAxis,
} from "@repo/ui/components/ui/chart";
import { Progress } from "@repo/ui/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/ui/table";
import { useConvexConnectionState, useQuery } from "convex/react";
import { AlertCircleIcon, BarChart3Icon, InfoIcon, WifiOffIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { Id } from "@repo/backend/convex/_generated/dataModel";

import {
  formatGasTelemetryStroops,
  formatGasTelemetryTimestamp,
  getGasTelemetryAvailabilityMessage,
  getGasTelemetryChartValue,
  getGasTelemetryHistoryMessage,
  getGasTelemetryHistoryRows,
  getGasUsagePercentage,
  getMillisecondsUntilNextUtcMidnight,
  getUtcDayKey,
  type GasPolicySnapshot,
  type GasTelemetryHistoryRow,
  type GasTelemetrySnapshot,
} from "./gas-ui";

export type GasTelemetryConnectionState = {
  isWebSocketConnected: boolean;
  hasEverConnected: boolean;
  connectionCount: number;
};

type GasTelemetryProps = {
  projectId: Id<"projects">;
  policy: GasPolicySnapshot | null | undefined;
};

export type GasTelemetryViewProps = {
  telemetry: GasTelemetrySnapshot | undefined;
  policy: GasPolicySnapshot | null | undefined;
  reportingDayKey: string;
  connectionState?: Pick<
    GasTelemetryConnectionState,
    "isWebSocketConnected" | "hasEverConnected" | "connectionCount"
  >;
};

const DEFAULT_CONNECTION_STATE: GasTelemetryViewProps["connectionState"] = {
  isWebSocketConnected: true,
  hasEverConnected: true,
  connectionCount: 1,
};

const telemetryChartConfig = {
  confirmedFees: {
    label: "Confirmed fees",
    color: "var(--primary)",
  },
} satisfies ChartConfig;

export function useUtcReportingDay(connectionState: GasTelemetryConnectionState): string {
  const [reportingDayKey, setReportingDayKey] = useState(() => getUtcDayKey(Date.now()));

  const checkReportingDay = useCallback(() => {
    const currentDayKey = getUtcDayKey(Date.now());
    setReportingDayKey((previousDayKey) =>
      previousDayKey === currentDayKey ? previousDayKey : currentDayKey,
    );
  }, []);

  useEffect(() => {
    let isActive = true;
    let midnightTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleMidnightCheck = () => {
      if (!isActive) return;
      midnightTimer = setTimeout(() => {
        if (!isActive) return;
        checkReportingDay();
        scheduleMidnightCheck();
      }, getMillisecondsUntilNextUtcMidnight(Date.now()));
    };

    const handleFocus = () => checkReportingDay();
    const handleOnline = () => checkReportingDay();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") checkReportingDay();
    };

    checkReportingDay();
    scheduleMidnightCheck();
    window.addEventListener("focus", handleFocus);
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isActive = false;
      if (midnightTimer !== null) clearTimeout(midnightTimer);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [checkReportingDay]);

  useEffect(() => {
    if (connectionState.isWebSocketConnected) checkReportingDay();
  }, [checkReportingDay, connectionState.connectionCount, connectionState.isWebSocketConnected]);

  return reportingDayKey;
}

function TelemetryMetric({
  label,
  value,
  description,
}: {
  label: string;
  value: string;
  description: string;
}) {
  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="break-words font-mono text-xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

function telemetryStatusVariant(
  telemetry: GasTelemetrySnapshot | undefined,
): "success" | "warning" | "gray" {
  if (telemetry === undefined) return "gray";
  return telemetry.availability === "available" ? "success" : "warning";
}

function telemetryStatusLabel(
  telemetry: GasTelemetrySnapshot | undefined,
  isConnected: boolean,
): string {
  if (!isConnected) return "Potentially stale";
  if (telemetry === undefined) return "Loading";
  return telemetry.availability === "available" ? "Accounting available" : "Totals unavailable";
}

function telemetryStatusTitle(telemetry: GasTelemetrySnapshot | undefined): string {
  if (telemetry === undefined) return "Fee telemetry loading";
  if (telemetry.availability === "available") return "Accounting definition";

  switch (telemetry.reasonCode) {
    case "missing_policy":
      return "No Gas policy configured";
    case "uninitialized_accounting":
      return "Accounting is not initialized";
    case "accounting_blocked":
      return "Accounting is blocked";
    case "inconsistent_counters":
      return "Accounting totals are inconsistent";
    default:
      return "Fee telemetry unavailable";
  }
}

function TelemetryStatus({
  telemetry,
  isConnected,
}: {
  telemetry: GasTelemetrySnapshot | undefined;
  isConnected: boolean;
}) {
  const isUnavailable = telemetry?.availability === "unavailable";
  const Icon = !isConnected ? WifiOffIcon : isUnavailable ? AlertCircleIcon : InfoIcon;

  return (
    <Alert>
      <Icon />
      <AlertTitle>
        {!isConnected ? "Connection unavailable" : telemetryStatusTitle(telemetry)}
      </AlertTitle>
      <AlertDescription>
        {!isConnected
          ? telemetry === undefined
            ? "Waiting for the Convex connection. Fee telemetry will load when the connection is restored."
            : "The displayed accounting data may be stale while disconnected. Reconnecting will refresh this reporting day."
          : getGasTelemetryAvailabilityMessage(telemetry)}
      </AlertDescription>
    </Alert>
  );
}

function SourceTimestamp({ value }: { value: number | null }) {
  const timestamp = formatGasTelemetryTimestamp(value);
  if (timestamp === "Unavailable") return <span>Unavailable</span>;
  return <time dateTime={timestamp}>{timestamp}</time>;
}

function UsageSummary({ telemetry }: { telemetry: GasTelemetrySnapshot | undefined }) {
  const usagePercentage = getGasUsagePercentage(
    telemetry?.effectiveUsageStroops ?? null,
    telemetry?.policyCapStroops ?? null,
  );
  const hasZeroCap = telemetry?.policyCapStroops === "0";
  const usageMessage = hasZeroCap
    ? "No budget configured"
    : usagePercentage === null
      ? "Usage unavailable"
      : `${usagePercentage}% of daily cap`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily cap usage</CardTitle>
        <CardDescription>
          Effective usage is confirmed fees today plus outstanding holds across days.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-mono text-lg font-semibold tabular-nums">{usageMessage}</span>
          {usagePercentage !== null ? (
            <span className="text-sm text-muted-foreground">
              {formatGasTelemetryStroops(telemetry?.effectiveUsageStroops ?? null)} /{" "}
              {formatGasTelemetryStroops(telemetry?.policyCapStroops ?? null)}
            </span>
          ) : null}
        </div>
        {usagePercentage !== null ? (
          <Progress
            value={usagePercentage}
            aria-label="Effective daily usage percentage"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={usagePercentage}
            aria-valuetext={`${usagePercentage}% of daily cap`}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            A usage bar is shown only when both the effective total and cap are known.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function chartDayLabel(value: string | number): string {
  return String(value).slice(5);
}

function TelemetryChart({ rows }: { rows: GasTelemetryHistoryRow[] }) {
  const chartData = rows.map((row) => ({
    ...row,
    chartValue: getGasTelemetryChartValue(row.confirmedFeeStroops),
  }));
  const hasConfirmedValues = chartData.some((row) => row.chartValue !== null);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">Confirmed fees by UTC day</h3>
          <p className="text-sm text-muted-foreground">
            Bars use approximate XLM coordinates. The table below remains exact.
          </p>
        </div>
        <Badge variant={hasConfirmedValues ? "outline" : "gray"}>
          {hasConfirmedValues ? "Chart available" : "No chart values"}
        </Badge>
      </div>
      {hasConfirmedValues ? (
        <ChartContainer
          config={telemetryChartConfig}
          className="h-64 max-h-64 min-h-0 w-full aspect-auto"
          role="img"
          aria-label="Seven-day confirmed fee bar chart"
        >
          <BarChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="reportingDayKey"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={chartDayLabel}
            />
            <YAxis tickLine={false} axisLine={false} width={48} />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelFormatter={(label) => `UTC ${String(label)}`}
                  formatter={(_value, _name, item) => {
                    const row = item.payload as GasTelemetryHistoryRow;
                    return [formatGasTelemetryStroops(row.confirmedFeeStroops), "Confirmed fees"];
                  }}
                />
              }
            />
            <Bar
              dataKey="chartValue"
              name="Confirmed fees (approx.)"
              fill="var(--color-confirmedFees)"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ChartContainer>
      ) : (
        <div className="flex h-32 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          Confirmed-fee bars are unavailable because every day is an unknown gap.
        </div>
      )}
    </div>
  );
}

function TelemetryHistoryTable({ rows }: { rows: GasTelemetryHistoryRow[] }) {
  return (
    <Table className="table-fixed">
      <caption className="sr-only">
        Daily confirmed fees: exact confirmed fees and accounting source updates by UTC day
      </caption>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[25%] whitespace-normal">UTC day</TableHead>
          <TableHead className="w-[35%] whitespace-normal">Confirmed fees</TableHead>
          <TableHead className="w-[40%] whitespace-normal">Source updated</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.reportingDayKey}>
            <TableCell className="whitespace-normal break-words font-mono text-xs">
              <time dateTime={`${row.reportingDayKey}T00:00:00.000Z`}>{row.reportingDayKey}</time>
            </TableCell>
            <TableCell className="whitespace-normal break-words font-mono text-xs">
              {formatGasTelemetryStroops(row.confirmedFeeStroops)}
            </TableCell>
            <TableCell className="whitespace-normal break-words text-xs">
              <SourceTimestamp value={row.sourceUpdatedAt} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function TelemetryHistory({
  telemetry,
  reportingDayKey,
}: {
  telemetry: GasTelemetrySnapshot | undefined;
  reportingDayKey: string;
}) {
  const rows = getGasTelemetryHistoryRows(telemetry, reportingDayKey);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <CardTitle>Seven-day fee history</CardTitle>
            <CardDescription>
              {getGasTelemetryHistoryMessage(telemetry?.historyCompleteness)}
            </CardDescription>
          </div>
          <BarChart3Icon className="size-5 text-muted-foreground" aria-hidden="true" />
        </div>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-5">
        <TelemetryChart rows={rows} />
        <div className="min-w-0">
          <TelemetryHistoryTable rows={rows} />
        </div>
      </CardContent>
    </Card>
  );
}

export function GasTelemetryView({
  telemetry,
  policy,
  reportingDayKey,
  connectionState = DEFAULT_CONNECTION_STATE,
}: GasTelemetryViewProps) {
  const isConnected = connectionState?.isWebSocketConnected ?? true;
  const isLoading = telemetry === undefined;
  const unknownMetric = isLoading ? "Loading…" : "Unavailable";
  const confirmedFees = isLoading
    ? unknownMetric
    : formatGasTelemetryStroops(telemetry.confirmedFeeStroops);
  const outstandingHolds = isLoading
    ? unknownMetric
    : formatGasTelemetryStroops(telemetry.outstandingHoldsStroops);
  const effectiveUsage = isLoading
    ? unknownMetric
    : formatGasTelemetryStroops(telemetry.effectiveUsageStroops);
  const dailyCap = isLoading
    ? unknownMetric
    : formatGasTelemetryStroops(telemetry.policyCapStroops);
  const quota =
    policy === undefined
      ? "Loading…"
      : policy === null
        ? "Unavailable"
        : `${policy.walletHourlyLimit} request(s) per wallet`;

  return (
    <section className="grid min-w-0 gap-4" aria-labelledby="gas-telemetry-title">
      <header className="grid min-w-0 gap-2">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <h2 id="gas-telemetry-title" className="text-xl font-semibold tracking-normal">
            Fee telemetry
          </h2>
          <Badge variant={telemetryStatusVariant(telemetry)}>
            {telemetryStatusLabel(telemetry, isConnected)}
          </Badge>
        </div>
        <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <p>
            UTC reporting day:{" "}
            <time dateTime={`${reportingDayKey}T00:00:00.000Z`}>{reportingDayKey}</time>
          </p>
          <p>
            Accounting source updated:{" "}
            <SourceTimestamp value={telemetry?.sourceUpdatedAt ?? null} />
          </p>
          <p>No five-minute expiry rule is applied to accounting data.</p>
        </div>
      </header>

      <TelemetryStatus telemetry={telemetry} isConnected={isConnected} />

      <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <TelemetryMetric
          label="Confirmed fees today"
          value={confirmedFees}
          description="Settled native fees attributed to today’s UTC accounting day."
        />
        <TelemetryMetric
          label="Outstanding holds"
          value={outstandingHolds}
          description="Reserved exposure still held across accounting days."
        />
        <TelemetryMetric
          label="Effective daily usage"
          value={effectiveUsage}
          description="Confirmed fees today plus outstanding holds."
        />
        <TelemetryMetric
          label="Daily cap"
          value={dailyCap}
          description="Configured exact XLM budget for the policy."
        />
        <TelemetryMetric
          label="Configured requests per wallet"
          value={quota}
          description="Hourly policy configuration, not remaining quota."
        />
      </div>

      <UsageSummary telemetry={telemetry} />
      <TelemetryHistory telemetry={telemetry} reportingDayKey={reportingDayKey} />
    </section>
  );
}

export function GasTelemetry({ projectId, policy }: GasTelemetryProps) {
  const connectionState = useConvexConnectionState();
  const reportingDayKey = useUtcReportingDay(connectionState);
  const telemetry = useQuery(api.gas.queries.getTelemetry, {
    projectId,
    utcDayKey: reportingDayKey,
  });
  const currentTelemetry = telemetry?.reportingDayKey === reportingDayKey ? telemetry : undefined;

  return (
    <GasTelemetryView
      telemetry={currentTelemetry}
      policy={policy}
      reportingDayKey={reportingDayKey}
      connectionState={connectionState}
    />
  );
}
