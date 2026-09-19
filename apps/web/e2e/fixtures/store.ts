import type {
  GasExecutionDetailSnapshot,
  GasLogSnapshot,
  GasPolicySnapshot,
  GasRelayerRefreshResult,
  GasRelayerSnapshot,
  GasTelemetrySnapshot,
} from "@/features/projects/gas-ui";

export const GAS_E2E_STORAGE_KEY = "velo:e2e:gas-fixture";

export type GasFixtureSession = "owner" | "editor" | "viewer" | "nonmember" | "disconnected";
export type GasFixtureProjectId = "project-gas-owner" | "project-gas-member";
export type GasFixtureScenario =
  | "default"
  | "policy-denial"
  | "policy-read-error"
  | "activity-read-error"
  | "telemetry-read-error"
  | "balance-failure"
  | "balance-account-not-found"
  | "balance-cooldown";

export type GasFixtureConfig = {
  session: GasFixtureSession;
  projectId: GasFixtureProjectId;
  scenario?: GasFixtureScenario;
};

export type GasFixtureCall = {
  id: number;
  kind: "query" | "mutation" | "action";
  functionName: string;
  args: unknown;
  status: "pending" | "fulfilled" | "rejected";
};

type Listener = () => void;
type Completion = { resolve: (value: unknown) => void; reject: (reason: unknown) => void };

type StoredPolicy = GasPolicySnapshot;

type FixtureProject = {
  _id: GasFixtureProjectId;
  name: string;
  slug: string;
  status: "registered";
  ownerAddress: string;
  paymentAccessActive: boolean;
};

type FixtureSession = {
  address: string | null;
  roleByProject: Partial<Record<GasFixtureProjectId, "owner" | "editor" | "viewer">>;
  ownerProjects: GasFixtureProjectId[];
};

type PaginationRecord = {
  functionName: string;
  args: { projectId: GasFixtureProjectId };
  visibleCount: number;
  nextCursor: string | null;
  initialCallId: number;
};

const OWNER_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const EDITOR_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHG";
const VIEWER_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHH";
const NONMEMBER_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHJ";

const projects: Record<GasFixtureProjectId, FixtureProject> = {
  "project-gas-owner": {
    _id: "project-gas-owner",
    name: "Owner Gas Project",
    slug: "owner-gas-project",
    status: "registered",
    ownerAddress: OWNER_ADDRESS,
    paymentAccessActive: false,
  },
  "project-gas-member": {
    _id: "project-gas-member",
    name: "Member-only Gas Project",
    slug: "member-only-gas-project",
    status: "registered",
    ownerAddress: OWNER_ADDRESS,
    paymentAccessActive: false,
  },
};

const sessions: Record<GasFixtureSession, FixtureSession> = {
  owner: {
    address: OWNER_ADDRESS,
    roleByProject: { "project-gas-owner": "owner" },
    ownerProjects: ["project-gas-owner"],
  },
  editor: {
    address: EDITOR_ADDRESS,
    roleByProject: { "project-gas-owner": "editor" },
    ownerProjects: [],
  },
  viewer: {
    address: VIEWER_ADDRESS,
    roleByProject: { "project-gas-member": "viewer" },
    ownerProjects: [],
  },
  nonmember: {
    address: NONMEMBER_ADDRESS,
    roleByProject: {},
    ownerProjects: [],
  },
  disconnected: {
    address: null,
    roleByProject: {},
    ownerProjects: [],
  },
};

const VALID_CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
const OBSERVED_AT = Date.parse("2026-09-16T12:00:00.000Z");
const RELAYER_PUBLIC_KEY = "GA54SPC34JL3I57ENALTO2V26XOFFG4VGQLFQXDGF6KJ5TJY7ODY56ST";
const INNER_HASH = "a".repeat(64);
const OUTER_HASH = "b".repeat(64);

const policies: Record<GasFixtureProjectId, StoredPolicy> = {
  "project-gas-owner": {
    enabled: true,
    network: "testnet",
    dailyCapStroops: "200000000",
    dailyReservedStroops: "7500000",
    dailyWindowKey: "2026-09-16",
    walletHourlyLimit: 60,
    allowedContractIds: [VALID_CONTRACT_ID],
    createdAt: OBSERVED_AT - 86_400_000,
    updatedAt: OBSERVED_AT,
  },
  "project-gas-member": {
    enabled: true,
    network: "testnet",
    dailyCapStroops: "100000000",
    dailyReservedStroops: "0",
    dailyWindowKey: "2026-09-16",
    walletHourlyLimit: 30,
    allowedContractIds: [],
    createdAt: OBSERVED_AT - 86_400_000,
    updatedAt: OBSERVED_AT,
  },
};

