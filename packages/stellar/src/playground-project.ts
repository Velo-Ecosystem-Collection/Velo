import type { CanonicalArgumentValue } from "./contract-arguments.ts";
import type { PlaygroundNetwork } from "./contract-spec.ts";

export type ProjectRole = "owner" | "editor" | "viewer";

export type PlaygroundVariableRefV1 = {
  $variable: string;
};

export type SavedPlaygroundContractV1 = {
  schemaVersion: 1;
  network: PlaygroundNetwork;
  contractId: string;
  displayName: string;
  description: string;
  tags: string[];
  wasmHash: string;
  specHash: string;
  repositoryUrl?: string;
  documentationUrl?: string;
};

export type SavedPlaygroundRequestVersionV1 = {
  schemaVersion: 1;
  network: PlaygroundNetwork;
  contractId: string;
  wasmHash: string;
  functionName: string;
  argumentTemplate: Record<string, CanonicalArgumentValue | PlaygroundVariableRefV1>;
  sourceStrategy: "connected_wallet";
  settings: { baseFee: string; cpuInstructions: number };
  tags: string[];
};

export type PlaygroundExecutionSummaryV1 = {
  schemaVersion: 1;
  kind: "simulation" | "invocation";
  network: PlaygroundNetwork;
  contractId: string;
  functionName: string;
  sourceAccount: string;
  status: "pending" | "success" | "failed" | "unknown";
  journeyCorrelationId: string;
  requestCorrelationId: string;
  transactionHash?: string;
  fee?: string;
};

export type PlaygroundShareSnapshotV1 = {
  schemaVersion: 1;
  network: PlaygroundNetwork;
  contractId: string;
  wasmHash: string;
  functionName: string;
  argumentTemplate?: Record<string, CanonicalArgumentValue>;
};

export type WebhookContractEventFilterV1 = {
  schemaVersion: 1;
  network: PlaygroundNetwork;
  contractId: string;
  topics: unknown[];
  data?: unknown;
};
