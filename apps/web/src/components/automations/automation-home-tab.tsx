import { useMemo } from "react";
import { useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CircleCheckIcon,
  CircleDotIcon,
  PlayIcon,
  SettingsIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UserFacingErrorView } from "@/components/ui/user-facing-error";
import {
  automationStatusBadgeVariant,
  getAutomationModelClassMeta,
  getAutomationTriggerDetail,
  getAutomationTriggerLabel,
  getNetworkAccessMeta,
  getProviderTriggerSubscriptionSummary,
  getTriggerEventSummary,
  humanizeRunStatus,
  humanizeTriggerType,
  parseAutomationTriggerEvents,
  parsePaginatedRuns,
  runStatusBadgeVariant,
  type AutomationTriggerEvent,
  type Automation,
  type AutomationConfigVersion,
  type AutomationRun,
} from "@/lib/automations-view-model";
import { humanizeCron } from "@/lib/cron-humanizer";
import { fullTimestamp, relativeTime } from "@/lib/format";
import { toUserFacingError } from "@/lib/user-facing-errors";

type AutomationHomeTabProps = {
  automation: Automation;
  config: AutomationConfigVersion | null;
  onNavigateTab: (tab: string, runId?: string) => void;
};

type AutomationState = "unconfigured" | "never_run" | "running" | "healthy" | "needs_attention";

const EMPTY_CURSOR: string | null = null;

function deriveState(
  config: AutomationConfigVersion | null,
  runs: AutomationRun[],
): AutomationState {
  if (!config || !config.prompt.trim()) {
    return "unconfigured";
  }
  if (runs.length === 0) {
    return "never_run";
  }
  const latest = runs[0]!;
  if (latest.status === "running" || latest.status === "pending") {
    return "running";
  }
  if (
    latest.status === "failed" ||
    latest.status === "timed_out" ||
    latest.status === "cancelled"
  ) {
    return "needs_attention";
  }
  return "healthy";
}

function StatusIndicator({ state }: { state: AutomationState }) {
  if (state === "running") {
    return <CircleDotIcon className="size-5 animate-pulse text-blue-500" />;
  }
  if (state === "needs_attention") {
    return <AlertTriangleIcon className="size-5 text-destructive" />;
  }
  if (state === "healthy") {
    return <CircleCheckIcon className="size-5 text-emerald-500" />;
  }
  return null;
}

