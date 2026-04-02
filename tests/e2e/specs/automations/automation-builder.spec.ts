import { mkdirSync } from "node:fs";
import { expect, test } from "../../fixtures/golden.fixture";

test("automation builder asks clarifying questions before drafting and keeps provider setup advisory", async ({
  auth,
  pages,
  page,
}) => {
  mkdirSync("ux-artifacts", { recursive: true });

  await page.addInitScript(
    ({ questionPayload, draftPayload }) => {
      window.__KEPPO_E2E_SERVER_FN_MOCKS__ = {
        ...window.__KEPPO_E2E_SERVER_FN_MOCKS__,
        generateAutomationQuestions: questionPayload,
        generateAutomationPrompt: draftPayload,
      };
    },
    {
      questionPayload: {
        ok: true,
        questions: [
          {
            id: "trigger_style",
            label: "How should this automation start?",
            description: "Choose the trigger that best matches this workflow.",
            input_type: "radio",
            required: true,
            options: [
              { value: "schedule", label: "On a schedule" },
              { value: "manual", label: "Manual run" },
            ],
          },
          {
            id: "delivery_channels",
            label: "Who should receive the reminder?",
            description: "Pick the channels that need the summary.",
            input_type: "checkbox",
            required: true,
            options: [
              { value: "slack", label: "Slack" },
              { value: "email", label: "Email" },
              { value: "notion", label: "Notion" },
            ],
          },
          {
            id: "skip_rules",
            label: "Anything the automation should avoid?",
            description: "Optional safeguard.",
            input_type: "text",
            required: false,
            placeholder: "Skip draft pull requests",
            options: [],
          },
        ],
        billing: {
          stage: "questions",
          charged_credits: 0,
          cycle_total_credits: 1,
          summary:
            "Clarifying questions do not deduct a credit. Keppo charges 1 credit only when it generates the final automation draft.",
        },
      },
      draftPayload: {
        ok: true,
        name: "Morning GitHub Triage",
        prompt:
          "Every morning, review stale pull requests, skip draft pull requests, and send the team a Slack and email reminder with blocker context.",
        description: "Creates a daily stale pull request reminder for the team.",
        mermaid_content: "flowchart TD\nStart-->Review\nReview-->Notify",
        trigger_type: "schedule",
        schedule_cron: "0 9 * * *",
        provider_recommendations: [
          {
            provider: "github",
            reason: "GitHub is required to inspect pull requests and collect blocker context.",
            confidence: "required",
          },
        ],
        credit_balance: {
          allowance_remaining: 24,
          purchased_remaining: 0,
          total_available: 24,
        },
        billing: {
          stage: "draft",
          charged_credits: 1,
          cycle_total_credits: 1,
          summary: "Keppo deducted 1 credit to generate the final automation draft.",
        },
      },
    },
  );

  await pages.login.login();
  const seeded = await auth.seedWorkspace("automation-builder", {
    subscriptionTier: "starter",
  });
  await pages.automations.setSelectedWorkspaceSlug(seeded.workspaceSlug);
  await pages.automations.open();
  await pages.automations.expectListLoaded();

  await page.getByRole("button", { name: "Open quick draft" }).click();
  await page
    .getByLabel("Automation outcome")
    .fill("Check stale pull requests every afternoon and remind the right reviewers.");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(
    page.getByRole("heading", { name: "How should this automation start?" }),
  ).toBeVisible({
    timeout: 20_000,
  });
  await page.getByTestId("automation-builder").screenshot({
    path: "ux-artifacts/automation-builder-question-step.png",
  });

  await page.keyboard.press("1");
  await page.keyboard.press("Enter");

  await expect(
    page.getByRole("heading", { name: "Who should receive the reminder?" }),
  ).toBeVisible();
  await page.keyboard.press("1");
  await page.keyboard.press("2");
  await page.keyboard.press("Enter");

  await expect(
    page.getByRole("heading", { name: "Anything the automation should avoid?" }),
  ).toBeVisible();
  await page.getByPlaceholder("Skip draft pull requests").fill("Skip draft pull requests");
  await page.keyboard.press("Enter");

  await expect(page.getByText("Drafted workflow")).toBeVisible({ timeout: 20_000 });
  const clarificationSummary = page.getByTestId("automation-builder-clarification-summary");
  await expect(clarificationSummary).toBeVisible();
  await expect(clarificationSummary).toContainText("Clarification summary");
  await expect(clarificationSummary).toContainText("schedule");
  await expect(clarificationSummary).toContainText("Slack, Email");
  await expect(clarificationSummary).toContainText("Skip draft pull requests");
  await expect(page.getByTestId("automation-builder-trigger-summary")).toContainText(
    "Every day at 9:00 AM",
  );
  await expect(
    page.getByTestId("automation-builder-diagram").locator("svg[id^='automation-diagram-']"),
  ).toBeVisible();
  const descriptionField = page.getByLabel("Description");
  await expect(descriptionField).toHaveValue(
    "Creates a daily stale pull request reminder for the team.",
  );
  await descriptionField.press("ControlOrMeta+A");
  await descriptionField.press("Backspace");
  await expect(descriptionField).toHaveValue("");
  await descriptionField.fill("Trimmed draft description");
  await expect(descriptionField).toHaveValue("Trimmed draft description");

  await page.getByRole("button", { name: "Continue" }).click();
  const providerCard = page.getByTestId("automation-builder-provider-github");
  await expect(providerCard).toBeVisible();
  await expect(
    page.getByText("Choose provider access for this automation", { exact: true }),
  ).toBeVisible();
  await expect(providerCard).toContainText(/Live data|Optional context/);
  await expect(providerCard.getByRole("button", { name: /Connect|Open/i })).toBeVisible();

  await page.getByTestId("automation-builder").screenshot({
    path: "ux-artifacts/automation-builder-provider-step.png",
  });

  await page.getByRole("button", { name: "Continue without these providers" }).click();
  await expect(page.getByLabel("Model")).toBeVisible();
  await expect(page.getByText("Resolved runtime")).toHaveCount(0);
  await expect(page.getByText("Runtime mode")).toHaveCount(0);
  await page.getByTestId("automation-builder-settings-step").screenshot({
    path: "ux-artifacts/automation-builder-settings-step.png",
  });

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Ready to create")).toBeVisible();

  await page.getByRole("button", { name: "Create automation" }).click();

  await pages.automations.expectDetailLoaded("Morning GitHub Triage");
  await expect(page).toHaveURL(/\/automations\/morning-github-triage$/);
  await expect(page.getByText("Trimmed draft description")).toBeVisible();
  const workflowDiagramToggle = page.getByRole("button", { name: /Workflow diagram/i });
  await expect(workflowDiagramToggle).toBeVisible();
  await expect(page.locator("svg[id^='automation-diagram-']")).toHaveCount(0);
  await workflowDiagramToggle.click();
  await expect(page.locator("svg[id^='automation-diagram-']")).toBeVisible();
});
