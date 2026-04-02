import { readFile } from "node:fs/promises";
import type { Locator } from "@playwright/test";
import { test, expect } from "../../fixtures/golden.fixture";
import { createConvexAdmin } from "../../helpers/convex-admin";
import { resolveScopedDashboardPath } from "../../helpers/dashboard-paths";
import { serviceLogFileForWorker } from "../../infra/stack-manager";

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

test("codex automation run completes after search_tools when fake OpenAI responses stream stays valid", async ({
  app,
  auth,
  pages,
  page,
}) => {
  test.skip(
    process.env.KEPPO_E2E_OPENAI_RESPONSES_FAKE !== "1",
    "Set KEPPO_E2E_OPENAI_RESPONSES_FAKE=1 to route Codex through the fake OpenAI responses endpoint.",
  );
  test.slow();

  await pages.login.login();
  const seeded = await auth.seedWorkspaceWithProvider(
    "codex-mcp-decode-repro",
    "google",
    undefined,
    {
      subscriptionTier: "free",
    },
  );
  await pages.automations.setSelectedWorkspaceSlug(seeded.workspaceSlug);

  const admin = createConvexAdmin(app);
  const createdAutomation = (await admin.createAutomationForWorkspace({
    orgId: seeded.orgId,
    workspaceId: seeded.workspaceId,
    name: `Codex MCP decode repro ${app.metadata.testId}`,
    prompt: "Find the Gmail send-email tool with search_tools, then record the outcome.",
  })) as {
    created: {
      automation: {
        id: string;
        slug: string;
      };
    };
  };

  const settingsUrl = new URL(
    await resolveScopedDashboardPath(page, "/settings"),
    app.dashboardBaseUrl,
  ).toString();
  await page.goto(settingsUrl, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await clickElement(page.getByRole("tab", { name: "AI Configuration" }));
  await page.getByLabel("Provider").selectOption("openai");
  await page.getByLabel("Mode").selectOption("byok");
  await setControlValue(page.getByLabel("API key"), "sk-keppo-e2e-openai");
  await clickElement(page.getByRole("button", { name: "Save Key" }));
  await expect(
    page.locator('[data-testid="ai-key-row"][data-ai-key-provider="openai"]'),
  ).toContainText("Active");

  const createdRun = (await admin.createAutomationRun(
    createdAutomation.created.automation.id,
    "manual",
  )) as { id: string };

  const dispatchResult = (await admin.dispatchAutomationRun(createdRun.id)) as {
    dispatched: boolean;
    status: string;
    http_status: number | null;
  };

  expect(dispatchResult).toMatchObject({
    dispatched: true,
    status: "dispatched",
    http_status: 200,
  });

  const runDetailUrl = new URL(
    await resolveScopedDashboardPath(
      page,
      `/automations/${createdAutomation.created.automation.slug}/runs/${createdRun.id}`,
    ),
    app.dashboardBaseUrl,
  ).toString();
  await page.goto(runDetailUrl, { waitUntil: "domcontentloaded" });

  await expect
    .poll(
      async () => {
        const run = await admin.getAutomationRun(createdRun.id);
        return run?.status ?? null;
      },
      { timeout: 90_000, intervals: [500, 1_000, 2_000] },
    )
    .toMatch(/^(succeeded|failed|cancelled|timed_out)$/);

  const readLogText = async (): Promise<string> => {
    const logs = await admin.getAutomationRunLogs(createdRun.id);
    if (!logs) {
      return "";
    }
    if (logs.mode === "cold") {
      const response = await request.get(logs.storage_url);
      if (!response.ok()) {
        return "";
      }
      return await response.text();
    }
    if (logs.mode !== "hot") {
      return "";
    }
    return logs.lines.map((line) => `[${line.level}] ${line.content}`).join("\n");
  };

  await expect.poll(readLogText, { timeout: 20_000, intervals: [500, 1_000, 2_000] }).not.toBe("");

  const run = await admin.getAutomationRun(createdRun.id);
  const logText = await readLogText();

  const readServiceLog = async (name: "dashboard" | "fake-gateway"): Promise<string> => {
    try {
      return await readFile(serviceLogFileForWorker(app.runtime.workerIndex, name), "utf8");
    } catch {
      return "";
    }
  };

  let fakeGatewayLog = await readServiceLog("fake-gateway");
  await expect
    .poll(
      async () => {
        fakeGatewayLog = await readServiceLog("fake-gateway");
        return fakeGatewayLog.includes("[fake-openai] path=/responses");
      },
      { timeout: 20_000, intervals: [500, 1_000, 2_000] },
    )
    .toBe(true);

  let dashboardLog = await readServiceLog("dashboard");
  await expect
    .poll(
      async () => {
        dashboardLog = await readServiceLog("dashboard");
        return (
          dashboardLog.includes('"msg":"mcp.tool_call.received"') &&
          dashboardLog.includes('"msg":"mcp.search_tools.completed"')
        );
      },
      { timeout: 20_000, intervals: [500, 1_000, 2_000] },
    )
    .toBe(true);

  expect(
    {
      status: run?.status ?? null,
      fakeGatewaySawResponses: fakeGatewayLog.includes("[fake-openai] path=/responses"),
      fakeGatewaySawSearchToolsFunction: fakeGatewayLog.includes(
        '"name":"mcp__keppo__search_tools"',
      ),
      fakeGatewaySawRecordOutcomeFunction: fakeGatewayLog.includes(
        '"name":"mcp__keppo__record_outcome"',
      ),
      fakeGatewaySawFunctionOutputFollowUp: fakeGatewayLog.includes(
        '"type":"function_call_output"',
      ),
      dashboardSawToolCallReceived: dashboardLog.includes('"msg":"mcp.tool_call.received"'),
      dashboardSawSearchToolsCompleted: dashboardLog.includes('"msg":"mcp.search_tools.completed"'),
      dashboardSawRecordOutcomeCall: dashboardLog.includes('"tool_name":"record_outcome"'),
      hasStreamDisconnectError: logText.includes(
        "stream disconnected before completion: stream closed before response.completed",
      ),
      hasAgentRecordedOutcome: logText.includes("Automation outcome (agent recorded): Success."),
      logText,
    },
    "fake OpenAI repro did not hit the expected successful Codex/MCP path",
  ).toEqual({
    status: "succeeded",
    fakeGatewaySawResponses: true,
    fakeGatewaySawSearchToolsFunction: true,
    fakeGatewaySawRecordOutcomeFunction: true,
    fakeGatewaySawFunctionOutputFollowUp: true,
    dashboardSawToolCallReceived: true,
    dashboardSawSearchToolsCompleted: true,
    dashboardSawRecordOutcomeCall: true,
    hasStreamDisconnectError: false,
    hasAgentRecordedOutcome: true,
    logText,
  });
});
