import { rpc, scValToNative } from "@stellar/stellar-sdk";

const DEFAULT_LEDGER_WINDOW = 1_200;
const DEFAULT_EVENT_LIMIT = 100;
const MAX_CONTRACT_IDS = 20;

type RpcEventLike = {
  id: string;
  type: string;
  ledger: number;
  ledgerClosedAt: string;
  transactionIndex: number;
  operationIndex: number;
  inSuccessfulContractCall: boolean;
  txHash: string;
  contractId?: { toString(): string } | string;
  topic: unknown[];
  value: unknown;
};

export type NormalizedContractEvent = {
  eventId: string;
  contractId: string;
  transactionHash: string;
  ledger: number;
  timestamp?: number;
  topic: string;
  topics: unknown[];
  type: string;
  decoded: unknown;
  raw: {
    id: string;
    type: string;
    ledger: number;
    ledgerClosedAt: string;
    transactionIndex: number;
    operationIndex: number;
    inSuccessfulContractCall: boolean;
    txHash: string;
    contractId: string;
    topic: unknown[];
    value: unknown;
  };
};

export type ContractEventFilters = {
  contractId?: string;
  eventType?: string;
  transactionHash?: string;
  ledger?: number;
};

export type RecentContractEventsResult = {
  events: NormalizedContractEvent[];
  latestLedger?: number;
  cursor?: string;
  startLedger?: number;
  historyGap?: {
    requestedStartLedger: number;
    availableStartLedger: number;
  };
};

type FilterableContractEvent = Pick<
  NormalizedContractEvent,
  "contractId" | "transactionHash" | "ledger" | "topic" | "type"
>;

function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("hex");
  }

  if (value instanceof Map) {
    return Object.fromEntries(
      Array.from(value.entries(), ([key, entryValue]) => [String(key), jsonSafe(entryValue)]),
    );
  }

  if (Array.isArray(value)) {
    return value.map(jsonSafe);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, jsonSafe(entryValue)]),
    );
  }

  return value;
}

function decodeScVal(value: unknown) {
  try {
    if (value && typeof value === "object" && "switch" in value) {
      return jsonSafe(scValToNative(value as Parameters<typeof scValToNative>[0]));
    }
  } catch {
    // Preserve the raw, JSON-safe value when the SDK cannot decode it.
  }

  return jsonSafe(value);
}

function eventContractId(contractId: RpcEventLike["contractId"]) {
  if (!contractId) {
    throw new Error("Contract event is missing a contract ID");
  }

  return typeof contractId === "string" ? contractId : contractId.toString();
}

export function normalizeRpcEvent(event: RpcEventLike): NormalizedContractEvent {
  const contractId = eventContractId(event.contractId);
  const topics = event.topic.map(decodeScVal);
  const decoded = decodeScVal(event.value);
  const timestamp = Date.parse(event.ledgerClosedAt);
  const raw = {
    id: event.id,
    type: event.type,
    ledger: event.ledger,
    ledgerClosedAt: event.ledgerClosedAt,
    transactionIndex: event.transactionIndex,
    operationIndex: event.operationIndex,
    inSuccessfulContractCall: event.inSuccessfulContractCall,
    txHash: event.txHash,
    contractId,
    topic: topics,
    value: decoded,
  };

  return {
    eventId: event.id,
    contractId,
    transactionHash: event.txHash,
    ledger: event.ledger,
    timestamp: Number.isNaN(timestamp) ? undefined : timestamp,
    topic: topics.length > 0 ? JSON.stringify(topics[0]) : "contract.event",
    topics,
    type: event.type,
    decoded,
    raw,
  };
}

export function filterContractEvents<T extends FilterableContractEvent>(
  events: readonly T[],
  filters: ContractEventFilters,
) {
  const contractId = filters.contractId?.trim().toLowerCase();
  const eventType = filters.eventType?.trim().toLowerCase();
  const transactionHash = filters.transactionHash?.trim().toLowerCase();

  return events.filter((event) => {
    if (contractId && event.contractId.toLowerCase() !== contractId) {
      return false;
    }

    if (
      eventType &&
      !event.type.toLowerCase().includes(eventType) &&
      !event.topic.toLowerCase().includes(eventType)
    ) {
      return false;
    }

    if (transactionHash && !event.transactionHash.toLowerCase().includes(transactionHash)) {
      return false;
    }

    return filters.ledger === undefined || event.ledger === filters.ledger;
  });
}

export async function fetchRecentContractEvents(input: {
  rpcUrl: string;
  contractIds: string[];
  cursor?: string;
  afterLedger?: number;
  ledgerWindow?: number;
  limit?: number;
}): Promise<RecentContractEventsResult> {
  const contractIds = Array.from(new Set(input.contractIds)).slice(0, MAX_CONTRACT_IDS);

  if (contractIds.length === 0) {
    return { events: [], latestLedger: undefined, cursor: undefined };
  }

  const server = new rpc.Server(input.rpcUrl);
  const limit = Math.min(DEFAULT_EVENT_LIMIT, Math.max(1, input.limit ?? DEFAULT_EVENT_LIMIT));

  let response;
  let startLedger: number | undefined;
  let historyGap:
    | {
        requestedStartLedger: number;
        availableStartLedger: number;
      }
    | undefined;
  if (input.cursor) {
    response = await server.getEvents({
      filters: [{ type: "contract", contractIds }],
      cursor: input.cursor,
      limit,
    });
  } else {
    // RPC exposes its retained ledger range through getHealth. Keep old saved
    // checkpoints inside that range instead of repeatedly requesting pruned
    // history and failing every poll.
    const health = await server.getHealth();
    const healthWithLedgerRange = health as typeof health & {
      latestLedger?: number;
      oldestLedger?: number;
    };
    const healthLatestLedger = healthWithLedgerRange.latestLedger;
    const latestLedger =
      typeof healthLatestLedger === "number" &&
      Number.isSafeInteger(healthLatestLedger) &&
      healthLatestLedger > 0
        ? healthLatestLedger
        : (await server.getLatestLedger()).sequence;
    const ledgerWindow = Math.max(1, input.ledgerWindow ?? DEFAULT_LEDGER_WINDOW);
    const requestedStartLedger = Math.max(
      1,
      input.afterLedger !== undefined ? input.afterLedger + 1 : latestLedger - ledgerWindow + 1,
    );
    const oldestLedger =
      typeof healthWithLedgerRange.oldestLedger === "number" &&
      Number.isSafeInteger(healthWithLedgerRange.oldestLedger)
        ? Math.max(1, healthWithLedgerRange.oldestLedger)
        : 1;
    startLedger = Math.min(latestLedger, Math.max(oldestLedger, requestedStartLedger));
    if (startLedger > requestedStartLedger) {
      historyGap = { requestedStartLedger, availableStartLedger: startLedger };
    }
    response = await server.getEvents({
      startLedger,
      filters: [{ type: "contract", contractIds }],
      limit,
    });
  }

  return {
    events: response.events.map((event) => normalizeRpcEvent(event)),
    latestLedger: response.latestLedger,
    cursor: response.cursor,
    startLedger,
    historyGap,
  };
}
