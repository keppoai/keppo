import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApprovalsPage } from "./approvals.lazy";
import { createFakeDashboardRuntime } from "@/test/fake-dashboard-runtime";
import { createAuthState, createWorkspaceState, renderDashboard } from "@/test/render-dashboard";

const createAction = (overrides: Record<string, unknown> = {}) => ({
  id: "action_1",
  automation_run_id: "run_1",
  automation_name: "Daily Digest",
  automation_run_started_at: "2026-03-08T00:00:00.000Z",
  action_type: "github.createIssue",
  risk_level: "high" as const,
  status: "pending" as const,
  payload_preview: { title: "Bug report" },
  result_redacted: null,
  idempotency_key: "idem_1",
  created_at: "2026-03-08T00:00:00.000Z",
  resolved_at: null,
  ...overrides,
});

describe("ApprovalsPage", () => {
  it("renders grouped approval sections with the split-panel detail placeholder", async () => {
    const runtime = createFakeDashboardRuntime({
      queryHandlers: {
        "actions:listPendingByWorkspace": () => [
          createAction({
            id: "action_2",
            created_at: "2026-03-08T00:01:00.000Z",
            payload_preview: { title: "Second issue" },
          }),
          createAction(),
        ],
        "actions:getActionDetail": () => null,
      },
    });

    renderDashboard(<ApprovalsPage />, {
      route: "/acme/workspace-1/approvals",
      auth: createAuthState({
        isAuthenticated: true,
        canApprove: () => true,
      }),
      workspace: createWorkspaceState({
        selectedWorkspaceId: "ws_1",
      }),
      runtime,
    });

    expect(await screen.findByText("Approvals")).toBeInTheDocument();
    expect(screen.getByTestId("approval-group-row")).toHaveTextContent("Daily Digest");
    expect(screen.getByTestId("approval-group-row")).toHaveTextContent("Approve group (2)");
    expect(screen.getAllByText("github.createIssue").length).toBeGreaterThan(0);
    expect(screen.getByText("j/k navigate, a approve, r reject")).toBeInTheDocument();
    expect(screen.getByText("Select an action from the table")).toBeInTheDocument();
  });

  it("confirms grouped approvals before dispatching them", async () => {
    const approveAction = vi.fn(() => Promise.resolve());
    const runtime = createFakeDashboardRuntime({
      mutationHandlers: {
        "actions:approveAction": approveAction,
      },
      queryHandlers: {
        "actions:listPendingByWorkspace": () => [
          createAction({
            id: "action_2",
            created_at: "2026-03-08T00:01:00.000Z",
            payload_preview: { title: "Second issue" },
          }),
          createAction(),
        ],
        "actions:getActionDetail": () => null,
      },
    });

    renderDashboard(<ApprovalsPage />, {
      route: "/acme/workspace-1/approvals",
      auth: createAuthState({
        isAuthenticated: true,
        canApprove: () => true,
      }),
      workspace: createWorkspaceState({
        selectedWorkspaceId: "ws_1",
      }),
      runtime,
    });

    fireEvent.click(await screen.findByTestId("approval-group-approve"));
    expect(screen.getByRole("heading", { name: "Approve 2 actions?" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Approve 2" }));

    expect(approveAction).toHaveBeenCalledTimes(2);
  });
});
