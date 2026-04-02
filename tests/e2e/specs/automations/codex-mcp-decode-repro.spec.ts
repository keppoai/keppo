import { readFile } from "node:fs/promises";
import type { APIRequestContext, Locator } from "@playwright/test";
import { test, expect } from "../../fixtures/golden.fixture";
import { createConvexAdmin } from "../../helpers/convex-admin";
import { resolveScopedDashboardPath } from "../../helpers/dashboard-paths";
import { serviceLogFileForWorker } from "../../infra/stack-manager";

type ProviderEvent = {
  body: unknown;
  path: string;
  provider?: string;
};

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

const eventBodyHasSearchTools = (body: unknown): boolean => {
  if (typeof body === "string") {
    return body.includes("search_tools");
  }
  try {
    if (JSON.stringify(body).includes("search_tools")) {
      return true;
    }
  } catch {
    // Fall back to the structured checks below.
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return false;
  }
  const record = body as { tools?: unknown };
  if (!Array.isArray(record.tools)) {
    return false;
  }
  return record.tools.some((tool) => {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
      return false;
    }
    const toolRecord = tool as { name?: unknown };
    return typeof toolRecord.name === "string" && toolRecord.name.includes("search_tools");
  });
};

const summarizeRunLogs = async (
  request: APIRequestContext,
  admin: ReturnType<typeof createConvexAdmin>,
  automationRunId: string,
): Promise<{
  text: string;
}> => {
  const logs = await admin.getAutomationRunLogs(automationRunId);
  if (logs.mode === "cold") {
    const response = await request.get(logs.storage_url);
    if (!response.ok()) {
      return { text: "" };
    }
    return { text: await response.text() };
  }
  if (logs.mode !== "hot") {
    return { text: "" };
  }
  return { text: logs.lines.map((line) => `[${line.level}] ${line.content}`).join("\n") };
};

test("codex automation run completes after search_tools when fake OpenAI responses stream stays valid", async ({
  app,
  auth,
  pages,
  page,
  provider,
  request,
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
  let aiConfigurationMode: "hosted" | "self-managed" | null = null;
  await expect
    .poll(
      async () => {
        if ((await page.getByText("Hosted mode keeps credentials managed").count()) > 0) {
          aiConfigurationMode = "hosted";
          return aiConfigurationMode;
        }
        if ((await page.getByLabel("Provider").count()) > 0) {
          aiConfigurationMode = "self-managed";
          return aiConfigurationMode;
        }
        return null;
      },
      { timeout: 30_000, intervals: [500, 1_000, 2_000] },
    )
    .not.toBeNull();

  if (aiConfigurationMode === "hosted") {
    await expect(page.getByText("Hosted mode keeps credentials managed")).toBeVisible();
    await expect(page.getByLabel("API key")).toHaveCount(0);
  } else {
    await page.getByLabel("Provider").selectOption("openai");
    await page.getByLabel("Mode").selectOption("byok");
    await setControlValue(page.getByLabel("API key"), "sk-keppo-e2e-openai");
    await clickElement(page.getByRole("button", { name: "Save Key" }));
    await expect(
      page.locator('[data-testid="ai-key-row"][data-ai-key-provider="openai"]'),
    ).toContainText("Active");
  }

  const createdRun = (await admin.createAutomationRun(
    createdAutomation.created.automation.id,
    "manual",
  )) as { id: string };

  const dispatchResult = (await admin.dispatchAutomationRun(createdRun.id, app.namespace)) as {
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

  const readLogText = async (): Promise<string> =>
    (await summarizeRunLogs(request, admin, createdRun.id)).text;

  await expect.poll(readLogText, { timeout: 20_000, intervals: [500, 1_000, 2_000] }).not.toBe("");

  const readServiceLog = async (name: "dashboard"): Promise<string> => {
    try {
      return await readFile(serviceLogFileForWorker(app.runtime.workerIndex, name), "utf8");
    } catch {
      return "";
    }
  };

  let finalRunState: {
    hasOpenAiResponsesSearchToolsRequest: boolean;
    status: string | null;
    outcomeSuccess: boolean | null;
    fakeGatewaySawResponses: boolean;
    fakeGatewaySawRecordOutcomeFunction: boolean;
    fakeGatewaySawFunctionOutputFollowUp: boolean;
    dashboardSawToolCallReceived: boolean;
    dashboardSawSearchToolsCompleted: boolean;
    dashboardSawRecordOutcomeCall: boolean;
    hasStreamDisconnectError: boolean;
    hasAgentRecordedOutcome: boolean;
    logText: string;
  } | null = null;
  await expect
    .poll(
      async () => {
        const run = await admin.getAutomationRun(createdRun.id);
        const logSummary = await summarizeRunLogs(request, admin, createdRun.id);
        const openAiEvents = (await provider.events("openai")) as ProviderEvent[];
        const stringifyOpenAiEvents = JSON.stringify(openAiEvents);
        const dashboardLog = await readServiceLog("dashboard");
        finalRunState = {
          hasOpenAiResponsesSearchToolsRequest: openAiEvents.some(
            (event) => typeof event.path === "string" && event.path.endsWith("/responses"),
          )
            ? openAiEvents.some(
                (event) =>
                  typeof event.path === "string" &&
                  event.path.endsWith("/responses") &&
                  eventBodyHasSearchTools(event.body),
              )
            : false,
          status: run?.status ?? null,
          outcomeSuccess: run?.outcome_success ?? null,
          fakeGatewaySawResponses: openAiEvents.some(
            (event) => typeof event.path === "string" && event.path.endsWith("/responses"),
          ),
          fakeGatewaySawRecordOutcomeFunction: stringifyOpenAiEvents.includes(
            '"name":"mcp__keppo__record_outcome"',
          ),
          fakeGatewaySawFunctionOutputFollowUp: stringifyOpenAiEvents.includes(
            '"type":"function_call_output"',
          ),
          dashboardSawToolCallReceived: dashboardLog.includes('"msg":"mcp.tool_call.received"'),
          dashboardSawSearchToolsCompleted: dashboardLog.includes(
            '"msg":"mcp.search_tools.completed"',
          ),
          dashboardSawRecordOutcomeCall: dashboardLog.includes('"tool_name":"record_outcome"'),
          hasStreamDisconnectError: logSummary.text.includes(
            "stream disconnected before completion",
          ),
          hasAgentRecordedOutcome: logSummary.text.includes(
            "Automation outcome (agent recorded): Success.",
          ),
          logText: logSummary.text,
        };
        return finalRunState;
      },
      {
        timeout: 20_000,
        intervals: [500, 1_000, 2_000],
      },
    )
    .toMatchObject({
      hasOpenAiResponsesSearchToolsRequest: true,
      status: "succeeded",
      outcomeSuccess: true,
      fakeGatewaySawResponses: true,
      fakeGatewaySawRecordOutcomeFunction: true,
      fakeGatewaySawFunctionOutputFollowUp: true,
      dashboardSawToolCallReceived: true,
      dashboardSawSearchToolsCompleted: true,
      dashboardSawRecordOutcomeCall: true,
      hasStreamDisconnectError: false,
      hasAgentRecordedOutcome: true,
    });

  expect(
    finalRunState?.logText,
    "fake OpenAI repro did not hit the expected successful Codex/MCP path",
  ).toContain("OpenAI Codex");
});
