import { approvalsRoute } from "./approvals";
import { createLazyRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { SearchIcon } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useWorkspace } from "@/hooks/use-workspace-context";
import { useActions } from "@/hooks/use-actions";
import { ApprovalsTable } from "@/components/approvals/approvals-table";
import { ApprovalDetailPanel } from "@/components/approvals/approval-detail-panel";
import { TestActionDialog } from "@/components/approvals/test-action-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { showUserFacingErrorToast } from "@/lib/show-user-facing-error-toast";
import { toUserFacingError, type UserFacingError } from "@/lib/user-facing-errors";
import type { Action } from "@/lib/types";

export const approvalsRouteLazy = createLazyRoute(approvalsRoute.id)({
  component: ApprovalsPage,
});

type ApprovalStatusFilter = "all" | "pending" | "approved" | "rejected";

const STATUS_FILTERS: Array<{ label: string; value: ApprovalStatusFilter }> = [
  { label: "All", value: "all" },
  { label: "Pending", value: "pending" },
  { label: "Approved", value: "approved" },
  { label: "Rejected", value: "rejected" },
];

const REJECTION_TEMPLATES = [
  "Insufficient context",
  "Wrong scope",
  "Needs manual verification",
  "Not authorized",
] as const;

const RISK_PRIORITY: Record<Action["risk_level"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const searchAction = (action: Action, term: string): boolean => {
  const normalizedTerm = term.trim().toLowerCase();
  if (!normalizedTerm) {
    return true;
  }
  const payload = JSON.stringify(action.payload_preview ?? {}).toLowerCase();
  return (
    action.action_type.toLowerCase().includes(normalizedTerm) ||
    action.status.toLowerCase().includes(normalizedTerm) ||
    action.idempotency_key.toLowerCase().includes(normalizedTerm) ||
    payload.includes(normalizedTerm)
  );
};

const buildPanelFeedback = (
  feedback: { actionId: string; title: string; summary: string } | null,
  selectedActionId: string | null,
  visibleActionIds: string[],
  inspectAction: (actionId: string | null) => void,
) => {
  if (!feedback || feedback.actionId !== selectedActionId) {
    return null;
  }

  const nextVisibleId = visibleActionIds[0] ?? null;
  return {
    title: feedback.title,
    summary: feedback.summary,
    ...(nextVisibleId
      ? {
          actionLabel: "Open next pending",
          onAction: () => {
            inspectAction(nextVisibleId);
          },
        }
      : {}),
  };
};

function ApprovalsPage() {
  const { canApprove } = useAuth();
  const { selectedWorkspaceId } = useWorkspace();
  const [statusFilter, setStatusFilter] = useState<ApprovalStatusFilter>("pending");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedActionIds, setSelectedActionIds] = useState<string[]>([]);
  const [rejectTargetIds, setRejectTargetIds] = useState<string[]>([]);
  const [rejectReason, setRejectReason] = useState("");
  const [submittingReject, setSubmittingReject] = useState(false);
  const [panelError, setPanelError] = useState<UserFacingError | null>(null);
  const [feedback, setFeedback] = useState<{
    actionId: string;
    title: string;
    summary: string;
  } | null>(null);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const tableRegionRef = useRef<HTMLDivElement | null>(null);
  const {
    actions,
    isActionsLoading,
    selectedActionId,
    selectedActionVisible,
    actionDetails,
    isActionDetailsLoading,
    approveAction,
    rejectAction,
    inspectAction,
  } = useActions(selectedWorkspaceId, {
    statusFilter,
  });
  const canApproveActions = canApprove();
  const visibleActions = useMemo(() => {
    return [...actions]
      .filter((action) => searchAction(action, searchTerm))
      .sort((left, right) => {
        const riskDelta = RISK_PRIORITY[left.risk_level] - RISK_PRIORITY[right.risk_level];
        if (riskDelta !== 0) {
          return riskDelta;
        }
        return right.created_at.localeCompare(left.created_at);
      });
  }, [actions, searchTerm]);
  const visibleActionIds = useMemo(
    () => visibleActions.map((action) => action.id),
    [visibleActions],
  );
  const panelFeedback = useMemo(
    () => buildPanelFeedback(feedback, selectedActionId, visibleActionIds, inspectAction),
    [feedback, inspectAction, selectedActionId, visibleActionIds],
  );
  const allVisibleSelected =
    visibleActionIds.length > 0 && visibleActionIds.every((id) => selectedActionIds.includes(id));
  const selectedAction = useMemo(
    () => visibleActions.find((action) => action.id === selectedActionId) ?? null,
    [selectedActionId, visibleActions],
  );
  const visibleHighRiskCount = useMemo(
    () =>
      visibleActions.filter(
        (action) => action.risk_level === "high" || action.risk_level === "critical",
      ).length,
    [visibleActions],
  );
  const visiblePendingCount = useMemo(
    () => visibleActions.filter((action) => action.status === "pending").length,
    [visibleActions],
  );
  const visibleResolvedCount = useMemo(
    () =>
      visibleActions.filter(
        (action) => action.status === "approved" || action.status === "rejected",
      ).length,
    [visibleActions],
  );
  const remainingAfterCurrent = Math.max(
    visiblePendingCount - (selectedAction?.status === "pending" ? 1 : 0),
    0,
  );

  useEffect(() => {
    setSelectedActionIds((current) => current.filter((id) => visibleActionIds.includes(id)));
  }, [visibleActionIds]);

  useEffect(() => {
    if (!selectedActionId && visibleActionIds.length > 0) {
      inspectAction(visibleActionIds[0] ?? null);
      return;
    }
    if (selectedActionId && !visibleActionIds.includes(selectedActionId)) {
      if (actionDetails?.action.id === selectedActionId) {
        return;
      }
      inspectAction(visibleActionIds[0] ?? null);
    }
  }, [actionDetails?.action.id, inspectAction, selectedActionId, visibleActionIds]);

  const focusTableRegion = () => {
    tableRegionRef.current?.focus();
  };

  const handleApprove = async (actionId: string) => {
    try {
      setPanelError(null);
      setFeedback(null);
      setBusyActionId(actionId);
      await approveAction(actionId);
      setSelectedActionIds((current) => current.filter((id) => id !== actionId));
      setFeedback({
        actionId,
        title: "Approval recorded",
        summary:
          "Keppo queued the approved action for execution. You can keep this detail panel open or jump to the next review item.",
      });
    } catch (error) {
      setPanelError(toUserFacingError(error, { fallback: "Failed to approve action." }));
    } finally {
      setBusyActionId(null);
    }
  };

  const handleBatchApprove = async () => {
    const pendingIds = selectedActionIds.filter((id) =>
      visibleActions.some((action) => action.id === id && action.status === "pending"),
    );
    await Promise.all(pendingIds.map((id) => handleApprove(id)));
  };

  const openRejectDialog = (ids: string[]) => {
    if (ids.length === 0) {
      return;
    }
    setRejectTargetIds(ids);
    setRejectReason("");
  };

  const handleReject = async () => {
    if (rejectTargetIds.length === 0) {
      return;
    }
    setSubmittingReject(true);
    try {
      setPanelError(null);
      setFeedback(null);
      setBusyActionId(rejectTargetIds.length === 1 ? (rejectTargetIds[0] ?? null) : null);
      const results = await Promise.allSettled(
        rejectTargetIds.map((id) => rejectAction(id, rejectReason.trim())),
      );
      const failures = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (failures.length > 0) {
        const firstFailure = failures[0];
        const normalized = toUserFacingError(firstFailure?.reason, {
          fallback: "Failed to reject one or more actions.",
        });
        setPanelError(normalized);
        if (failures.length > 1) {
          showUserFacingErrorToast(firstFailure?.reason, {
            normalized,
          });
        }
      }
      if (failures.length !== rejectTargetIds.length) {
        if (rejectTargetIds.length === 1) {
          setFeedback({
            actionId: rejectTargetIds[0]!,
            title: "Action rejected",
            summary:
              "This action will not execute. Keppo kept the audit detail open so you can confirm the recorded decision before moving on.",
          });
        }
        setSelectedActionIds((current) => current.filter((id) => !rejectTargetIds.includes(id)));
        setRejectTargetIds([]);
        setRejectReason("");
      }
    } finally {
      setSubmittingReject(false);
      setBusyActionId(null);
    }
  };

  const handleTableKeyDown = async (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    const tagName = target?.tagName?.toLowerCase();
    if (
      rejectTargetIds.length > 0 ||
      tagName === "input" ||
      tagName === "textarea" ||
      tagName === "button" ||
      tagName === "select"
    ) {
      return;
    }
    if (visibleActionIds.length === 0) {
      return;
    }
    const currentIndex = selectedActionId ? visibleActionIds.indexOf(selectedActionId) : -1;
    if (event.key === "j") {
      event.preventDefault();
      const nextIndex = Math.min(currentIndex + 1, visibleActionIds.length - 1);
      inspectAction(visibleActionIds[nextIndex] ?? visibleActionIds[0]!);
      return;
    }
    if (event.key === "k") {
      event.preventDefault();
      const nextIndex = currentIndex <= 0 ? 0 : currentIndex - 1;
      inspectAction(visibleActionIds[nextIndex] ?? visibleActionIds[0]!);
      return;
    }
    if (!canApproveActions || !selectedActionId) {
      return;
    }
    if (event.key === "a") {
      event.preventDefault();
      await handleApprove(selectedActionId);
      return;
    }
    if (event.key === "r") {
      event.preventDefault();
      openRejectDialog([selectedActionId]);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">Approvals</h1>
          {actions.length > 0 && <Badge variant="secondary">{actions.length} pending</Badge>}
        </div>
        <TestActionDialog workspaceId={selectedWorkspaceId} />
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <Tabs
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value as ApprovalStatusFilter)}
          >
            <TabsList>
              {STATUS_FILTERS.map((filter) => (
                <TabsTrigger key={filter.value} value={filter.value}>
                  {filter.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="relative w-full max-w-sm">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.currentTarget.value)}
              className="pl-9"
              placeholder="Search action type or payload"
            />
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border bg-muted/20 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Ready now
            </p>
            <p className="mt-2 text-2xl font-semibold">{visibleActions.length}</p>
            <p className="mt-1 text-sm text-muted-foreground">Items matching the current filters</p>
          </div>
          <div className="rounded-2xl border border-destructive/30 bg-destructive/8 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-destructive">
              Review first
            </p>
            <p className="mt-2 text-2xl font-semibold">{visibleHighRiskCount}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Critical or high-risk actions in this view
            </p>
          </div>
          <div className="rounded-2xl border border-primary/25 bg-primary/8 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary">
              After this one
            </p>
            <p className="mt-2 text-2xl font-semibold">{remainingAfterCurrent}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {visibleResolvedCount} already resolved in this filtered view
            </p>
          </div>
        </div>

        {selectedActionIds.length >= 2 && canApproveActions ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3">
            <p className="text-sm font-medium">
              {selectedActionIds.length} actions selected for bulk review.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => {
                  void handleBatchApprove();
                }}
              >
                Approve Selected ({selectedActionIds.length})
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => openRejectDialog(selectedActionIds)}
              >
                Reject Selected ({selectedActionIds.length})
              </Button>
            </div>
          </div>
        ) : null}

        <div
          ref={tableRegionRef}
          tabIndex={0}
          className="rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          onKeyDown={(event) => {
            void handleTableKeyDown(event);
          }}
        >
          <div className="mb-2 text-xs text-muted-foreground">
            j/k navigate, a approve, r reject
          </div>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,11fr)_minmax(0,9fr)]">
            {isActionsLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : (
              <Card className="overflow-auto">
                <ApprovalsTable
                  actions={visibleActions}
                  selectedActionId={selectedActionId}
                  selectedActionIds={selectedActionIds}
                  allVisibleSelected={allVisibleSelected}
                  onToggleAllVisible={(checked) => {
                    setSelectedActionIds(checked ? visibleActionIds : []);
                  }}
                  onToggleAction={(id, checked) => {
                    setSelectedActionIds((current) =>
                      checked
                        ? [...new Set([...current, id])]
                        : current.filter((value) => value !== id),
                    );
                  }}
                  onSelect={(id) => {
                    inspectAction(id);
                    focusTableRegion();
                  }}
                  onApprove={handleApprove}
                  onRequestReject={openRejectDialog}
                  canApprove={canApproveActions}
                  busyActionId={busyActionId}
                  emptyTitle={searchTerm ? "No matches" : "All clear"}
                  emptyDescription={
                    searchTerm
                      ? "Try a different action type or payload term."
                      : "No actions waiting for approval right now."
                  }
                />
              </Card>
            )}

            <Card className="min-h-[360px]">
              {isActionDetailsLoading ? (
                <div className="space-y-3 p-4">
                  <Skeleton className="h-6 w-1/3" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-11/12" />
                  <Skeleton className="h-32 w-full" />
                </div>
              ) : (
                <ApprovalDetailPanel
                  actionId={selectedActionId}
                  details={actionDetails}
                  onApprove={handleApprove}
                  onRequestReject={openRejectDialog}
                  canApprove={canApproveActions}
                  feedback={panelFeedback}
                  error={panelError}
                  selectedActionVisible={selectedActionVisible}
                  isApproving={busyActionId === selectedActionId}
                  isRejecting={submittingReject && rejectTargetIds.includes(selectedActionId ?? "")}
                  testIdScope="approval-panel"
                />
              )}
            </Card>
          </div>
        </div>
      </div>

      <Dialog
        open={rejectTargetIds.length > 0}
        onOpenChange={(open) => {
          if (!open && !submittingReject) {
            setRejectTargetIds([]);
            setRejectReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {rejectTargetIds.length > 1
                ? `Reject ${rejectTargetIds.length} actions`
                : "Reject action"}
            </DialogTitle>
            <DialogDescription>
              Record why this action should stay blocked. The same reason will be applied to each
              selected action.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="reject-reason">Reason (optional)</Label>
            <div className="flex flex-wrap gap-2">
              {REJECTION_TEMPLATES.map((template) => (
                <Button
                  key={template}
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setRejectReason(template)}
                >
                  {template}
                </Button>
              ))}
            </div>
            <Textarea
              id="reject-reason"
              rows={4}
              value={rejectReason}
              onChange={(event) => setRejectReason(event.currentTarget.value)}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setRejectTargetIds([]);
                setRejectReason("");
              }}
              disabled={submittingReject}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleReject()}
              disabled={submittingReject}
            >
              {submittingReject ? "Rejecting..." : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export { ApprovalsPage };
