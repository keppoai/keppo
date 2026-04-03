import { readFile } from "node:fs/promises";
import type { APIRequestContext, Locator } from "@playwright/test";
import { test, expect } from "../../fixtures/golden.fixture";
import { createConvexAdmin } from "../../helpers/convex-admin";
import { gotoWithNavigationRetry } from "../../helpers/billing-hooks";
import { resolveScopedDashboardPath } from "../../helpers/dashboard-paths";
import { serviceLogFileForWorker } from "../../infra/stack-manager";

type ProviderEvent = {
  body: unknown;
  path: string;
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

const readProviderEvents = async (
  request: APIRequestContext,
  baseUrl: string,
): Promise<ProviderEvent[]> => {
  const response = await request.get(`${baseUrl}/__provider-events`);
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { events?: ProviderEvent[] };
  return payload.events ?? [];
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
  );
  settingsUrl.searchParams.set("tab", "ai");
  await gotoWithNavigationRetry(page, settingsUrl.toString());
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
  const openAiEventCountBeforeDispatch = (
    await readProviderEvents(request, app.runtime.fakeGatewayBaseUrl)
  ).length;

  const dispatchResult = (await admin.dispatchAutomationRun(createdRun.id, app.namespace)) as {
    dispatched: boolean;
    status: string;
    http_status: number | null;
  };
  if (!dispatchResult.dispatched) {
    const failedRun = await admin.getAutomationRun(createdRun.id);
    throw new Error(
      `Automation dispatch failed: ${JSON.stringify({
        dispatchResult,
        runStatus: failedRun?.status ?? null,
        runError: failedRun?.error_message ?? null,
      })}`,
    );
  }

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

  let finalRunState: {
    hasOpenAiResponsesSearchToolsRequest: boolean;
    status: string | null;
    outcomeSuccess: boolean | null;
    hasStreamDisconnectError: boolean;
    logText: string;
  } | null = null;

  await expect
    .poll(
      async () => {
        const run = await admin.getAutomationRun(createdRun.id);
        const logSummary = await summarizeRunLogs(request, admin, createdRun.id);
        const openAiEvents = await readProviderEvents(request, app.runtime.fakeGatewayBaseUrl);
        const newOpenAiEvents = openAiEvents.slice(openAiEventCountBeforeDispatch);
        finalRunState = {
          hasOpenAiResponsesSearchToolsRequest: newOpenAiEvents.some(
            (event) => event.path.includes("responses") && eventBodyHasSearchTools(event.body),
          ),
          status: run?.status ?? null,
          outcomeSuccess: run?.outcome_success ?? null,
          hasStreamDisconnectError: logSummary.text.includes(
            "stream disconnected before completion",
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
      hasStreamDisconnectError: false,
    });

  const finalLogText = finalRunState?.logText ?? "";

  const readServiceLog = async (name: "dashboard"): Promise<string> => {
    try {
      return await readFile(serviceLogFileForWorker(app.runtime.workerIndex, name), "utf8");
    } catch {
      return "";
    }
  };

  let dashboardLog = await readServiceLog("dashboard");
  await expect
    .poll(
      async () => {
        dashboardLog = await readServiceLog("dashboard");
        return (
          dashboardLog.includes('"msg":"automation.dispatch.runtime_configured"') &&
          dashboardLog.includes('"msg":"automation.dispatch.succeeded"') &&
          dashboardLog.includes("/internal/automations/complete")
        );
      },
      { timeout: 30_000, intervals: [500, 1_000, 2_000] },
    )
    .toBe(true);

  const result = {
    status: finalRunState?.status ?? null,
    outcomeSuccess: finalRunState?.outcomeSuccess ?? null,
    dashboardConfiguredFakeOpenAiPath:
      dashboardLog.includes('"msg":"automation.dispatch.runtime_configured"') &&
      dashboardLog.includes('"has_e2e_openai_base_url":true') &&
      dashboardLog.includes('"runner_uses_custom_openai_provider":true'),
    dashboardDispatchSucceeded: dashboardLog.includes('"msg":"automation.dispatch.succeeded"'),
    dashboardSawCompletionCallback: dashboardLog.includes("/internal/automations/complete"),
    hasCodexSessionBootstrapped:
      finalLogText.includes("Added global MCP server 'keppo'.") &&
      finalLogText.includes("OpenAI Codex"),
    hasStreamDisconnectError: finalRunState?.hasStreamDisconnectError ?? true,
  };

  expect(result, "fake OpenAI repro did not hit the expected successful Codex/MCP path").toEqual({
    status: "succeeded",
    outcomeSuccess: true,
    dashboardConfiguredFakeOpenAiPath: true,
    dashboardDispatchSucceeded: true,
    dashboardSawCompletionCallback: true,
    hasCodexSessionBootstrapped: true,
    hasStreamDisconnectError: false,
  });
});
