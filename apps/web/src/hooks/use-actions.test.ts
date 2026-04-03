import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDashboardRuntime } from "@/test/fake-dashboard-runtime";
import { renderDashboardHook } from "@/test/render-dashboard";
import { useActions } from "./use-actions";

describe("useActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips Convex queries and stays idle when no workspace is selected", () => {
    const runtime = createFakeDashboardRuntime();

    const { result } = renderDashboardHook(() => useActions(""), {
      runtime,
    });

    expect(result.current.actions).toEqual([]);
    expect(result.current.selectedActionId).toBeNull();
    expect(result.current.actionDetails).toBeNull();
    expect(result.current.isActionsLoading).toBe(false);
    expect(result.current.isActionDetailsLoading).toBe(false);
    expect(result.current.selectedActionVisible).toBe(false);
  });

  it("keeps mutation payloads stable and preserves the inspected action when it leaves the list", async () => {
    const approveActionMutation = vi.fn(async () => undefined);
    const rejectActionMutation = vi.fn(async () => undefined);
    const actionRow = {
      id: "action_1",
      automation_run_id: "run_1",
      automation_name: "Daily Digest",
      automation_run_started_at: "2026-03-08T00:00:00.000Z",
      action_type: "gmail.sendEmail",
      risk_level: "high",
      status: "pending",
      payload_preview: {},
      result_redacted: null,
      idempotency_key: "idem_1",
      created_at: "2026-03-08T00:00:00.000Z",
      resolved_at: null,
    };
    let actionsPayload = [actionRow];

    const runtime = createFakeDashboardRuntime({
      queryHandlers: {
        "actions:listPendingByWorkspace": () => actionsPayload,
        "actions:getActionDetail": (args) =>
          args === "skip"
            ? null
            : {
                action: actionRow,
                normalized_payload: {},
                approvals: [],
                cel_rule_matches: [],
                policy_decisions: [],
                timeline: [],
              },
      },
      mutationHandlers: {
        "actions:approveAction": approveActionMutation,
        "actions:rejectAction": rejectActionMutation,
      },
    });

    const { result, rerender } = renderDashboardHook(() => useActions("ws_1"), {
      runtime,
    });

    act(() => {
      result.current.inspectAction("action_1");
    });
    rerender();

    expect(result.current.selectedActionId).toBe("action_1");

    await act(async () => {
      await result.current.approveAction("action_1");
      await result.current.rejectAction("action_1", "Not safe");
    });

    expect(approveActionMutation).toHaveBeenCalledWith({
      actionId: "action_1",
      reason: "Approved from dashboard",
    });
    expect(rejectActionMutation).toHaveBeenCalledWith({
      actionId: "action_1",
      reason: "Not safe",
    });

    actionsPayload = [];
    rerender();

    await waitFor(() => {
      expect(result.current.selectedActionId).toBe("action_1");
      expect(result.current.selectedActionVisible).toBe(false);
      expect(result.current.actionDetails?.action.id).toBe("action_1");
    });
  });

  it("passes through an all-status filter when requested", () => {
    const runtime = createFakeDashboardRuntime({
      queryHandlers: {
        "actions:listByWorkspace": () => [],
      },
    });

    renderDashboardHook(() => useActions("ws_1", { statusFilter: "all" }), {
      runtime,
    });

    expect(runtime.useQuery).toHaveBeenNthCalledWith(1, expect.anything(), {
      workspaceId: "ws_1",
    });
  });
});
