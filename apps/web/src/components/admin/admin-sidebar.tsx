import type { MouseEvent } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  ActivityIcon,
  ArrowLeftIcon,
  BarChart3Icon,
  FlagIcon,
  LayoutDashboardIcon,
  ShieldAlertIcon,
  TicketIcon,
} from "lucide-react";

import { NavUser } from "@/components/layout/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/use-auth";
import { useWorkspace } from "@/hooks/use-workspace-context";
import { buildWorkspacePath } from "@/hooks/use-route-params";
import { cn } from "@/lib/utils";

const adminSidebarLinkClass =
  "ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:bg-sidebar-accent active:text-sidebar-accent-foreground data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground gap-2 rounded-lg p-2 text-left text-sm transition-[width,height,padding] group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2! focus-visible:ring-2 data-active:font-medium flex min-h-[44px] w-full items-center overflow-hidden outline-hidden disabled:pointer-events-none disabled:opacity-50 [&>span:last-child]:truncate [&_svg]:size-4 [&_svg]:shrink-0";

const navItems = [
  { label: "Overview", to: "/admin", icon: LayoutDashboardIcon },
  { label: "Feature Flags", to: "/admin/flags", icon: FlagIcon },
  { label: "Invite Codes", to: "/admin/invite-codes", icon: TicketIcon },
  { label: "System Health", to: "/admin/health", icon: ActivityIcon },
  { label: "Usage", to: "/admin/usage", icon: BarChart3Icon },
  { label: "Abuse", to: "/admin/abuse", icon: ShieldAlertIcon },
] as const;

export function AdminSidebar() {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { getOrgSlug } = useAuth();
  const { selectedWorkspace } = useWorkspace();

  const orgSlug = getOrgSlug();
  const backToDashboardHref =
    orgSlug && selectedWorkspace?.slug ? buildWorkspacePath(orgSlug, selectedWorkspace.slug) : "/";

  const handleNavigation = (event: MouseEvent<HTMLAnchorElement>, to: string) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      event.shiftKey
    ) {
      return;
    }

    event.preventDefault();
    void navigate({ to });
  };

  const preventMouseDown = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
  };

  return (
    <Sidebar variant="inset">
      <SidebarHeader className="gap-4 p-4">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            Platform Admin
          </p>
          <p className="text-lg font-semibold tracking-tight text-sidebar-foreground">
            Control Center
          </p>
          <p className="text-sm text-muted-foreground">
            Platform-wide rollout, health, usage, and abuse operations.
          </p>
        </div>
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            Sections
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive =
                  pathname === item.to ||
                  (item.to !== "/admin" && pathname.startsWith(`${item.to}/`));
                const Icon = item.icon;
                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      tooltip={item.label}
                      isActive={isActive}
                      render={
                        <a
                          href={item.to}
                          data-active={isActive ? "" : undefined}
                          className={cn(adminSidebarLinkClass)}
                          onMouseDown={preventMouseDown}
                          onClick={(event) => {
                            handleNavigation(event, item.to);
                          }}
                        />
                      }
                    >
                      <Icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="gap-3 p-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Back to dashboard"
              render={
                <Link
                  to={backToDashboardHref}
                  className={cn(adminSidebarLinkClass, "bg-background/70")}
                />
              }
            >
              <ArrowLeftIcon />
              <span>Back to dashboard</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <NavUser />
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