const relayers: Record<GasFixtureProjectId, GasRelayerSnapshot> = {
  "project-gas-owner": {
    publicKey: RELAYER_PUBLIC_KEY,
    network: "testnet",
    status: "active",
    balanceStroops: "42000000",
    balanceUpdatedAt: OBSERVED_AT,
    createdAt: OBSERVED_AT - 86_400_000,
    updatedAt: OBSERVED_AT,
  },
  "project-gas-member": {
    publicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAARM2",
    network: "testnet",
    status: "active",
    balanceStroops: "0",
    balanceUpdatedAt: OBSERVED_AT,
    createdAt: OBSERVED_AT - 86_400_000,
    updatedAt: OBSERVED_AT,
  },
};

function logFor(index: number): GasLogSnapshot {
  const requestId = `gas-e2e-${String(index + 1).padStart(3, "0")}`;
  const lifecycle: GasLogSnapshot["lifecycle"] =
    index === 0
      ? "succeeded"
      : index === 1
        ? "submitted"
        : index === 2
          ? "submission_unknown"
          : index === 3
            ? "rejected"
            : index === 4
              ? "expired"
              : "failed";
  const isRejected = lifecycle === "rejected";

  return {
    requestId,
    transactionHash: isRejected ? null : index === 0 ? INNER_HASH : `${index}`.repeat(64),
    sourceWallet: isRejected ? "G-E2E-REJECTED-WALLET" : `G-E2E-SOURCE-${index + 1}`,
    targetContractIds: isRejected ? null : [VALID_CONTRACT_ID],
    innerMaxFeeStroops: isRejected ? null : "100000",
    reservedStroops: isRejected ? null : "100100",
    actualFeeStroops: index === 0 ? "12345678" : index === 4 ? "0" : isRejected ? null : null,
    decisionCode: isRejected ? "rejected" : "reserved",
    rejectionCode: isRejected ? "contract_not_whitelisted" : null,
    lifecycle,
    expiresAt: OBSERVED_AT + 900_000 - index * 60_000,
    createdAt: OBSERVED_AT - index * 60_000,
    updatedAt: OBSERVED_AT - index * 55_000,
  };
}

const activityLogs = Array.from({ length: 40 }, (_, index) => logFor(index));

const executionDetails: Record<string, GasExecutionDetailSnapshot> = {
  "gas-e2e-001": {
    object: "gas_submit_result",
    requestId: "gas-e2e-001",
    transactionHash: INNER_HASH,
    outerTransactionHash: OUTER_HASH,
    status: "succeeded",
    reservedStroops: "100100",
    actualFeeStroops: "12345678",
    expiresAt: "2026-09-16T12:15:00.000Z",
    reconciliationRequired: false,
  },
  "gas-e2e-002": {
    object: "gas_submit_result",
    requestId: "gas-e2e-002",
    transactionHash: "2".repeat(64),
    outerTransactionHash: null,
    status: "submitted",
    reservedStroops: "100100",
    actualFeeStroops: null,
    expiresAt: "2026-09-16T12:14:00.000Z",
    reconciliationRequired: true,
  },
  "gas-e2e-003": {
    object: "gas_submit_result",
    requestId: "gas-e2e-003",
    transactionHash: "3".repeat(64),
    outerTransactionHash: "not-a-validated-hash",
    status: "submission_unknown",
    reservedStroops: "100100",
    actualFeeStroops: null,
    expiresAt: "2026-09-16T12:13:00.000Z",
    reconciliationRequired: true,
  },
};

function dayKeys(reportingDayKey: string): string[] {
  const start = new Date(`${reportingDayKey}T00:00:00.000Z`);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setUTCDate(day.getUTCDate() - (6 - index));
    return day.toISOString().slice(0, 10);
  });
}

