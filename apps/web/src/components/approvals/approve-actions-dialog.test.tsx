import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApproveActionsDialog } from "./approve-actions-dialog";

describe("ApproveActionsDialog", () => {
  it("renders the live pending count in the confirmation copy", () => {
    render(
      <ApproveActionsDialog
        open
        pendingCount={2}
        actionTypes={["gmail.sendEmail", "stripe.refund"]}
        runSummaries={[
          { runId: "run_1", label: "Daily Digest", pendingCount: 2 },
          { runId: "run_2", label: "Refund Escalation", pendingCount: 1 },
        ]}
        criticalRiskCount={1}
        highRiskCount={1}
        submitting={false}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );

    expect(screen.getByRole("heading", { name: "Approve 2 actions?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve 2" })).toBeEnabled();
    expect(screen.getByText("Selection summary")).toBeInTheDocument();
    expect(screen.getByText("Daily Digest: 2 pending")).toBeInTheDocument();
    expect(screen.getByText("1 critical")).toBeInTheDocument();
  });

  it("disables confirmation while submission is in flight", () => {
    render(
      <ApproveActionsDialog
        open
        pendingCount={2}
        actionTypes={["gmail.sendEmail"]}
        runSummaries={[{ runId: "run_1", label: "Daily Digest", pendingCount: 2 }]}
        criticalRiskCount={0}
        highRiskCount={0}
        submitting
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "Approving..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("lets the operator dismiss stale selections with no pending actions left", () => {
    const onCancel = vi.fn();
    render(
      <ApproveActionsDialog
        open
        pendingCount={0}
        actionTypes={[]}
        runSummaries={[]}
        criticalRiskCount={0}
        highRiskCount={0}
        submitting={false}
        onConfirm={() => undefined}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByRole("heading", { name: "Approve 0 actions?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve 0" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
