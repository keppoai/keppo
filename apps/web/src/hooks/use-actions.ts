import { useCallback, useEffect, useMemo, useState } from "react";
import { makeFunctionReference } from "convex/server";
import { parseActionDetailPayload, parsePendingActionsPayload } from "@/lib/boundary-contracts";
import { useDashboardRuntime } from "@/lib/dashboard-runtime";
import type { Action, ActionDetailResponse } from "@/lib/types";

type UseActionsOptions = {
  statusFilter?: Action["status"] | "all";
};

export function useActions(workspaceId: string, options: UseActionsOptions = {}) {
  const runtime = useDashboardRuntime();
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const statusFilter = options.statusFilter ?? "pending";
  const actionsQueryRef =
    statusFilter === "pending"
      ? makeFunctionReference<"query">("actions:listPendingByWorkspace")
      : makeFunctionReference<"query">("actions:listByWorkspace");
  const actionsQuery = runtime.useQuery(
    actionsQueryRef,
    workspaceId
      ? statusFilter === "pending"
        ? { workspaceId }
        : {
            workspaceId,
            ...(statusFilter === "all" ? {} : { status: statusFilter }),
          }
      : "skip",
  );
  const actionDetailsQuery = runtime.useQuery(
    makeFunctionReference<"query">("actions:getActionDetail"),
    selectedActionId ? { actionId: selectedActionId } : "skip",
  );
  const approveActionMutation = runtime.useMutation(
    makeFunctionReference<"mutation">("actions:approveAction"),
  );
  const rejectActionMutation = runtime.useMutation(
    makeFunctionReference<"mutation">("actions:rejectAction"),
  );

  const actions = useMemo<Action[]>(() => {
    return parsePendingActionsPayload(actionsQuery ?? []);
  }, [actionsQuery]);
  const actionDetails = useMemo<ActionDetailResponse | null>(
    () => parseActionDetailPayload(actionDetailsQuery ?? null),
    [actionDetailsQuery],
  );
  const selectedActionVisible = useMemo(
    () => (selectedActionId ? actions.some((action) => action.id === selectedActionId) : false),
    [actions, selectedActionId],
  );

  useEffect(() => {
    if (!workspaceId) {
      setSelectedActionId(null);
      return;
    }
    if (actionsQuery === undefined) {
      return;
    }
    if (
      selectedActionId &&
      !actions.some((action) => action.id === selectedActionId) &&
      actionDetails?.action.id !== selectedActionId
    ) {
      setSelectedActionId(null);
    }
  }, [actionDetails?.action.id, actions, actionsQuery, selectedActionId, workspaceId]);

  const approveAction = useCallback(
    async (actionId: string): Promise<void> => {
      await approveActionMutation({
        actionId,
        reason: "Approved from dashboard",
      });
    },
    [approveActionMutation],
  );

  const rejectAction = useCallback(
    async (actionId: string, reason: string): Promise<void> => {
      await rejectActionMutation({
        actionId,
        reason,
      });
    },
    [rejectActionMutation],
  );

  const inspectAction = useCallback((actionId: string | null) => {
    setSelectedActionId(actionId);
  }, []);

  const isActionsLoading = Boolean(workspaceId) && actionsQuery === undefined;
  const isActionDetailsLoading = Boolean(selectedActionId) && actionDetailsQuery === undefined;

  return {
    actions,
    isActionsLoading,
    selectedActionId,
    selectedActionVisible,
    actionDetails,
    isActionDetailsLoading,
    approveAction,
    rejectAction,
    inspectAction,
  };
}
