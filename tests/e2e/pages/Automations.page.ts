import { expect, type Locator } from "@playwright/test";
import { cronToBuilderState } from "../../../apps/web/src/lib/cron-builder";
import { BasePage } from "./base-page";

const setFormControlValue = async (locator: Locator, value: string): Promise<void> => {
  await locator.evaluate((element, nextValue) => {
    const prototype =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    descriptor?.set?.call(element, nextValue);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
};

export class AutomationsPage extends BasePage {
  async setSchedule(cron: string): Promise<void> {
    const state = cronToBuilderState(cron);
    if (!state) {
      throw new Error(`Unsupported test cron expression: ${cron}`);
    }

    await this.page.locator("#manual-schedule-cron-frequency").selectOption(state.frequency);

    if (state.frequency === "minutes") {
      await this.page
        .locator("#manual-schedule-cron-minute-interval")
        .selectOption(String(state.minuteInterval));
      return;
    }

    if (state.frequency === "hourly") {
      await this.page
        .locator("#manual-schedule-cron-minute-of-hour")
        .selectOption(String(state.minuteOfHour));
      return;
    }

    await this.page.locator("#manual-schedule-cron-hour").selectOption(String(state.hour));
    await this.page.locator("#manual-schedule-cron-minute").selectOption(String(state.minute));

    if (state.frequency === "weekly") {
      const daySelectors = new Map<number, string>([
        [1, "#manual-schedule-cron-day-1"],
        [2, "#manual-schedule-cron-day-2"],
        [3, "#manual-schedule-cron-day-3"],
        [4, "#manual-schedule-cron-day-4"],
        [5, "#manual-schedule-cron-day-5"],
        [6, "#manual-schedule-cron-day-6"],
        [0, "#manual-schedule-cron-day-0"],
      ]);
      for (const [dayValue, daySelector] of daySelectors) {
        const checkbox = this.page.locator(daySelector);
        const shouldBeChecked = state.daysOfWeek.includes(dayValue);
        if ((await checkbox.isChecked()) !== shouldBeChecked) {
          await checkbox.click();
        }
      }
      return;
    }

    if (state.frequency === "monthly") {
      await this.page
        .locator("#manual-schedule-cron-day-of-month")
        .selectOption(String(state.dayOfMonth));
    }
  }

  private manualCreatePage() {
    return this.page.getByRole("heading", { name: "Create manually" });
  }

  async open(): Promise<void> {
    await this.goto("/automations");
  }

  async expectListLoaded(): Promise<void> {
    await expect(this.page).toHaveURL(/\/automations(?:$|\?)/);
    await expect
      .poll(
        async () => {
          const headingVisible = await this.page
            .getByRole("heading", { name: "Automations" })
            .isVisible();
          const listVisible = await this.page
            .getByText("Workspace Automations", { exact: true })
            .isVisible();
          return headingVisible && listVisible;
        },
        { timeout: 20_000 },
      )
      .toBe(true);
  }

  async openCreatePage(): Promise<void> {
    const createButton = this.page.getByRole("button", { name: "Create manually" });
    await expect(createButton).toBeVisible();
    await createButton.evaluate((element) => {
      (element as HTMLButtonElement).click();
    });
    await expect(this.page).toHaveURL(/\/automations\/create$/);
    await expect(this.manualCreatePage()).toBeVisible();
  }

  async createManualAutomation(params: {
    name: string;
    description: string;
    prompt: string;
    triggerType?: "schedule" | "manual";
    scheduleCron?: string;
    aiKeyMode?: "byok" | "subscription_token";
    networkAccess?: "mcp_only" | "mcp_and_web";
  }): Promise<void> {
    await setFormControlValue(this.page.getByLabel("Name"), params.name);
    await setFormControlValue(this.page.getByLabel("Description"), params.description);
    await this.page
      .getByRole("button", { name: "Continue" })
      .evaluate((element) => (element as HTMLButtonElement).click());
    await this.page
      .getByLabel("Trigger type")
      .selectOption(params.triggerType === "manual" ? "manual" : "schedule");
    if ((params.triggerType ?? "schedule") === "schedule") {
      await this.setSchedule(params.scheduleCron ?? "0 9 * * *");
    }
    await this.page
      .getByRole("button", { name: "Continue" })
      .evaluate((element) => (element as HTMLButtonElement).click());
    await this.page
      .getByLabel("Key mode")
      .selectOption(params.aiKeyMode === "subscription_token" ? "subscription_token" : "byok");
    if (params.networkAccess === "mcp_and_web") {
      await this.page
        .getByRole("switch", { name: "Enable web access" })
        .evaluate((element) => (element as HTMLButtonElement).click());
    }
    await setFormControlValue(this.page.getByLabel("Prompt"), params.prompt);
    await this.page
      .getByRole("button", { name: /Create automation/i })
      .evaluate((element) => (element as HTMLButtonElement).click());
  }

  async expectCreateWarning(text: RegExp | string): Promise<void> {
    await expect(this.page.getByRole("main")).toContainText(text);
  }

  async expectAutomationVisible(name: string): Promise<void> {
    await expect(this.page.getByRole("row", { name: new RegExp(name, "i") })).toBeVisible();
  }

  async openAutomation(name: string): Promise<void> {
    const row = this.page.getByRole("row", { name: new RegExp(name, "i") });
    await expect(row).toBeVisible();
    await row.evaluate((element) => {
      (element as HTMLTableRowElement).click();
    });
  }

  async expectDetailLoaded(name: string): Promise<void> {
    const heading = this.page.getByRole("heading", { name });
    await expect
      .poll(
        async () => {
          return await heading.isVisible().catch(() => false);
        },
        { timeout: 15_000 },
      )
      .toBe(true);
  }

  async runNow(): Promise<void> {
    await this.page.getByRole("button", { name: "Run now" }).first().click();
  }

  async expectRunDetailPage(): Promise<void> {
    await expect(this.page).toHaveURL(/\/automations\/[^/]+\/runs\/arun_/);
  }

  async goBackFromRunDetail(): Promise<void> {
    await this.page
      .getByRole("button", { name: "Back", exact: true })
      .evaluate((element) => (element as HTMLButtonElement).click());
    await expect(this.page).toHaveURL(/\/automations\/[^/]+$/);
  }

  async expectRunsTab(): Promise<void> {
    // After runNow, we navigate to the run detail page instead of the runs tab
    await this.expectRunDetailPage();
  }

  async expectRunRowVisible(status?: RegExp | string): Promise<void> {
    // On run detail page, status is shown in the header badge
    if (status) {
      await expect(this.page.getByText(status).first()).toBeVisible();
    }
  }

  async expectLogViewerState(text: RegExp | string): Promise<void> {
    const locator = this.page.getByText(text).first();
    await expect
      .poll(
        async () => {
          return await locator.isVisible().catch(() => false);
        },
        { timeout: 15_000 },
      )
      .toBe(true);
  }

  async openConfigTab(): Promise<void> {
    await this.page
      .getByRole("tab", { name: "Config" })
      .evaluate((element) => (element as HTMLButtonElement).click());
  }

  async saveConfigVersion(params: { prompt: string; changeSummary: string }): Promise<void> {
    await setFormControlValue(this.page.getByLabel("Prompt", { exact: true }), params.prompt);
    await setFormControlValue(this.page.getByLabel("Change Summary"), params.changeSummary);
    const saveButton = this.page.getByRole("button", { name: "Save Changes" });
    await saveButton.evaluate((element) => (element as HTMLButtonElement).click());
    const savingButton = this.page.getByRole("button", { name: "Saving..." });
    await expect(savingButton).toBeVisible();
    await expect(saveButton).toBeVisible();
    await expect(saveButton).toBeEnabled();
  }

  async openVersionsTab(): Promise<void> {
    await this.page
      .getByRole("tab", { name: "Versions" })
      .evaluate((element) => (element as HTMLButtonElement).click());
  }

  async expectVersionCard(versionNumber: number, badgeText?: RegExp | string): Promise<void> {
    const card = this.page.locator("div.rounded-md.border").filter({
      has: this.page.getByText(`v${versionNumber}`, { exact: true }),
    });
    await expect(card.first()).toBeVisible();
    if (badgeText) {
      await expect(card.first()).toContainText(badgeText);
    }
  }

  async rollbackVersion(versionNumber: number): Promise<void> {
    const card = this.page.locator("div.rounded-md.border").filter({
      has: this.page.getByText(`v${versionNumber}`, { exact: true }),
    });
    await card
      .getByRole("button", { name: "Rollback" })
      .evaluate((element) => (element as HTMLButtonElement).click());
  }

  async deleteAutomation(): Promise<void> {
    await this.page
      .getByRole("button", { name: "Delete" })
      .evaluate((element) => (element as HTMLButtonElement).click());
    const dialog = this.page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("button", { name: "Delete Automation" })
      .evaluate((element) => (element as HTMLButtonElement).click());
  }

  async expectEmptyState(): Promise<void> {
    await expect(this.page.getByText("No automations yet")).toBeVisible();
  }
}
