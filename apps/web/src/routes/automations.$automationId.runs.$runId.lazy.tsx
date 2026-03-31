import { runDetailRoute } from "./automations.$automationId.runs.$runId";
import { useMemo, useState } from "react";
import { createLazyRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  BanIcon,
  CheckCircle2Icon,
  Clock3Icon,
  Loader2Icon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RunChatViewer } from "@/components/automations/run-chat-viewer";
import { LogViewer } from "@/components/automations/log-viewer";
import { UserFacingErrorView } from "@/components/ui/user-facing-error";
import {
  getRunOutcomeBadgeLabel,
  getRunOutcomeBadgeVariant,
  getRunOutcomeTitle,
  getRunStatusSummary,
  parseAutomationRun,
  runStatusBadgeVariant,
  humanizeTriggerType,
} from "@/lib/automations-view-model";
import { relativeTime } from "@/lib/format";
import { toUserFacingError, type UserFacingError } from "@/lib/user-facing-errors";
import { useRouteParams } from "@/hooks/use-route-params";

export const runDetailRouteLazy = createLazyRoute(runDetailRoute.id)({
  component: RunDetailPage,
});

const describeOutcome = (status: string): string => {
  switch (status) {
    case "failed":
      return "Run failed. Review the grouped timeline below to locate the last successful step and the failure context.";
    case "succeeded":
      return "Run completed successfully. The grouped timeline below shows the full reasoning and execution sequence.";
    case "cancelled":
      return "Run was cancelled before completion. Review the final grouped events to confirm where execution stopped.";
    case "timed_out":
      return "Run timed out before completion. Review the latest grouped events to identify what stalled.";
    case "running":
      return "Run is still in progress. New grouped events will append in real time.";
    default:
      return "Run is queued. Execution details will appear here as soon as the worker starts.";
  }
};

const getRunSummaryIcon = (run: NonNullable<ReturnType<typeof parseAutomationRun>>) => {
  if (run.outcome?.success === false || run.status === "failed" || run.status === "timed_out") {
    return <AlertTriangleIcon className="size-4" />;
  }
  if (run.outcome?.success === true || run.status === "succeeded") {
    return <CheckCircle2Icon className="size-4" />;
  }
  if (run.status === "running") {
    return <Loader2Icon className="size-4 animate-spin" />;
  }
  if (run.status === "cancelled") {
    return <BanIcon className="size-4" />;
  }
  return <Clock3Icon className="size-4" />;
};

