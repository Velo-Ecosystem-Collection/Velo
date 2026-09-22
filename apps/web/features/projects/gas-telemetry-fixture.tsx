"use client";

import { Alert, AlertDescription, AlertTitle } from "@repo/ui/components/ui/alert";
import { Button } from "@repo/ui/components/ui/button";
import { InfoIcon } from "lucide-react";
import { useState } from "react";

import { GasTelemetryView, useUtcReportingDay } from "./gas-telemetry";
import {
  getGasTelemetryDayKeys,
  getUtcDayKey,
  type GasPolicySnapshot,
  type GasTelemetrySnapshot,
} from "./gas-ui";

const FIXTURE_REPORTING_DAY_KEY = "2026-09-15";
const FIXTURE_OBSERVED_AT = "2026-09-15T12:00:00.000Z";
const FIXTURE_SOURCE_UPDATED_AT = Date.parse("2026-09-15T11:59:00.000Z");

const fixturePolicy = {
  enabled: true,
  dailyCapStroops: "20000000",
  walletHourlyLimit: 60,
  allowedContractIds: [],
  network: "testnet",
} satisfies GasPolicySnapshot;

type FixtureScenario = "settled" | "pending" | "empty" | "blocked" | "missing";

const scenarioLabels: Record<FixtureScenario, string> = {
  settled: "Settled fees",
  pending: "Pending hold",
  empty: "Initialized empty",
  blocked: "Blocked accounting",
  missing: "Missing policy",
};

function buildHistory(values: Record<string, string | null>): GasTelemetrySnapshot["history"] {
  return getGasTelemetryDayKeys(FIXTURE_REPORTING_DAY_KEY).map((reportingDayKey) => {
    const confirmedFeeStroops = values[reportingDayKey] ?? null;
    return {
      reportingDayKey,
      confirmedFeeStroops,
      sourceUpdatedAt: confirmedFeeStroops === null ? null : FIXTURE_SOURCE_UPDATED_AT,
    };
  });
}

function buildTelemetry(
  scenario: FixtureScenario,
  values: Record<string, string | null>,
): GasTelemetrySnapshot {
  const isBlocked = scenario === "blocked";
  const isMissing = scenario === "missing";
  const history = buildHistory(values);
  return {
    reportingDayKey: FIXTURE_REPORTING_DAY_KEY,
    confirmedFeeStroops:
      isBlocked || isMissing
        ? null
        : scenario === "settled"
          ? "12345678"
          : scenario === "pending"
            ? "5000000"
            : "0",
    outstandingHoldsStroops:
      isBlocked || isMissing ? null : scenario === "pending" ? "2500000" : "0",
    effectiveUsageStroops:
      isBlocked || isMissing
        ? null
        : scenario === "settled"
          ? "12345678"
          : scenario === "pending"
            ? "7500000"
            : "0",
    policyCapStroops: isMissing ? null : "20000000",
    availability: isBlocked || isMissing ? "unavailable" : "available",
    reasonCode: isBlocked ? "accounting_blocked" : isMissing ? "missing_policy" : null,
    accountingBlockReason: isBlocked ? "inconsistent_counters" : null,
    sourceUpdatedAt: FIXTURE_SOURCE_UPDATED_AT,
    historyCompleteness: isMissing
      ? "unavailable"
      : history.every((entry) => entry.confirmedFeeStroops !== null)
        ? "complete"
        : "partial",
    history,
  };
}

const fixtureTelemetry: Record<FixtureScenario, GasTelemetrySnapshot> = {
  settled: buildTelemetry("settled", {
    "2026-09-09": null,
    "2026-09-10": "0",
    "2026-09-11": "10000000",
    "2026-09-12": "2345678",
    "2026-09-13": "0",
    "2026-09-14": "1500000",
    "2026-09-15": "12345678",
  }),
  pending: buildTelemetry("pending", {
    "2026-09-09": null,
    "2026-09-10": "2000000",
    "2026-09-11": null,
    "2026-09-12": "1000000",
    "2026-09-13": "0",
    "2026-09-14": "3000000",
    "2026-09-15": "5000000",
  }),
  empty: buildTelemetry("empty", {
    "2026-09-09": "0",
    "2026-09-10": "0",
    "2026-09-11": "0",
    "2026-09-12": "0",
    "2026-09-13": "0",
    "2026-09-14": "0",
    "2026-09-15": "0",
  }),
  blocked: buildTelemetry("blocked", {
    "2026-09-09": null,
    "2026-09-10": "0",
    "2026-09-11": "1000000",
    "2026-09-12": null,
    "2026-09-13": "0",
    "2026-09-14": "3000000",
    "2026-09-15": "5000000",
  }),
  missing: buildTelemetry("missing", {
    "2026-09-09": null,
    "2026-09-10": null,
    "2026-09-11": null,
    "2026-09-12": null,
    "2026-09-13": null,
    "2026-09-14": null,
    "2026-09-15": null,
  }),
};

function nextUtcDay(dayKey: string): string {
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return getUtcDayKey(date);
}

