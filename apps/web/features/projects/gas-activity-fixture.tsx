"use client";

import { Alert, AlertDescription, AlertTitle } from "@repo/ui/components/ui/alert";
import { Button } from "@repo/ui/components/ui/button";
import { InfoIcon } from "lucide-react";
import { useState } from "react";

import {
  GasActivityErrorState,
  GasActivityView,
  GasReceiptDetailBody,
  GasReceiptDetailErrorState,
  type GasActivityPaginationStatus,
} from "./gas-activity";
import { type GasExecutionDetailSnapshot, type GasLogSnapshot } from "./gas-ui";

const FIXTURE_OBSERVED_AT = "2026-09-16T12:00:00.000Z";
const INNER_HASH = "a".repeat(64);
const OUTER_HASH = "b".repeat(64);
const INVALID_HASH = "not-a-validated-hash";

type FixtureScenario =
  | "history"
  | "empty"
  | "loading"
  | "error"
  | "disconnected"
  | "loading-execution"
  | "missing-execution"
  | "detail-error"
  | "missing-audit";

const scenarioLabels: Record<FixtureScenario, string> = {
  history: "Loaded history",
  empty: "Empty history",
  loading: "Loading activity",
  error: "Activity read error",
  disconnected: "Disconnected snapshot",
  "loading-execution": "Loading receipt",
  "missing-execution": "Missing execution",
  "detail-error": "Receipt read error",
  "missing-audit": "Audit record unavailable",
};

const baseLog: GasLogSnapshot = {
  requestId: "gas-fixture-001",
  transactionHash: INNER_HASH,
  sourceWallet: "GAS-FIXTURE-SOURCE-WALLET",
  targetContractIds: ["GAS-FIXTURE-CONTRACT-001"],
  innerMaxFeeStroops: "100000",
  reservedStroops: "100100",
  actualFeeStroops: "12345678",
  decisionCode: "reserved",
  rejectionCode: null,
  lifecycle: "succeeded",
  expiresAt: Date.parse("2026-09-16T12:15:00.000Z"),
  createdAt: Date.parse("2026-09-16T11:59:00.000Z"),
  updatedAt: Date.parse("2026-09-16T12:00:00.000Z"),
};

const fixtureLogs: GasLogSnapshot[] = [
  baseLog,
  {
    ...baseLog,
    requestId: "gas-fixture-002",
    transactionHash: "c".repeat(64),
    sourceWallet: "GAS-FIXTURE-SECOND-WALLET",
    lifecycle: "submitted",
    actualFeeStroops: null,
    createdAt: Date.parse("2026-09-16T11:58:00.000Z"),
    updatedAt: Date.parse("2026-09-16T11:58:30.000Z"),
  },
  {
    ...baseLog,
    requestId: "gas-fixture-003",
    transactionHash: "d".repeat(64),
    sourceWallet: null,
    targetContractIds: null,
    lifecycle: "submission_unknown",
    actualFeeStroops: null,
    createdAt: Date.parse("2026-09-16T11:57:00.000Z"),
    updatedAt: Date.parse("2026-09-16T11:57:30.000Z"),
  },
  {
    ...baseLog,
    requestId: "gas-fixture-004",
    transactionHash: null,
    sourceWallet: "GAS-FIXTURE-REJECTED-WALLET",
    targetContractIds: null,
    innerMaxFeeStroops: null,
    reservedStroops: null,
    actualFeeStroops: null,
    decisionCode: "rejected",
    rejectionCode: "contract_not_whitelisted",
    lifecycle: "rejected",
    createdAt: Date.parse("2026-09-16T11:56:00.000Z"),
    updatedAt: Date.parse("2026-09-16T11:56:00.000Z"),
  },
  {
    ...baseLog,
    requestId: "gas-fixture-005",
    transactionHash: "e".repeat(64),
    lifecycle: "expired",
    actualFeeStroops: "0",
    createdAt: Date.parse("2026-09-16T11:55:00.000Z"),
    updatedAt: Date.parse("2026-09-16T12:01:00.000Z"),
  },
];

const fixtureDetails: Record<string, GasExecutionDetailSnapshot> = {
  "gas-fixture-001": {
    object: "gas_submit_result",
    requestId: "gas-fixture-001",
    transactionHash: INNER_HASH,
    outerTransactionHash: OUTER_HASH,
    status: "succeeded",
    reservedStroops: "100100",
    actualFeeStroops: "12345678",
    expiresAt: "2026-09-16T12:15:00.000Z",
    reconciliationRequired: false,
  },
  "gas-fixture-002": {
    object: "gas_submit_result",
    requestId: "gas-fixture-002",
    transactionHash: "c".repeat(64),
    outerTransactionHash: null,
    status: "submitted",
    reservedStroops: "100100",
    actualFeeStroops: null,
    expiresAt: "2026-09-16T12:14:00.000Z",
    reconciliationRequired: true,
  },
  "gas-fixture-003": {
    object: "gas_submit_result",
    requestId: "gas-fixture-003",
    transactionHash: "d".repeat(64),
    outerTransactionHash: INVALID_HASH,
    status: "submission_unknown",
    reservedStroops: "100100",
    actualFeeStroops: null,
    expiresAt: "2026-09-16T12:13:00.000Z",
    reconciliationRequired: true,
  },
};

