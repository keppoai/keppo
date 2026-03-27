import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import {
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  LoaderIcon,
  BanIcon,
  AlertTriangleIcon,
  SearchIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  getRunStatusSummary,
  humanizeTriggerType,
  parsePaginatedRuns,
  type AutomationRunStatus,
  humanizeRunStatus,
} from "@/lib/automations-view-model";
import { relativeTime } from "@/lib/format";
import { useRouteParams } from "@/hooks/use-route-params";

type RunListProps = {
  automationId: string;
  automationPath: string;
};

const EMPTY_CURSOR: string | null = null;

const searchRun = (
  run: ReturnType<typeof parsePaginatedRuns>["page"][number],
  term: string,
): boolean => {
  const normalizedTerm = term.trim().toLowerCase();
  if (!normalizedTerm) {
    return true;
  }
  return [run.id, run.status, run.trigger_type, run.error_message, getRunStatusSummary(run)]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .some((value) => value.toLowerCase().includes(normalizedTerm));
};

const StatusIcon = ({ status }: { status: AutomationRunStatus }) => {
  switch (status) {
    case "succeeded":
      return <CheckCircleIcon className="size-4 text-emerald-500" />;
    case "failed":
      return <XCircleIcon className="size-4 text-red-500" />;
    case "running":
      return <LoaderIcon className="size-4 animate-spin text-blue-400" />;
    case "pending":
      return <ClockIcon className="text-muted-foreground size-4" />;
    case "cancelled":
      return <BanIcon className="text-muted-foreground size-4" />;
    case "timed_out":
      return <AlertTriangleIcon className="size-4 text-amber-500" />;
  }
};

export function RunList({ automationId, automationPath }: RunListProps) {
  const navigate = useNavigate();
  const { buildWorkspacePath } = useRouteParams();
  const [statusFilter, setStatusFilter] = useState<"all" | AutomationRunStatus>("all");
  const [searchTerm, setSearchTerm] = useState("");

  const runsRaw = useQuery(
    makeFunctionReference<"query">("automation_runs:listAutomationRuns"),
    automationId
      ? {
          automation_id: automationId,
          ...(statusFilter === "all" ? {} : { status: statusFilter }),
          paginationOpts: { numItems: 100, cursor: EMPTY_CURSOR },
        }
      : "skip",
  );

  const runs = useMemo(() => parsePaginatedRuns(runsRaw).page, [runsRaw]);
  const filteredRuns = useMemo(
    () => runs.filter((run) => searchRun(run, searchTerm)),
    [runs, searchTerm],
  );
  const activeRunCount = runs.filter(
    (run) => run.status === "pending" || run.status === "running",
  ).length;
  const failedRunCount = runs.filter(
    (run) => run.status === "failed" || run.status === "timed_out",
  ).length;
  const successfulRunCount = runs.filter((run) => run.status === "succeeded").length;

  const handleSelectRun = (runId: string) => {
    void navigate({
      to: buildWorkspacePath(`/automations/${automationPath}/runs/${runId}`),
      search: {},
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">Runs</h3>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{filteredRuns.length} shown</span>
            <NativeSelect
              value={statusFilter}
              onChange={(event) => {
                const next = event.currentTarget.value;
                if (
                  next === "pending" ||
                  next === "running" ||
                  next === "succeeded" ||
                  next === "failed" ||
                  next === "cancelled" ||
                  next === "timed_out"
                ) {
                  setStatusFilter(next);
                  return;
                }
                setStatusFilter("all");
              }}
              className="w-44"
            >
              <option value="all">All statuses</option>
              <option value="pending">Pending</option>
              <option value="running">Running</option>
              <option value="succeeded">Succeeded</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
              <option value="timed_out">Timed Out</option>
            </NativeSelect>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div
            className="rounded-2xl border bg-muted/20 px-4 py-3"
            data-testid="run-summary-in-flight"
          >
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              In flight
            </p>
            <p className="mt-2 text-2xl font-semibold">{activeRunCount}</p>
            <p className="mt-1 text-sm text-muted-foreground">Pending or currently executing</p>
          </div>
          <div
            className="rounded-2xl border bg-destructive/5 px-4 py-3"
            data-testid="run-summary-needs-review"
          >
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-destructive">
              Needs review
            </p>
            <p className="mt-2 text-2xl font-semibold">{failedRunCount}</p>
            <p className="mt-1 text-sm text-muted-foreground">Failed or timed out outcomes</p>
          </div>
          <div
            className="rounded-2xl border bg-primary/5 px-4 py-3"
            data-testid="run-summary-succeeded"
          >
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary">
              Succeeded
            </p>
            <p className="mt-2 text-2xl font-semibold">{successfulRunCount}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Clean completions ready for spot checks
            </p>
          </div>
        </div>

        <div className="relative w-full max-w-md">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.currentTarget.value)}
            className="pl-9"
            placeholder="Search by status, trigger, error, or run ID"
          />
        </div>
      </div>

      {runs.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          No runs found for this automation.
        </p>
      ) : filteredRuns.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          No runs match this search. Try another term or broaden the status filter.
        </p>
      ) : (
        <div className="space-y-1">
          {filteredRuns.map((run) => {
            const durationMs =
              run.started_at && run.ended_at
                ? Math.max(0, Date.parse(run.ended_at) - Date.parse(run.started_at))
                : null;

            return (
              <button
                type="button"
                key={run.id}
                onClick={() => handleSelectRun(run.id)}
                className="hover:bg-muted/50 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors"
              >
                <StatusIcon status={run.status} />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{humanizeRunStatus(run.status)}</span>
                    <span className="text-muted-foreground text-xs">
                      {humanizeTriggerType(run.trigger_type)}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {run.created_at ? relativeTime(run.created_at) : "Just now"}
                    </span>
                  </div>
                  <p
                    className={
                      run.status === "failed" || run.status === "timed_out"
                        ? "text-destructive mt-0.5 truncate text-xs"
                        : "text-muted-foreground mt-0.5 truncate text-xs"
                    }
                  >
                    {getRunStatusSummary(run)}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {durationMs !== null ? (
                    <Badge variant="outline" className="text-[10px]">
                      {Math.round(durationMs / 1000)}s
                    </Badge>
                  ) : null}
                  <code className="text-muted-foreground hidden text-[10px] sm:inline">
                    {run.id}
                  </code>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
