import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApprovalsPage } from "./approvals.lazy";
import { createFakeDashboardRuntime } from "@/test/fake-dashboard-runtime";
import { createAuthState, createWorkspaceState, renderDashboard } from "@/test/render-dashboard";

describe("ApprovalsPage", () => {
  it("renders the pending queue with the split-panel detail placeholder", async () => {
    const action = {
      id: "action_1",
      workspace_id: "ws_1",
      action_type: "github.createIssue",
      risk_level: "high" as const,
      status: "pending" as const,
      payload_preview: { title: "Bug report" },
      result_redacted: null,
      idempotency_key: "idem_1",
      created_at: "2026-03-08T00:00:00.000Z",
      resolved_at: null,
    };
    const runtime = createFakeDashboardRuntime({
      queryHandlers: {
        "actions:listPendingByWorkspace": () => [action],
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
    expect(screen.getAllByText("github.createIssue").length).toBeGreaterThan(0);
    expect(screen.getByText("j/k navigate, a approve, r reject")).toBeInTheDocument();
    expect(screen.getByText("Select an action from the table")).toBeInTheDocument();
  });
});