function RunDetailPage() {
  const navigate = useNavigate();
  const { automationId, runId } = runDetailRoute.useParams();
  const { buildWorkspacePath } = useRouteParams();

  const [tab, setTab] = useState<"chat" | "raw">("chat");
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState<UserFacingError | null>(null);

  const runRaw = useQuery(
    makeFunctionReference<"query">("automation_runs:getAutomationRun"),
    runId ? { automation_run_id: runId } : "skip",
  );

  const cancelMutation = useMutation(
    makeFunctionReference<"mutation">("automation_runs:cancelAutomationRun"),
  );

  const run = useMemo(() => parseAutomationRun(runRaw), [runRaw]);

  const canCancel = run !== null && (run.status === "pending" || run.status === "running");

  const handleCancel = async () => {
    if (!run) return;
    setError(null);
    setIsCancelling(true);
    try {
      await cancelMutation({ automation_run_id: run.id });
    } catch (caught) {
      setError(toUserFacingError(caught, { fallback: "Failed to cancel run." }));
    } finally {
      setIsCancelling(false);
    }
  };

  const durationMs =
    run?.started_at && run.ended_at
      ? Math.max(0, Date.parse(run.ended_at) - Date.parse(run.started_at))
      : null;
  const runSummaryTone =
    run?.outcome?.success === false || run?.status === "failed" || run?.status === "timed_out"
      ? "border-destructive/30 bg-destructive/8"
      : run?.outcome?.success === true || run?.status === "succeeded"
        ? "border-emerald-500/25 bg-emerald-500/8"
        : "border-border bg-muted/30";

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-4 py-4">
        <div className="flex flex-wrap items-start gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              void navigate({
                to: buildWorkspacePath(`/automations/${automationId}`),
                search: {},
              })
            }
          >
            <ArrowLeftIcon className="mr-1 size-4" />
            Back
          </Button>

          {runRaw === undefined ? (
            <span className="text-muted-foreground text-sm">Loading run...</span>
          ) : run ? (
            <>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-base font-semibold">Automation run</p>
                  <Badge variant={runStatusBadgeVariant(run.status)} className="capitalize">
                    {run.status.replace("_", " ")}
                  </Badge>
                  {getRunOutcomeBadgeLabel(run) ? (
                    <Badge variant={getRunOutcomeBadgeVariant(run)} className="text-xs">
                      {getRunOutcomeBadgeLabel(run)}
                    </Badge>
                  ) : null}
                  <Badge variant="outline" className="text-xs">
                    {humanizeTriggerType(run.trigger_type)}
                  </Badge>
                </div>
                <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
                  {run.created_at ? <span>{relativeTime(run.created_at)}</span> : null}
                  {durationMs !== null ? (
                    <span className="inline-flex items-center gap-1">
                      <Clock3Icon className="size-3.5" />
                      {Math.round(durationMs / 1000)}s
                    </span>
                  ) : null}
                  <code>{run.id}</code>
                </div>
              </div>

              <div className="ml-auto flex items-center gap-2">
                {canCancel ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleCancel()}
                    disabled={isCancelling}
                  >
                    {isCancelling ? "Cancelling..." : "Cancel"}
                  </Button>
                ) : null}
              </div>
            </>
          ) : (
            <span className="text-muted-foreground text-sm">Run not found.</span>
          )}
        </div>

        {run ? (
          <div className={`mt-4 rounded-2xl border px-4 py-3 ${runSummaryTone}`}>
            <div className="flex flex-wrap items-start gap-3">
              <div
                className={
                  run.outcome?.success === false ||
                  run.status === "failed" ||
                  run.status === "timed_out"
                    ? "rounded-xl bg-destructive/12 p-2 text-destructive"
                    : run.outcome?.success === true || run.status === "succeeded"
                      ? "rounded-xl bg-emerald-500/12 p-2 text-emerald-700 dark:text-emerald-400"
                      : "rounded-xl bg-background/80 p-2 text-foreground"
                }
              >
                {getRunSummaryIcon(run)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{getRunOutcomeTitle(run)}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {run.outcome ? getRunStatusSummary(run) : describeOutcome(run.status)}
                </p>
                {run.error_message ? (
                  <UserFacingErrorView
                    error={toUserFacingError(run.error_message, {
                      fallback: "This run failed.",
                    })}
                    variant="compact"
                    className="mt-3"
                  />
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {error ? <UserFacingErrorView error={error} variant="compact" className="mt-3" /> : null}
      </div>

      {run ? (
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as "chat" | "raw")}
          className="flex flex-1 flex-col overflow-hidden"
        >
          <div className="border-b px-4 py-3">
            <TabsList className="h-10 bg-muted/60 p-1">
              <TabsTrigger value="chat" className="px-3">
                Grouped timeline
              </TabsTrigger>
              <TabsTrigger value="raw" className="px-3">
                Raw logs
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="chat" className="mt-0 flex flex-1 flex-col overflow-hidden">
            <RunChatViewer automationRunId={run.id} />
          </TabsContent>

          <TabsContent value="raw" className="mt-0 flex-1 overflow-auto p-4">
            <LogViewer automationRunId={run.id} />
          </TabsContent>
        </Tabs>
      ) : runRaw === undefined ? null : (
        <div className="p-4 text-sm text-muted-foreground">
          The requested run could not be found for this workspace.
        </div>
      )}
    </div>
  );
}
