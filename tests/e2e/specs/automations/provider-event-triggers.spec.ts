import { mkdirSync } from "node:fs";
import type { Locator } from "@playwright/test";
import { test, expect } from "../../fixtures/golden.fixture";
import { resolveScopedDashboardPath } from "../../helpers/dashboard-paths";

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

test("gmail provider trigger authoring surfaces structured filters and health", async ({
  app,
  auth,
  pages,
  page,
}) => {
  mkdirSync("ux-artifacts", { recursive: true });

  const now = Date.now();
  await pages.login.login();
  const seeded = await auth.seedWorkspaceWithProvider(
    "automation-provider-trigger",
    "google",
    {
      metadata: {
        automation_trigger_lifecycle: {
          google: {
            incoming_email: {
              active_mode: "polling",
              history_cursor: "history-42",
              last_sync_at: new Date(now - 60_000).toISOString(),
              last_poll_at: new Date(now - 30_000).toISOString(),
              watch_topic_name: "projects/demo/topics/gmail",
              watch_expiration: new Date(now + 86_400_000).toISOString(),
            },
          },
        },
      },
    },
    {
      subscriptionTier: "starter",
    },
  );
  await pages.automations.setSelectedWorkspaceSlug(seeded.workspaceSlug);

  const settingsUrl = new URL(
    await resolveScopedDashboardPath(page, "/settings"),
    app.dashboardBaseUrl,
  ).toString();
  await page.goto(settingsUrl, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await clickElement(page.getByRole("tab", { name: "AI Configuration" }));
  await page.getByLabel("Provider").selectOption("openai");
  await page.getByLabel("Mode").selectOption("byok");
  await setControlValue(page.getByLabel("API key"), "sk-keppo-e2e-1234");
  await clickElement(page.getByRole("button", { name: "Save Key" }));
  await expect(
    page.locator('[data-testid="ai-key-row"][data-ai-key-provider="openai"]'),
  ).toContainText("Active");

  await pages.automations.open();
  await pages.automations.expectListLoaded();
  await pages.automations.openCreatePage();

  await setControlValue(page.getByLabel("Name"), `Inbox Trigger ${app.metadata.testId}`);
  await setControlValue(
    page.getByLabel("Description"),
    "Escalate matching inbox events into an operator workflow.",
  );
  await clickElement(page.getByRole("button", { name: "Continue" }));
  await page.getByLabel("Trigger type").selectOption("event");
  await page.locator("#provider-trigger-provider").selectOption("google");
  await page.locator("#provider-trigger-key").selectOption("incoming_email");
  await setControlValue(page.locator("#provider-trigger-filter-from"), "alerts@example.com");
  await setControlValue(page.locator("#provider-trigger-filter-subject_contains"), "Deployment");
  await setControlValue(page.locator("#provider-trigger-filter-has_any_labels"), "ops,urgent");
  await clickElement(page.getByRole("checkbox", { name: "Unread only" }));

  await expect(
    page.getByText(
      "Start an automation when Gmail receives a message that matches structured filters.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("Uses integrations already enabled for this workspace."),
  ).toBeVisible();
  await page.locator("#provider-trigger-provider").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "ux-artifacts/automation-provider-trigger-page.png",
    timeout: 20_000,
  });

  await clickElement(page.getByRole("button", { name: "Continue" }));
  await setControlValue(
    page.getByLabel("Prompt"),
    "Review the matching inbox event, summarize the issue, and prepare the next operator action.",
  );

  await clickElement(page.getByRole("button", { name: /Create automation/i }));

  await pages.automations.expectDetailLoaded(`Inbox Trigger ${app.metadata.testId}`);
  await expect(page.getByText("Trigger Activity", { exact: true })).toBeVisible();
  await expect(
    page.getByText("No provider deliveries have been recorded for this automation yet."),
  ).toBeVisible();

  await pages.automations.openConfigTab();
  await expect(page.locator("#provider-trigger-provider")).toHaveValue("google");
  await expect(page.locator("#provider-trigger-key")).toHaveValue("incoming_email");
  await expect(page.locator("#provider-trigger-filter-from")).toHaveValue("alerts@example.com");
  await expect(page.locator("#provider-trigger-filter-subject_contains")).toHaveValue("Deployment");
  await expect(page.locator("#provider-trigger-filter-has_any_labels")).toHaveValue("ops, urgent");
});

test("multi-provider trigger authoring surfaces Reddit and X polling filters from the shared registry", async ({
  app,
  auth,
  pages,
  page,
}) => {
  await pages.login.login();
  const seeded = await auth.seedWorkspaceWithProvider(
    "automation-provider-trigger-multi",
    "google",
  );
  await auth.connectProviderForOrg(seeded.orgId, "reddit", undefined, seeded.workspaceId, true);
  await auth.connectProviderForOrg(seeded.orgId, "x", undefined, seeded.workspaceId, true);
  await pages.automations.setSelectedWorkspaceSlug(seeded.workspaceSlug);

  const settingsUrl = new URL(
    await resolveScopedDashboardPath(page, "/settings"),
    app.dashboardBaseUrl,
  ).toString();
  await page.goto(settingsUrl, { waitUntil: "domcontentloaded" });
  await clickElement(page.getByRole("tab", { name: "AI Configuration" }));
  await page.getByLabel("Provider").selectOption("openai");
  await page.getByLabel("Mode").selectOption("byok");
  await setControlValue(page.getByLabel("API key"), "sk-keppo-e2e-1234");
  await clickElement(page.getByRole("button", { name: "Save Key" }));

  await pages.automations.open();
  await pages.automations.expectListLoaded();
  await pages.automations.openCreatePage();

  await setControlValue(page.getByLabel("Name"), `Provider Trigger ${app.metadata.testId}`);
  await clickElement(page.getByRole("button", { name: "Continue" }));
  await page.getByLabel("Trigger type").selectOption("event");

  await expect(page.locator("#provider-trigger-provider")).toContainText("Reddit");
  await expect(page.locator("#provider-trigger-provider")).toContainText("X");

  await page.locator("#provider-trigger-provider").selectOption("reddit");
  await expect(page.locator("#provider-trigger-key")).toContainText("Mentions");
  await expect(page.locator("#provider-trigger-key")).toContainText("Unread inbox message");
  await page.locator("#provider-trigger-key").selectOption("mentions");
  await expect(
    page.getByText("Start an automation when Reddit inbox mentions reference this account."),
  ).toBeVisible();
  await expect(page.locator("#provider-trigger-filter-from")).toBeVisible();
  await expect(page.locator("#provider-trigger-filter-subject_contains")).toBeVisible();
  await expect(page.locator("#provider-trigger-filter-body_contains")).toBeVisible();

  await page.locator("#provider-trigger-provider").selectOption("x");
  await expect(page.locator("#provider-trigger-key")).toHaveValue("mentions");
  await expect(
    page.getByText("Start an automation when X mentions this connected account in a post."),
  ).toBeVisible();
  await expect(page.locator("#provider-trigger-filter-text_contains")).toBeVisible();
  await expect(page.locator("#provider-trigger-filter-author_id")).toBeVisible();
});
