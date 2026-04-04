import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApprovalsTable } from "./approvals-table";
import type { ApprovalGroup } from "@/lib/approvals-view-model";
import type { Action } from "@/lib/types";

const createAction = (overrides: Partial<Action> = {}): Action => ({
  id: "action_1",
  automation_run_id: "run_1",
  automation_name: "Daily Digest",
  automation_run_started_at: "2026-03-08T00:00:00.000Z",
  action_type: "github.createIssue",
  risk_level: "high",
  status: "pending",
  payload_preview: { title: "Bug report" },
  result_redacted: null,
  idempotency_key: "idem_1",
  created_at: "2026-03-08T00:00:00.000Z",
  resolved_at: null,
  ...overrides,
});

const createGroup = (actions: Action[]): ApprovalGroup => ({
  automation_run_id: actions[0]?.automation_run_id ?? "run_1",
  automation_name: actions[0]?.automation_name ?? null,
  automation_run_started_at: actions[0]?.automation_run_started_at ?? null,
  actions,
  pending_action_ids: actions
    .filter((action) => action.status === "pending")
    .map((action) => action.id),
  pending_count: actions.filter((action) => action.status === "pending").length,
  resolved_count: actions.filter((action) => action.status !== "pending").length,
});

describe("ApprovalsTable", () => {
  it("routes group approvals through the pending ids in the run section", () => {
    const onApproveGroup = vi.fn();
    render(
      <ApprovalsTable
        groups={[
          createGroup([
            createAction({ id: "action_1", created_at: "2026-03-08T00:02:00.000Z" }),
            createAction({ id: "action_2", created_at: "2026-03-08T00:01:00.000Z" }),
          ]),
        ]}
        selectedActionId={null}
        onSelect={() => undefined}
        selectedActionIds={[]}
        onToggleAction={() => undefined}
        onToggleAllVisible={() => undefined}
        allVisibleSelected={false}
        onApprove={() => undefined}
        onApproveGroup={onApproveGroup}
        onRequestReject={() => undefined}
        canApprove
      />,
    );

    fireEvent.click(screen.getByTestId("approval-group-approve"));

    expect(onApproveGroup).toHaveBeenCalledWith(["action_1", "action_2"]);
  });

  it("adds accessible labels to grouped rows", () => {
    render(
      <ApprovalsTable
        groups={[
          createGroup([
            createAction({ id: "action_1", created_at: "2026-03-08T00:02:00.000Z" }),
            createAction({ id: "action_2", created_at: "2026-03-08T00:01:00.000Z" }),
          ]),
        ]}
        selectedActionId={null}
        onSelect={() => undefined}
        selectedActionIds={[]}
        onToggleAction={() => undefined}
        onToggleAllVisible={() => undefined}
        allVisibleSelected={false}
        onApprove={() => undefined}
        onApproveGroup={() => undefined}
        onRequestReject={() => undefined}
        canApprove
      />,
    );

    expect(screen.getByTestId("approval-group-row")).toHaveAttribute(
      "aria-label",
      "Run group: Daily Digest, 2 pending",
    );
    expect(screen.getByRole("heading", { name: "Daily Digest" })).toBeInTheDocument();
  });

  it("still allows approving or rejecting a single action within a grouped run", () => {
    const onApprove = vi.fn();
    const onRequestReject = vi.fn();
    render(
      <ApprovalsTable
        groups={[
          createGroup([
            createAction({ id: "action_1", created_at: "2026-03-08T00:02:00.000Z" }),
            createAction({ id: "action_2", created_at: "2026-03-08T00:01:00.000Z" }),
          ]),
        ]}
        selectedActionId={null}
        onSelect={() => undefined}
        selectedActionIds={[]}
        onToggleAction={() => undefined}
        onToggleAllVisible={() => undefined}
        allVisibleSelected={false}
        onApprove={onApprove}
        onApproveGroup={() => undefined}
        onRequestReject={onRequestReject}
        canApprove
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Approve" })[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: "Reject" })[0]!);

    expect(onApprove).toHaveBeenCalledWith("action_1");
    expect(onRequestReject).toHaveBeenCalledWith(["action_1"]);
  });
});
