"use client";

import { NavMain } from "@repo/ui/components/ui-customs/sidebar/nav-main";
import { NavUser, SidebarUser } from "@repo/ui/components/ui-customs/sidebar/nav-user";
import {
  ProjectSwitcher,
  SwitcherProject,
} from "@repo/ui/components/ui-customs/sidebar/project-switcher";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@repo/ui/components/ui/sidebar";
import {
  ActivityIcon,
  BookOpenIcon,
  BracesIcon,
  FileCheckIcon,
  FileTextIcon,
  KeyIcon,
  LayoutDashboardIcon,
  TerminalIcon,
  FlaskConicalIcon,
  WalletIcon,
  WebhookIcon,
  BanknoteIcon,
  CreditCardIcon,
} from "lucide-react";
import * as React from "react";

export type SidebarProps = React.ComponentProps<typeof Sidebar> & {
  user: SidebarUser | null;
  projects?: SwitcherProject[];
  activeProjectId?: string | null;
  currentPath?: string;
  onSelectProject?: (id: string) => void;
  onCreateProject?: () => void;
  onEditProfile?: () => void;
  onDisconnect?: () => void;
  onNavigate?: (url: string) => void;
  onPrefetch?: (url: string) => void;
  onConnect?: () => void;
  isConnecting?: boolean;
};

function isPathActive(currentPath: string | undefined, url: string) {
  if (!currentPath) return false;
  if (url === "/dashboard") return currentPath === url;
  return currentPath === url || currentPath.startsWith(`${url}/`);
}

export function AppSidebar({
  user,
  projects = [],
  activeProjectId,
  currentPath,
  onSelectProject,
  onCreateProject,
  onEditProfile,
  onDisconnect,
  onNavigate,
  onPrefetch,
  onConnect,
  isConnecting,
  ...props
}: SidebarProps) {
  const activeProject = projects.find((project) => project.id === activeProjectId);
  const projectBaseUrl = activeProject ? `/projects/${activeProject.id}` : "/dashboard";
  const publicProofUrl = activeProject?.slug ? `/verify/${activeProject.slug}` : "/dashboard";
  const settingsUrl = activeProject ? `/projects/${activeProject.id}/settings` : undefined;

  const navItems = [
    {
      title: "Dashboard",
      url: "/dashboard",
      icon: LayoutDashboardIcon,
    },
  ].map((item) => ({
    ...item,
    isActive: isPathActive(currentPath, item.url),
  }));

  const navGroups = [
    {
      title: "Build",
      icon: BracesIcon,
      items: [
        {
          title: "Integration",
          url: `${projectBaseUrl}/integration`,
          icon: BracesIcon,
          disabled: !activeProject,
        },
        {
          title: "API Keys",
          url: `${projectBaseUrl}/api-keys`,
          icon: KeyIcon,
          disabled: !activeProject,
        },
        {
          title: "Wallets",
          url: `${projectBaseUrl}/wallets`,
          icon: WalletIcon,
          disabled: !activeProject,
        },
        {
          title: "Playground",
          url: "/playground",
          icon: FlaskConicalIcon,
        },
        {
          title: "Project Playground",
          url: `${projectBaseUrl}/playground`,
          icon: FlaskConicalIcon,
          disabled: !activeProject,
        },
        {
          title: "Docs",
          url: "/docs",
          icon: BookOpenIcon,
        },
      ],
    },
    {
      title: "Verify",
      icon: FileCheckIcon,
      items: [
        {
          title: "Contracts",
          url: `${projectBaseUrl}/contracts`,
          icon: FileCheckIcon,
          disabled: !activeProject,
        },
        {
          title: "Public Proof",
          url: publicProofUrl,
          icon: FileTextIcon,
          disabled: !activeProject?.slug,
        },
      ],
    },
    {
      title: "Observe",
      icon: ActivityIcon,
      items: [
        {
          title: "Events",
          url: `${projectBaseUrl}/events`,
          icon: ActivityIcon,
          disabled: !activeProject,
        },
        {
          title: "Webhooks",
          url: `${projectBaseUrl}/webhooks`,
          icon: WebhookIcon,
          disabled: !activeProject,
        },
        {
          title: "Velo Logs",
          url: activeProject ? `${projectBaseUrl}/playground#project-history` : "/playground",
          icon: ActivityIcon,
          disabled: !activeProject,
        },
        {
          title: "Debug",
          url: "/debug",
          icon: TerminalIcon,
        },
      ],
    },
    {
      title: "Pay",
      icon: CreditCardIcon,
      items: [
        {
          title: "Payments",
          url: `${projectBaseUrl}/payments`,
          icon: CreditCardIcon,
          disabled: !activeProject,
        },
      ],
    },
    {
      title: "Settle",
      icon: BanknoteIcon,
      items: [
        {
          title: "Settlement",
          url: `${projectBaseUrl}/settlement`,
          icon: BanknoteIcon,
          disabled: !activeProject,
        },
      ],
    },
  ].map((group) => ({
    ...group,
    items: group.items.map((item) => ({
      ...item,
      isActive: !item.disabled && isPathActive(currentPath, item.url),
    })),
    isActive: group.items.some((item) => !item.disabled && isPathActive(currentPath, item.url)),
  }));

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <ProjectSwitcher
          projects={projects}
          activeProjectId={activeProjectId}
          onSelectProject={onSelectProject}
          onCreateProject={onCreateProject}
        />
      </SidebarHeader>
      <SidebarContent className="gap-0">
        <NavMain
          items={navItems}
          groups={navGroups}
          onNavigate={onNavigate}
          onPrefetch={onPrefetch}
        />
      </SidebarContent>
      <SidebarFooter>
        {user ? (
          <NavUser
            user={user}
            onEditProfile={onEditProfile}
            onDisconnect={onDisconnect}
            feedbackUrl="/feedback"
            billingUrl="/billing"
            settingsUrl={settingsUrl}
            onNavigate={onNavigate}
          />
        ) : onConnect ? (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={onConnect}
                disabled={isConnecting}
                className="gap-2 text-zinc-600 hover:text-zinc-900"
              >
                <WalletIcon className="size-4" />
                <span>Connect Wallet</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        ) : null}
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
