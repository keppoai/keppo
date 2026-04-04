import { expect, type Locator } from "@playwright/test";
import { BasePage } from "./base-page";

export class ActionQueuePage extends BasePage {
  private async waitForDecisionTransition(expectedFeedbackTitle: string): Promise<void> {
    await expect
      .poll(
        async () => {
          const feedbackVisible = await this.page
            .getByTestId("approval-panel-feedback")
            .getByText(expectedFeedbackTitle, { exact: true })
            .isVisible()
            .catch(() => false);
          if (feedbackVisible) {
            return "feedback";
          }

          const approveButton = this.approvalDetailApproveButton();
          const stillVisible = await approveButton.isVisible().catch(() => false);
          if (!stillVisible) {
            return "hidden";
          }

          return (await approveButton.isEnabled().catch(() => false)) ? "pending" : "settled";
        },
        {
          timeout: 15_000,
          intervals: [150, 300, 500, 1_000],
        },
      )
      .not.toBe("pending");
  }

  async selectWorkspaceByName(name: string): Promise<void> {
    await this.page.locator('[data-sidebar="menu-button"]').click();
    await this.page.getByRole("menuitem", { name, exact: true }).click();
  }

  async open(): Promise<void> {
    await this.goto("/approvals");
  }

  async expectPendingSummaryVisible(text: RegExp | string): Promise<void> {
    await expect(this.page.getByText(text)).toBeVisible();
  }

  private firstVisiblePendingRowActionType(): Locator {
    return this.page.locator('[data-testid="approval-row-select"]').first();
  }

  private groupRow(runId: string): Locator {
    return this.page.locator(`[data-testid="approval-group-row"][data-run-id="${runId}"]`);
  }

  private rowsForRun(runId: string): Locator {
    return this.page.locator(`[data-testid="approval-row"][data-run-id="${runId}"]`);
  }

  private approvalDetailApproveButton(): Locator {
    return this.page.locator('[data-testid="approval-detail-approve"]').first();
  }

  private approvalDetailRejectButton(): Locator {
    return this.page.locator('[data-testid="approval-detail-reject"]').first();
  }

  private emptyStateDescription(): Locator {
    return this.page
      .locator("p[data-slot='empty-description']")
      .filter({ hasText: /No actions waiting for approval right now|No pending actions/i });
  }

  private async waitForPendingRow(): Promise<Locator> {
    await expect
      .poll(
        async () => {
          const pendingRowActionType = this.firstVisiblePendingRowActionType();
          if ((await pendingRowActionType.count().catch(() => 0)) > 0) {
            return "pending";
          }
          if (
            (await this.emptyStateDescription()
              .count()
              .catch(() => 0)) > 0
          ) {
            await this.page.reload({ waitUntil: "domcontentloaded" });
          }
          return "waiting";
        },
        {
          timeout: 30_000,
          intervals: [250, 500, 1_000],
          message: "Timed out waiting for a pending approval row to appear.",
        },
      )
      .toBe("pending");
    const pendingRowActionType = this.firstVisiblePendingRowActionType();
    if ((await pendingRowActionType.count().catch(() => 0)) === 0) {
      throw new Error("Pending approval row disappeared before interaction.");
    }
    return pendingRowActionType;
  }

  async approveFirstPending(): Promise<void> {
    const firstRowActionType = await this.waitForPendingRow();
    await firstRowActionType.evaluate((element) => {
      (element as HTMLButtonElement).click();
    });
    const approveButton = this.approvalDetailApproveButton();
    await expect(approveButton).toBeVisible();
    await approveButton.evaluate((element) => {
      (element as HTMLButtonElement).click();
    });
    await this.waitForDecisionTransition("Approval recorded");
  }

  async rejectFirstPending(reason = "Policy violation"): Promise<void> {
    const firstRowActionType = await this.waitForPendingRow();
    await firstRowActionType.evaluate((element) => {
      (element as HTMLButtonElement).click();
    });
    const rejectButton = this.approvalDetailRejectButton();
    await expect(rejectButton).toBeVisible();
    await rejectButton.evaluate((element) => {
      (element as HTMLButtonElement).click();
    });
    const dialog = this.page.getByRole("dialog").filter({ hasText: /Reject action/i });
    await expect(dialog).toBeVisible();
    if (reason.trim().length > 0) {
      await dialog.getByLabel("Reason (optional)").evaluate((element, value) => {
        (element as HTMLTextAreaElement).value = value;
        element.dispatchEvent(new Event("input", { bubbles: true }));
      }, reason);
    }
    await dialog.getByRole("button", { name: "Reject" }).evaluate((element) => {
      (element as HTMLButtonElement).click();
    });
    await this.waitForDecisionTransition("Action rejected");
  }

  async expectGroupVisible(runId: string): Promise<void> {
    await expect(this.groupRow(runId)).toBeVisible();
  }

  async expectPendingCountForRun(runId: string, count: number): Promise<void> {
    await expect(this.rowsForRun(runId)).toHaveCount(count);
  }

  async approveGroup(runId: string, _count: number): Promise<void> {
    const group = this.groupRow(runId);
    await expect(group).toBeVisible();
    await group.getByTestId("approval-group-approve").click();
    const dialog = this.page.getByRole("dialog").filter({ hasText: /Approve \d+ actions\?/i });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /Approve \d+/i }).click();
    await expect(group).toHaveCount(0);
  }

  async rejectGroup(runId: string, _count: number, reason = "Policy violation"): Promise<void> {
    const group = this.groupRow(runId);
    await expect(group).toBeVisible();
    await group.getByTestId("approval-group-reject").click();
    const dialog = this.page.getByRole("dialog").filter({ hasText: /Reject/i });
    await expect(dialog).toBeVisible();
    if (reason.trim().length > 0) {
      await dialog.getByLabel("Reason (optional)").fill(reason);
    }
    await dialog.getByRole("button", { name: "Reject" }).click();
    await expect(group).toHaveCount(0);
  }

  async approveSingleActionInRun(runId: string, index = 0): Promise<void> {
    const rowActionType = this.rowsForRun(runId)
      .locator('[data-testid="approval-row-select"]')
      .nth(index);
    await expect(rowActionType).toBeVisible();
    await rowActionType.click();
    await expect(this.approvalDetailApproveButton()).toBeVisible();
    await this.approvalDetailApproveButton().click();
    await this.waitForDecisionTransition("Approval recorded");
  }

  async rejectSingleActionInRun(
    runId: string,
    reason = "Policy violation",
    index = 0,
  ): Promise<void> {
    const rowActionType = this.rowsForRun(runId)
      .locator('[data-testid="approval-row-select"]')
      .nth(index);
    await expect(rowActionType).toBeVisible();
    await rowActionType.click();
    await expect(this.approvalDetailRejectButton()).toBeVisible();
    await this.approvalDetailRejectButton().click();
    const dialog = this.page.getByRole("dialog").filter({ hasText: /Reject action/i });
    await expect(dialog).toBeVisible();
    if (reason.trim().length > 0) {
      await dialog.getByLabel("Reason (optional)").fill(reason);
    }
    await dialog.getByRole("button", { name: "Reject" }).click();
    await this.waitForDecisionTransition("Action rejected");
  }

  async expectNoPending(): Promise<void> {
    const emptyDescription = this.emptyStateDescription();
    await expect(emptyDescription).toHaveCount(1);
  }

  async expectActionTypeVisible(actionType: string): Promise<void> {
    await expect(this.page.getByText(actionType)).toBeVisible();
  }
}
