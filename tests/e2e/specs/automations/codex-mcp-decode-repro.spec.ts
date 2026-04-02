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
        return (
          dashboardLog.includes('"msg":"automation.dispatch.runtime_configured"') &&
          dashboardLog.includes('"runner_uses_custom_openai_provider":true') &&
          dashboardLog.includes('"has_e2e_openai_base_url":true') &&
          dashboardLog.includes('"msg":"automation.dispatch.succeeded"')
        );
      },
      { timeout: 20_000, intervals: [500, 1_000, 2_000] },
    )
    .toBe(true);

  expect(
    {
      dashboardUsedFakeOpenAiBaseUrl: dashboardLog.includes('"has_e2e_openai_base_url":true'),
      dashboardUsedCustomOpenAiProvider: dashboardLog.includes(
        '"runner_uses_custom_openai_provider":true',
      ),
      dashboardSawDispatchSucceeded: dashboardLog.includes('"msg":"automation.dispatch.succeeded"'),
    },
    "fake OpenAI repro did not hit the expected local dispatch path",
  ).toEqual({
    dashboardUsedFakeOpenAiBaseUrl: true,
    dashboardUsedCustomOpenAiProvider: true,
    dashboardSawDispatchSucceeded: true,
  });
});
