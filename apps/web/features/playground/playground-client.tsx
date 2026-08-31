"use client";

import { useWallet } from "@/core/wallet/wallet-provider";
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
import { Input } from "@repo/ui/components/ui/input";
import { useQuery } from "convex/react";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  Code2Icon,
  Loader2Icon,
  PlayIcon,
  RefreshCwIcon,
  SearchIcon,
  WalletIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useReducer, useRef, useState } from "react";

import type { Id } from "@repo/backend/convex/_generated/dataModel";
import type {
  CanonicalArgumentValue,
  ContractSpecDocumentV1,
  NormalizedContractFunction,
  NormalizedContractSpecType,
} from "@repo/stellar";

import { ArgumentEditor } from "./argument-editor";
import {
  createFunctionDraft,
  updateDraftFromValue,
  type FunctionArgumentDraft,
} from "./argument-editor-state";
import { assertWalletEnvelopeMatchesReview } from "./client-integrity";
import {
  PlaygroundHistoryRepository,
  sanitizeHistoryArguments,
  type PlaygroundHistoryEntryV1,
} from "./history";
import { ProjectPlaygroundPanel } from "./project-playground-panel";
import {
  createSimulationContextKey,
  simulationFreshness,
  type SimulationContext,
  type SimulationFreshness,
} from "./simulation-state";
import { PlaygroundCodePanel, PlaygroundHistoryPanel } from "./sprint5-panels";
import { emitPlaygroundTelemetry } from "./telemetry";
import {
  PLAYGROUND_PENDING_STORAGE_KEY,
  initialTransactionLifecycle,
  parsePendingTransaction,
  pollPendingTransaction,
  transactionLifecycleReducer,
} from "./transaction-lifecycle";

type Network = "testnet" | "mainnet";
type LoadedContract = ContractSpecDocumentV1 & {
  invocation: {
    eligible: boolean;
    functionName: "hello";
    reason: string;
  };
};
type Simulation = {
  schemaVersion: 1;
  status: "success" | "restore_required";
  simulationId: string;
  correlationId: string;
  identity: string;
  contextKey: string;
  simulatedAt: string;
  unsignedXdr: string;
  transactionHash: string;
  expiresAt: string;
  latestLedger: number;
  request: {
    network: Network;
    contractId: string;
    expectedWasmHash: string;
    expectedSpecHash: string;
    sourceAccount: string;
    functionName: string;
    settings: { baseFee: string; cpuInstructions: number };
    argumentNames: string[];
  };
  result: { decoded: unknown; rawXdr: string | null };
  fee: {
    base: string;
    minimumResource: string;
    total: string;
    excessiveThreshold: string;
  };
  authorization: {
    required: boolean;
    entries: Array<{ credentials: string; xdr: string }>;
  };
  footprint: {
    readOnly: Array<{ type: string; xdr: string }>;
    readWrite: Array<{ type: string; xdr: string }>;
  };
  warnings: Array<{
    code: string;
    severity: "info" | "warning";
    source: "rpc" | "inference";
    message: string;
  }>;
  evidence: unknown;
  signingEligible: boolean;
  review: {
    network: Network;
    sourceAccount: string;
    contractId: string;
    wasmHash: string;
    functionName: string;
    arguments: Array<{ name: string; type: string; value: unknown }>;
    sequence: string;
    timeBounds: { minTime: string; maxTime: string };
    baseFee: string;
    resourceFee: string;
    totalFee: string;
    authorization: Array<{ credentials: string; xdr: string }>;
    predictedWrites: Array<{ type: string; xdr: string }>;
    unsignedXdr: string;
    transactionHash: string;
  };
  safeguard?: { acknowledgementRequired: true; message: string };
};
type TransactionResult =
  | { status: "pending"; transactionHash: string }
  | { status: "unknown"; transactionHash: string }
  | {
      status: "success";
      transactionHash: string;
      ledger: number;
      result: { decoded: unknown; rawXdr: string | null };
      feeCharged: string;
      events: Array<{
        order: number;
        contractId: string | null;
        topics: unknown[];
        data: unknown;
        rawXdr: string;
        ledger: number;
        transactionHash: string;
      }>;
      evidence: {
        resultXdr: string;
        resultMetaXdr: string;
        diagnosticEventsXdr: string[];
      };
      explorerUrl: string;
    }
  | {
      status: "failed";
      transactionHash: string;
      ledger: number;
      code: string;
      message: string;
      stage: "execution";
      evidence: {
        resultXdr: string;
        resultMetaXdr: string;
        diagnosticEventsXdr: string[];
      };
    };

function typeLabel(type: NormalizedContractSpecType): string {
  switch (type.kind) {
    case "option":
      return `Option<${typeLabel(type.valueType)}>`;
    case "result":
      return `Result<${typeLabel(type.okType)}, ${typeLabel(type.errorType)}>`;
    case "vector":
      return `Vec<${typeLabel(type.elementType)}>`;
    case "map":
      return `Map<${typeLabel(type.keyType)}, ${typeLabel(type.valueType)}>`;
    case "tuple":
      return `(${type.elements.map(typeLabel).join(", ")})`;
    case "bytesN":
      return `BytesN<${type.length}>`;
    case "custom":
      return type.name;
    default:
      return type.kind;
  }
}

function customReferences(functionSpec: NormalizedContractFunction) {
  const names = new Set<string>();
  const collect = (type: NormalizedContractSpecType) => {
    if (type.kind === "custom") names.add(type.name);
    else if (type.kind === "option" || type.kind === "vector") {
      collect(type.kind === "option" ? type.valueType : type.elementType);
    } else if (type.kind === "result") {
      collect(type.okType);
      collect(type.errorType);
    } else if (type.kind === "map") {
      collect(type.keyType);
      collect(type.valueType);
    } else if (type.kind === "tuple") type.elements.forEach(collect);
  };
  functionSpec.parameters.forEach((item) => collect(item.type));
  functionSpec.outputs.forEach((item) => collect(item.type));
  return names;
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & {
    error?: { message?: string; code?: string; stage?: string; correlationId?: string };
  };
  if (!response.ok) {
    const error = new Error(body.error?.message ?? "Playground request failed.");
    error.name = body.error?.code ?? "PLAYGROUND_ERROR";
    Object.assign(error, {
      stage: body.error?.stage,
      correlationId: body.error?.correlationId,
    });
    throw error;
  }
  return body;
}

