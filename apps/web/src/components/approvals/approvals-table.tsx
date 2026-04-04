import { Fragment, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyIllustration,
  EmptyTitle,
} from "@/components/ui/empty";
import { getRiskBadgeVariant } from "@/lib/action-badges";
import { relativeTime, fullTimestamp } from "@/lib/format";
import type { ApprovalGroup } from "@/lib/approvals-view-model";
import type { Action } from "@/lib/types";

interface ApprovalsTableProps {
  groups: ApprovalGroup[];
  selectedActionId: string | null;
  onSelect: (id: string) => void;
  selectedActionIds: string[];
  onToggleAction: (id: string, checked: boolean) => void;
  onToggleAllVisible: (checked: boolean) => void;
  allVisibleSelected: boolean;
  onApprove: (id: string) => Promise<void> | void;
  onApproveGroup: (ids: string[]) => Promise<void> | void;
  onRequestReject: (ids: string[]) => void;
  canApprove: boolean;
  busyActionIds?: string[];
  emptyTitle?: string;
  emptyDescription?: string;
}

export function ApprovalsTable({
  groups,
  selectedActionId,
  onSelect,
  selectedActionIds,
  onToggleAction,
  onToggleAllVisible,
  allVisibleSelected,
  onApprove,
  onApproveGroup,
  onRequestReject,
  canApprove,
  busyActionIds = [],
  emptyTitle = "All clear",
  emptyDescription = "No actions waiting for approval right now.",
}: ApprovalsTableProps) {
  const selectedIdSet = useMemo(() => new Set(selectedActionIds), [selectedActionIds]);
  const busyIdSet = useMemo(() => new Set(busyActionIds), [busyActionIds]);
  const formatRunId = (runId: string): string => runId.replace(/^run_/, "").slice(0, 8);
  const rowToneClass = (riskLevel: Action["risk_level"], isSelected: boolean): string => {
    switch (riskLevel) {
      case "critical":
        return isSelected
          ? "border-l-4 border-l-red-700 bg-red-500/12 ring-1 ring-red-500/25"
          : "border-l-4 border-l-red-600 bg-red-500/5";
      case "high":
        return isSelected
          ? "border-l-4 border-l-red-600 bg-red-500/10 ring-1 ring-red-500/20"
          : "border-l-4 border-l-red-500";
      case "medium":
        return isSelected
          ? "border-l-4 border-l-amber-600 bg-amber-500/10 ring-1 ring-amber-500/20"
          : "border-l-4 border-l-amber-500";
      default:
        return isSelected
          ? "border-l-4 border-l-emerald-600 bg-emerald-500/10 ring-1 ring-emerald-500/20"
          : "border-l-4 border-l-emerald-500";
    }
  };
  if (groups.length === 0) {
    return (
      <Empty className="rounded-lg border py-10">
        <EmptyHeader>
          <EmptyIllustration
            src="/illustrations/empty-approvals.png"
            alt="Illustration of a calm all-clear approvals state"
            className="w-[160px]"
          />
          <EmptyTitle>{emptyTitle}</EmptyTitle>
          <EmptyDescription>{emptyDescription}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">
            <Checkbox
              aria-label="Select visible approvals"
              checked={allVisibleSelected}
              onCheckedChange={(checked) => {
                onToggleAllVisible(checked === true);
              }}
            />
          </TableHead>
          <TableHead>Action Type</TableHead>
          <TableHead>Risk Level</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Created</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups.map((group) => {
          const groupBusy = group.pending_action_ids.some((id) => busyIdSet.has(id));
          const showGroupActions = canApprove && group.pending_count > 1;
          const showGroupHeader = group.actions.length > 1;
          const groupLabel = `Run group: ${
            group.automation_name?.trim() || formatRunId(group.automation_run_id)
          }, ${group.pending_count} pending`;

          return (
            <Fragment key={group.automation_run_id}>
              {showGroupHeader ? (
                <TableRow
                  data-testid="approval-group-row"
                  data-run-id={group.automation_run_id}
                  aria-label={groupLabel}
                  className="bg-muted/25 hover:bg-muted/25"
                >
                  <TableCell colSpan={6} className="py-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span role="heading" aria-level={2} className="text-sm font-semibold">
                            {group.automation_name?.trim() ||
                              `Automation run ${formatRunId(group.automation_run_id)}`}
                          </span>
                          <Badge variant="outline">
                            Run {formatRunId(group.automation_run_id)}
                          </Badge>
                          <Badge variant="secondary">
                            {group.actions.length} action{group.actions.length === 1 ? "" : "s"}
                          </Badge>
                          <Badge variant={group.pending_count > 0 ? "secondary" : "outline"}>
                            {group.pending_count} pending
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {group.automation_run_started_at
                            ? `Started ${relativeTime(group.automation_run_started_at)}`
                            : `Latest action ${relativeTime(group.actions[0]?.created_at ?? "")}`}
                          {group.resolved_count > 0
                            ? ` • ${group.resolved_count} resolved in this view`
                            : ""}
                        </p>
                      </div>
                      {showGroupActions ? (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            onClick={() => {
                              void Promise.resolve(onApproveGroup(group.pending_action_ids));
                            }}
                            disabled={groupBusy}
                            data-testid="approval-group-approve"
                          >
                            {groupBusy ? "Working..." : `Approve group (${group.pending_count})`}
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => onRequestReject(group.pending_action_ids)}
                            disabled={groupBusy}
                            data-testid="approval-group-reject"
                          >
                            Reject group ({group.pending_count})
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ) : null}
              {group.actions.map((action) => (
                <TableRow
                  key={action.id}
                  data-testid="approval-row"
                  data-action-id={action.id}
                  data-action-type={action.action_type}
                  data-run-id={group.automation_run_id}
                  className={`${rowToneClass(action.risk_level, selectedActionId === action.id)} ${
                    selectedActionId === action.id ? "shadow-sm" : ""
                  } cursor-pointer ${action.risk_level === "critical" ? "animate-pulse" : ""}`}
                  onClick={() => onSelect(action.id)}
                >
                  <TableCell>
                    <Checkbox
                      aria-label={`Select ${action.action_type}`}
                      checked={selectedIdSet.has(action.id)}
                      onClick={(event) => {
                        event.stopPropagation();
                      }}
                      onCheckedChange={(checked) => {
                        onToggleAction(action.id, checked === true);
                      }}
                    />
                  </TableCell>
                  <TableCell className="font-medium" data-testid="approval-row-action-type">
                    <button
                      type="button"
                      data-testid="approval-row-select"
                      className="w-full cursor-pointer text-left"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelect(action.id);
                      }}
                    >
                      <span
                        className={
                          selectedActionId === action.id ? "font-semibold text-foreground" : ""
                        }
                      >
                        {action.action_type}
                      </span>
                      <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground/60">
                        {action.id.slice(0, 8)}
                      </span>
                    </button>
                  </TableCell>
                  <TableCell>
                    <Badge variant={getRiskBadgeVariant(action.risk_level)}>
                      {action.risk_level}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        action.status === "approved"
                          ? "default"
                          : action.status === "rejected"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {action.status}
                    </Badge>
                  </TableCell>
                  <TableCell title={fullTimestamp(action.created_at)}>
                    {relativeTime(action.created_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    {canApprove ? (
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="default"
                          onClick={async (event) => {
                            event.stopPropagation();
                            await Promise.resolve(onApprove(action.id));
                          }}
                          disabled={action.status !== "pending" || busyIdSet.has(action.id)}
                        >
                          {busyIdSet.has(action.id) ? "Working..." : "Approve"}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={(event) => {
                            event.stopPropagation();
                            onRequestReject([action.id]);
                          }}
                          disabled={action.status !== "pending" || busyIdSet.has(action.id)}
                        >
                          Reject
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">Viewer role</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}
