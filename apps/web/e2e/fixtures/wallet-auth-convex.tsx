"use client";
import { createContext, useContext, type ReactNode } from "react";
export {
  useQuery,
  useMutation,
  useAction,
  usePaginatedQuery,
  useConvex,
  useConvexConnectionState,
  ConvexProvider,
} from "./convex-react";

type Auth = {
  isLoading: boolean;
  isAuthenticated: boolean;
  fetchAccessToken: (options: { forceRefreshToken: boolean }) => Promise<string | null>;
};
const Context = createContext({ isLoading: false, isAuthenticated: false });
export class ConvexReactClient {
  constructor(..._args: unknown[]) {}
}
export function ConvexProviderWithAuth({
  children,
  useAuth,
}: {
  children: ReactNode;
  useAuth: () => Auth;
}) {
  const auth = useAuth();
  return <Context.Provider value={auth}>{children}</Context.Provider>;
}
export function useConvexAuth() {
  return useContext(Context);
}
