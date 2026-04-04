import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApproveActionsDialog } from "./approve-actions-dialog";

describe("ApproveActionsDialog", () => {
  it("renders the live pending count in the confirmation copy", () => {
    render(
      <ApproveActionsDialog
        open
        pendingCount={2}
        submitting={false}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );

    expect(screen.getByRole("heading", { name: "Approve 2 actions?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve 2" })).toBeEnabled();
  });

  it("disables confirmation while submission is in flight", () => {
    render(
      <ApproveActionsDialog
        open
        pendingCount={2}
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
