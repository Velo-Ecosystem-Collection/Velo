"use client";

import { getFunctionName } from "convex/server";
import { useSyncExternalStore, type ReactNode, type JSXElementConstructor } from "react";

import { getGasFixtureStore, installGasFixtureBrowserApi } from "./store";

function useFixtureRevision() {
  const store = getGasFixtureStore();
  installGasFixtureBrowserApi(store);
  return [
    store,
    useSyncExternalStore(store.subscribe, store.getRevision, store.getRevision),
  ] as const;
}

export function useConvexAuth() {
  const [store] = useFixtureRevision();
  const wallet = store.getWalletSnapshot();
  return {
    isLoading: false,
    isAuthenticated: wallet.address !== null,
  };
}

export function useConvexConnectionState() {
  const [store] = useFixtureRevision();
  return store.getConnectionState();
}

export function useQuery(query: unknown, args: unknown = {}) {
  const [store] = useFixtureRevision();
  if (args === "skip") return undefined;
  return store.useQuery(getFunctionName(query as Parameters<typeof getFunctionName>[0]), args);
}

export function useMutation(mutation: unknown) {
  const [store] = useFixtureRevision();
  const functionName = getFunctionName(mutation as Parameters<typeof getFunctionName>[0]);
  return (args: unknown) => store.dispatchMutation(functionName, args);
}

export function useAction(action: unknown) {
  const [store] = useFixtureRevision();
  const functionName = getFunctionName(action as Parameters<typeof getFunctionName>[0]);
  return (args: unknown) => store.dispatchAction(functionName, args);
}

export function usePaginatedQuery(
  query: unknown,
  args: unknown,
  options: { initialNumItems: number },
) {
  const [store] = useFixtureRevision();
  if (args === "skip") {
    return {
      results: [],
      status: "LoadingFirstPage" as const,
      isLoading: true,
      loadMore: () => undefined,
    };
  }
  return store.usePaginatedQuery(
    getFunctionName(query as Parameters<typeof getFunctionName>[0]),
    args as { projectId: "project-gas-owner" | "project-gas-member" },
    options.initialNumItems,
  );
}

export function ConvexProviderWithAuth({ children }: { children: ReactNode }) {
  return children;
}

export function ConvexProvider({ children }: { children: ReactNode }) {
  return children;
}

export function ConvexReactClient() {
  return null as unknown as JSXElementConstructor<unknown>;
}