function fixturePaginationStatus(
  scenario: FixtureScenario,
  visibleCount: number,
): GasActivityPaginationStatus {
  if (scenario === "loading") return "LoadingFirstPage";
  return visibleCount < fixtureLogs.length ? "CanLoadMore" : "Exhausted";
}

export function GasActivityFixture() {
  const [scenario, setScenario] = useState<FixtureScenario>("history");
  const [visibleCount, setVisibleCount] = useState(2);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [identityVersion, setIdentityVersion] = useState(1);
  const [updateVersion, setUpdateVersion] = useState(0);

  function handleScenarioChange(nextScenario: FixtureScenario) {
    setScenario(nextScenario);
    setVisibleCount(nextScenario === "empty" || nextScenario === "loading" ? 0 : 2);
    setIsLoadingMore(false);
    setUpdateVersion(0);
  }

  function handleLoadMore() {
    if (isLoadingMore) return;
    setIsLoadingMore(true);
    setTimeout(() => {
      setVisibleCount((count) => Math.min(count + 2, fixtureLogs.length));
      setIsLoadingMore(false);
    }, 100);
  }

  function handleIdentityChange() {
    setIdentityVersion((version) => (version === 1 ? 2 : 1));
    setVisibleCount(2);
    setScenario("history");
    setUpdateVersion(0);
  }

  function handleReactiveUpdate() {
    setUpdateVersion((version) => version + 1);
  }

  const logs =
    scenario === "empty" || scenario === "loading"
      ? []
      : fixtureLogs
          .slice(0, visibleCount)
          .map((log, index) =>
            index === 0 && updateVersion > 0
              ? { ...log, actualFeeStroops: "12345679", updatedAt: log.updatedAt + 1_000 }
              : log,
          );
  const paginationStatus = isLoadingMore
    ? "LoadingMore"
    : fixturePaginationStatus(scenario, visibleCount);

  function renderFixtureDetail(requestId: string, audit: GasLogSnapshot | null) {
    if (scenario === "detail-error") return <GasReceiptDetailErrorState />;
    if (scenario === "loading-execution") {
      return <GasReceiptDetailBody audit={audit} detail={undefined} isConnected />;
    }
    return (
      <GasReceiptDetailBody
        audit={scenario === "missing-audit" ? null : audit}
        detail={scenario === "missing-execution" ? null : (fixtureDetails[requestId] ?? null)}
        isConnected={scenario !== "disconnected"}
      />
    );
  }

  return (
    <main className="mx-auto grid w-full max-w-7xl gap-6 p-4 sm:p-6">
      <header className="grid gap-2">
        <h1 className="text-3xl font-semibold tracking-normal">Gas activity fixture</h1>
        <p className="text-sm text-muted-foreground">
          Development-only presentation fixture for retained Gas activity and receipt detail.
        </p>
      </header>
      <Alert>
        <InfoIcon />
        <AlertTitle>Simulated fixture — not live Testnet evidence</AlertTitle>
        <AlertDescription>
          Fixture project {identityVersion}. Observation time: {FIXTURE_OBSERVED_AT}. Values are
          local UI fixtures; no authentication bypass, Convex read, backend write, or live
          transaction is used.
        </AlertDescription>
      </Alert>
      <div className="flex flex-wrap gap-2" aria-label="Activity fixture scenarios">
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
        <Button type="button" variant="outline" onClick={handleLoadMore}>
          Fixture load more
        </Button>
        <Button type="button" variant="outline" onClick={handleReactiveUpdate}>
          Simulate reactive fee update
        </Button>
        <Button type="button" variant="outline" onClick={handleIdentityChange}>
          Switch fixture identity
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Current fixture project: {identityVersion}. A project or wallet identity change remounts the
        activity view and clears its selected receipt and pagination.
      </p>
      {scenario === "error" ? (
        <GasActivityErrorState />
      ) : (
        <GasActivityView
          key={identityVersion}
          logs={logs}
          paginationStatus={paginationStatus}
          onLoadMore={handleLoadMore}
          connectionState={{ isWebSocketConnected: scenario !== "disconnected" }}
          renderExecutionDetail={renderFixtureDetail}
        />
      )}
    </main>
  );
}