function shiftTelemetryDay(
  telemetry: GasTelemetrySnapshot,
  reportingDayKey: string,
): GasTelemetrySnapshot {
  const dayKeys = getGasTelemetryDayKeys(reportingDayKey);
  return {
    ...telemetry,
    reportingDayKey,
    history: telemetry.history.map((entry, index) => ({
      ...entry,
      reportingDayKey: dayKeys[index] ?? entry.reportingDayKey,
    })),
  };
}

function reactiveUpdate(telemetry: GasTelemetrySnapshot): GasTelemetrySnapshot {
  if (telemetry.reasonCode === "accounting_blocked" || telemetry.reasonCode === "missing_policy") {
    return telemetry;
  }
  const confirmedFeeStroops =
    telemetry.confirmedFeeStroops === null
      ? null
      : (BigInt(telemetry.confirmedFeeStroops) + 1n).toString();
  return {
    ...telemetry,
    confirmedFeeStroops,
    effectiveUsageStroops:
      telemetry.effectiveUsageStroops === null
        ? null
        : (BigInt(telemetry.effectiveUsageStroops) + 1n).toString(),
    history: telemetry.history.map((entry, index) =>
      index === telemetry.history.length - 1
        ? { ...entry, confirmedFeeStroops, sourceUpdatedAt: FIXTURE_SOURCE_UPDATED_AT + 1_000 }
        : entry,
    ),
    sourceUpdatedAt: FIXTURE_SOURCE_UPDATED_AT + 1_000,
  };
}

export function GasTelemetryFixture() {
  const [scenario, setScenario] = useState<FixtureScenario>("settled");
  const [isConnected, setIsConnected] = useState(true);
  const [connectionCount, setConnectionCount] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [reportingDayKey, setReportingDayKey] = useState(FIXTURE_REPORTING_DAY_KEY);
  const [updateVersion, setUpdateVersion] = useState(0);
  const reportingDayProbe = useUtcReportingDay({
    isWebSocketConnected: isConnected,
    hasEverConnected: connectionCount > 1,
    connectionCount,
  });

  function handleReconnect() {
    setIsConnected(true);
    setConnectionCount((count) => count + 1);
  }

  function handleConnectionToggle() {
    if (isConnected) {
      setIsConnected(false);
    } else {
      handleReconnect();
    }
  }

  function handleScenarioChange(nextScenario: FixtureScenario) {
    setScenario(nextScenario);
    setUpdateVersion(0);
  }

  function handleAdvanceUtcDay() {
    setReportingDayKey((dayKey) => nextUtcDay(dayKey));
  }

  const scenarioTelemetry = shiftTelemetryDay(
    updateVersion > 0 ? reactiveUpdate(fixtureTelemetry[scenario]) : fixtureTelemetry[scenario],
    reportingDayKey,
  );

  return (
    <main className="mx-auto grid w-full max-w-7xl gap-6 p-4 sm:p-6">
      <header className="grid gap-2">
        <h1 className="text-3xl font-semibold tracking-normal">Gas telemetry fixture</h1>
        <p className="text-sm text-muted-foreground">
          Development-only presentation fixture for reactive fee telemetry.
        </p>
      </header>
      <Alert>
        <InfoIcon />
        <AlertTitle>Simulated fixture — XLM units</AlertTitle>
        <AlertDescription>
          Reporting day: {reportingDayKey}. Observation time: {FIXTURE_OBSERVED_AT}. These values
          are local UI fixtures; no authentication bypass, Convex read, or backend write is used.
        </AlertDescription>
      </Alert>
      <div className="flex flex-wrap gap-2" aria-label="Telemetry fixture scenarios">
        {(Object.keys(scenarioLabels) as FixtureScenario[]).map((nextScenario) => (
          <Button
            key={nextScenario}
            type="button"
            variant={scenario === nextScenario ? "default" : "outline"}
            onClick={() => handleScenarioChange(nextScenario)}
            aria-pressed={scenario === nextScenario}
          >
            {scenarioLabels[nextScenario]}
          </Button>
        ))}
        <Button
          type="button"
          variant={isLoading ? "default" : "outline"}
          onClick={() => setIsLoading((loading) => !loading)}
          aria-pressed={isLoading}
        >
          {isLoading ? "Show loaded state" : "Loading state"}
        </Button>
        <Button
          type="button"
          variant={isConnected ? "outline" : "default"}
          onClick={handleConnectionToggle}
          aria-pressed={!isConnected}
        >
          {isConnected ? "Simulate disconnected" : "Reconnect"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setUpdateVersion((version) => version + 1)}
        >
          Simulate reactive fee update
        </Button>
        <Button type="button" variant="outline" onClick={handleAdvanceUtcDay}>
          Simulate UTC midnight
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        UTC boundary probe:{" "}
        <time dateTime={`${reportingDayProbe}T00:00:00.000Z`}>{reportingDayProbe}</time>
      </p>
      <GasTelemetryView
        telemetry={isLoading ? undefined : scenarioTelemetry}
        policy={scenario === "missing" ? null : fixturePolicy}
        reportingDayKey={reportingDayKey}
        connectionState={{
          isWebSocketConnected: isConnected,
          hasEverConnected: connectionCount > 1,
          connectionCount,
        }}
      />
    </main>
  );
}
