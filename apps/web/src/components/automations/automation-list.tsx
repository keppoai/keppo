import { useMemo, useState } from "react";
import { SearchIcon } from "lucide-react";
import { AutomationDescriptionPreview } from "@/components/automations/automation-description-content";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyIllustration,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  automationStatusBadgeVariant,
  getAutomationModelClassMeta,
  getAutomationPathSegment,
  getRunStatusSummary,
  humanizeRunStatus,
  humanizeTriggerType,
  parsePaginatedAutomations,
  type AutomationListItem,
} from "@/lib/automations-view-model";
import { fullTimestamp } from "@/lib/format";
import { useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

type AutomationListProps = {
  workspaceId: string;
  onOpenAutomation: (automationPath: string) => void;
};

const EMPTY_CURSOR: string | null = null;
type AutomationStatusFilter = "all" | "active" | "paused" | "draft";

const searchAutomation = (item: AutomationListItem, term: string): boolean => {
  const normalizedTerm = term.trim().toLowerCase();
  if (!normalizedTerm) {
    return true;
  }
  return [
    item.automation.name,
    item.automation.description,
    item.automation.mermaid_content,
    item.automation.status,
    item.current_config_version?.trigger_type,
    item.current_config_version?.model_class,
    item.latest_run?.status,
    item.latest_run?.error_message,
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .some((value) => value.toLowerCase().includes(normalizedTerm));
};

function AutomationListRow({
  item,
  onOpenAutomation,
}: {
  item: AutomationListItem;
  onOpenAutomation: (path: string) => void;
}) {
  const triggerType = item.current_config_version?.trigger_type ?? "schedule";
  const modelClass = item.current_config_version?.model_class ?? "auto";

  return (
    <TableRow
      className="cursor-pointer"
      onClick={() => {
        onOpenAutomation(getAutomationPathSegment(item.automation));
      }}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenAutomation(getAutomationPathSegment(item.automation));
        }
      }}
    >
      <TableCell>
        <div className="font-medium">{item.automation.name || item.automation.id}</div>
        <AutomationDescriptionPreview
          description={item.automation.description}
          mermaidContent={item.automation.mermaid_content}
        />
      </TableCell>
      <TableCell>
        <Badge
          variant={automationStatusBadgeVariant(item.automation.status)}
          className="capitalize"
        >
          {item.automation.status}
        </Badge>
      </TableCell>
      <TableCell>{humanizeTriggerType(triggerType)}</TableCell>
      <TableCell>{getAutomationModelClassMeta(modelClass).label}</TableCell>
      <TableCell>
        {item.latest_run ? (
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={
                  item.latest_run.status === "succeeded"
                    ? "default"
                    : item.latest_run.status === "cancelled"
                      ? "outline"
                      : item.latest_run.status === "pending" || item.latest_run.status === "running"
                        ? "secondary"
                        : "destructive"
                }
                className="w-fit"
              >
                {humanizeRunStatus(item.latest_run.status)}
              </Badge>
              <span className="text-muted-foreground text-xs">
                {fullTimestamp(item.latest_run.created_at)}
              </span>
            </div>
            <p className="max-w-[320px] truncate text-xs text-muted-foreground">
              {getRunStatusSummary(item.latest_run)}
            </p>
          </div>
        ) : (
          <span className="text-muted-foreground text-xs">No runs yet</span>
        )}
      </TableCell>
    </TableRow>
  );
}

export function AutomationList({ workspaceId, onOpenAutomation }: AutomationListProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<AutomationStatusFilter>("all");
  const automationsRaw = useQuery(
    makeFunctionReference<"query">("automations:listAutomations"),
    workspaceId
      ? {
          workspace_id: workspaceId,
          paginationOpts: { numItems: 100, cursor: EMPTY_CURSOR },
        }
      : "skip",
  );

  const automationPage = useMemo(
    () => parsePaginatedAutomations(automationsRaw).page,
    [automationsRaw],
  );
  const isLoading = Boolean(workspaceId) && automationsRaw === undefined;
  const filteredAutomations = useMemo(() => {
    return automationPage.filter((item) => {
      if (statusFilter !== "all" && item.automation.status !== statusFilter) {
        return false;
      }
      return searchAutomation(item, searchTerm);
    });
  }, [automationPage, searchTerm, statusFilter]);
  const activeAutomationCount = automationPage.filter(
    (item) => item.automation.status === "active",
  ).length;
  const attentionAutomationCount = automationPage.filter((item) => {
    const latestStatus = item.latest_run?.status;
    return latestStatus === "failed" || latestStatus === "timed_out";
  }).length;
  const neverRunCount = automationPage.filter((item) => item.latest_run === null).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workspace Automations</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {!isLoading ? (
          <>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border bg-muted/20 px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Total
                </p>
                <p className="mt-2 text-2xl font-semibold">{automationPage.length}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Automations configured for this workspace
                </p>
              </div>
              <div className="rounded-2xl border bg-primary/5 px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary">
                  Active
                </p>
                <p className="mt-2 text-2xl font-semibold">{activeAutomationCount}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Ready to trigger or run on schedule
                </p>
              </div>
              <div className="rounded-2xl border bg-secondary/10 px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-foreground">
                  Needs review
                </p>
                <p className="mt-2 text-2xl font-semibold">{attentionAutomationCount}</p>
                <p className="mt-1 text-sm text-muted-foreground">Latest run failed or timed out</p>
              </div>
            </div>

            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="relative w-full max-w-md">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.currentTarget.value)}
                  className="pl-9"
                  placeholder="Search by automation, trigger, runner, or run status"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {filteredAutomations.length} shown
                </span>
                <NativeSelect
                  value={statusFilter}
                  onChange={(event) => {
                    const next = event.currentTarget.value;
                    if (next === "active" || next === "paused" || next === "draft") {
                      setStatusFilter(next);
                      return;
                    }
                    setStatusFilter("all");
                  }}
                  className="w-40"
                  aria-label="Filter automations by status"
                >
                  <option value="all">All statuses</option>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="draft">Draft</option>
                </NativeSelect>
              </div>
            </div>
          </>
        ) : null}

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : automationPage.length === 0 ? (
          <Empty className="rounded-lg border px-6 py-10">
            <EmptyHeader>
              <EmptyIllustration
                src="/illustrations/empty-automations.png"
                alt="Illustration of a person and robot ready to build automations"
                className="w-[160px]"
              />
              <EmptyTitle>No automations yet</EmptyTitle>
              <EmptyDescription>
                Create your first automation to automate recurring workflows.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : filteredAutomations.length === 0 ? (
          <Empty className="rounded-lg border px-6 py-10">
            <EmptyHeader>
              <EmptyIllustration
                src="/illustrations/empty-automations.png"
                alt="Illustration of automation filters narrowing the list"
                className="w-[160px]"
              />
              <EmptyTitle>No automations match this view</EmptyTitle>
              <EmptyDescription>
                Try another search term or broaden the status filter.{" "}
                {neverRunCount > 0
                  ? `${neverRunCount} automation${neverRunCount === 1 ? "" : "s"} still have no runs.`
                  : "All listed automations have already run at least once."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Last run</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAutomations.map((item) => (
                <AutomationListRow
                  key={item.automation.id}
                  item={item}
                  onOpenAutomation={onOpenAutomation}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
