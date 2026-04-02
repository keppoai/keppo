import { readFile } from "node:fs/promises";
import type { APIRequestContext } from "@playwright/test";
import { test, expect } from "../../fixtures/golden.fixture";
import { createConvexAdmin } from "../../helpers/convex-admin";
import { serviceLogFileForWorker } from "../../infra/stack-manager";

type ProviderEvent = {
  body: unknown;
  path: string;
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

  await admin.upsertBundledOrgAiKey(seeded.orgId, "openai", "sk-keppo-e2e-openai");

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
  const dispatchRun = await admin.getAutomationRun(createdRun.id);

  expect(
    {
      dispatchResult,
      dispatchError: dispatchRun?.error_message ?? null,
    },
    "automation dispatch failed before the run reached the owned runtime",
  ).toMatchObject({
    dispatchResult: {
      dispatched: true,
      status: "dispatched",
      http_status: 200,
    },
    dispatchError: null,
  });

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

  const readServiceLog = async (name: "dashboard" | "fake-gateway"): Promise<string> => {
    try {
      return await readFile(serviceLogFileForWorker(app.runtime.workerIndex, name), "utf8");
    } catch {
      return "";
    }
  };

  let finalRunState: {
    dashboardSawToolsListCompleted: boolean;
    hasAgentRecordedOutcome: boolean;
    hasOpenAiResponsesSearchToolsRequest: boolean;
    hasStreamDisconnectError: boolean;
    logText: string;
    status: string | null;
  } | null = null;

  await expect
    .poll(
      async () => {
        const run = await admin.getAutomationRun(createdRun.id);
        const logSummary = await summarizeRunLogs(request, admin, createdRun.id);
        const openAiEvents = await readProviderEvents(request, app.runtime.fakeGatewayBaseUrl);
        const newOpenAiEvents = openAiEvents.slice(openAiEventCountBeforeDispatch);
        const dashboardLog = await readServiceLog("dashboard");
        finalRunState = {
          dashboardSawToolsListCompleted: dashboardLog.includes('"msg":"mcp.tools_list.completed"'),
          hasAgentRecordedOutcome: logSummary.text.includes(
            "Automation outcome (agent recorded): Success.",
          ),
          hasOpenAiResponsesSearchToolsRequest: newOpenAiEvents.some(
            (event) => event.path.includes("responses") && eventBodyHasSearchTools(event.body),
          ),
          hasStreamDisconnectError: logSummary.text.includes(
            "stream disconnected before completion",
          ),
          logText: logSummary.text,
          status: run?.status ?? null,
        };
        return finalRunState;
      },
      {
        timeout: 20_000,
        intervals: [500, 1_000, 2_000],
      },
    )
    .toMatchObject({
      dashboardSawToolsListCompleted: true,
      hasAgentRecordedOutcome: true,
      hasOpenAiResponsesSearchToolsRequest: true,
      hasStreamDisconnectError: false,
      status: "succeeded",
    });

  expect(
    finalRunState?.logText,
    "fake OpenAI repro did not hit the expected successful Codex/MCP path",
  ).toContain("OpenAI Codex");
});
