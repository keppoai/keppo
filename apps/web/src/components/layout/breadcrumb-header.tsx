import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { makeFunctionReference } from "convex/server";
import { CoinsIcon, SearchIcon, ShieldIcon } from "lucide-react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { getProviderMeta } from "@/components/integrations/provider-icons";
import { useAdmin } from "@/hooks/use-admin";
import { useRouteParams } from "@/hooks/use-route-params";
import { useWorkspace } from "@/hooks/use-workspace-context";
import {
  formatAiCreditAmount,
  parseAutomationRun,
  parseAutomationWithConfig,
  humanizeRunStatus,
} from "@/lib/automations-view-model";
import { relativeTime } from "@/lib/format";
import { Separator } from "@/components/ui/separator";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { DisabledNotificationBell } from "@/components/notifications/disabled-notification-bell";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { HelpDialog } from "@/components/layout/help-dialog";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/use-auth";
import { ErrorBoundary } from "@/components/error-boundary";
import { useDashboardRuntime } from "@/lib/dashboard-runtime";

const pathLabels: Record<string, string> = {
  "/": "Dashboard",
  "/approvals": "Approvals",
  "/automations": "Automations",
  "/automations/build": "Build Automation",
  "/automations/create": "Create Manually",
  "/rules": "Rules & Policies",
  "/prompt-builder": "Prompt Builder",
  "/integrations": "Integrations",
  "/servers": "Custom Servers",
  "/settings/members": "Members",
  "/settings/audit": "Audit Logs",
  "/settings/workspaces": "Workspaces",
  "/settings/billing": "Billing",
  "/settings": "Settings",
  "/admin/health": "System Health",
  "/admin": "Admin",
};

type Crumb = {
  label: string;
  path?: string;
};

const AI_CREDIT_BALANCE_REF = makeFunctionReference<"query">("ai_credits:getAiCreditBalance");
const CURRENT_ORG_BILLING_REF = makeFunctionReference<"query">("billing:getCurrentOrgBilling");

function BillingActions({
  orgId,
  workspaceId,
  onOpenBilling,
}: {
  orgId: string | null;
  workspaceId: string | null;
  onOpenBilling: () => void;
}) {
  const runtime = useDashboardRuntime();
  const aiCreditBalanceRaw = runtime.useQuery(
    AI_CREDIT_BALANCE_REF,
    orgId ? { org_id: orgId } : "skip",
  );
  const billing = runtime.useQuery(CURRENT_ORG_BILLING_REF, orgId ? {} : "skip");
  const creditCount =
    aiCreditBalanceRaw &&
    typeof aiCreditBalanceRaw === "object" &&
    "total_available" in aiCreditBalanceRaw
      ? typeof aiCreditBalanceRaw.total_available === "number"
        ? aiCreditBalanceRaw.total_available
        : null
      : null;

  return (
    <>
      {orgId ? (
        <Button
          variant="outline"
          size="sm"
          className="hidden sm:inline-flex"
          onClick={onOpenBilling}
        >
          <CoinsIcon className="size-4" />
          {creditCount === null ? "Billing" : `${formatAiCreditAmount(creditCount)} credits`}
        </Button>
      ) : null}
      <HelpDialog orgId={orgId} workspaceId={workspaceId} tier={billing?.tier ?? null} />
    </>
  );
}

function BillingActionsFallback({
  orgId,
  workspaceId,
  onOpenBilling,
}: {
  orgId: string | null;
  workspaceId: string | null;
  onOpenBilling: () => void;
}) {
  return (
    <>
      {orgId ? (
        <Button
          variant="outline"
          size="sm"
          className="hidden sm:inline-flex"
          onClick={onOpenBilling}
        >
          <CoinsIcon className="size-4" />
          Billing
        </Button>
      ) : null}
      <HelpDialog orgId={orgId} workspaceId={workspaceId} tier={null} />
    </>
  );
}

