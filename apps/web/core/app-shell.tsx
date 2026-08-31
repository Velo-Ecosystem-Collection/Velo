"use client";

import { stellarConfig } from "@/core/config/stellar";
import { shortenAddress } from "@/core/wallet/format";
import { useWallet } from "@/core/wallet/wallet-provider";
import { useUserProfile } from "@/features/onboarding/use-user-profile";
import { api } from "@repo/backend/convex/_generated/api";
import { Badge } from "@repo/ui/components/ui-customs/badge";
import { AppSidebar } from "@repo/ui/components/ui-customs/sidebar/app-sidebar";
import { Alert, AlertDescription, AlertTitle } from "@repo/ui/components/ui/alert";
import { Separator } from "@repo/ui/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@repo/ui/components/ui/sidebar";
import { useQuery, useConvexAuth } from "convex/react";
import { Loader2Icon, PlugZapIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const selectedProjectStoragePrefix = "velo:selected-project";

type SelectedProjectContextValue = {
  selectedProjectId: string | null;
  projectCount: number;
  projectsLoaded: boolean;
};

const SelectedProjectContext = createContext<SelectedProjectContextValue>({
  selectedProjectId: null,
  projectCount: 0,
  projectsLoaded: false,
});

export function useSelectedProject() {
  return useContext(SelectedProjectContext);
}

const walletStatusCopy = {
  initializing: "Loading wallet support",
  ready: "Wallet ready",
  connected: "Wallet connected",
  connecting: "Opening wallet modal",
  disconnected: "Wallet disconnected",
  unavailable: "Wallet unavailable",
  rejected: "Connection rejected",
  unsupported: "Unsupported network",
  stale: "Session needs reconnect",
  error: "Wallet error",
} as const;

export function AppShell({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  const { isAuthenticated: isConvexAuthenticated } = useConvexAuth();
  const { user, isNewUser, isLoading } = useUserProfile(wallet.address);
  const pathname = usePathname();
  const router = useRouter();
  const [storedSelectedProjectId, setStoredSelectedProjectId] = useState<string | null>(null);
  const [loadedSelectedProjectStorageKey, setLoadedSelectedProjectStorageKey] = useState<
    string | null
  >(null);

  const showWalletNotice = ["unavailable", "unsupported", "rejected", "stale", "error"].includes(
    wallet.status,
  );

  const isProtectedRoute =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/billing") ||
    pathname.startsWith("/projects") ||
    pathname.startsWith("/profile");
  const showSidebar =
    isProtectedRoute ||
    pathname.startsWith("/verify") ||
    pathname === "/debug" ||
    pathname === "/docs" ||
    pathname === "/playground" ||
    pathname === "/feedback";

  useEffect(() => {
    if (wallet.status === "initializing" || isLoading) {
      return;
    }

    if (isProtectedRoute && wallet.status !== "connected") {
      router.push("/login");
    } else if (
      wallet.status === "connected" &&
      isNewUser &&
      pathname !== "/signup" &&
      pathname !== "/playground"
    ) {
      router.push("/signup");
    }
  }, [wallet.status, isNewUser, isLoading, isProtectedRoute, pathname, router]);

  const handleEditProfile = useCallback(() => {
    router.push("/profile");
  }, [router]);

  // Fetch projects list for the sidebar switcher
  const rawProjects = useQuery(
    api.projects.query.listByOwner,
    wallet.address && isConvexAuthenticated ? {} : "skip",
  );

  const sidebarProjects = useMemo(() => {
    if (!rawProjects) return [];
    return rawProjects.map((p) => ({
      id: p._id,
      name: p.name,
      status: p.status,
      slug: p.slug,
      logoUrl: p.logoUrl,
    }));
  }, [rawProjects]);

  const selectedProjectStorageKey = useMemo(() => {
    return wallet.address ? `${selectedProjectStoragePrefix}:${wallet.address}` : null;
  }, [wallet.address]);
  const hasLoadedStoredSelectedProject =
    selectedProjectStorageKey === null ||
    loadedSelectedProjectStorageKey === selectedProjectStorageKey;

  useEffect(() => {
    if (!selectedProjectStorageKey) {
      setStoredSelectedProjectId(null);
      setLoadedSelectedProjectStorageKey(null);
      return;
    }

    setStoredSelectedProjectId(window.localStorage.getItem(selectedProjectStorageKey));
    setLoadedSelectedProjectStorageKey(selectedProjectStorageKey);
  }, [selectedProjectStorageKey]);

  // Parse route project from path if applicable (e.g. /projects/projectId or /verify/slug)
  const routeProjectId = useMemo(() => {
    const projectsMatch = pathname.match(/^\/projects\/([a-zA-Z0-9_-]+)/);
    if (projectsMatch && projectsMatch[1] !== "new") {
      return projectsMatch[1];
    }
    const verifyMatch = pathname.match(/^\/verify\/([a-zA-Z0-9_-]+)/);
    if (verifyMatch) {
      const slug = verifyMatch[1];
      const project = sidebarProjects.find((p) => p.slug === slug);
      if (project) {
        return project.id;
      }
    }
    return null;
  }, [pathname, sidebarProjects]);

  const activeProjectId = useMemo(() => {
    if (routeProjectId) {
      return routeProjectId;
    }

    if (!rawProjects) {
      return storedSelectedProjectId;
    }

    if (!hasLoadedStoredSelectedProject) {
      return null;
    }

    const storedProject = sidebarProjects.find((project) => project.id === storedSelectedProjectId);
    return storedProject?.id ?? sidebarProjects[0]?.id ?? null;
  }, [
    hasLoadedStoredSelectedProject,
    rawProjects,
    routeProjectId,
    sidebarProjects,
    storedSelectedProjectId,
  ]);

  const rememberSelectedProject = useCallback(
    (id: string) => {
      setStoredSelectedProjectId(id);
      if (selectedProjectStorageKey) {
        window.localStorage.setItem(selectedProjectStorageKey, id);
      }
    },
    [selectedProjectStorageKey],
  );

  useEffect(() => {
    if (routeProjectId) {
      rememberSelectedProject(routeProjectId);
      return;
    }

    if (
      rawProjects &&
      hasLoadedStoredSelectedProject &&
      activeProjectId &&
      activeProjectId !== storedSelectedProjectId
    ) {
      rememberSelectedProject(activeProjectId);
    }
  }, [
    activeProjectId,
    hasLoadedStoredSelectedProject,
    rawProjects,
    rememberSelectedProject,
    routeProjectId,
    storedSelectedProjectId,
  ]);

  const sidebarUser = useMemo(() => {
    if (user) {
      return {
        name: user.name,
        email: user.email,
        avatar: user.avatarUrl ?? "",
      };
    }
    if (wallet.address) {
      return {
        name: shortenAddress(wallet.address),
        email: `${wallet.address.slice(0, 8)}...`,
        avatar: "",
      };
    }
    return null;
  }, [user, wallet.address]);

  const handleSelectProject = useCallback(
    (id: string) => {
      rememberSelectedProject(id);

      if (pathname === "/dashboard") {
        return;
      }

      const projectRouteMatch = pathname.match(/^\/projects\/([a-zA-Z0-9_-]+)(\/.*)?$/);
      if (projectRouteMatch && projectRouteMatch[1] !== "new" && projectRouteMatch[2]) {
        router.push(`/projects/${id}${projectRouteMatch[2]}`);
        return;
      }

      router.push("/dashboard");
    },
    [pathname, rememberSelectedProject, router],
  );

  const handleCreateProject = useCallback(() => {
    router.push("/projects/new");
  }, [router]);

  const handleNavigate = useCallback(
    (url: string) => {
      if (url === "/dashboard" && activeProjectId) {
        rememberSelectedProject(activeProjectId);
      }
      router.push(url);
    },
    [activeProjectId, rememberSelectedProject, router],
  );

  const handlePrefetch = useCallback(
    (url: string) => {
      router.prefetch(url);
    },
    [router],
  );

  useEffect(() => {
    const activeProject = sidebarProjects.find((project) => project.id === activeProjectId);
    const urls = [
      "/dashboard",
      "/billing",
      "/profile",
      "/debug",
      "/docs",
      "/playground",
      "/projects/new",
    ];

    if (activeProject) {
      urls.push(
        `/projects/${activeProject.id}/contracts`,
        `/projects/${activeProject.id}/playground`,
        `/projects/${activeProject.id}/events`,
        `/projects/${activeProject.id}/webhooks`,
        `/projects/${activeProject.id}/api-keys`,
        `/projects/${activeProject.id}/integration`,
        `/projects/${activeProject.id}/settings`,
      );

      if (activeProject.slug) {
        urls.push(`/verify/${activeProject.slug}`);
      }
    }

    for (const url of urls) {
      router.prefetch(url);
    }
  }, [activeProjectId, router, sidebarProjects]);

  if (showSidebar) {
    return (
      <SidebarProvider className="min-h-dvh overflow-x-clip">
        <SelectedProjectContext
          value={{
            selectedProjectId: activeProjectId,
            projectCount: sidebarProjects.length,
            projectsLoaded:
              rawProjects !== undefined &&
              (routeProjectId !== null || hasLoadedStoredSelectedProject),
          }}
        >
          <AppSidebar
            user={sidebarUser}
            projects={sidebarProjects}
            activeProjectId={activeProjectId}
            currentPath={pathname}
            onSelectProject={handleSelectProject}
            onCreateProject={handleCreateProject}
            onNavigate={handleNavigate}
            onPrefetch={handlePrefetch}
            onEditProfile={handleEditProfile}
            onDisconnect={wallet.disconnect}
            onConnect={wallet.connect}
            isConnecting={wallet.status === "connecting"}
          />
          <SidebarInset className="flex min-h-dvh max-w-full min-w-0 flex-col overflow-x-clip bg-background text-foreground">
            {/* Top Bar for Protected Pages */}
            <header className="flex min-h-16 shrink-0 items-center gap-2 border-b border-border bg-card px-4 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:gap-4 sm:px-6">
              <SidebarTrigger className="-ml-1 size-9 sm:size-7" />
              <Separator orientation="vertical" className="mr-2 h-4" />

              <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
                <Badge variant="info">{stellarConfig.networkLabel}</Badge>
                <Badge
                  variant={
                    wallet.address ? "success" : wallet.status === "stale" ? "warning" : "gray"
                  }
                  className="hidden sm:inline-flex"
                >
                  {wallet.walletName ?? "No wallet"}
                </Badge>
                <Badge
                  variant={wallet.address ? "success" : "warning"}
                  className="max-w-36 truncate sm:max-w-none"
                >
                  {wallet.address
                    ? shortenAddress(wallet.address)
                    : walletStatusCopy[wallet.status]}
                </Badge>
              </div>
            </header>

            <main className="max-w-full min-w-0 flex-1 overflow-x-clip overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6 lg:p-8">
              {showWalletNotice ? (
                <Alert className="mb-6">
                  <PlugZapIcon />
                  <AlertTitle>{walletStatusCopy[wallet.status]}</AlertTitle>
                  <AlertDescription>
                    {wallet.error ??
                      (wallet.staleAddress
                        ? `Reconnect ${shortenAddress(wallet.staleAddress)} to continue with owner-scoped projects.`
                        : "Use a Stellar Testnet wallet to create and manage draft projects.")}
                  </AlertDescription>
                </Alert>
              ) : null}

              {isProtectedRoute && !isConvexAuthenticated ? (
                <div className="flex min-h-[50vh] items-center justify-center">
                  <Loader2Icon className="h-8 w-8 animate-spin text-zinc-400" />
                </div>
              ) : (
                children
              )}
            </main>
          </SidebarInset>
        </SelectedProjectContext>
      </SidebarProvider>
    );
  }

  return (
    <main className="flex min-h-dvh max-w-full flex-col justify-center overflow-x-clip bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-6 lg:px-8">
        {showWalletNotice ? (
          <Alert>
            <PlugZapIcon />
            <AlertTitle>{walletStatusCopy[wallet.status]}</AlertTitle>
            <AlertDescription>
              {wallet.error ??
                (wallet.staleAddress
                  ? `Reconnect ${shortenAddress(wallet.staleAddress)} to continue with owner-scoped projects.`
                  : "Use a Stellar Testnet wallet to create and manage draft projects.")}
            </AlertDescription>
          </Alert>
        ) : null}

        {children}
      </div>
    </main>
  );
}
