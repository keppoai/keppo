import { approvalsRoute } from "./approvals";
import { createLazyRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { SearchIcon } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useWorkspace } from "@/hooks/use-workspace-context";
import { useActions } from "@/hooks/use-actions";
import { ApproveActionsDialog } from "@/components/approvals/approve-actions-dialog";
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
import { buildApprovalQueueView, getApprovalGroupForAction } from "@/lib/approvals-view-model";
import { runBatchedSettled } from "@/lib/run-batched-settled";
import { showUserFacingErrorToast } from "@/lib/show-user-facing-error-toast";
import { toUserFacingError, type UserFacingError } from "@/lib/user-facing-errors";

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

const APPROVAL_BATCH_CONCURRENCY = 10;

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
  const [approveTargetIds, setApproveTargetIds] = useState<string[]>([]);
  const [rejectTargetIds, setRejectTargetIds] = useState<string[]>([]);
  const [rejectReason, setRejectReason] = useState("");
  const [submittingApprove, setSubmittingApprove] = useState(false);
  const [submittingReject, setSubmittingReject] = useState(false);
  const [panelError, setPanelError] = useState<UserFacingError | null>(null);
  const [feedback, setFeedback] = useState<{
    actionId: string;
    title: string;
    summary: string;
  } | null>(null);
  const [busyActionIds, setBusyActionIds] = useState<string[]>([]);
  const tableRegionRef = useRef<HTMLDivElement | null>(null);
  const {
    actions,
    isActionsLoading,
    selectedActionId,
    actionDetails,
    isActionDetailsLoading,
    approveAction,
    rejectAction,
    inspectAction,
  } = useActions(selectedWorkspaceId, {
    statusFilter,
  });
  const canApproveActions = canApprove();
  const approvalQueueView = useMemo(
    () => buildApprovalQueueView(actions, searchTerm),
    [actions, searchTerm],
  );
  const visibleActions = approvalQueueView.ordered_actions;
  const visibleActionIds = approvalQueueView.visible_action_ids;
  const visibleGroups = approvalQueueView.groups;
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
  const selectedActionVisible = selectedActionId
    ? visibleActionIds.includes(selectedActionId)
    : false;
  const selectedActionGroup = useMemo(
    () => getApprovalGroupForAction(visibleGroups, selectedActionId),
    [selectedActionId, visibleGroups],
  );
  const selectedRunCount = useMemo(() => {
    const selectedRuns = new Set(
      visibleActions
        .filter((action) => selectedActionIds.includes(action.id))
        .map((action) => action.automation_run_id),
    );
    return selectedRuns.size;
  }, [selectedActionIds, visibleActions]);
  const remainingAfterCurrent = Math.max(
    visiblePendingCount - (selectedAction?.status === "pending" ? 1 : 0),
    0,
  );
  const approveDialogPendingIds = useMemo(() => {
    const pendingIdSet = new Set(
      visibleActions.filter((action) => action.status === "pending").map((action) => action.id),
    );
    return [...new Set(approveTargetIds)].filter((id) => pendingIdSet.has(id));
  }, [approveTargetIds, visibleActions]);
  const approveDialogCount = approveDialogPendingIds.length;

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

  const addBusyActionIds = (ids: string[]) => {
    setBusyActionIds((current) => [...new Set([...current, ...ids])]);
  };

  const removeBusyActionIds = (ids: string[]) => {
    setBusyActionIds((current) => current.filter((id) => !ids.includes(id)));
  };

  const resolvePendingVisibleIds = (ids: string[]) => {
    const pendingIdSet = new Set(
      visibleActions.filter((action) => action.status === "pending").map((action) => action.id),
    );
    return [...new Set(ids)].filter((id) => pendingIdSet.has(id));
  };

  const resolveFeedbackAnchorId = (resolvedIds: string[]) => {
    if (selectedActionId && resolvedIds.includes(selectedActionId)) {
      return selectedActionId;
    }
    return resolvedIds[0] ?? null;
  };

  const handleApproveIds = async (ids: string[]) => {
    const pendingIds = resolvePendingVisibleIds(ids);
    if (pendingIds.length === 0) {
      return;
    }

    try {
      setPanelError(null);
      setFeedback(null);
      addBusyActionIds(pendingIds);
      const results = await runBatchedSettled(pendingIds, APPROVAL_BATCH_CONCURRENCY, (id) =>
        approveAction(id),
      );
      const successfulIds: string[] = [];
      const failedIds: string[] = [];
      let firstFailureReason: unknown = null;

      results.forEach((result, index) => {
        const id = pendingIds[index];
        if (!id) {
          return;
        }
        if (result.status === "fulfilled") {
          successfulIds.push(id);
          return;
        }
        failedIds.push(id);
        firstFailureReason ??= result.reason;
      });

      if (failedIds.length > 0) {
        const normalized = toUserFacingError(firstFailureReason, {
          fallback: "Failed to approve one or more actions.",
        });
        setPanelError(normalized);
        if (failedIds.length > 1 || successfulIds.length > 0) {
          showUserFacingErrorToast(firstFailureReason, {
            normalized,
          });
        }
      }

      if (successfulIds.length > 0) {
        setSelectedActionIds((current) => current.filter((id) => !successfulIds.includes(id)));
        const feedbackActionId = resolveFeedbackAnchorId(successfulIds);
        if (feedbackActionId) {
          setFeedback({
            actionId: feedbackActionId,
            title:
              successfulIds.length === 1
                ? "Approval recorded"
                : `${successfulIds.length} actions approved`,
            summary:
              successfulIds.length === 1
                ? "Keppo queued the approved action for execution. You can keep this detail panel open or jump to the next review item."
                : "Keppo queued the approved actions for execution. You can keep this detail panel open or jump to the next review item.",
          });
        }
      }
    } catch (error) {
      setPanelError(toUserFacingError(error, { fallback: "Failed to approve action." }));
    } finally {
      removeBusyActionIds(pendingIds);
    }
  };

  const handleApprove = async (actionId: string) => {
    await handleApproveIds([actionId]);
  };

  const handleBatchApprove = async () => {
    const pendingIds = resolvePendingVisibleIds(selectedActionIds);
    if (pendingIds.length <= 1) {
      await handleApproveIds(pendingIds);
      return;
    }
    setApproveTargetIds(pendingIds);
  };

  const openRejectDialog = (ids: string[]) => {
    if (ids.length === 0) {
      return;
    }
    setRejectTargetIds(ids);
    setRejectReason("");
  };

  const handleReject = async () => {
    const pendingIds = resolvePendingVisibleIds(rejectTargetIds);
    if (pendingIds.length === 0) {
      return;
    }
    setSubmittingReject(true);
    try {
      setPanelError(null);
      setFeedback(null);
      addBusyActionIds(pendingIds);
      const results = await runBatchedSettled(pendingIds, APPROVAL_BATCH_CONCURRENCY, (id) =>
        rejectAction(id, rejectReason.trim()),
      );
      const successfulIds: string[] = [];
      const failedIds: string[] = [];
      let firstFailureReason: unknown = null;

      results.forEach((result, index) => {
        const id = pendingIds[index];
        if (!id) {
          return;
        }
        if (result.status === "fulfilled") {
          successfulIds.push(id);
          return;
        }
        failedIds.push(id);
        firstFailureReason ??= result.reason;
      });

      if (failedIds.length > 0) {
        const normalized = toUserFacingError(firstFailureReason, {
          fallback: "Failed to reject one or more actions.",
        });
        setPanelError(normalized);
        if (failedIds.length > 1 || successfulIds.length > 0) {
          showUserFacingErrorToast(firstFailureReason, {
            normalized,
          });
        }
      }

      if (successfulIds.length > 0) {
        const feedbackActionId = resolveFeedbackAnchorId(successfulIds);
        if (feedbackActionId) {
          setFeedback({
            actionId: feedbackActionId,
            title:
              successfulIds.length === 1
                ? "Action rejected"
                : `${successfulIds.length} actions rejected`,
            summary:
              successfulIds.length === 1
                ? "This action will not execute. Keppo kept the audit detail open so you can confirm the recorded decision before moving on."
                : "These actions will not execute. Keppo kept the current audit detail open so you can confirm the recorded decisions before moving on.",
          });
        }
        setSelectedActionIds((current) => current.filter((id) => !successfulIds.includes(id)));
      }

      if (failedIds.length === 0) {
        setRejectTargetIds([]);
        setRejectReason("");
      } else if (successfulIds.length > 0) {
        setRejectTargetIds(failedIds);
      }
    } finally {
      setSubmittingReject(false);
      removeBusyActionIds(pendingIds);
    }
  };

  const handleApproveGroup = (ids: string[]) => {
    const pendingIds = resolvePendingVisibleIds(ids);
    if (pendingIds.length <= 1) {
      void handleApproveIds(pendingIds);
      return;
    }
    setApproveTargetIds(pendingIds);
  };

  const handleConfirmApprove = async () => {
    const pendingIds = approveDialogPendingIds;
    if (pendingIds.length === 0) {
      setApproveTargetIds([]);
      return;
    }
    setSubmittingApprove(true);
    try {
      await handleApproveIds(pendingIds);
      setApproveTargetIds([]);
    } finally {
      setSubmittingApprove(false);
    }
  };

  const handleTableKeyDown = async (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    const tagName = target?.tagName?.toLowerCase();
    if (
      approveTargetIds.length > 0 ||
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
          {visibleActionIds.length > 0 && (
            <Badge variant="secondary">
              {statusFilter === "pending"
                ? `${visiblePendingCount} pending`
                : `${visibleActionIds.length} shown`}
            </Badge>
          )}
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
              placeholder="Search actions, runs, or payload"
              aria-label="Search actions, runs, or payload"
            />
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border bg-muted/20 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Ready now
            </p>
            <p className="mt-2 text-2xl font-semibold">{visibleActions.length}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Across {visibleGroups.length} automation run{visibleGroups.length === 1 ? "" : "s"} in
              this view
            </p>
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
              {selectedActionIds.length} actions selected across {selectedRunCount} run
              {selectedRunCount === 1 ? "" : "s"}.
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
                  groups={visibleGroups}
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
                  onApproveGroup={handleApproveGroup}
                  onRequestReject={openRejectDialog}
                  canApprove={canApproveActions}
                  busyActionIds={busyActionIds}
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
                  groupContext={
                    selectedActionGroup
                      ? {
                          automation_run_id: selectedActionGroup.automation_run_id,
                          automation_name: selectedActionGroup.automation_name,
                          automation_run_started_at: selectedActionGroup.automation_run_started_at,
                          visible_action_count: selectedActionGroup.actions.length,
                          visible_pending_count: selectedActionGroup.pending_count,
                        }
                      : null
                  }
                  onApprove={handleApprove}
                  onRequestReject={openRejectDialog}
                  canApprove={canApproveActions}
                  feedback={panelFeedback}
                  error={panelError}
                  selectedActionVisible={selectedActionVisible}
                  isApproving={selectedActionId ? busyActionIds.includes(selectedActionId) : false}
                  isRejecting={submittingReject && rejectTargetIds.includes(selectedActionId ?? "")}
                  testIdScope="approval-panel"
                />
              )}
            </Card>
          </div>
        </div>
      </div>

      <ApproveActionsDialog
        open={approveTargetIds.length > 0}
        pendingCount={approveDialogCount}
        submitting={submittingApprove}
        onConfirm={() => void handleConfirmApprove()}
        onCancel={() => setApproveTargetIds([])}
      />

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
