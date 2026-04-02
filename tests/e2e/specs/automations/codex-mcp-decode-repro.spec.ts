import { readFile } from "node:fs/promises";
import { test, expect } from "../../fixtures/golden.fixture";
import { createConvexAdmin } from "../../helpers/convex-admin";
import { serviceLogFileForWorker } from "../../infra/stack-manager";

test("codex automation run completes after search_tools when fake OpenAI responses stream stays valid", async ({
  app,
  auth,
  pages,
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

  let dashboardLog = await readServiceLog("dashboard");
  await expect
    .poll(
      async () => {
        dashboardLog = await readServiceLog("dashboard");
        return dashboardLog.includes('"msg":"mcp.tools_list.completed"');
      },
      { timeout: 20_000, intervals: [500, 1_000, 2_000] },
    )
    .toBe(true);

  expect(
    {
      status: run?.status ?? null,
      dashboardSawToolsListCompleted: dashboardLog.includes('"msg":"mcp.tools_list.completed"'),
      hasStreamDisconnectError: logText.includes("stream disconnected before completion"),
      hasAgentRecordedOutcome: logText.includes("Automation outcome (agent recorded): Success."),
      logText,
    },
    "fake OpenAI repro did not hit the expected successful Codex/MCP path",
  ).toEqual({
    status: "succeeded",
    dashboardSawToolsListCompleted: true,
    hasStreamDisconnectError: false,
    hasAgentRecordedOutcome: true,
    logText,
  });
});