function ConfigSummary({
  config,
  onNavigateTab,
}: {
  config: AutomationConfigVersion;
  onNavigateTab: (tab: string) => void;
}) {
  const triggerLabel =
    config.trigger_type === "schedule" && config.schedule_cron
      ? `${humanizeTriggerType(config.trigger_type)} - ${humanizeCron(config.schedule_cron)}`
      : getAutomationTriggerLabel(config);
  const triggerDetail = getAutomationTriggerDetail(config);
  const subscriptionSummary = getProviderTriggerSubscriptionSummary(config);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-sm">Configuration</CardTitle>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs"
          onClick={() => onNavigateTab("config")}
        >
          Edit
          <ArrowRightIcon className="ml-1 size-3" />
        </Button>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Trigger</dt>
          <dd>
            <div>{triggerLabel}</div>
            {triggerDetail ? (
              <p className="text-xs text-muted-foreground">{triggerDetail}</p>
            ) : null}
          </dd>
          {config.trigger_type === "event" && config.provider_trigger ? (
            <>
              <dt className="text-muted-foreground">Delivery</dt>
              <dd>
                {config.provider_trigger.subscription_state.active_mode ??
                  config.provider_trigger.delivery.preferred_mode}
              </dd>
              <dt className="text-muted-foreground">Health</dt>
              <dd>{subscriptionSummary ?? "Not yet activated"}</dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">Model</dt>
          <dd>{getAutomationModelClassMeta(config.model_class).label}</dd>
          <dt className="text-muted-foreground">Network</dt>
          <dd>{getNetworkAccessMeta(config.network_access).label}</dd>
        </dl>
      </CardContent>
    </Card>
  );
}

function TriggerActivityCard({
  config,
  events,
  isLoading,
  onNavigateTab,
}: {
  config: AutomationConfigVersion;
  events: AutomationTriggerEvent[];
  isLoading: boolean;
  onNavigateTab: (tab: string, runId?: string) => void;
}) {
  if (config.trigger_type !== "event" || !config.provider_trigger) {
    return null;
  }

  const lastStartedRun = events.find((event) => event.status === "dispatched");
  const activeMode =
    config.provider_trigger.subscription_state.active_mode ??
    config.provider_trigger.delivery.preferred_mode;

  return (
    <Card className="md:col-span-2">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-sm">Trigger Activity</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Recent events from your provider and whether they triggered a run.
          </p>
        </div>
        <Badge variant="outline" className="capitalize">
          {activeMode}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border bg-muted/20 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Last dispatch
            </p>
            <p className="mt-2 text-sm font-semibold">
              {lastStartedRun
                ? relativeTime(lastStartedRun.created_at)
                : "No matched deliveries yet"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {lastStartedRun
                ? fullTimestamp(lastStartedRun.created_at)
                : "Waiting for the first matching provider event."}
            </p>
          </div>
          <div className="rounded-2xl border bg-primary/5 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary">
              Delivery mode
            </p>
            <p className="mt-2 text-sm font-semibold capitalize">{activeMode}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Preferred mode is {config.provider_trigger.delivery.preferred_mode} with{" "}
              {config.provider_trigger.delivery.fallback_mode ?? "no"} fallback.
            </p>
          </div>
          <div className="rounded-2xl border bg-amber-500/5 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-amber-700 dark:text-amber-300">
              Subscription
            </p>
            <p className="mt-2 text-sm font-semibold">
              {getProviderTriggerSubscriptionSummary(config) ?? "Not yet activated"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {config.provider_trigger.subscription_state.updated_at
                ? `Updated ${relativeTime(config.provider_trigger.subscription_state.updated_at)}`
                : "No provider lifecycle update recorded yet."}
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-14 w-full" />
            ))}
          </div>
        ) : events.length === 0 ? (
          <div className="rounded-2xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
            No provider deliveries have been recorded for this automation yet.
          </div>
        ) : (
          <div className="space-y-2">
            {events.map((event) => {
              const canOpenRun = Boolean(event.automation_run_id);
              const content = (
                <>
                  <Badge
                    variant={event.status === "dispatched" ? "default" : "secondary"}
                    className="mt-0.5 capitalize"
                  >
                    {event.match_status ?? event.status}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{getTriggerEventSummary(event)}</p>
                      {event.delivery_mode ? (
                        <Badge variant="outline" className="capitalize">
                          {event.delivery_mode}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {event.event_type} · {relativeTime(event.created_at)}
                    </p>
                    {event.failure_reason ? (
                      <p className="mt-1 text-xs text-destructive">
                        Reason: {event.failure_reason.replaceAll("_", " ")}
                      </p>
                    ) : null}
                  </div>
                  {canOpenRun ? (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      View run
                      {event.automation_run_status ? ` (${event.automation_run_status})` : ""}
                      <ArrowRightIcon className="size-3" />
                    </span>
                  ) : null}
                </>
              );

              return canOpenRun ? (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => onNavigateTab("runs", event.automation_run_id ?? undefined)}
                  className="flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors hover:bg-muted/50"
                >
                  {content}
                </button>
              ) : (
                <div
                  key={event.id}
                  className="flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left"
                >
                  {content}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const formatRunDuration = (run: AutomationRun): string => {
  if (!run.started_at || !run.ended_at) {
    return run.status === "running" || run.status === "pending" ? "In progress" : "-";
  }
  const durationMs = Math.max(0, Date.parse(run.ended_at) - Date.parse(run.started_at));
  return `${Math.max(1, Math.round(durationMs / 1000))}s`;
};

function RecentRunsTable({
  runs,
  onNavigateTab,
}: {
  runs: AutomationRun[];
  onNavigateTab: (tab: string, runId?: string) => void;
}) {
  if (runs.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-sm">Recent Runs</CardTitle>
        <Button variant="ghost" size="sm" className="text-xs" onClick={() => onNavigateTab("runs")}>
          View all
          <ArrowRightIcon className="ml-1 size-3" />
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Trigger type</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Duration</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => (
              <TableRow
                key={run.id}
                className="cursor-pointer"
                role="link"
                tabIndex={0}
                onClick={() => onNavigateTab("runs", run.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onNavigateTab("runs", run.id);
                  }
                }}
              >
                <TableCell>
                  <Badge variant={runStatusBadgeVariant(run.status)}>
                    {humanizeRunStatus(run.status)}
                  </Badge>
                </TableCell>
                <TableCell>{humanizeTriggerType(run.trigger_type)}</TableCell>
                <TableCell>{relativeTime(run.created_at)}</TableCell>
                <TableCell>{formatRunDuration(run)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function RecentRunsSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <Skeleton className="h-4 w-24" />
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-11 w-full" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function AutomationHomeTab({ automation, config, onNavigateTab }: AutomationHomeTabProps) {
  const runsRaw = useQuery(
    makeFunctionReference<"query">("automation_runs:listAutomationRuns"),
    automation.id
      ? {
          automation_id: automation.id,
          paginationOpts: { numItems: 5, cursor: EMPTY_CURSOR },
        }
      : "skip",
  );

  const runs = useMemo(() => parsePaginatedRuns(runsRaw).page, [runsRaw]);
  const triggerEventsRaw = useQuery(
    makeFunctionReference<"query">("automation_triggers:listAutomationTriggerEvents"),
    automation.id && config?.trigger_type === "event"
      ? { automation_id: automation.id, limit: 6 }
      : "skip",
  );
  const triggerEvents = useMemo(
    () => parseAutomationTriggerEvents(triggerEventsRaw ?? []),
    [triggerEventsRaw],
  );
  const isLoadingRuns = runsRaw === undefined;
  const isLoadingTriggerEvents = config?.trigger_type === "event" && triggerEventsRaw === undefined;
  const state = isLoadingRuns ? null : deriveState(config, runs);

  if (state === null) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="md:col-span-2">
          <CardContent className="py-6">
            <div className="space-y-3">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-72" />
            </div>
          </CardContent>
        </Card>
        <RecentRunsSkeleton />
        <Card>
          <CardHeader className="pb-3">
            <Skeleton className="h-4 w-28" />
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (state === "unconfigured") {
    return (
      <div className="grid gap-4">
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <SettingsIcon className="size-6 text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">Set up your automation</h3>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                This automation needs a prompt before it can run. Configure a trigger, runner, and
                prompt to get started.
              </p>
            </div>
            <Button onClick={() => onNavigateTab("config")}>
              <SettingsIcon className="mr-1.5 size-4" />
              Set up config
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Automation Info</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Status</dt>
              <dd>
                <Badge
                  variant={automationStatusBadgeVariant(automation.status)}
                  className="capitalize"
                >
                  {automation.status}
                </Badge>
              </dd>
              <dt className="text-muted-foreground">Created</dt>
              <dd>{fullTimestamp(automation.created_at)}</dd>
            </dl>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (state === "never_run") {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-primary/20 bg-primary/5 md:col-span-2">
          <CardContent className="flex flex-col items-center gap-4 py-8 text-center sm:flex-row sm:text-left">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <PlayIcon className="size-6 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold">Ready to run</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Your automation is configured and waiting for its first run. Use the controls above
                when you're ready to trigger execution.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onNavigateTab("config")}>
                Edit config
              </Button>
              <Button variant="secondary" onClick={() => onNavigateTab("runs")}>
                View run history
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardContent className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3">
              <Badge
                variant={automationStatusBadgeVariant(automation.status)}
                className="capitalize"
              >
                {automation.status}
              </Badge>
              <span className="text-sm text-muted-foreground">
                Created {relativeTime(automation.created_at)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Availability controls live in the summary panel above.
            </p>
          </CardContent>
        </Card>

        {config ? (
          <TriggerActivityCard
            config={config}
            events={triggerEvents}
            isLoading={Boolean(isLoadingTriggerEvents)}
            onNavigateTab={onNavigateTab}
          />
        ) : null}
        {config && <ConfigSummary config={config} onNavigateTab={onNavigateTab} />}
      </div>
    );
  }

  const latestRun = runs[0] ?? null;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="md:col-span-2">
        <CardContent className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <StatusIndicator state={state} />
            <div>
              <div className="flex items-center gap-2">
                <Badge
                  variant={automationStatusBadgeVariant(automation.status)}
                  className="capitalize"
                >
                  {automation.status}
                </Badge>
                {state === "running" ? (
                  <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
                    Run in progress
                  </span>
                ) : null}
                {state === "needs_attention" ? (
                  <span className="text-sm font-medium text-destructive">Needs attention</span>
                ) : null}
                {state === "healthy" ? (
                  <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                    Healthy
                  </span>
                ) : null}
              </div>
              {latestRun ? (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Last run {relativeTime(latestRun.created_at)}
                </p>
              ) : null}
            </div>
          </div>

          {state === "running" ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                latestRun ? onNavigateTab("runs", latestRun.id) : onNavigateTab("runs")
              }
            >
              View live run
              <ArrowRightIcon className="ml-1.5 size-3" />
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              Use the summary controls above to run or pause this automation.
            </p>
          )}
        </CardContent>
      </Card>

      {state === "needs_attention" && latestRun?.error_message ? (
        <Card className="border-destructive/40 md:col-span-2">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-destructive">Last run failed</p>
                <UserFacingErrorView
                  error={toUserFacingError(latestRun.error_message, {
                    fallback: "The last run failed.",
                  })}
                  variant="compact"
                  className="mt-2"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => onNavigateTab("runs", latestRun.id)}
              >
                View details
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {isLoadingRuns ? (
        <RecentRunsSkeleton />
      ) : (
        <RecentRunsTable runs={runs} onNavigateTab={onNavigateTab} />
      )}

      {config ? (
        <TriggerActivityCard
          config={config}
          events={triggerEvents}
          isLoading={Boolean(isLoadingTriggerEvents)}
          onNavigateTab={onNavigateTab}
        />
      ) : null}
      {config && <ConfigSummary config={config} onNavigateTab={onNavigateTab} />}
    </div>
  );
}
