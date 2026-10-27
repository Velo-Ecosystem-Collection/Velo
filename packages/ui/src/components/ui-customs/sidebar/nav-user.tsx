"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
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
import {
  ChevronsUpDown,
  CreditCardIcon,
  LogOut,
  MessageSquare,
  Pencil,
  SettingsIcon,
} from "lucide-react";

export type SidebarUser = {
  name: string;
  email: string;
  avatar?: string;
};

export function NavUser({
  user,
  onEditProfile,
  onDisconnect,
  feedbackUrl = "/feedback",
  billingUrl = "/billing",
  settingsUrl,
  onNavigate,
}: {
  user: SidebarUser;
  onEditProfile?: () => void;
  onDisconnect?: () => void;
  feedbackUrl?: string;
  billingUrl?: string;
  settingsUrl?: string;
  onNavigate?: (url: string) => void;
}) {
  const { isMobile } = useSidebar();

  const initials = React.useMemo(() => {
    if (!user.name) return "VE";
    const parts = user.name.split(" ").filter(Boolean);
    if (parts.length >= 2 && parts[0] && parts[1]) {
      const first = parts[0][0] || "";
      const second = parts[1][0] || "";
      return (first + second).toUpperCase();
    }
    return user.name.slice(0, 2).toUpperCase();
  }, [user.name]);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-lg">
                {user.avatar ? <AvatarImage src={user.avatar} alt={user.name} /> : null}
                <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user.name}</span>
                <span className="truncate text-xs text-muted-foreground">{user.email}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  {user.avatar ? <AvatarImage src={user.avatar} alt={user.name} /> : null}
                  <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{user.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                </div>
              </div>
            </DropdownMenuLabel>

            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {onEditProfile ? (
                <DropdownMenuItem onClick={onEditProfile} className="cursor-pointer gap-2">
                  <Pencil className="size-4" />
                  <span>Edit Profile</span>
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem asChild className="cursor-pointer gap-2">
                <a
                  href={billingUrl}
                  onClick={(event) => {
                    if (
                      !onNavigate ||
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.altKey
                    ) {
                      return;
                    }

                    event.preventDefault();
                    onNavigate(billingUrl);
                  }}
                >
                  <CreditCardIcon className="size-4" />
                  <span>Billing</span>
                </a>
              </DropdownMenuItem>
              {settingsUrl ? (
                <DropdownMenuItem asChild className="cursor-pointer gap-2">
                  <a
                    href={settingsUrl}
                    onClick={(event) => {
                      if (
                        !onNavigate ||
                        event.metaKey ||
                        event.ctrlKey ||
                        event.shiftKey ||
                        event.altKey
                      ) {
                        return;
                      }

                      event.preventDefault();
                      onNavigate(settingsUrl);
                    }}
                  >
                    <SettingsIcon className="size-4" />
                    <span>Project Settings</span>
                  </a>
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem asChild className="cursor-pointer gap-2">
                <a
                  href={feedbackUrl}
                  onClick={(event) => {
                    if (
                      !onNavigate ||
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.altKey
                    ) {
                      return;
                    }

                    event.preventDefault();
                    onNavigate(feedbackUrl);
                  }}
                >
                  <MessageSquare className="size-4" />
                  <span>Feedback</span>
                </a>
              </DropdownMenuItem>
            </DropdownMenuGroup>

            {onDisconnect && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onDisconnect}
                  className="cursor-pointer gap-2 text-red-600 focus:bg-red-50 focus:text-red-600"
                >
                  <LogOut className="size-4" />
                  <span>Disconnect Wallet</span>
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

// React import needed for React.useMemo
import * as React from "react";
