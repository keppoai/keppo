import { indexRoute } from "./index";
import { createLazyRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { makeFunctionReference } from "convex/server";
import {
  ArrowRightIcon,
  CheckCircle2Icon,
  Clock3Icon,
  DotIcon,
  FlameIcon,
  KeyRoundIcon,
  PlayCircleIcon,
  PlugIcon,
  ShieldAlertIcon,
  SparklesIcon,
  WrenchIcon,
} from "lucide-react";

import { AutomationPromptBox } from "@/components/automations/automation-prompt-box";
import { RecentActions } from "@/components/dashboard/recent-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useActions } from "@/hooks/use-actions";
import { useAuth } from "@/hooks/use-auth";
import { useIntegrations } from "@/hooks/use-integrations";
import { useOnboarding, type OnboardingStep } from "@/hooks/use-onboarding";
import { useRouteParams } from "@/hooks/use-route-params";
import { useWorkspace } from "@/hooks/use-workspace-context";
import { humanizeRunStatus, parsePaginatedAutomations } from "@/lib/automations-view-model";
import { useDashboardRuntime } from "@/lib/dashboard-runtime";
import { relativeTime } from "@/lib/format";
import { isIntegrationReconnectRequired } from "@/lib/integration-health";

export const indexRouteLazy = createLazyRoute(indexRoute.id)({
  component: DashboardPage,
});

const EMPTY_CURSOR: string | null = null;
const DAY_MS = 24 * 60 * 60 * 1000;

type AttentionItem = {
  id: string;
  icon: typeof ShieldAlertIcon;
  tone: string;
  title: string;
  detail: string;
  href: string;
  cta: string;
};

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

const isWithinDays = (value: string | null | undefined, days: number): boolean => {
  if (!value) {
    return false;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return false;
  }
  return timestamp - Date.now() <= days * DAY_MS;
};

const isRecent = (value: string | null | undefined, maxAgeMs: number): boolean => {
  if (!value) {
    return false;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return false;
  }
  return Date.now() - timestamp <= maxAgeMs;
};

function ReadinessBadge({
  allComplete,
  completedCount,
}: {
  allComplete: boolean;
  completedCount: number;
}) {
  const tone = allComplete
    ? {
        label: "Operational",
        icon: <CheckCircle2Icon className="size-4 text-primary" />,
        border: "border-primary/20 bg-primary/5",
      }
    : completedCount === 0
      ? {
          label: "Not configured",
          icon: <Clock3Icon className="size-4 text-secondary" />,
          border: "border-secondary/20 bg-secondary/5",
        }
      : {
          label: "In progress",
          icon: <SparklesIcon className="size-4 text-primary" />,
          border: "border-primary/20 bg-primary/5",
        };

  return (
    <Badge variant="outline" className={`w-fit px-3 py-1 text-xs ${tone.border}`}>
      <span className="mr-2">{tone.icon}</span>
      {tone.label}
    </Badge>
  );
}

function SetupProgress({
  steps,
  totalCount,
  nextStep,
}: {
  steps: OnboardingStep[];
  totalCount: number;
  nextStep: OnboardingStep | null;
}) {
  const currentStepNumber = nextStep
    ? Math.max(steps.findIndex((step) => step.id === nextStep.id) + 1, 1)
    : totalCount;
  const progress = nextStep
    ? totalCount <= 1
      ? 0
      : Math.round(((currentStepNumber - 1) / (totalCount - 1)) * 100)
    : 100;

  return (
    <div className="space-y-3 rounded-[28px] border border-primary/15 bg-linear-to-br from-background via-background to-primary/5 p-6 shadow-sm">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          What happens next
        </p>
        <p className="mt-1 text-lg font-semibold text-foreground">
          {nextStep
            ? `Step ${currentStepNumber} of ${totalCount}: ${nextStep.label}`
            : "Setup complete"}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Generate the draft first. Keppo will guide provider and AI access setup in the next step,
          and nothing goes live until you review the automation.
        </p>
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {steps.map((step) => {
          if (!step.completed && step.id !== nextStep?.id) {
            return null;
          }
          const state = step.completed ? "done" : "next";
          return (
            <Badge
              key={step.id}
              variant={state === "done" ? "default" : "outline"}
              className={
                state === "next" ? "border-primary/40 bg-primary/8 text-primary" : undefined
              }
            >
              {step.completed ? "Done" : state === "next" ? "Up next" : "Later"}
              <span className="ml-2">{step.label}</span>
            </Badge>
          );
        })}
      </div>
    </div>
  );
}

function DashboardHeader({
  displayName,
  subtitle,
  allComplete,
  completedCount,
  showReadinessBadge = true,
}: {
  displayName: string;
  subtitle: string;
  allComplete: boolean;
  completedCount: number;
  showReadinessBadge?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {getGreeting()}, {displayName}
        </h1>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {showReadinessBadge ? (
        <ReadinessBadge allComplete={allComplete} completedCount={completedCount} />
      ) : null}
    </div>
  );
}

function FirstTimeView({
  activeWorkspaceId,
  steps,
  totalCount,
  nextStep,
}: {
  activeWorkspaceId: string;
  steps: OnboardingStep[];
  totalCount: number;
  nextStep: OnboardingStep | null;
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <AutomationPromptBox workspaceId={activeWorkspaceId} variant="hero" />
      </div>
      <SetupProgress steps={steps} totalCount={totalCount} nextStep={nextStep} />
    </div>
  );
}

function ReturningUserDashboard({
  activeWorkspaceId,
  buildWorkspacePath,
  scopePath,
  actions,
  automations,
  completedCount,
  totalCount,
  nextStep,
  readyProviderCount,
  connectedProviderCount,
  enabledProviderCount,
  activeAutomationCount,
  latestRun,
  attentionItems,
  pendingHighRiskCount,
}: {
  activeWorkspaceId: string;
  buildWorkspacePath: ReturnType<typeof useRouteParams>["buildWorkspacePath"];
  scopePath: ReturnType<typeof useRouteParams>["scopePath"];
  actions: ReturnType<typeof useActions>["actions"];
  automations: ReturnType<typeof parsePaginatedAutomations>["page"];
  completedCount: number;
  totalCount: number;
  nextStep: OnboardingStep | null;
  readyProviderCount: number;
  connectedProviderCount: number;
  enabledProviderCount: number;
  activeAutomationCount: number;
  latestRun: (typeof automations)[number]["latest_run"] | undefined;
  attentionItems: AttentionItem[];
  pendingHighRiskCount: number;
}) {
  const emptyActionState = nextStep
    ? {
        title: "No approvals are blocking progress",
        description: `Use this quiet window to ${nextStep.label.toLowerCase()} and move the workspace closer to live operation.`,
        ...(nextStep.href ? { href: scopePath(nextStep.href), ctaLabel: nextStep.label } : {}),
      }
    : {
        title: "No approvals are blocking progress",
        description:
          "The workspace is quiet. Use the builder to expand coverage or test an automation.",
        href: buildWorkspacePath("/automations"),
        ctaLabel: "Open automations",
      };

  return (
    <div className="space-y-4">
      {pendingHighRiskCount > 0 ? (
        <div className="flex flex-wrap gap-3">
          <Button nativeButton={false} render={<Link to={buildWorkspacePath("/approvals")} />}>
            <ShieldAlertIcon className="mr-2 size-4" />
            Review Approvals
          </Button>
        </div>
      ) : null}

      <Card className="border-primary/20 bg-linear-to-br from-primary/8 via-background to-background shadow-sm">
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-primary">
                <SparklesIcon className="size-4" />
                Automation summary
              </div>
              <CardTitle className="text-2xl">
                {activeAutomationCount} active automation
                {activeAutomationCount === 1 ? "" : "s"}
              </CardTitle>
              <p className="max-w-3xl text-sm text-muted-foreground">
                {latestRun
                  ? `${humanizeRunStatus(latestRun.status)} ${relativeTime(latestRun.created_at)}. Keep runs healthy and expand coverage when the workspace is quiet.`
                  : "Automations are configured. Run one now or extend the workspace with another focused automation."}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                nativeButton={false}
                render={<Link to={buildWorkspacePath("/automations")} />}
              >
                <PlayCircleIcon className="mr-2 size-4" />
                Run Automation
              </Button>
              <Button
                variant="outline"
                nativeButton={false}
                render={<Link to={buildWorkspacePath("/automations")} />}
              >
                Open Automations
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="border-primary/20 bg-primary/5">
              Setup {completedCount}/{totalCount}
            </Badge>
            {nextStep ? (
              <Badge variant="outline" className="border-secondary/20 bg-secondary/5">
                Next: {nextStep.label}
              </Badge>
            ) : (
              <Badge variant="outline" className="border-primary/20 bg-primary/5">
                Workspace operational
              </Badge>
            )}
            {readyProviderCount > 0 ? (
              <Badge variant="outline">{readyProviderCount} providers ready</Badge>
            ) : null}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-primary/15 bg-background/80 p-4">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Latest run
              </p>
              <p className="mt-2 text-lg font-semibold">
                {latestRun ? humanizeRunStatus(latestRun.status) : "No runs yet"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {latestRun ? relativeTime(latestRun.created_at) : "Trigger the first live run"}
              </p>
            </div>
            <div className="rounded-2xl border border-primary/15 bg-background/80 p-4">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Providers ready
              </p>
              <p className="mt-2 text-lg font-semibold">{readyProviderCount}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {connectedProviderCount} connected across the org
              </p>
            </div>
            <div className="rounded-2xl border border-primary/15 bg-background/80 p-4">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Total automations
              </p>
              <p className="mt-2 text-lg font-semibold">{automations.length}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {activeAutomationCount} active in this workspace
              </p>
            </div>
          </div>

          {attentionItems.length > 0 ? (
            <div className="flex flex-wrap gap-3">
              {attentionItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.id}
                    to={item.href}
                    className={`flex min-w-[220px] flex-1 items-start gap-3 rounded-2xl border p-3 transition-colors hover:bg-background/80 ${item.tone}`}
                  >
                    <div className="rounded-full bg-background/80 p-2">
                      <Icon className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">{item.title}</p>
                      <p className="text-sm text-muted-foreground">{item.detail}</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="border-primary/20 bg-primary/5">
                Calm workspace
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-dashed border-border/70 bg-muted/10 shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            <DotIcon className="size-4" />
            Expand coverage
          </div>
          <CardTitle className="text-sm">Keep expansion one click away</CardTitle>
        </CardHeader>
        <CardContent>
          <AutomationPromptBox
            workspaceId={activeWorkspaceId}
            variant="compact"
            collapseByDefault
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <RecentActions actions={actions} emptyState={emptyActionState} />

        <Card className="border-secondary/25 bg-linear-to-br from-secondary/6 via-background to-background shadow-sm">
          <CardHeader className="gap-3">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-secondary">
              <WrenchIcon className="size-4" />
              Health and readiness
            </div>
            <CardTitle className="text-xl">
              {completedCount}/{totalCount} setup complete
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {nextStep
                ? `Operationally healthy enough to expand, but ${nextStep.label.toLowerCase()} is still the next gap to close.`
                : "Setup is complete. Keep an eye on provider health and automation runs."}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Readiness</span>
                <span className="font-medium">
                  {completedCount}/{totalCount}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-secondary transition-[width]"
                  style={{
                    width: `${totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100)}%`,
                  }}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border p-3">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Providers
                </p>
                <p className="mt-2 font-medium">
                  {connectedProviderCount} connected / {enabledProviderCount} enabled
                </p>
              </div>
              <div className="rounded-2xl border p-3">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Operational gap
                </p>
                <p className="mt-2 font-medium">
                  {nextStep?.label ?? "Expand automation coverage"}
                </p>
              </div>
            </div>

            {attentionItems.length > 0 ? (
              <div className="space-y-2">
                {attentionItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.id}
                      to={item.href}
                      className={`flex items-start gap-3 rounded-2xl border p-3 transition-colors hover:bg-background/80 ${item.tone}`}
                    >
                      <Icon className="mt-0.5 size-4 shrink-0" />
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">{item.title}</p>
                        <p className="text-sm text-muted-foreground">{item.detail}</p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-border/70 bg-background/70 p-3 text-sm text-muted-foreground">
                No degraded integrations, expiring non-refreshable credentials, or failed runs are
                competing for attention.
              </div>
            )}

            {nextStep?.href ? (
              <Button
                variant="outline"
                className="w-full justify-between"
                nativeButton={false}
                render={<Link to={scopePath(nextStep.href)} />}
              >
                Continue setup
                <ArrowRightIcon className="size-4" />
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { selectedWorkspaceId, selectedWorkspaceIntegrations, selectedWorkspaceMatchesUrl } =
    useWorkspace();
  const runtime = useDashboardRuntime();
  const { buildWorkspacePath, scopePath } = useRouteParams();
  const activeWorkspaceId = selectedWorkspaceMatchesUrl ? selectedWorkspaceId : "";
  const { actions, isActionsLoading } = useActions(activeWorkspaceId);
  const { integrations, isLoading: isIntegrationsLoading } = useIntegrations();
  const { session } = useAuth();
  const { steps, completedCount, totalCount, nextStep, allComplete } = useOnboarding();
  const automationsRaw = runtime.useQuery(
    makeFunctionReference<"query">("automations:listAutomations"),
    activeWorkspaceId
      ? {
          workspace_id: activeWorkspaceId,
          paginationOpts: { numItems: 100, cursor: EMPTY_CURSOR },
        }
      : "skip",
  );

  const automations = useMemo(
    () => parsePaginatedAutomations(automationsRaw).page,
    [automationsRaw],
  );
  const isAutomationsLoading = Boolean(activeWorkspaceId) && automationsRaw === undefined;
  const isLoading = isActionsLoading || isIntegrationsLoading || isAutomationsLoading;

  const email = String(session?.user?.email ?? "");
  const userName = session?.user?.name;
  const nameStr = typeof userName === "string" ? userName : "";
  const firstName = nameStr ? nameStr.split(" ")[0] : (email.split("@")[0] ?? "");
  const displayName = firstName || "there";
  const isFirstTimeUser = automations.length === 0;

  const enabledProviderCount = selectedWorkspaceIntegrations.filter(
    (entry) => entry.enabled,
  ).length;
  const connectedProviderCount = integrations.filter((entry) => entry.connected).length;
  const readyProviderCount = selectedWorkspaceIntegrations.filter((entry) => {
    return (
      entry.enabled &&
      integrations.some(
        (integration) => integration.connected && integration.provider === entry.provider,
      )
    );
  }).length;
  const activeAutomationCount = automations.filter(
    (item) => item.automation.status === "active",
  ).length;
  const failedRuns = automations
    .map((item) => item.latest_run)
    .filter(
      (run): run is NonNullable<(typeof automations)[number]["latest_run"]> =>
        run !== null && (run.status === "failed" || run.status === "timed_out"),
    );
  const recentFailedRuns = failedRuns.filter((run) => isRecent(run.created_at, DAY_MS));
  const latestRun = automations
    .map((item) => item.latest_run)
    .filter((run): run is NonNullable<(typeof automations)[number]["latest_run"]> => run !== null)
    .sort((left, right) => right.created_at.localeCompare(left.created_at))[0];
  const pendingHighRiskCount = actions.filter(
    (action) =>
      action.status === "pending" &&
      (action.risk_level === "high" || action.risk_level === "critical"),
  ).length;
  const reconnectRequiredIntegrations = integrations.filter((integration) => {
    return isIntegrationReconnectRequired({
      status: integration.status,
      credentialExpiresAt: integration.credential_expires_at,
      hasRefreshToken: integration.has_refresh_token,
      lastErrorCategory: integration.last_error_category,
    });
  });
  const reconnectRequiredIntegrationIds = new Set(
    reconnectRequiredIntegrations.map((integration) => integration.id),
  );
  const degradedIntegrations = integrations.filter(
    (integration) =>
      integration.connected &&
      !reconnectRequiredIntegrationIds.has(integration.id) &&
      (Boolean(integration.degraded_reason) ||
        Boolean(integration.last_error_code) ||
        (integration.last_health_check_at &&
          integration.last_successful_health_check_at &&
          integration.last_health_check_at > integration.last_successful_health_check_at)),
  );
  const expiringCredentials = integrations.filter(
    (integration) =>
      integration.connected &&
      integration.has_refresh_token === false &&
      isWithinDays(integration.credential_expires_at, 14),
  );
  const attentionItems = [
    pendingHighRiskCount > 0
      ? {
          id: "approvals",
          icon: ShieldAlertIcon,
          tone: "border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300",
          title: `${pendingHighRiskCount} high-risk approval${pendingHighRiskCount === 1 ? "" : "s"} waiting`,
          detail: "High and critical actions are blocked until someone reviews them.",
          href: buildWorkspacePath("/approvals"),
          cta: "Review approvals",
        }
      : null,
    reconnectRequiredIntegrations.length > 0
      ? {
          id: "integrations-reconnect",
          icon: PlugIcon,
          tone: "border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300",
          title: `${reconnectRequiredIntegrations.length} integration${reconnectRequiredIntegrations.length === 1 ? " needs" : "s need"} reconnect`,
          detail: "Saved credentials expired or lost required access.",
          href: buildWorkspacePath("/integrations"),
          cta: "Reconnect providers",
        }
      : null,
    degradedIntegrations.length > 0
      ? {
          id: "integrations",
          icon: PlugIcon,
          tone: "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300",
          title: `${degradedIntegrations.length} integration${degradedIntegrations.length === 1 ? "" : "s"} degraded`,
          detail: "Recent health checks or provider errors suggest upstream trouble.",
          href: buildWorkspacePath("/integrations"),
          cta: "Inspect integrations",
        }
      : null,
    recentFailedRuns.length > 0
      ? {
          id: "runs",
          icon: FlameIcon,
          tone: "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300",
          title: `${recentFailedRuns.length} failed run${recentFailedRuns.length === 1 ? "" : "s"} in the last 24h`,
          detail: "Recent automations need operator review before more work piles up.",
          href: buildWorkspacePath("/automations"),
          cta: "Open automations",
        }
      : null,
    expiringCredentials.length > 0
      ? {
          id: "credentials",
          icon: KeyRoundIcon,
          tone: "border-secondary/30 bg-secondary/10 text-secondary-foreground",
          title: `${expiringCredentials.length} credential${expiringCredentials.length === 1 ? "" : "s"} expiring soon`,
          detail: "Refresh provider credentials before they interrupt automation runs.",
          href: buildWorkspacePath("/integrations"),
          cta: "Refresh credentials",
        }
      : null,
  ].filter((item): item is AttentionItem => item !== null);

  return (
    <div className="flex flex-col gap-6">
      <DashboardHeader
        displayName={displayName}
        subtitle={
          isFirstTimeUser
            ? "Create your first automation to get started."
            : "Automations, recent runs, and setup blockers in one place."
        }
        allComplete={allComplete}
        completedCount={completedCount}
        showReadinessBadge={!isFirstTimeUser}
      />

      {isLoading ? (
        <>
          <Skeleton className="h-32 w-full" />
          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <Skeleton className="h-56 w-full" />
            <Skeleton className="h-56 w-full" />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
          <Skeleton className="h-80 w-full" />
        </>
      ) : isFirstTimeUser ? (
        <FirstTimeView
          activeWorkspaceId={activeWorkspaceId}
          steps={steps}
          totalCount={totalCount}
          nextStep={nextStep}
        />
      ) : (
        <ReturningUserDashboard
          activeWorkspaceId={activeWorkspaceId}
          buildWorkspacePath={buildWorkspacePath}
          scopePath={scopePath}
          actions={actions}
          automations={automations}
          completedCount={completedCount}
          totalCount={totalCount}
          nextStep={nextStep}
          readyProviderCount={readyProviderCount}
          connectedProviderCount={connectedProviderCount}
          enabledProviderCount={enabledProviderCount}
          activeAutomationCount={activeAutomationCount}
          latestRun={latestRun}
          attentionItems={attentionItems}
          pendingHighRiskCount={pendingHighRiskCount}
        />
      )}
    </div>
  );
}
