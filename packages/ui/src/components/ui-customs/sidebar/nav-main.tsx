import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@repo/ui/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@repo/ui/components/ui/sidebar";
import { ChevronRight, type LucideIcon } from "lucide-react";
import * as React from "react";

export type NavMainItem = {
  title: string;
  url: string;
  icon?: LucideIcon;
  isActive?: boolean;
  disabled?: boolean;
};

export type NavMainGroup = {
  title: string;
  icon?: LucideIcon;
  items: NavMainItem[];
  isActive?: boolean;
};

export function NavMain({
  items = [],
  groups,
  onNavigate,
  onPrefetch,
}: {
  items?: NavMainItem[];
  groups: NavMainGroup[];
  onNavigate?: (url: string) => void;
  onPrefetch?: (url: string) => void;
}) {
  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>({});
  const activeGroupTitle = groups.find((group) => group.isActive)?.title;

  React.useEffect(() => {
    if (!activeGroupTitle) return;

    setOpenGroups((current) => {
      if (current[activeGroupTitle]) return current;
      return { ...current, [activeGroupTitle]: true };
    });
  }, [activeGroupTitle]);

  function handleLinkClick(event: React.MouseEvent<HTMLAnchorElement>, url: string) {
    if (!onNavigate || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    event.preventDefault();
    onNavigate(url);
  }

  function prefetch(url: string) {
    onPrefetch?.(url);
  }

  function renderStandaloneItem(item: NavMainItem) {
    return (
      <SidebarMenuItem key={item.title}>
        {item.disabled ? (
          <SidebarMenuButton
            disabled
            tooltip={`${item.title} requires a selected project`}
            className="cursor-not-allowed opacity-50"
          >
            {item.icon && <item.icon />}
            <span>{item.title}</span>
          </SidebarMenuButton>
        ) : (
          <SidebarMenuButton asChild tooltip={item.title} isActive={item.isActive}>
            <a
              href={item.url}
              onClick={(event) => handleLinkClick(event, item.url)}
              onFocus={() => prefetch(item.url)}
              onMouseEnter={() => prefetch(item.url)}
            >
              {item.icon && <item.icon />}
              <span>{item.title}</span>
            </a>
          </SidebarMenuButton>
        )}
      </SidebarMenuItem>
    );
  }

  return (
    <>
      {items.length > 0 ? (
        <SidebarGroup className="px-2 py-1">
          <SidebarMenu>{items.map(renderStandaloneItem)}</SidebarMenu>
        </SidebarGroup>
      ) : null}
      {groups.map((group) => {
        const isOpen = openGroups[group.title] ?? group.isActive ?? false;
        const contentId = `velo-sidebar-group-${encodeURIComponent(group.title)}`;

        if (group.items.length === 0) {
          return (
            <SidebarGroup key={group.title} className="px-2 py-1">
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    tooltip={group.title}
                    className="cursor-default text-sidebar-foreground/70 hover:bg-transparent hover:text-sidebar-foreground/70"
                  >
                    <div>
                      {group.icon && <group.icon />}
                      <span className="group-data-[collapsible=icon]:hidden">{group.title}</span>
                    </div>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>
          );
        }

        return (
          <SidebarGroup key={group.title} className="px-2 py-1">
            <Collapsible
              asChild
              open={isOpen}
              onOpenChange={(open) =>
                setOpenGroups((current) => ({ ...current, [group.title]: open }))
              }
              className="group/principle"
            >
              <SidebarMenu>
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild aria-controls={contentId}>
                    <SidebarMenuButton tooltip={group.title} isActive={group.isActive}>
                      {group.icon && <group.icon />}
                      <span className="group-data-[collapsible=icon]:hidden">{group.title}</span>
                      <ChevronRight className="ml-auto transition-transform duration-200 group-data-[collapsible=icon]:hidden group-data-[state=open]/principle:rotate-90" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent id={contentId}>
                    <SidebarMenuSub>
                      {group.items.map((item) => (
                        <SidebarMenuSubItem key={item.title}>
                          {item.disabled ? (
                            <SidebarMenuSubButton
                              aria-disabled="true"
                              className="cursor-not-allowed opacity-50"
                              title={`${item.title} requires a selected project`}
                            >
                              {item.icon && <item.icon />}
                              <span>{item.title}</span>
                            </SidebarMenuSubButton>
                          ) : (
                            <SidebarMenuSubButton asChild isActive={item.isActive}>
                              <a
                                href={item.url}
                                onClick={(event) => handleLinkClick(event, item.url)}
                                onFocus={() => prefetch(item.url)}
                                onMouseEnter={() => prefetch(item.url)}
                              >
                                {item.icon && <item.icon />}
                                <span>{item.title}</span>
                              </a>
                            </SidebarMenuSubButton>
                          )}
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </SidebarMenu>
            </Collapsible>
          </SidebarGroup>
        );
      })}
    </>
  );
}
