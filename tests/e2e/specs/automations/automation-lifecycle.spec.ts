import { mkdirSync } from "node:fs";
import type { Locator } from "@playwright/test";
import { test, expect } from "../../fixtures/golden.fixture";
import { createConvexAdmin } from "../../helpers/convex-admin";

const slugify = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const clickElement = async (locator: Locator): Promise<void> => {
  await locator.evaluate((element) => (element as HTMLElement).click());
};

const setControlValue = async (locator: Locator, value: string): Promise<void> => {
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

test.slow();

test("automation lifecycle", async ({ app, auth, pages, page }) => {
  const admin = createConvexAdmin(app);
  const automationName = `Lifecycle Automation ${app.metadata.testId}`;
  const expectedSlug = slugify(automationName);
  const description = "Daily inbox review workflow";
  const executeCodeDescription = "Summarize the inbox findings and print a structured report.";
  const executeCodeSource = [
    "const report = {",
    '  summary: "Inbox delta",',
    '  blockers: ["Blocked thread"],',
    "};",
    "console.log(JSON.stringify(report));",
  ].join("\n");

  await pages.login.login();
  mkdirSync("ux-artifacts", { recursive: true });
  const seeded = await auth.seedWorkspace("automations-lifecycle", {
    subscriptionTier: "starter",
  });
  await pages.automations.setSelectedWorkspaceSlug(seeded.workspaceSlug);
  await pages.automations.open();
  await pages.automations.expectListLoaded();

  await pages.automations.openCreatePage();
  await expect(page.getByText("Setup progress")).toBeVisible();
  await expect(page.getByText("Step 1: Name and description")).toBeVisible();
  await setControlValue(page.getByLabel("Name"), automationName);
  await setControlValue(page.getByLabel("Description"), description);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Step 2: Trigger configuration")).toBeVisible();
  await page.getByLabel("Trigger type").selectOption("schedule");
  await expect(page.locator("#manual-schedule-cron-frequency")).toBeVisible();
  await expect(page.getByText("Runs every day at 9:00 AM.")).toBeVisible();
  await page.screenshot({
    path: "ux-artifacts/automation-create-manual-page.png",
    timeout: 20_000,
  });
  await page.screenshot({
    path: "ux-artifacts/usability-config-flows.png",
    timeout: 20_000,
  });
  await page.getByLabel("Trigger type").selectOption("manual");
  await page.getByRole("button", { name: "Continue" }).click();
  await setControlValue(
    page.getByLabel("Prompt"),
    "Check the workspace inbox and summarize what changed today.",
  );
  await page.getByRole("button", { name: /Create automation/i }).click();
  await pages.automations.expectDetailLoaded(automationName);
  await expect(page).toHaveURL(new RegExp(`/automations/${expectedSlug}$`));
  const automationIdLocator = page.getByText(/^automation_/);
  await expect(automationIdLocator).toBeVisible();
  const automationId = (await automationIdLocator.textContent()) ?? "";
  expect(automationId).toMatch(/^automation_/);

  const createdRun = (await admin.createAutomationRun(automationId, "manual")) as {
    id: string;
  };
  const runId = createdRun.id;
  expect(runId).toMatch(/^arun_/);
  await page.goto(`${page.url()}/runs/${runId}`);
  await pages.automations.expectRunDetailPage();

  await admin.appendRunLog(runId, "Run kicked off from automation lifecycle e2e.", "system", {
    eventType: "system",
    eventData: { message: "Run kicked off from automation lifecycle e2e." },
  });
  await admin.appendRunLog(runId, "Plan the inbox sweep.", "stderr", {
    eventType: "thinking",
    eventData: { text: "Plan the inbox sweep." },
  });
  await admin.appendRunLog(runId, "Then summarize blockers for handoff.", "stderr", {
    eventType: "thinking",
    eventData: { text: "Then summarize blockers for handoff." },
  });
  await admin.appendRunLog(runId, "model: gpt-5.2", "stderr", {
    eventType: "automation_config",
    eventData: { key: "model", value: "gpt-5.2" },
  });
  await admin.appendRunLog(runId, "sandbox: workspace-write", "stderr", {
    eventType: "automation_config",
    eventData: { key: "sandbox", value: "workspace-write" },
  });
  await admin.appendRunLog(runId, 'tool keppo.search_tools({"q":"important unread"})', "stderr", {
    eventType: "tool_call",
    eventData: {
      tool_name: "keppo.search_tools",
      args: { q: "important unread" },
    },
  });
  await admin.appendRunLog(runId, "keppo.search_tools(...) success in 32ms:", "stderr", {
    eventType: "tool_call",
    eventData: {
      tool_name: "keppo.search_tools",
      status: "success",
      duration_ms: 32,
      is_result: true,
    },
  });
  await admin.appendRunLog(
    runId,
    '{"items":[{"title":"Inbox delta"},{"title":"Blocked thread"}]}',
    "stdout",
    {
      eventType: "output",
      eventData: {
        text: '{"items":[{"title":"Inbox delta"},{"title":"Blocked thread"}]}',
        format: "json",
        parsed: {
          items: [{ title: "Inbox delta" }, { title: "Blocked thread" }],
        },
      },
    },
  );
  await admin.appendRunLog(
    runId,
    `tool execute_code(${JSON.stringify({
      description: executeCodeDescription,
      code: executeCodeSource,
    })})`,
    "stderr",
    {
      eventType: "tool_call",
      eventData: {
        tool_name: "execute_code",
        args: {
          description: executeCodeDescription,
          code: executeCodeSource,
        },
      },
    },
  );
  await admin.appendRunLog(runId, "execute_code(...) success in 120ms:", "stderr", {
    eventType: "tool_call",
    eventData: {
      tool_name: "execute_code",
      status: "success",
      duration_ms: 120,
      is_result: true,
    },
  });
  await admin.appendRunLog(
    runId,
    '{"summary":"Inbox delta","blockers":["Blocked thread"]}',
    "stdout",
    {
      eventType: "output",
      eventData: {
        text: '{"summary":"Inbox delta","blockers":["Blocked thread"]}',
        format: "json",
        parsed: {
          summary: "Inbox delta",
          blockers: ["Blocked thread"],
        },
      },
    },
  );
  await admin.finishRun(runId, "running");
  await admin.finishRun(runId, "failed");

  await pages.automations.expectRunRowVisible(
    /failed|pending|running|cancelled|timed out|succeeded/i,
  );
  await pages.automations.expectLogViewerState(/Run kicked off from automation lifecycle e2e\./i);
  await expect(page.getByText("Thinking", { exact: true })).toHaveCount(1);
  await expect(page.getByText("2 blocks")).toBeVisible();
  await expect(page.getByText("keppo.search_tools")).toBeVisible();
  await expect(page.getByText("Execute code", { exact: true })).toBeVisible();
  await expect(page.getByText(executeCodeDescription)).toBeVisible();
  await page.getByRole("button", { name: "Show code" }).click();
  await expect(page.getByText("const report = {")).toBeVisible();
  await expect(page.getByText('blockers: ["Blocked thread"],')).toBeVisible();
  await expect(page.getByText("items")).toBeVisible();
  await page.screenshot({
    path: "ux-artifacts/automation-run-chat-grouped.png",
    fullPage: true,
    timeout: 20_000,
  });
  await page
    .getByRole("tab", { name: "Raw Logs" })
    .evaluate((element) => (element as HTMLButtonElement).click());
  const rawToolCall = page.getByText('tool keppo.search_tools({"q":"important unread"})');
  await expect
    .poll(
      async () => {
        return await rawToolCall.isVisible().catch(() => false);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  await page
    .getByRole("tab", { name: "Grouped timeline" })
    .evaluate((element) => (element as HTMLButtonElement).click());

  await pages.automations.goBackFromRunDetail();
  await pages.automations.open();
  await expect(page.getByRole("row", { name: new RegExp(automationName, "i") })).toContainText(
    /Failed/i,
  );
  await expect(page.getByText("Inbox delta")).toHaveCount(0);
  await expect(page.getByText("Ended with an error", { exact: false })).toBeVisible();
  await page.screenshot({
    path: "ux-artifacts/automations-latest-run-summary.png",
    fullPage: true,
    timeout: 20_000,
  });
  await pages.automations.openAutomation(automationName);
  await clickElement(page.getByRole("tab", { name: "Runs" }));
  await expect(page.getByPlaceholder("Search by status, trigger, error, or run ID")).toBeVisible();
  await expect(page.getByTestId("run-summary-in-flight")).toContainText("In flight");
  await expect(page.getByTestId("run-summary-needs-review")).toContainText("Needs review");
  await expect(page.getByTestId("run-summary-succeeded")).toContainText("Succeeded");

  await pages.automations.openConfigTab();
  await pages.automations.saveConfigVersion({
    prompt: "Check the workspace inbox, summarize what changed, and call out blockers.",
    changeSummary: "Add blocker reporting",
  });
  await pages.automations.openVersionsTab();
  await pages.automations.expectVersionCard(2, /current/i);
  await pages.automations.expectVersionCard(1);

  await pages.automations.rollbackVersion(1);
  await pages.automations.expectVersionCard(1, /current/i);

  await pages.automations.deleteAutomation();
  await pages.automations.expectPath("/automations");
});
