import type { MouseEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { makeFunctionReference } from "convex/server";
import {
  BotIcon,
  CreditCardIcon,
  LayoutDashboardIcon,
  PlugIcon,
  ScrollTextIcon,
  ServerIcon,
  SettingsIcon,
  ShieldCheckIcon,
  UsersIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { WorkspaceSwitcher } from "@/components/layout/workspace-switcher";
import { NavUser } from "@/components/layout/nav-user";
import { usePendingApprovalCount } from "@/hooks/use-pending-approval-count";
import {
  buildWorkspacePath as buildWorkspaceScopedPath,
  useRouteParams,
} from "@/hooks/use-route-params";
import { useAuth } from "@/hooks/use-auth";
import { useWorkspace } from "@/hooks/use-workspace-context";
import { useDashboardRuntime } from "@/lib/dashboard-runtime";
import { cn } from "@/lib/utils";

const sidebarNavLinkClass =
  "ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:bg-sidebar-accent active:text-sidebar-accent-foreground data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground gap-2 rounded-md p-2 text-left text-sm transition-[width,height,padding] group-has-data-[sidebar=menu-action]/menu-item:pr-8 group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2! focus-visible:ring-2 data-active:font-medium peer/menu-button flex w-full items-center overflow-hidden outline-hidden group/menu-button disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&>span:last-child]:truncate [&_svg]:size-4 [&_svg]:shrink-0";

const sidebarSubNavLinkClass =
  "text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:bg-sidebar-accent active:text-sidebar-accent-foreground [&>svg]:text-sidebar-accent-foreground data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground h-7 gap-2 rounded-md px-2 focus-visible:ring-2 data-[size=md]:text-sm data-[size=sm]:text-xs [&>svg]:size-4 flex min-w-0 -translate-x-px items-center overflow-hidden outline-hidden group-data-[collapsible=icon]:hidden disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&>span:last-child]:truncate [&>svg]:shrink-0";

export function AppSidebar() {
  const runtime = useDashboardRuntime();
  const navigate = useNavigate();
  const pendingApprovalCount = usePendingApprovalCount();
  const { buildOrgPath, buildWorkspacePath, orgSlug, relativePath, workspaceSlug } =
    useRouteParams();
  const { getOrgId } = useAuth();
  const { selectedWorkspace } = useWorkspace();
  const orgId = getOrgId();
  const activeWorkspaceSlug = selectedWorkspace?.slug ?? workspaceSlug ?? null;
  const resolveWorkspaceHref = (subpath = "") =>
    orgSlug && activeWorkspaceSlug
      ? buildWorkspaceScopedPath(orgSlug, activeWorkspaceSlug, subpath)
      : buildWorkspacePath(subpath);
  const isAutomationsSection =
    relativePath === "/automations" || relativePath.startsWith("/automations/");
  const isIntegrationsSection =
    relativePath === "/integrations" || relativePath.startsWith("/integrations/");
  const isCustomServersSection =
    relativePath === "/servers" || relativePath.startsWith("/servers/");
  const customServers =
    runtime.useQuery(
      makeFunctionReference<"query">("custom_mcp:listServers"),
      orgId ? {} : "skip",
    ) ?? [];
  const connectedCustomServerCount = customServers.filter(
    (server: { status: string }) => server.status === "connected",
  ).length;
  const isOrgSettingsSection =
    relativePath === "/settings" || relativePath.startsWith("/settings/");
  const handleSidebarNavigation = (event: MouseEvent<HTMLAnchorElement>, to: string) => {
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
  const preventSidebarMouseDown = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
  };

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <WorkspaceSwitcher />
      </SidebarHeader>

      <SidebarContent>
        {/* Main section */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="Dashboard"
                  isActive={relativePath === "/"}
                  render={
                    <a
                      href={resolveWorkspaceHref()}
                      data-active={relativePath === "/" ? "" : undefined}
                      className={cn(sidebarNavLinkClass, "rounded-lg")}
                      onMouseDown={preventSidebarMouseDown}
                      onClick={(event) => {
                        handleSidebarNavigation(event, resolveWorkspaceHref());
                      }}
                    />
                  }
                >
                  <LayoutDashboardIcon />
                  <span>Dashboard</span>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="Approvals"
                  isActive={relativePath === "/approvals"}
                  render={
                    <a
                      href={resolveWorkspaceHref("/approvals")}
                      data-active={relativePath === "/approvals" ? "" : undefined}
                      className={cn(sidebarNavLinkClass, "rounded-lg")}
                      onMouseDown={preventSidebarMouseDown}
                      onClick={(event) => {
                        handleSidebarNavigation(event, resolveWorkspaceHref("/approvals"));
                      }}
                    />
                  }
                >
                  <ShieldCheckIcon />
                  <span>Approvals</span>
                  {pendingApprovalCount > 0 && (
                    <Badge className="ml-auto rounded-full bg-secondary px-1.5 py-0 text-[10px] text-secondary-foreground">
                      {pendingApprovalCount > 99 ? "99+" : pendingApprovalCount}
                    </Badge>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Workspace section */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Workspace
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="Automations"
                  isActive={isAutomationsSection}
                  render={
                    <a
                      href={resolveWorkspaceHref("/automations")}
                      data-active={isAutomationsSection ? "" : undefined}
                      className={cn(sidebarNavLinkClass, "rounded-lg")}
                      onMouseDown={preventSidebarMouseDown}
                      onClick={(event) => {
                        handleSidebarNavigation(event, resolveWorkspaceHref("/automations"));
                      }}
                    />
                  }
                >
                  <BotIcon />
                  <span>Automations</span>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="Integrations"
                  isActive={isIntegrationsSection || isCustomServersSection}
                  render={
                    <a
                      href={resolveWorkspaceHref("/integrations")}
                      data-active={isIntegrationsSection || isCustomServersSection ? "" : undefined}
                      className={cn(sidebarNavLinkClass, "rounded-lg")}
                      onMouseDown={preventSidebarMouseDown}
                      onClick={(event) => {
                        handleSidebarNavigation(event, resolveWorkspaceHref("/integrations"));
                      }}
                    />
                  }
                >
                  <PlugIcon />
                  <span>Integrations</span>
                </SidebarMenuButton>
                {isIntegrationsSection || isCustomServersSection ? (
                  <SidebarMenuSub className="mt-1">
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton
                        isActive={isCustomServersSection}
                        render={
                          <a
                            href={resolveWorkspaceHref("/servers")}
                            data-active={isCustomServersSection ? "" : undefined}
                            className={sidebarSubNavLinkClass}
                            onMouseDown={preventSidebarMouseDown}
                            onClick={(event) => {
                              handleSidebarNavigation(event, resolveWorkspaceHref("/servers"));
                            }}
                          />
                        }
                      >
                        <ServerIcon />
                        <span>Custom Integrations</span>
                        {connectedCustomServerCount > 0 ? (
                          <Badge
                            variant="secondary"
                            className="ml-auto rounded-full px-1.5 py-0 text-[10px]"
                          >
                            {connectedCustomServerCount}
                          </Badge>
                        ) : null}
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  </SidebarMenuSub>
                ) : null}
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="Rules"
                  isActive={relativePath === "/rules"}
                  render={
                    <a
                      href={resolveWorkspaceHref("/rules")}
                      data-active={relativePath === "/rules" ? "" : undefined}
                      className={cn(sidebarNavLinkClass, "rounded-lg")}
                      onMouseDown={preventSidebarMouseDown}
                      onClick={(event) => {
                        handleSidebarNavigation(event, resolveWorkspaceHref("/rules"));
                      }}
                    />
                  }
                >
                  <ShieldCheckIcon />
                  <span>Rules</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Organization section */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Organization
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="Settings"
                  isActive={relativePath === "/settings"}
                  render={
                    <a
                      href={buildOrgPath("/settings")}
                      data-active={relativePath === "/settings" ? "" : undefined}
                      className={cn(sidebarNavLinkClass, "rounded-lg")}
                      onMouseDown={preventSidebarMouseDown}
                      onClick={(event) => {
                        handleSidebarNavigation(event, buildOrgPath("/settings"));
                      }}
                    />
                  }
                >
                  <SettingsIcon />
                  <span>Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="Members"
                  isActive={relativePath === "/settings/members"}
                  render={
                    <a
                      href={buildOrgPath("/settings/members")}
                      data-active={relativePath === "/settings/members" ? "" : undefined}
                      className={cn(sidebarNavLinkClass, "rounded-lg")}
                      onMouseDown={preventSidebarMouseDown}
                      onClick={(event) => {
                        handleSidebarNavigation(event, buildOrgPath("/settings/members"));
                      }}
                    />
                  }
                >
                  <UsersIcon />
                  <span>Members</span>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="Billing"
                  isActive={relativePath === "/settings/billing"}
                  render={
                    <a
                      href={buildOrgPath("/settings/billing")}
                      data-active={relativePath === "/settings/billing" ? "" : undefined}
                      className={cn(sidebarNavLinkClass, "rounded-lg")}
                      onMouseDown={preventSidebarMouseDown}
                      onClick={(event) => {
                        handleSidebarNavigation(event, buildOrgPath("/settings/billing"));
                      }}
                    />
                  }
                >
                  <CreditCardIcon />
                  <span>Billing</span>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="Audit Logs"
                  isActive={relativePath === "/settings/audit"}
                  render={
                    <a
                      href={buildOrgPath("/settings/audit")}
                      data-active={relativePath === "/settings/audit" ? "" : undefined}
                      className={cn(sidebarNavLinkClass, "rounded-lg")}
                      onMouseDown={preventSidebarMouseDown}
                      onClick={(event) => {
                        handleSidebarNavigation(event, buildOrgPath("/settings/audit"));
                      }}
                    />
                  }
                >
                  <ScrollTextIcon />
                  <span>Audit Logs</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="gap-3 p-3">
        <NavUser />
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