function telemetryFor(
  reportingDayKey: string,
  projectId: GasFixtureProjectId,
  updateVersion: number,
): GasTelemetrySnapshot {
  const currentFee = projectId === "project-gas-owner" ? 12_345_678 + updateVersion : 0;
  const history = dayKeys(reportingDayKey).map((day, index) => ({
    reportingDayKey: day,
    confirmedFeeStroops: index === 0 ? null : index === 1 ? "0" : String(currentFee),
    sourceUpdatedAt: index === 0 ? null : OBSERVED_AT,
  }));
  return {
    reportingDayKey,
    confirmedFeeStroops: String(currentFee),
    outstandingHoldsStroops: projectId === "project-gas-owner" ? "2500000" : "0",
    effectiveUsageStroops: projectId === "project-gas-owner" ? String(currentFee + 2_500_000) : "0",
    policyCapStroops: policies[projectId].dailyCapStroops,
    availability: "available",
    reasonCode: null,
    accountingBlockReason: null,
    sourceUpdatedAt: OBSERVED_AT,
    historyCompleteness: "partial",
    history,
  };
}

function readInitialConfig(): GasFixtureConfig {
  if (typeof window === "undefined") {
    return { session: "disconnected", projectId: "project-gas-owner", scenario: "default" };
  }

  try {
    const stored = JSON.parse(
      window.localStorage.getItem(GAS_E2E_STORAGE_KEY) ?? "null",
    ) as Partial<GasFixtureConfig>;
    if (
      (stored.session === "owner" ||
        stored.session === "editor" ||
        stored.session === "viewer" ||
        stored.session === "nonmember" ||
        stored.session === "disconnected") &&
      (stored.projectId === "project-gas-owner" || stored.projectId === "project-gas-member")
    ) {
      return {
        session: stored.session,
        projectId: stored.projectId,
        scenario: stored.scenario ?? "default",
      };
    }
  } catch {
    // Invalid test storage uses the safe disconnected default.
  }

  return { session: "disconnected", projectId: "project-gas-owner", scenario: "default" };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class GasFixtureStore {
  private config: GasFixtureConfig = readInitialConfig();
  private readonly listeners = new Set<Listener>();
  private readonly queries = new Map<string, number>();
  private readonly pagination = new Map<string, PaginationRecord>();
  private readonly pending = new Map<number, Completion>();
  private readonly retiredCalls = new Map<number, GasFixtureCall>();
  private readonly calls: GasFixtureCall[] = [];
  private revision = 0;
  private callId = 0;
  private updateVersion = 0;
  private connectionCount = 1;
  private isConnected = this.config.session !== "disconnected";

  readonly subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getRevision = () => this.revision;

  getConfig(): GasFixtureConfig {
    return { ...this.config };
  }

  getCalls(): GasFixtureCall[] {
    return clone(this.calls);
  }

  getConnectionState() {
    return {
      isWebSocketConnected: this.isConnected,
      hasEverConnected: this.isConnected || this.connectionCount > 1,
      connectionCount: this.connectionCount,
    };
  }

  configure(next: Partial<GasFixtureConfig> & Pick<GasFixtureConfig, "session">) {
    this.config = {
      ...this.config,
      ...next,
      projectId: next.projectId ?? this.config.projectId,
      scenario: next.scenario ?? "default",
    };
    this.isConnected = this.config.session !== "disconnected";
    this.connectionCount = 1;
    this.updateVersion = 0;
    this.queries.clear();
    this.pagination.clear();
    for (const call of this.calls) {
      if (call.status === "pending" && this.pending.has(call.id)) {
        this.retiredCalls.set(call.id, call);
      }
    }
    this.calls.length = 0;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(GAS_E2E_STORAGE_KEY, JSON.stringify(this.config));
    }
    this.notify();
  }

  setScenario(scenario: GasFixtureScenario) {
    this.config = { ...this.config, scenario };
    this.queries.clear();
    this.pagination.clear();
    if (typeof window !== "undefined") {
      window.localStorage.setItem(GAS_E2E_STORAGE_KEY, JSON.stringify(this.config));
    }
    this.notify();
  }

  setConnection(connected: boolean) {
    if (connected && !this.isConnected) this.connectionCount += 1;
    this.isConnected = connected;
    this.notify();
  }

  simulateReactiveUpdate() {
    this.updateVersion += 1;
    this.notify();
  }

  simulateStoredPolicyUpdate() {
    const projectId = this.config.projectId;
    policies[projectId] = {
      ...policies[projectId],
      dailyCapStroops: (BigInt(policies[projectId].dailyCapStroops) + 10_000_000n).toString(),
      updatedAt: Date.now(),
    };
    this.notify();
  }

  getWalletSnapshot() {
    const session = sessions[this.config.session];
    const connected = session.address !== null;
    return {
      address: session.address,
      walletId: connected ? "gas-e2e-wallet" : null,
      walletName: connected ? "Simulated test wallet" : null,
      status: connected ? ("connected" as const) : ("disconnected" as const),
      error: null,
      errorCode: null,
      supportedWallets: connected
        ? [{ id: "gas-e2e-wallet", name: "Simulated test wallet", isAvailable: true }]
        : [],
      staleAddress: null,
    };
  }

  disconnect() {
    this.configure({ session: "disconnected" });
  }

  connect() {
    this.configure({ session: "owner", projectId: "project-gas-owner" });
    return Promise.resolve();
  }

  signTransaction(xdr: string) {
    return Promise.resolve(xdr);
  }

  signMessage(message: string) {
    return Promise.resolve(message);
  }

  useQuery(functionName: string, args: unknown): unknown {
    const key = this.queryKey(functionName, args);
    if (!this.queries.has(key)) {
      this.record("query", functionName, args);
      this.queries.set(key, this.callId);
    }
    return this.queryValue(functionName, args);
  }

  usePaginatedQuery(
    functionName: string,
    args: { projectId: GasFixtureProjectId },
    initialNumItems: number,
  ) {
    const key = this.queryKey(functionName, args);
    let page = this.pagination.get(key);
    if (!page) {
      const initialCallId = this.record("query", functionName, {
        ...args,
        paginationOpts: { numItems: initialNumItems, cursor: null, id: this.callId + 1 },
      });
      page = {
        functionName,
        args,
        visibleCount: initialNumItems,
        nextCursor: `cursor:${initialNumItems}`,
        initialCallId,
      };
      this.pagination.set(key, page);
    }

    if (this.config.scenario === "activity-read-error") {
      throw new Error("fixture activity provider failure");
    }

    const logs = this.logsFor(args.projectId);
    const visibleLogs = logs.slice(0, page.visibleCount);
    const status =
      page.visibleCount >= logs.length
        ? "Exhausted"
        : page.visibleCount === initialNumItems
          ? "CanLoadMore"
          : "CanLoadMore";

    return {
      results: visibleLogs,
      status,
      isLoading: false,
      loadMore: (numItems: number) => this.loadMore(key, numItems),
    } as const;
  }

  loadMore(key: string, numItems: number) {
    const page = this.pagination.get(key);
    if (!page || page.visibleCount >= this.logsFor(page.args.projectId).length) return;
    const nextVisibleCount = Math.min(
      page.visibleCount + numItems,
      this.logsFor(page.args.projectId).length,
    );
    this.record("query", page.functionName, {
      ...page.args,
      paginationOpts: {
        numItems,
        cursor: page.nextCursor,
        id: page.initialCallId,
      },
    });
    page.visibleCount = nextVisibleCount;
    page.nextCursor = `cursor:${nextVisibleCount}`;
    this.notify();
  }

  dispatchMutation(functionName: string, args: unknown): Promise<unknown> {
    const callId = this.record("mutation", functionName, args);
    return new Promise((resolve, reject) => {
      this.pending.set(callId, {
        resolve: (value) => {
          this.updateCall(callId, "fulfilled");
          resolve(value);
        },
        reject: (reason) => {
          this.updateCall(callId, "rejected");
          reject(reason);
        },
      });
    });
  }

  dispatchAction(functionName: string, args: unknown): Promise<unknown> {
    const callId = this.record("action", functionName, args);
    return new Promise((resolve, reject) => {
      this.pending.set(callId, {
        resolve: (value) => {
          this.updateCall(callId, "fulfilled");
          resolve(value);
        },
        reject: (reason) => {
          this.updateCall(callId, "rejected");
          reject(reason);
        },
      });
    });
  }

  resolveNext(functionName?: string, value?: unknown) {
    const call = [...this.calls, ...this.retiredCalls.values()].find(
      (candidate) =>
        candidate.status === "pending" &&
        this.pending.has(candidate.id) &&
        (functionName === undefined || candidate.functionName === functionName),
    );
    if (!call) throw new Error(`No pending fixture call for ${functionName ?? "any function"}`);
    const completion = this.pending.get(call.id);
    this.pending.delete(call.id);
    if (
      call.functionName === "gas/mutations:updatePolicy" &&
      this.config.scenario === "policy-denial"
    ) {
      completion?.reject({ data: { code: "daily_cap_below_effective_usage" } });
    } else {
      completion?.resolve(value ?? this.defaultCompletion(call));
    }
    this.retiredCalls.delete(call.id);
    this.notify();
  }

  rejectNext(functionName?: string, message = "fixture completion rejected") {
    const call = [...this.calls, ...this.retiredCalls.values()].find(
      (candidate) =>
        candidate.status === "pending" &&
        this.pending.has(candidate.id) &&
        (functionName === undefined || candidate.functionName === functionName),
    );
    if (!call) throw new Error(`No pending fixture call for ${functionName ?? "any function"}`);
    const completion = this.pending.get(call.id);
    this.pending.delete(call.id);
    completion?.reject(new Error(message));
    this.retiredCalls.delete(call.id);
    this.notify();
  }

  private queryValue(functionName: string, args: unknown): unknown {
    const config = this.config;
    const projectId = this.projectIdFromArgs(args);
    const session = sessions[config.session];
    const role = projectId ? session.roleByProject[projectId] : undefined;

    switch (functionName) {
      case "projects/query:listByOwner":
        return session.ownerProjects.map((id) => clone(projects[id]));
      case "users/query:getByWallet":
        return session.address
          ? {
              _id: `user-${config.session}`,
              walletAddress: session.address,
              name: `${config.session.charAt(0).toUpperCase()}${config.session.slice(1)} operator`,
              email: `${config.session}@gas-e2e.test`,
              avatarUrl: undefined,
            }
          : null;
      case "playground_projects/queries:getMyAccess":
        return role ? { role } : null;
      case "projects/query:getById":
        return projectId && role ? clone(projects[projectId]) : null;
      case "projects/query:listApiKeys":
        // Integration guidance must render without exposing or inventing a credential.
        return [];
      case "gas/queries:getPolicy":
        if (config.scenario === "policy-read-error") {
          throw new Error("fixture policy provider failure");
        }
        return projectId && role ? clone(policies[projectId]) : null;
      case "gas/queries:getRelayerAccount":
        return projectId && role ? clone(relayers[projectId]) : null;
      case "gas/queries:getTelemetry":
        if (config.scenario === "telemetry-read-error") {
          throw new Error("fixture telemetry provider failure");
        }
        return projectId && role
          ? telemetryFor(this.telemetryDayFromArgs(args), projectId, this.updateVersion)
          : null;
      case "gas/queries:getExecutionDetail": {
        const requestId = this.stringFromArgs(args, "requestId");
        return requestId ? clone(executionDetails[requestId] ?? null) : null;
      }
      default:
        throw new Error(`Unexpected Gas E2E fixture query: ${functionName}`);
    }
  }

  private defaultCompletion(call: GasFixtureCall): unknown {
    if (call.functionName === "gas/mutations:updatePolicy") {
      const args = call.args as {
        projectId: GasFixtureProjectId;
        enabled: boolean;
        dailyCapStroops: string;
        walletHourlyLimit: number;
        allowedContractIds: string[];
      };
      const saved: StoredPolicy = {
        ...policies[args.projectId],
        enabled: args.enabled,
        dailyCapStroops: args.dailyCapStroops,
        walletHourlyLimit: args.walletHourlyLimit,
        allowedContractIds: [...args.allowedContractIds],
        updatedAt: Date.now(),
      };
      policies[args.projectId] = saved;
      this.notify();
      return clone(saved);
    }

    if (call.functionName === "gas/mutations:updateRelayerAccount") {
      const args = call.args as {
        projectId: GasFixtureProjectId;
        publicKey: string;
        status: GasRelayerSnapshot["status"];
      };
      const current = relayers[args.projectId];
      const keyChanged = current.publicKey !== args.publicKey;
      const saved: GasRelayerSnapshot = {
        ...current,
        publicKey: args.publicKey,
        status: args.status,
        balanceStroops: keyChanged ? null : current.balanceStroops,
        balanceUpdatedAt: keyChanged ? null : current.balanceUpdatedAt,
        updatedAt: Date.now(),
      };
      relayers[args.projectId] = saved;
      this.notify();
      return clone(saved);
    }

    if (call.functionName === "gas/balance_action:refreshRelayerBalance") {
      const projectId = this.projectIdFromArgs(call.args) ?? "project-gas-owner";
      if (this.config.scenario === "balance-cooldown")
        return { status: "cooldown", retryAfterMs: 10_000 };
      if (this.config.scenario === "balance-account-not-found") {
        return { status: "account_not_found", relayer: clone(relayers[projectId]) };
      }
      if (this.config.scenario === "balance-failure") {
        return {
          status: "reader_failure",
          reason: "provider_failure",
          relayer: clone(relayers[projectId]),
        } satisfies GasRelayerRefreshResult;
      }
      relayers[projectId] = {
        ...relayers[projectId],
        balanceStroops: "43000000",
        balanceUpdatedAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.notify();
      return {
        status: "success",
        relayer: clone(relayers[projectId]),
      } satisfies GasRelayerRefreshResult;
    }

    throw new Error(`Unexpected Gas E2E fixture completion: ${call.functionName}`);
  }

  private logsFor(projectId: GasFixtureProjectId): GasLogSnapshot[] {
    return projectId === "project-gas-owner"
      ? clone(activityLogs)
      : clone(activityLogs.slice(0, 2));
  }

  private record(kind: GasFixtureCall["kind"], functionName: string, args: unknown): number {
    const supported = new Set([
      "projects/query:listByOwner",
      "users/query:getByWallet",
      "playground_projects/queries:getMyAccess",
      "projects/query:getById",
      "projects/query:listApiKeys",
      "gas/queries:getPolicy",
      "gas/queries:getRelayerAccount",
      "gas/queries:getTelemetry",
      "gas/queries:listLogsPage",
      "gas/queries:getExecutionDetail",
      "gas/mutations:updatePolicy",
      "gas/mutations:updateRelayerAccount",
      "gas/balance_action:refreshRelayerBalance",
    ]);
    if (!supported.has(functionName)) {
      throw new Error(`Unexpected Gas E2E fixture call: ${functionName}`);
    }
    const id = ++this.callId;
    this.calls.push({
      id,
      kind,
      functionName,
      args: clone(args),
      status: kind === "query" ? "fulfilled" : "pending",
    });
    return id;
  }

  private updateCall(id: number, status: GasFixtureCall["status"]) {
    const call = [...this.calls, ...this.retiredCalls.values()].find(
      (candidate) => candidate.id === id,
    );
    if (call) call.status = status;
  }

  private queryKey(functionName: string, args: unknown): string {
    return `${functionName}:${JSON.stringify(args)}`;
  }

  private projectIdFromArgs(args: unknown): GasFixtureProjectId | null {
    if (!args || typeof args !== "object") return null;
    const value =
      (args as { projectId?: unknown; id?: unknown }).projectId ??
      (args as { projectId?: unknown; id?: unknown }).id;
    return value === "project-gas-owner" || value === "project-gas-member" ? value : null;
  }

  private stringFromArgs(args: unknown, key: string): string | null {
    if (!args || typeof args !== "object") return null;
    const value = (args as Record<string, unknown>)[key];
    return typeof value === "string" ? value : null;
  }

  private telemetryDayFromArgs(args: unknown): string {
    return this.stringFromArgs(args, "utcDayKey") ?? "2026-09-16";
  }

  private notify() {
    this.revision += 1;
    this.listeners.forEach((listener) => listener());
  }
}

let singleton: GasFixtureStore | null = null;

export function getGasFixtureStore(): GasFixtureStore {
  singleton ??= new GasFixtureStore();
  return singleton;
}

export type GasFixtureBrowserApi = {
  configure: (config: Partial<GasFixtureConfig> & Pick<GasFixtureConfig, "session">) => void;
  setScenario: (scenario: GasFixtureScenario) => void;
  setConnection: (connected: boolean) => void;
  simulateReactiveUpdate: () => void;
  simulateStoredPolicyUpdate: () => void;
  resolveNext: (functionName?: string, value?: unknown) => void;
  rejectNext: (functionName?: string, message?: string) => void;
  getCalls: () => GasFixtureCall[];
  getConfig: () => GasFixtureConfig;
};

declare global {
  interface Window {
    __veloGasE2E?: GasFixtureBrowserApi;
  }
}

export function installGasFixtureBrowserApi(store: GasFixtureStore) {
  if (typeof window === "undefined") return;
  window.__veloGasE2E ??= {
    configure: (config) => store.configure(config),
    setScenario: (scenario) => store.setScenario(scenario),
    setConnection: (connected) => store.setConnection(connected),
    simulateReactiveUpdate: () => store.simulateReactiveUpdate(),
    simulateStoredPolicyUpdate: () => store.simulateStoredPolicyUpdate(),
    resolveNext: (functionName, value) => store.resolveNext(functionName, value),
    rejectNext: (functionName, message) => store.rejectNext(functionName, message),
    getCalls: () => store.getCalls(),
    getConfig: () => store.getConfig(),
  };
}
