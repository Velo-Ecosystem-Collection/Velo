"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@repo/ui/components/ui/sidebar";
import { ChevronsUpDown, Plus, FolderIcon } from "lucide-react";
import * as React from "react";

export type SwitcherProject = {
  id: string;
  name: string;
  status: string;
  slug?: string;
  logoUrl?: string;
};

export function ProjectSwitcher({
  projects = [],
  activeProjectId,
  onSelectProject,
  onCreateProject,
}: {
  projects: SwitcherProject[];
  activeProjectId?: string | null;
  onSelectProject?: (id: string) => void;
  onCreateProject?: () => void;
}) {
  const { isMobile } = useSidebar();

  const activeProject = React.useMemo(() => {
    return projects.find((p) => p.id === activeProjectId);
  }, [projects, activeProjectId]);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="flex aspect-square size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                {activeProject?.logoUrl ? (
                  <img src={activeProject.logoUrl} alt="" className="size-full object-cover" />
                ) : (
                  <FolderIcon className="size-4" />
                )}
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">
                  {activeProject
                    ? activeProject.name
                    : projects.length > 0
                      ? "Select project"
                      : "No projects"}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {activeProject
                    ? `${activeProject.slug ? `/${activeProject.slug} · ` : ""}Status: ${activeProject.status}`
                    : projects.length > 0
                      ? "Choose from projects"
                      : "Create a new project"}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Projects
            </DropdownMenuLabel>
            {projects.map((project) => (
              <DropdownMenuItem
                key={project.id}
                onClick={() => onSelectProject?.(project.id)}
                className="gap-2 p-2"
              >
                <div className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md border">
                  {project.logoUrl ? (
                    <img src={project.logoUrl} alt="" className="size-full object-cover" />
                  ) : (
                    <FolderIcon className="size-3.5 shrink-0" />
                  )}
                </div>
                <div className="flex flex-1 flex-col">
                  <span className="text-sm font-medium">{project.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {project.slug ? `/${project.slug} · ` : ""}
                    <span className="capitalize">{project.status}</span>
                  </span>
                </div>
              </DropdownMenuItem>
            ))}
            {projects.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem
              onClick={() => onCreateProject?.()}
              className="cursor-pointer gap-2 p-2"
            >
              <div className="flex size-6 items-center justify-center rounded-md border bg-transparent">
                <Plus className="size-4" />
              </div>
              <div className="font-medium text-muted-foreground">Create project</div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
