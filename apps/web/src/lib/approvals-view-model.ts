import type { Action } from "@/lib/types";

const RISK_PRIORITY: Record<Action["risk_level"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export type ApprovalGroup = {
  automation_run_id: string;
  automation_name: string | null;
  automation_run_started_at: string | null;
  actions: Action[];
  pending_action_ids: string[];
  pending_count: number;
  resolved_count: number;
};

export type ApprovalQueueView = {
  ordered_actions: Action[];
  visible_action_ids: string[];
  groups: ApprovalGroup[];
};

export const sortApprovalActions = (left: Action, right: Action): number => {
  const riskDelta = RISK_PRIORITY[left.risk_level] - RISK_PRIORITY[right.risk_level];
  if (riskDelta !== 0) {
    return riskDelta;
  }
  return right.created_at.localeCompare(left.created_at);
};

export const searchApprovalAction = (action: Action, term: string): boolean => {
  const normalizedTerm = term.trim().toLowerCase();
  if (!normalizedTerm) {
    return true;
  }
  const payload = JSON.stringify(action.payload_preview ?? {}).toLowerCase();
  return (
    action.action_type.toLowerCase().includes(normalizedTerm) ||
    action.status.toLowerCase().includes(normalizedTerm) ||
    action.idempotency_key.toLowerCase().includes(normalizedTerm) ||
    action.automation_run_id.toLowerCase().includes(normalizedTerm) ||
    (action.automation_name?.toLowerCase().includes(normalizedTerm) ?? false) ||
    payload.includes(normalizedTerm)
  );
};

export const buildApprovalQueueView = (
  actions: Action[],
  searchTerm: string,
): ApprovalQueueView => {
  const sortedActions = [...actions]
    .filter((action) => searchApprovalAction(action, searchTerm))
    .sort(sortApprovalActions);
  const groupsByRunId = new Map<string, ApprovalGroup>();

  for (const action of sortedActions) {
    const existing = groupsByRunId.get(action.automation_run_id);
    if (existing) {
      existing.actions.push(action);
      if (action.status === "pending") {
        existing.pending_action_ids.push(action.id);
        existing.pending_count += 1;
      } else {
        existing.resolved_count += 1;
      }
      continue;
    }

    groupsByRunId.set(action.automation_run_id, {
      automation_run_id: action.automation_run_id,
      automation_name: action.automation_name ?? null,
      automation_run_started_at: action.automation_run_started_at ?? null,
      actions: [action],
      pending_action_ids: action.status === "pending" ? [action.id] : [],
      pending_count: action.status === "pending" ? 1 : 0,
      resolved_count: action.status === "pending" ? 0 : 1,
    });
  }

  const groups = [...groupsByRunId.values()];
  const orderedActions = groups.flatMap((group) => group.actions);

  return {
    ordered_actions: orderedActions,
    visible_action_ids: orderedActions.map((action) => action.id),
    groups,
  };
};

export const getApprovalGroupForAction = (
  groups: ApprovalGroup[],
  actionId: string | null,
): ApprovalGroup | null => {
  if (!actionId) {
    return null;
  }
  return groups.find((group) => group.actions.some((action) => action.id === actionId)) ?? null;
};