export function BreadcrumbHeader({
  notificationsEnabled = true,
}: {
  notificationsEnabled?: boolean;
}) {
  const runtime = useDashboardRuntime();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { getOrgId } = useAuth();
  const {
    relativePath,
    buildOrgPath,
    buildWorkspacePath,
    automationLookup,
    runId,
    integrationProvider,
    customServerId,
  } = useRouteParams();
  const { selectedWorkspaceId } = useWorkspace();
  const { canAccessAdminPage } = useAdmin();
  const orgId = getOrgId();

  const automationRaw = runtime.useQuery(
    makeFunctionReference<"query">("automations:getAutomation"),
    automationLookup &&
      automationLookup !== "build" &&
      automationLookup !== "create" &&
      selectedWorkspaceId
      ? { automation_id: automationLookup, workspace_id: selectedWorkspaceId }
      : "skip",
  );
  const runRaw = runtime.useQuery(
    makeFunctionReference<"query">("automation_runs:getAutomationRun"),
    runId ? { automation_run_id: runId } : "skip",
  );
  const serverRaw = runtime.useQuery(
    makeFunctionReference<"query">("custom_mcp:getServer"),
    customServerId ? { serverId: customServerId } : "skip",
  );

  const automation = parseAutomationWithConfig(automationRaw)?.automation ?? null;
  const run = parseAutomationRun(runRaw);
  const serverName =
    serverRaw && typeof serverRaw === "object" && "display_name" in serverRaw
      ? typeof serverRaw.display_name === "string"
        ? serverRaw.display_name
        : null
      : null;

  const crumbs: Crumb[] = [];

  if (relativePath === "/automations/build" || relativePath === "/automations/create") {
    crumbs.push({
      label: "Automations",
      path: buildWorkspacePath("/automations"),
    });
    crumbs.push({
      label: pathLabels[relativePath] ?? "Automations",
    });
  } else if (relativePath.startsWith("/integrations/") && integrationProvider) {
    crumbs.push({
      label: "Integrations",
      path: buildWorkspacePath("/integrations"),
    });
    crumbs.push({
      label: getProviderMeta(integrationProvider).label || integrationProvider,
    });
  } else if (relativePath.startsWith("/automations/") && automationLookup) {
    crumbs.push({
      label: "Automations",
      path: buildWorkspacePath("/automations"),
    });
    crumbs.push({
      label: automation?.name || "Loading automation",
      ...(runId ? { path: buildWorkspacePath(`/automations/${automationLookup}`) } : {}),
    });
    if (runId) {
      crumbs.push({
        label: run
          ? `${humanizeRunStatus(run.status)} run${run.created_at ? ` · ${relativeTime(run.created_at)}` : ""}`
          : "Loading run",
      });
    }
  } else if (relativePath.startsWith("/servers/") && customServerId) {
    crumbs.push({
      label: "Custom Servers",
      path: buildWorkspacePath("/servers"),
    });
    crumbs.push({ label: serverName || "Server" });
  } else if (relativePath.startsWith("/settings/")) {
    const pageLabel = pathLabels[relativePath] ?? pathLabels[pathname] ?? "Page";
    crumbs.push({
      label: "Organization settings",
      path: buildOrgPath("/settings"),
    });
    if (pageLabel !== "Settings") {
      crumbs.push({ label: pageLabel });
    }
  } else {
    crumbs.push({
      label: pathLabels[relativePath] ?? pathLabels[pathname] ?? "Page",
    });
  }

  const notificationFallback = <DisabledNotificationBell />;
  const workspaceId = selectedWorkspaceId || null;

  return (
    <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b bg-background px-4">
      <SidebarTrigger className="-ml-1 flex min-h-[44px] min-w-[44px] items-center justify-center" />
      <Separator orientation="vertical" className="mr-2 h-4" />
      <Breadcrumb>
        <BreadcrumbList>
          {crumbs.map((crumb, index) => {
            const isLast = index === crumbs.length - 1;
            return (
              <BreadcrumbItem key={`${crumb.label}-${index}`}>
                {crumb.path && !isLast ? (
                  <BreadcrumbLink render={<Link to={crumb.path} />}>{crumb.label}</BreadcrumbLink>
                ) : (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                )}
                {!isLast ? <BreadcrumbSeparator /> : null}
              </BreadcrumbItem>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>
      <div className="ml-auto flex items-center gap-1">
        <ErrorBoundary
          boundary="layout"
          fallback={
            <BillingActionsFallback
              orgId={orgId}
              workspaceId={workspaceId}
              onOpenBilling={() => {
                void navigate({ to: buildOrgPath("/settings/billing") });
              }}
            />
          }
        >
          <BillingActions
            orgId={orgId}
            workspaceId={workspaceId}
            onOpenBilling={() => {
              void navigate({ to: buildOrgPath("/settings/billing") });
            }}
          />
        </ErrorBoundary>
        <Button
          variant="outline"
          size="sm"
          className="hidden sm:inline-flex"
          onClick={() => {
            window.dispatchEvent(new CustomEvent("keppo:open-command-palette"));
          }}
        >
          <SearchIcon className="size-4" />
          Command
        </Button>
        {canAccessAdminPage ? (
          <Button
            variant="secondary"
            size="sm"
            className="hidden sm:inline-flex"
            render={<Link to="/admin" />}
          >
            <ShieldIcon />
            Admin tools
          </Button>
        ) : null}
        <ErrorBoundary boundary="layout" fallback={notificationFallback}>
          <NotificationBell enabled={notificationsEnabled} />
        </ErrorBoundary>
        <ThemeToggle />
      </div>
    </header>
  );
}
