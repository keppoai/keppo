import { expect, type Locator } from "@playwright/test";
import { BasePage } from "./base-page";

export class RulesPage extends BasePage {
  private async clickElement(locator: Locator): Promise<void> {
    await locator.evaluate((element) => (element as HTMLElement).click());
  }

  private async setControlValue(locator: Locator, value: string): Promise<void> {
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
  }

  async open(): Promise<void> {
    await this.goto("/rules");
  }

  async ensureBuilderVisible(): Promise<void> {
    const policiesTab = this.page.getByRole("tab", { name: "Policies" });
    await expect(this.page.getByRole("heading", { name: "Rules" })).toBeVisible();
    if (await policiesTab.isVisible().catch(() => false)) {
      return;
    }

    const createRuleButton = this.page.getByRole("button", { name: "Create the first rule" });
    await expect
      .poll(
        async () => {
          if (await policiesTab.isVisible().catch(() => false)) {
            return "builder";
          }
          if (await createRuleButton.isVisible().catch(() => false)) {
            return "empty";
          }
          return "loading";
        },
        { timeout: 15_000 },
      )
      .not.toBe("loading");

    if (await createRuleButton.isVisible().catch(() => false)) {
      await this.clickElement(createRuleButton);
    }
    await expect(policiesTab).toBeVisible({ timeout: 10_000 });
  }

  async setPolicyMode(mode: "manual_only" | "rules_first" | "rules_plus_agent"): Promise<void> {
    await this.ensureBuilderVisible();
    await this.page.getByTestId("rules-policy-mode").selectOption(mode);
    await expect(this.page.getByTestId("rules-policy-mode")).toHaveValue(mode);
  }

  async openCelRulesTab(): Promise<void> {
    await this.ensureBuilderVisible();
    await this.clickElement(this.page.getByRole("tab", { name: "CEL Rules" }));
  }

  async openAutoApprovalsTab(): Promise<void> {
    await this.ensureBuilderVisible();
    await this.clickElement(this.page.getByRole("tab", { name: "Auto-Approvals" }));
  }

  async openDecisionLogsTab(): Promise<void> {
    await this.ensureBuilderVisible();
    await this.clickElement(this.page.getByRole("tab", { name: "Decision Logs" }));
  }

  async createCelRule(params: {
    name: string;
    expression: string;
    effect?: "approve" | "deny";
    testContextJson?: string;
  }): Promise<void> {
    await this.openCelRulesTab();
    await this.setControlValue(this.page.getByLabel("Name"), params.name);
    await this.setControlValue(this.page.getByLabel("Expression"), params.expression);
    if (params.testContextJson) {
      await this.setControlValue(
        this.page.getByLabel("Test Context (JSON)"),
        params.testContextJson,
      );
      await this.clickElement(this.page.getByRole("button", { name: "Test Expression" }));
    }
    await this.page.getByLabel("Effect").selectOption(params.effect ?? "deny");
    await this.clickElement(this.page.getByRole("button", { name: "Create Rule" }));
  }

  async expectRuleVisible(name: string): Promise<void> {
    await expect(this.page.getByRole("row", { name: new RegExp(name, "i") })).toBeVisible();
  }

  async expectAlertText(text: RegExp | string): Promise<void> {
    await expect(this.page.getByRole("alert")).toContainText(text);
  }

  async disableRule(name: string): Promise<void> {
    const row = this.page.getByRole("row", { name: new RegExp(name, "i") });
    await this.clickElement(row.getByRole("button", { name: "Enabled" }));
    await expect(row.getByRole("button", { name: "Disabled" })).toBeVisible();
  }

  async resetRuleDraftExpression(): Promise<void> {
    await this.setControlValue(this.page.getByLabel("Expression"), "");
    await expect(this.page.getByText("Inline validation: enter an expression")).toBeVisible();
  }

  async enableAutoApproval(toolName: string): Promise<void> {
    await this.openAutoApprovalsTab();
    await this.page
      .locator('[data-testid="auto-approval-row"]')
      .filter({ has: this.page.getByText(toolName, { exact: true }) })
      .getByRole("switch")
      .evaluate((element) => (element as HTMLButtonElement).click());
  }

  async setAutoApproval(toolName: string, enabled: boolean): Promise<void> {
    await this.openAutoApprovalsTab();
    const toggleInput = this.page.locator(`[id="auto-${toolName}"]`);
    await expect(toggleInput).toHaveCount(1);
    const currentlyEnabled = await toggleInput.isChecked();
    if (currentlyEnabled !== enabled) {
      await this.page
        .locator(`label[for="auto-${toolName}"]`)
        .evaluate((element) => (element as HTMLLabelElement).click());
    }
    if (enabled) {
      await expect(toggleInput).toBeChecked();
      return;
    }
    await expect(toggleInput).not.toBeChecked();
  }

  async expectCelMatchVisible(text: RegExp | string): Promise<void> {
    await this.openDecisionLogsTab();
    await expect(this.page.getByText("CEL Match Log", { exact: true })).toBeVisible();
    await expect(this.page.getByText(text)).toBeVisible();
  }
}