function requestErrorDetails(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  const correlationId =
    error && typeof error === "object" && "correlationId" in error
      ? String(error.correlationId)
      : undefined;
  return {
    message,
    correlationId,
    display: correlationId ? `${message} Correlation ID: ${correlationId}.` : message,
  };
}

function projectAuthorizationHeader() {
  try {
    const stored = window.sessionStorage.getItem("velo:convex-token");
    const token = stored ? (JSON.parse(stored) as { token?: string }).token : undefined;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

function projectRequestHeaders(projectId?: string) {
  return projectId ? { "X-Velo-Project-Id": projectId, ...projectAuthorizationHeader() } : {};
}

export function PlaygroundClient({
  initialNetwork,
  initialContractId,
  projectId,
  shareToken,
}: {
  initialNetwork: Network;
  initialContractId: string;
  projectId?: string;
  shareToken?: string;
}) {
  const router = useRouter();
  const wallet = useWallet();
  const privateShare = useQuery(
    api.playground_projects.queries.getPrivateShare,
    projectId && shareToken ? { token: shareToken } : "skip",
  );
  const [network, setNetwork] = useState<Network>(initialNetwork);
  const [contractId, setContractId] = useState(initialContractId);
  const [contract, setContract] = useState<LoadedContract | null>(null);
  const [selectedFunction, setSelectedFunction] = useState("");
  const [search, setSearch] = useState("");
  const [argumentDrafts, setArgumentDrafts] = useState<Record<string, FunctionArgumentDraft>>({});
  const [baseFee, setBaseFee] = useState("100");
  const [cpuInstructions, setCpuInstructions] = useState("0");
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [transaction, setTransaction] = useState<TransactionResult | null>(null);
  const [lifecycle, dispatchLifecycle] = useReducer(
    transactionLifecycleReducer,
    initialTransactionLifecycle,
  );
  const [reviewedFingerprint, setReviewedFingerprint] = useState<string | null>(null);
  const [mainnetAcknowledged, setMainnetAcknowledged] = useState(false);
  const [busy, setBusy] = useState<"load" | "simulate" | "sign" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [announcement, setAnnouncement] = useState("Enter a contract ID to inspect its spec.");
  const [history, setHistory] = useState<PlaygroundHistoryEntryV1[]>([]);
  const [projectResolution, setProjectResolution] = useState<{
    argumentTemplateJson: string;
    resolvedArgumentsJson: string;
    resolutionHash: string;
    requestVersionId?: Id<"playgroundRequestVersions">;
  } | null>(null);
  const simulationAbort = useRef<AbortController | null>(null);
  const simulationRequest = useRef(0);
  const priorContextKey = useRef("");
  const historyRepository = useRef<PlaygroundHistoryRepository | null>(null);
  const sessionId = useRef(`playground-session-${crypto.randomUUID()}`);
  const playgroundRequestId = useRef(`playground-request-${crypto.randomUUID()}`);
  const activeHistoryId = useRef<string | null>(null);
  const priorWalletStatus = useRef(wallet.status);
  const formTelemetryKey = useRef("");
  const openedPrivateShare = useRef<string | null>(null);

  useEffect(() => {
    historyRepository.current = new PlaygroundHistoryRepository(window.localStorage);
    setHistory(historyRepository.current.load().entries);
  }, []);

  function telemetry(
    event: Parameters<typeof emitPlaygroundTelemetry>[0]["event"],
    outcome: Parameters<typeof emitPlaygroundTelemetry>[0]["outcome"],
    durationMs?: number,
    errorCategory?: string,
  ) {
    emitPlaygroundTelemetry({
      schemaVersion: 1,
      event,
      outcome,
      network,
      sessionId: sessionId.current,
      playgroundRequestId: playgroundRequestId.current,
      ...(durationMs === undefined ? {} : { durationMs }),
      ...(errorCategory ? { errorCategory } : {}),
    });
  }

  function saveHistory(entry: PlaygroundHistoryEntryV1) {
    const store = historyRepository.current?.upsert(entry);
    if (store) setHistory(store.entries);
  }

  useEffect(() => {
    setTransaction(null);
    setReviewedFingerprint(null);
    setMainnetAcknowledged(false);
    dispatchLifecycle({ type: "RESET" });
  }, [network, contractId, wallet.address]);

  useEffect(() => {
    const stored = parsePendingTransaction(
      window.sessionStorage.getItem(PLAYGROUND_PENDING_STORAGE_KEY),
    );
    if (!stored) {
      window.sessionStorage.removeItem(PLAYGROUND_PENDING_STORAGE_KEY);
      return;
    }
    let cancelled = false;
    setTransaction({ status: "pending", transactionHash: stored.transactionHash });
    dispatchLifecycle({ type: "PENDING", transactionHash: stored.transactionHash });
    void (async () => {
      for (let attempt = 0; attempt < 15 && !cancelled; attempt += 1) {
        try {
          const result = await responseJson<TransactionResult>(
            await fetch(`/api/v1/playground/transactions/${stored.transactionHash}`, {
              cache: "no-store",
              headers: {
                "X-Velo-Journey-Id": playgroundRequestId.current,
                ...projectRequestHeaders(projectId),
              },
            }),
          );
          if (cancelled) return;
          setTransaction(result);
          if (result.status === "success") {
            window.sessionStorage.removeItem(PLAYGROUND_PENDING_STORAGE_KEY);
            dispatchLifecycle({ type: "SUCCESS" });
            return;
          }
          if (result.status === "failed") {
            window.sessionStorage.removeItem(PLAYGROUND_PENDING_STORAGE_KEY);
            dispatchLifecycle({ type: "FAIL", stage: "execution", message: result.message });
            return;
          }
        } catch {
          // A transient lookup error must never cause automatic resubmission.
        }
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
      if (!cancelled) {
        setTransaction({ status: "unknown", transactionHash: stored.transactionHash });
        dispatchLifecycle({ type: "UNKNOWN" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!simulation) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [simulation]);

  const functions = useMemo(
    () =>
      (contract?.functions ?? []).filter((item) =>
        item.name.toLowerCase().includes(search.trim().toLowerCase()),
      ),
    [contract, search],
  );
  const selected =
    contract?.functions.find((item) => item.name === selectedFunction) ?? functions[0] ?? null;
  const referencedTypes = selected ? customReferences(selected) : new Set<string>();
  const selectedDraft =
    selected && contract
      ? (argumentDrafts[selected.name] ?? createFunctionDraft(selected, contract))
      : null;

  useEffect(() => {
    if (
      projectResolution &&
      selectedDraft &&
      JSON.stringify(selectedDraft.value) !== projectResolution.resolvedArgumentsJson
    ) {
      setProjectResolution(null);
    }
  }, [projectResolution, selectedDraft]);
  const parsedCpuInstructions = Number(cpuInstructions);
  const settingsValid =
    /^[0-9]+$/.test(baseFee) &&
    BigInt(baseFee || "0") >= 100n &&
    BigInt(baseFee || "0") <= 10_000_000n &&
    Number.isSafeInteger(parsedCpuInstructions) &&
    parsedCpuInstructions >= 0 &&
    parsedCpuInstructions <= 100_000_000;
  const simulationContext: SimulationContext | null =
    contract &&
    selected &&
    selectedDraft &&
    selectedDraft.issues.length === 0 &&
    !selectedDraft.jsonError &&
    wallet.address &&
    wallet.status === "connected" &&
    settingsValid
      ? {
          network,
          contractId: contract.contractId,
          expectedWasmHash: contract.wasmHash,
          expectedSpecHash: contract.specHash,
          sourceAccount: wallet.address,
          functionName: selected.name,
          arguments: selectedDraft.value,
          settings: {
            baseFee: BigInt(baseFee).toString(),
            cpuInstructions: parsedCpuInstructions,
          },
        }
      : null;
  const currentContextKey = simulationContext ? createSimulationContextKey(simulationContext) : "";
  const freshness: SimulationFreshness | null =
    simulation && currentContextKey
      ? simulationFreshness(simulation, currentContextKey, clock)
      : simulation
        ? "stale"
        : null;
  const reviewConfirmed =
    freshness === "fresh" &&
    reviewedFingerprint === simulation?.transactionHash &&
    simulation.review.transactionHash === simulation.transactionHash &&
    simulation.review.unsignedXdr === simulation.unsignedXdr;

  useEffect(() => {
    if (priorContextKey.current && priorContextKey.current !== currentContextKey) {
      setReviewedFingerprint(null);
      dispatchLifecycle({ type: "RESET" });
    }
    priorContextKey.current = currentContextKey;
  }, [currentContextKey]);

  useEffect(() => {
    if (!reviewConfirmed && reviewedFingerprint) setReviewedFingerprint(null);
  }, [reviewConfirmed, reviewedFingerprint]);

  useEffect(() => {
    if (freshness === "expired") dispatchLifecycle({ type: "EXPIRE" });
  }, [freshness]);

  useEffect(() => {
    if (
      priorWalletStatus.current !== wallet.status &&
      (wallet.status === "connected" || wallet.status === "rejected")
    ) {
      telemetry(
        "wallet_connection",
        wallet.status === "connected" ? "success" : "rejected",
        undefined,
        wallet.errorCode?.toLowerCase(),
      );
    }
    priorWalletStatus.current = wallet.status;
  }, [wallet.errorCode, wallet.status]);

  useEffect(() => {
    if (!selected || !selectedDraft || selectedDraft.issues.length || selectedDraft.jsonError)
      return;
    const key = `${selected.name}:${JSON.stringify(selectedDraft.value)}`;
    if (formTelemetryKey.current === key) return;
    formTelemetryKey.current = key;
    telemetry("form_valid", "success");
  }, [selected, selectedDraft]);

  async function load(event?: FormEvent, replay?: PlaygroundHistoryEntryV1, duplicate = false) {
    event?.preventDefault();
    const startedAt = performance.now();
    const targetNetwork = replay?.network ?? network;
    const targetContractId = replay?.contractId ?? contractId;
    playgroundRequestId.current = `playground-request-${crypto.randomUUID()}`;
    if (replay) {
      setNetwork(replay.network);
      setContractId(replay.contractId);
    }
    setBusy("load");
    setError(null);
    setContract(null);
    try {
      const query = new URLSearchParams({
        network: targetNetwork,
        contractId: targetContractId.trim().toUpperCase(),
      });
      router.replace(
        projectId
          ? `/projects/${projectId}/playground?${query.toString()}`
          : `/playground?${query.toString()}`,
        { scroll: false },
      );
      const loaded = await responseJson<LoadedContract>(
        await fetch("/api/v1/playground/contracts/load", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Velo-Journey-Id": playgroundRequestId.current,
            ...projectRequestHeaders(projectId),
          },
          body: JSON.stringify({ network: targetNetwork, contractId: targetContractId }),
        }),
      );
      setContract(loaded);
      const replayFunction = replay?.functionName
        ? loaded.functions.find((item) => item.name === replay.functionName)
        : undefined;
      const hashMatches =
        !replay || (replay.wasmHash === loaded.wasmHash && replay.specHash === loaded.specHash);
      if (replayFunction && replay?.arguments && replay.replayable && hashMatches) {
        const initial = createFunctionDraft(replayFunction, loaded);
        setArgumentDrafts({
          [replayFunction.name]: updateDraftFromValue(
            initial,
            replayFunction,
            replay.arguments,
            loaded,
          ),
        });
      } else {
        setArgumentDrafts({});
      }
      setContractId(loaded.contractId);
      setSelectedFunction(replayFunction?.name ?? loaded.functions[0]?.name ?? "");
      setAnnouncement(`Loaded ${loaded.functions.length} functions from ${loaded.contractId}.`);
      const historyId = duplicate || !replay ? crypto.randomUUID() : replay.id;
      activeHistoryId.current = historyId;
      saveHistory({
        schemaVersion: 1,
        id: historyId,
        kind: replay?.kind ?? "contract",
        createdAt: new Date().toISOString(),
        network: loaded.network,
        contractId: loaded.contractId,
        wasmHash: loaded.wasmHash,
        specHash: loaded.specHash,
        ...(replayFunction ? { functionName: replayFunction.name } : {}),
        ...(replay?.arguments && replay.replayable && hashMatches
          ? { arguments: replay.arguments }
          : {}),
        replayable: Boolean(replay?.arguments && replay.replayable && hashMatches),
        ...(!hashMatches
          ? { privacyReason: "The contract changed. Review arguments before simulating again." }
          : {}),
        status: "loaded",
      });
      telemetry(
        replay ? "history_replayed" : "contract_loaded",
        "success",
        performance.now() - startedAt,
      );
    } catch (loadError) {
      const details = requestErrorDetails(loadError, "Contract load failed.");
      setError(details.display);
      setAnnouncement(details.display);
      telemetry(
        replay ? "history_replayed" : "contract_loaded",
        "error",
        performance.now() - startedAt,
        String((loadError as { name?: string })?.name ?? "load_error").toLowerCase(),
      );
    } finally {
      setBusy(null);
    }
  }

  async function simulate() {
    if (!simulationContext) return;
    const startedAt = performance.now();
    simulationAbort.current?.abort();
    const controller = new AbortController();
    simulationAbort.current = controller;
    const requestNumber = ++simulationRequest.current;
    setBusy("simulate");
    setError(null);
    setReviewedFingerprint(null);
    dispatchLifecycle({ type: "SIMULATE" });
    try {
      const result = await responseJson<Simulation>(
        await fetch("/api/v1/playground/simulations", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Velo-Journey-Id": playgroundRequestId.current,
            ...projectRequestHeaders(projectId),
          },
          body: JSON.stringify({
            ...simulationContext,
            ...(projectId && projectResolution
              ? {
                  projectContext: {
                    projectId,
                    argumentTemplateJson: projectResolution.argumentTemplateJson,
                    resolutionHash: projectResolution.resolutionHash,
                    ...(projectResolution.requestVersionId
                      ? { requestVersionId: projectResolution.requestVersionId }
                      : {}),
                  },
                }
              : {}),
          }),
          signal: controller.signal,
        }),
      );
      if (requestNumber !== simulationRequest.current) return;
      setSimulation(result);
      dispatchLifecycle({ type: "REVIEW", transactionHash: result.transactionHash });
      setClock(Date.now());
      setAnnouncement("Simulation ready for review.");
      const sanitized = sanitizeHistoryArguments(
        selectedDraft!.value as Record<string, CanonicalArgumentValue>,
      );
      const historyId = activeHistoryId.current ?? crypto.randomUUID();
      activeHistoryId.current = historyId;
      saveHistory({
        schemaVersion: 1,
        id: historyId,
        kind: "request",
        createdAt: new Date().toISOString(),
        network,
        contractId: contract!.contractId,
        wasmHash: contract!.wasmHash,
        specHash: contract!.specHash,
        functionName: selected!.name,
        ...sanitized,
        status: "simulated",
      });
      telemetry("simulation_finished", "success", performance.now() - startedAt);
    } catch (simulationError) {
      if (controller.signal.aborted || requestNumber !== simulationRequest.current) return;
      const details = requestErrorDetails(simulationError, "Simulation failed.");
      setError(details.display);
      dispatchLifecycle({
        type: "FAIL",
        stage: "simulation",
        message: details.message,
        correlationId: details.correlationId,
      });
      setAnnouncement(details.display);
      telemetry(
        "simulation_finished",
        "error",
        performance.now() - startedAt,
        String((simulationError as { name?: string })?.name ?? "simulation_error").toLowerCase(),
      );
    } finally {
      if (requestNumber === simulationRequest.current) setBusy(null);
    }
  }

  async function poll(hash: string) {
    const result = await pollPendingTransaction(
      async () =>
        responseJson<TransactionResult>(
          await fetch(`/api/v1/playground/transactions/${hash}`, {
            cache: "no-store",
            headers: {
              "X-Velo-Journey-Id": playgroundRequestId.current,
              ...projectRequestHeaders(projectId),
            },
          }),
        ),
      (candidate) => candidate.status === "pending",
      { onResult: setTransaction },
    );
    if (result?.status === "success") {
      window.sessionStorage.removeItem(PLAYGROUND_PENDING_STORAGE_KEY);
      dispatchLifecycle({ type: "SUCCESS" });
      return result;
    }
    if (result?.status === "failed") {
      window.sessionStorage.removeItem(PLAYGROUND_PENDING_STORAGE_KEY);
      dispatchLifecycle({ type: "FAIL", stage: "execution", message: result.message });
      return result;
    }
    const unknown = { status: "unknown" as const, transactionHash: hash };
    setTransaction(unknown);
    dispatchLifecycle({ type: "UNKNOWN" });
    return unknown;
  }

  async function signAndSubmit() {
    if (!simulation || !reviewConfirmed || !simulation.signingEligible || network !== "testnet")
      return;
    setBusy("sign");
    setError(null);
    dispatchLifecycle({ type: "REQUEST_SIGNATURE" });
    let failureStage: "signing" | "review" | "submission" = "signing";
    try {
      const signedXdr = await wallet.signTransaction(simulation.unsignedXdr);
      telemetry("signature_finished", "success");
      dispatchLifecycle({ type: "SIGNED" });
      failureStage = "review";
      assertWalletEnvelopeMatchesReview(
        simulation.unsignedXdr,
        signedXdr,
        simulation.transactionHash,
      );
      window.sessionStorage.setItem(
        PLAYGROUND_PENDING_STORAGE_KEY,
        JSON.stringify({
          schemaVersion: 1,
          network: "testnet",
          transactionHash: simulation.transactionHash,
          startedAt: new Date().toISOString(),
        }),
      );
      failureStage = "submission";
      dispatchLifecycle({ type: "SUBMIT" });
      const submitted = await responseJson<TransactionResult>(
        await fetch("/api/v1/playground/transactions/submit", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Velo-Journey-Id": playgroundRequestId.current,
            ...projectRequestHeaders(projectId),
          },
          body: JSON.stringify({
            network: "testnet",
            signedXdr,
            reviewedTransactionHash: simulation.transactionHash,
            expectedWasmHash: simulation.request.expectedWasmHash,
          }),
        }),
      );
      setTransaction(submitted);
      if (submitted.status === "pending") {
        dispatchLifecycle({ type: "PENDING", transactionHash: submitted.transactionHash });
      } else if (submitted.status === "success") {
        window.sessionStorage.removeItem(PLAYGROUND_PENDING_STORAGE_KEY);
        dispatchLifecycle({ type: "SUCCESS" });
      } else if (submitted.status === "failed") {
        window.sessionStorage.removeItem(PLAYGROUND_PENDING_STORAGE_KEY);
        dispatchLifecycle({ type: "FAIL", stage: "execution", message: submitted.message });
      }
      const finalResult =
        submitted.status === "pending" ? await poll(submitted.transactionHash) : submitted;
      setAnnouncement(
        finalResult.status === "success"
          ? "Transaction succeeded."
          : finalResult.status === "unknown"
            ? "Transaction is unresolved. Check again by hash."
            : "Transaction reached a terminal state.",
      );
      telemetry(
        finalResult.status === "success" ? "final_status" : "submission_finished",
        finalResult.status === "success" ? "success" : "error",
      );
      const currentEntry = history.find((entry) => entry.id === activeHistoryId.current);
      if (currentEntry) {
        saveHistory({
          ...currentEntry,
          createdAt: new Date().toISOString(),
          status: finalResult.status,
          transactionHash: finalResult.transactionHash,
        });
      }
    } catch (signError) {
      const details = requestErrorDetails(signError, "Wallet signing or submission failed.");
      setError(
        /reject|denied|cancel/i.test(details.message)
          ? "Wallet request rejected."
          : details.display,
      );
      dispatchLifecycle({
        type: "FAIL",
        stage: failureStage,
        message: details.message,
        correlationId: details.correlationId,
      });
      setAnnouncement(details.display);
      telemetry(
        failureStage === "signing" ? "signature_finished" : "submission_finished",
        /reject|denied|cancel/i.test(details.message) ? "rejected" : "error",
        undefined,
        String((signError as { name?: string })?.name ?? failureStage).toLowerCase(),
      );
    } finally {
      setBusy(null);
    }
  }

  async function openProjectRequest(version: {
    network: Network;
    contractId: string;
    functionName: string;
    argumentTemplateJson: string;
    sourceArgumentTemplateJson?: string;
    resolutionHash?: string;
    requestVersionId?: Id<"playgroundRequestVersions">;
  }) {
    setBusy("load");
    setError(null);
    playgroundRequestId.current = `playground-request-${crypto.randomUUID()}`;
    try {
      const loaded = await responseJson<LoadedContract>(
        await fetch("/api/v1/playground/contracts/load", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Velo-Journey-Id": playgroundRequestId.current,
            ...projectRequestHeaders(projectId),
          },
          body: JSON.stringify({ network: version.network, contractId: version.contractId }),
        }),
      );
      const functionSpec = loaded.functions.find((item) => item.name === version.functionName);
      if (!functionSpec) throw new Error("Saved function is no longer present in this contract.");
      const canonicalArguments = JSON.parse(version.argumentTemplateJson) as Record<
        string,
        CanonicalArgumentValue
      >;
      const initial = createFunctionDraft(functionSpec, loaded);
      const restored = updateDraftFromValue(initial, functionSpec, canonicalArguments, loaded);
      setNetwork(version.network);
      setContractId(loaded.contractId);
      setContract(loaded);
      setSelectedFunction(functionSpec.name);
      setArgumentDrafts({ [functionSpec.name]: restored });
      setProjectResolution(
        version.sourceArgumentTemplateJson && version.resolutionHash
          ? {
              argumentTemplateJson: version.sourceArgumentTemplateJson,
              resolvedArgumentsJson: JSON.stringify(canonicalArguments),
              resolutionHash: version.resolutionHash,
              ...(version.requestVersionId ? { requestVersionId: version.requestVersionId } : {}),
            }
          : null,
      );
      setSimulation(null);
      setTransaction(null);
      router.replace(
        `/projects/${projectId}/playground?network=${version.network}&contractId=${encodeURIComponent(loaded.contractId)}`,
        { scroll: false },
      );
      setAnnouncement("Saved project request reopened. Re-simulate before invocation.");
    } catch (openError) {
      const details = requestErrorDetails(openError, "Saved request could not be opened.");
      setError(details.display);
      setAnnouncement(details.display);
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    if (!shareToken || !privateShare || openedPrivateShare.current === shareToken) return;
    openedPrivateShare.current = shareToken;
    const snapshot = JSON.parse(privateShare.snapshotJson) as {
      network: Network;
      contractId: string;
      functionName: string;
      argumentTemplate?: Record<string, CanonicalArgumentValue>;
    };
    void openProjectRequest({
      network: snapshot.network,
      contractId: snapshot.contractId,
      functionName: snapshot.functionName,
      argumentTemplateJson: JSON.stringify(snapshot.argumentTemplate ?? {}),
    });
  }, [privateShare, shareToken]);

  return (
    <section className="grid min-w-0 gap-6 [&_button]:min-h-11 [&_select]:min-h-11">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-semibold">Contract Playground</h1>
          <Badge variant="info">Sprint 5 alpha</Badge>
          <Badge variant={network === "mainnet" ? "warning" : "gray"}>
            {network === "mainnet" ? "Mainnet · simulation only" : "Testnet"}
          </Badge>
        </div>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Simulate any supported contract call, review its exact envelope, sign on Testnet, recover
          pending results, and reuse safe requests locally.
        </p>
        <p className="mt-2 max-w-3xl text-xs text-muted-foreground">
          Privacy-safe product telemetry records stages, timings, network, and error categories. It
          never includes arguments, wallet or contract identifiers, XDR, signatures, hashes, or
          generated code.
        </p>
      </div>

      <form onSubmit={load} className="grid gap-3 rounded-xl border bg-card p-4 sm:p-6">
        <div className="grid gap-3 md:grid-cols-[10rem_minmax(0,1fr)_auto] md:items-end">
          <label htmlFor="playground-network" className="grid gap-1 text-sm font-medium">
            Network
            <select
              id="playground-network"
              value={network}
              onChange={(event) => setNetwork(event.target.value as Network)}
              className="h-9 rounded-md border bg-background px-3 text-sm"
            >
              <option value="testnet">Testnet</option>
              <option value="mainnet">Mainnet</option>
            </select>
          </label>
          <label
            htmlFor="playground-contract-id"
            className="grid min-w-0 gap-1 text-sm font-medium"
          >
            Contract ID
            <Input
              id="playground-contract-id"
              value={contractId}
              onChange={(event) => setContractId(event.target.value)}
              placeholder="C..."
              className="font-mono"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <Button type="submit" disabled={busy !== null || !contractId.trim()}>
            {busy === "load" ? (
              <Loader2Icon className="motion-safe:animate-spin" />
            ) : (
              <SearchIcon />
            )}
            {busy === "load" ? "Loading…" : "Load contract"}
          </Button>
        </div>
      </form>

      <PlaygroundHistoryPanel
        entries={history}
        onOpen={(entry) => void load(undefined, entry)}
        onDuplicate={(entry) => void load(undefined, entry, true)}
        onDelete={(id) => {
          const store = historyRepository.current?.remove(id);
          if (store) setHistory(store.entries);
          setAnnouncement("History entry deleted.");
        }}
        onClear={() => {
          if (!window.confirm("Clear all local Playground history? This cannot be undone.")) return;
          const store = historyRepository.current?.clear();
          if (store) setHistory(store.entries);
          setAnnouncement("Local Playground history cleared.");
        }}
      />

      {projectId ? (
        <ProjectPlaygroundPanel
          projectId={projectId}
          contract={contract}
          requestDraft={
            selected &&
            selectedDraft &&
            selectedDraft.issues.length === 0 &&
            !selectedDraft.jsonError
              ? {
                  functionName: selected.name,
                  arguments: selectedDraft.value as Record<string, CanonicalArgumentValue>,
                  settings: {
                    baseFee,
                    cpuInstructions: parsedCpuInstructions,
                  },
                }
              : null
          }
          onOpenRequest={(version) => void openProjectRequest(version)}
          onResolvedPreview={(preview) => setProjectResolution(preview)}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4 text-sm">
        <WalletIcon className="size-4" />
        <Badge variant={wallet.address ? "success" : "gray"}>{wallet.status}</Badge>
        <span className="font-mono break-all">
          {wallet.address ?? wallet.staleAddress ?? "No wallet account connected"}
        </span>
        {wallet.walletName ? <span>{wallet.walletName}</span> : null}
        {wallet.error ? (
          <span role="alert" className="text-destructive">
            {wallet.errorCode ? `${wallet.errorCode}: ` : ""}
            {wallet.error}
          </span>
        ) : null}
        {wallet.address ? (
          <Button type="button" variant="outline" onClick={() => void wallet.disconnect()}>
            Disconnect
          </Button>
        ) : (
          <Button type="button" onClick={() => void wallet.connect()}>
            {wallet.staleAddress ? "Reconnect wallet" : "Connect wallet"}
          </Button>
        )}
      </div>

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      {error ? (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Playground request failed</AlertTitle>
          <AlertDescription>
            {error}{" "}
            {contractId ? (
              <button className="underline" type="button" onClick={() => void load()}>
                Retry
              </button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {!contract ? (
        <div className="rounded-xl border border-dashed bg-card px-5 py-12 text-center">
          <Code2Icon className="mx-auto size-7 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">No contract specification loaded.</p>
        </div>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Contract overview</CardTitle>
              <CardDescription className="font-mono break-all">
                {contract.contractId}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Overview label="Network" value={contract.network} />
                <Overview label="Functions" value={String(contract.functions.length)} />
                <Overview label="Custom types" value={String(contract.customTypes.length)} />
                <Overview label="Loaded" value={new Date(contract.loadedAt).toLocaleString()} />
                <Overview label="Wasm hash" value={contract.wasmHash} wide />
                <Overview label="Spec hash" value={contract.specHash} wide />
              </dl>
            </CardContent>
          </Card>

          <div className="grid min-w-0 gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
            <Card>
              <CardHeader>
                <CardTitle>Functions</CardTitle>
                <CardDescription>Search and select an exported function.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search functions"
                />
                <div className="grid max-h-80 gap-1 overflow-y-auto">
                  {functions.map((item) => (
                    <Button
                      key={item.name}
                      type="button"
                      variant={selected?.name === item.name ? "secondary" : "ghost"}
                      className="justify-start font-mono"
                      onClick={() => {
                        setSelectedFunction(item.name);
                        telemetry("function_selected", "success");
                      }}
                    >
                      {item.name}
                    </Button>
                  ))}
                  {functions.length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      No functions match.
                    </p>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            {selected ? (
              <Card>
                <CardHeader>
                  <CardTitle className="font-mono">{selected.name}</CardTitle>
                  <CardDescription>
                    {selected.documentation || "No contract documentation supplied."}
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-5">
                  <SpecRows title="Parameters">
                    {selected.parameters.length
                      ? selected.parameters.map((item) => (
                          <SpecRow
                            key={item.name}
                            name={item.name}
                            type={typeLabel(item.type)}
                            documentation={item.documentation}
                          />
                        ))
                      : "None"}
                  </SpecRows>
                  <SpecRows title="Outputs">
                    {selected.outputs.length
                      ? selected.outputs.map((item) => (
                          <SpecRow
                            key={item.index}
                            name={`#${item.index}`}
                            type={typeLabel(item.type)}
                          />
                        ))
                      : "None"}
                  </SpecRows>
                  {referencedTypes.size ? (
                    <SpecRows title="Referenced custom types">
                      {[...referencedTypes].map((name) => (
                        <SpecRow
                          key={name}
                          name={name}
                          type={
                            contract.customTypes.find((item) => item.name === name)?.kind ??
                            "custom"
                          }
                        />
                      ))}
                    </SpecRows>
                  ) : null}
                  {selectedDraft ? (
                    <ArgumentEditor
                      functionSpec={selected}
                      context={contract}
                      draft={selectedDraft}
                      onChange={(draft) =>
                        setArgumentDrafts((current) => ({
                          ...current,
                          [selected.name]: draft,
                        }))
                      }
                    />
                  ) : null}
                </CardContent>
              </Card>
            ) : null}
          </div>

          {selected &&
          selectedDraft &&
          selectedDraft.issues.length === 0 &&
          !selectedDraft.jsonError ? (
            <PlaygroundCodePanel
              network={network}
              contract={contract}
              functionName={selected.name}
              arguments={selectedDraft.value}
              onCopied={() => telemetry("code_copied", "success")}
            />
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Simulation and preflight</CardTitle>
              <CardDescription>
                Simulate the selected function with its canonical arguments, fee, and CPU-resource
                settings.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {selected ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-muted-foreground">Lifecycle</span>
                    <Badge variant="gray">{lifecycle.status.replaceAll("_", " ")}</Badge>
                  </div>
                  {network === "mainnet" ? (
                    <Alert>
                      <AlertCircleIcon />
                      <AlertTitle>Mainnet · simulation only</AlertTitle>
                      <AlertDescription>
                        Contract <span className="font-mono break-all">{contract.contractId}</span>{" "}
                        on Mainnet can be simulated, but Velo will never sign or submit it.
                        <label className="mt-3 flex items-start gap-2 font-medium">
                          <input
                            type="checkbox"
                            aria-label="Acknowledge Mainnet simulation-only safeguard"
                            checked={mainnetAcknowledged}
                            onChange={(event) => setMainnetAcknowledged(event.target.checked)}
                          />
                          I understand this request targets Mainnet and is simulation-only.
                        </label>
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label htmlFor="playground-base-fee" className="grid gap-1 text-sm font-medium">
                      Base fee (stroops)
                      <Input
                        id="playground-base-fee"
                        value={baseFee}
                        onChange={(event) => setBaseFee(event.target.value)}
                        inputMode="numeric"
                        maxLength={8}
                        aria-invalid={!settingsValid}
                      />
                    </label>
                    <label
                      htmlFor="playground-cpu-leeway"
                      className="grid gap-1 text-sm font-medium"
                    >
                      Additional CPU instructions
                      <Input
                        id="playground-cpu-leeway"
                        value={cpuInstructions}
                        onChange={(event) => setCpuInstructions(event.target.value)}
                        inputMode="numeric"
                        maxLength={9}
                        aria-invalid={!settingsValid}
                      />
                    </label>
                  </div>
                  {!settingsValid ? (
                    <p role="alert" className="text-sm text-destructive">
                      Base fee must be 100–10,000,000 stroops and CPU leeway must be 0–100,000,000.
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    {!wallet.address ? (
                      <Button type="button" onClick={() => void wallet.connect()}>
                        <WalletIcon /> Connect wallet
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        onClick={() => void simulate()}
                        disabled={
                          busy !== null ||
                          !simulationContext ||
                          (network === "mainnet" && !mainnetAcknowledged)
                        }
                      >
                        {busy === "simulate" ? (
                          <Loader2Icon className="motion-safe:animate-spin" />
                        ) : (
                          <PlayIcon />
                        )}
                        Simulate
                      </Button>
                    )}
                    {simulation?.signingEligible ? (
                      <Button
                        type="button"
                        onClick={() => void signAndSubmit()}
                        disabled={busy !== null || !reviewConfirmed}
                      >
                        {busy === "sign" ? (
                          <Loader2Icon className="motion-safe:animate-spin" />
                        ) : (
                          <WalletIcon />
                        )}
                        Review complete — sign exact XDR
                      </Button>
                    ) : null}
                  </div>
                  {simulation && freshness ? (
                    <SimulationReview simulation={simulation} freshness={freshness} />
                  ) : null}
                  {simulation && freshness === "fresh" ? (
                    <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
                      <input
                        type="checkbox"
                        aria-label="Confirm exact transaction review"
                        checked={reviewConfirmed}
                        onChange={(event) => {
                          if (event.target.checked) {
                            setReviewedFingerprint(simulation.transactionHash);
                            dispatchLifecycle({ type: "CONFIRM_REVIEW" });
                          } else {
                            setReviewedFingerprint(null);
                            dispatchLifecycle({ type: "UNCONFIRM_REVIEW" });
                          }
                        }}
                      />
                      I reviewed the exact network, contract, arguments, fees, authorization,
                      predicted writes, expiry, and transaction fingerprint.
                    </label>
                  ) : null}
                  {transaction ? (
                    <TransactionOutcome
                      transaction={transaction}
                      onCheck={(hash) => {
                        setTransaction({ status: "pending", transactionHash: hash });
                        dispatchLifecycle({ type: "PENDING", transactionHash: hash });
                        void poll(hash);
                      }}
                    />
                  ) : null}
                </>
              ) : (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <RefreshCwIcon className="size-4" />
                  Select a function to prepare its simulation.
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </section>
  );
}

function Overview({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "min-w-0 sm:col-span-2" : "min-w-0"}>
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-1 font-mono text-sm break-all">{value}</dd>
    </div>
  );
}

function SpecRows({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      <div className="grid gap-2">{children}</div>
    </div>
  );
}

function SpecRow({
  name,
  type,
  documentation,
}: {
  name: string;
  type: string;
  documentation?: string;
}) {
  return (
    <div className="min-w-0 rounded-md border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-medium">{name}</span>
        <Badge variant="gray">{type}</Badge>
      </div>
      {documentation ? <p className="mt-1 text-xs text-muted-foreground">{documentation}</p> : null}
    </div>
  );
}

function SimulationReview({
  simulation,
  freshness,
}: {
  simulation: Simulation;
  freshness: SimulationFreshness;
}) {
  const review = simulation.review;
  const rows = [
    ["Status", simulation.status],
    ["Freshness", freshness],
    ["Network", review.network],
    ["Source", review.sourceAccount],
    ["Contract", review.contractId],
    ["Wasm hash", review.wasmHash],
    ["Function", review.functionName],
    ["Arguments", JSON.stringify(review.arguments)],
    ["Sequence", review.sequence],
    ["Time bounds", `${review.timeBounds.minTime}–${review.timeBounds.maxTime}`],
    ["Latest ledger", String(simulation.latestLedger)],
    ["Fees", `${review.totalFee} stroops (${review.resourceFee} resource)`],
    ["Required auth", `${review.authorization.length} entries`],
    ["Predicted writes", `${review.predictedWrites.length} ledger keys`],
    ["Fingerprint", review.transactionHash],
  ];
  const diagnosticBundle = JSON.stringify(
    {
      schemaVersion: simulation.schemaVersion,
      stage: "simulate",
      simulationId: simulation.simulationId,
      correlationId: simulation.correlationId,
      identity: simulation.identity,
      status: simulation.status,
      latestLedger: simulation.latestLedger,
      request: simulation.request,
      result: simulation.result,
      fee: simulation.fee,
      authorization: simulation.authorization,
      footprint: simulation.footprint,
      warnings: simulation.warnings,
      evidence: simulation.evidence,
      review,
    },
    null,
    2,
  );
  return (
    <div className="grid gap-2 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        {freshness === "fresh" ? (
          <CheckCircle2Icon className="size-4 text-emerald-600" />
        ) : (
          <AlertCircleIcon className="size-4 text-amber-600" />
        )}
        <h3 className="font-medium">Simulation decision record</h3>
      </div>
      {freshness !== "fresh" ? (
        <Alert>
          <AlertCircleIcon />
          <AlertTitle>
            {freshness === "restore_required"
              ? "Archived state requires restoration"
              : freshness === "expired"
                ? "Simulation expired"
                : "Simulation is stale"}
          </AlertTitle>
          <AlertDescription>Re-simulate before review or signing.</AlertDescription>
        </Alert>
      ) : null}
      {rows.map(([label, value]) => (
        <div key={label} className="grid min-w-0 gap-1 sm:grid-cols-[9rem_minmax(0,1fr)]">
          <span className="text-xs text-muted-foreground">{label}</span>
          <span className="font-mono text-xs break-all">{value}</span>
        </div>
      ))}
      <div className="grid gap-2 rounded-md bg-muted/30 p-3">
        <h4 className="text-sm font-medium">Predicted result</h4>
        <pre className="overflow-x-auto text-xs">
          {JSON.stringify(simulation.result.decoded, null, 2)}
        </pre>
      </div>
      <details className="rounded-md border p-3">
        <summary className="cursor-pointer text-sm font-medium">Exact unsigned XDR</summary>
        <pre className="mt-3 max-h-48 overflow-auto text-xs whitespace-pre-wrap break-all">
          {review.unsignedXdr}
        </pre>
      </details>
      <div className="grid gap-2 sm:grid-cols-3">
        <Overview label="Required auth" value={simulation.authorization.required ? "Yes" : "No"} />
        <Overview label="Read-only keys" value={String(simulation.footprint.readOnly.length)} />
        <Overview label="Read-write keys" value={String(simulation.footprint.readWrite.length)} />
      </div>
      <div className="grid gap-2">
        {simulation.warnings.map((warning) => (
          <Alert key={warning.code}>
            <AlertCircleIcon />
            <AlertTitle>
              {warning.code.replaceAll("_", " ")} ·{" "}
              {warning.source === "rpc" ? "RPC fact" : "Velo inference"}
            </AlertTitle>
            <AlertDescription>{warning.message}</AlertDescription>
          </Alert>
        ))}
      </div>
      <details className="rounded-md border p-3">
        <summary className="cursor-pointer text-sm font-medium">Raw simulation evidence</summary>
        <div className="mt-3 grid gap-3">
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            onClick={() => void navigator.clipboard.writeText(diagnosticBundle)}
          >
            Copy diagnostics
          </Button>
          <pre className="max-h-96 overflow-auto text-xs whitespace-pre-wrap break-all">
            {diagnosticBundle}
          </pre>
        </div>
      </details>
      <p className="text-xs text-muted-foreground">
        Simulated {new Date(simulation.simulatedAt).toLocaleString()}; expires{" "}
        {new Date(simulation.expiresAt).toLocaleString()}.
      </p>
    </div>
  );
}

function TransactionOutcome({
  transaction,
  onCheck,
}: {
  transaction: TransactionResult;
  onCheck: (hash: string) => void;
}) {
  if (transaction.status === "pending") {
    return (
      <Alert>
        <Loader2Icon className="motion-safe:animate-spin" />
        <AlertTitle>Transaction pending</AlertTitle>
        <AlertDescription className="font-mono break-all">
          {transaction.transactionHash}
        </AlertDescription>
      </Alert>
    );
  }
  if (transaction.status === "unknown") {
    return (
      <Alert>
        <AlertCircleIcon />
        <AlertTitle>Transaction status unresolved</AlertTitle>
        <AlertDescription>
          <p className="font-mono break-all">{transaction.transactionHash}</p>
          <p>Polling stopped without cancelling or resubmitting the transaction.</p>
          <Button
            type="button"
            variant="outline"
            className="mt-2"
            onClick={() => onCheck(transaction.transactionHash)}
          >
            Check again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  if (transaction.status === "failed") {
    return (
      <Alert variant="destructive">
        <AlertCircleIcon />
        <AlertTitle>Contract transaction failed</AlertTitle>
        <AlertDescription>
          {transaction.message}
          <details className="mt-2">
            <summary className="cursor-pointer">Raw execution evidence</summary>
            <pre className="mt-2 max-h-48 overflow-auto text-xs whitespace-pre-wrap break-all">
              {JSON.stringify(transaction.evidence, null, 2)}
            </pre>
          </details>
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert>
      <CheckCircle2Icon />
      <AlertTitle>Transaction succeeded</AlertTitle>
      <AlertDescription>
        <pre className="mt-2 overflow-x-auto text-xs">
          {JSON.stringify(transaction.result.decoded, null, 2)}
        </pre>
        <div className="mt-2 grid gap-1 text-xs">
          <span>Ledger: {transaction.ledger}</span>
          <span>Fee charged: {transaction.feeCharged} stroops</span>
          <span>Events: {transaction.events.length}</span>
        </div>
        {transaction.events.map((event) => (
          <details key={event.order} className="mt-2 rounded border p-2">
            <summary className="cursor-pointer">
              Event #{event.order} · {event.contractId ?? "system"}
            </summary>
            <pre className="mt-2 overflow-x-auto text-xs">
              {JSON.stringify({ topics: event.topics, data: event.data }, null, 2)}
            </pre>
            <pre className="mt-2 overflow-x-auto text-xs break-all whitespace-pre-wrap">
              {event.rawXdr}
            </pre>
          </details>
        ))}
        <details className="mt-2">
          <summary className="cursor-pointer">Raw final XDR evidence</summary>
          <pre className="mt-2 max-h-48 overflow-auto text-xs whitespace-pre-wrap break-all">
            {JSON.stringify(
              { rawResult: transaction.result.rawXdr, ...transaction.evidence },
              null,
              2,
            )}
          </pre>
        </details>
        <a
          href={transaction.explorerUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 block font-mono text-xs break-all underline"
        >
          {transaction.transactionHash}
        </a>
      </AlertDescription>
    </Alert>
  );
}
