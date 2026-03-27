import { createHmac } from "node:crypto";
import { KeppoStore } from "@keppo/shared/store";
import { test, expect } from "../../fixtures/golden.fixture";
import { createConvexAdmin } from "../../helpers/convex-admin";
import { resolveScopedDashboardPath } from "../../helpers/dashboard-paths";

const resolveAutomationCallbackSecret = (): string => {
  const secret = process.env.KEPPO_CALLBACK_HMAC_SECRET ?? process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error("Missing KEPPO_CALLBACK_HMAC_SECRET or BETTER_AUTH_SECRET for E2E callbacks.");
  }
  return secret;
};

const signAutomationCallbackUrl = (baseUrl: string, pathname: string, runId: string): URL => {
  const expires = Date.now() + 5 * 60_000;
  const url = new URL(pathname, baseUrl);
  url.searchParams.set("automation_run_id", runId);
  url.searchParams.set("expires", String(expires));
  url.searchParams.set(
    "signature",
    createHmac("sha256", resolveAutomationCallbackSecret())
      .update(`${url.pathname}:${runId}:${expires}`)
      .digest("hex"),
  );
  return url;
};

test("start-owned automation callbacks ingest logs and completion on the unified web runtime", async ({
  app,
  auth,
  pages,
  page,
  request,
}) => {
  await pages.login.login();
  const seeded = await auth.seedWorkspace("automation-runtime", {
    subscriptionTier: "starter",
  });
  await pages.automations.setSelectedWorkspaceSlug(seeded.workspaceSlug);

  const admin = createConvexAdmin(app);
  const createdAutomation = (await admin.createAutomationForWorkspace({
    orgId: seeded.orgId,
    workspaceId: seeded.workspaceId,
    name: `Start-owned runtime ${app.metadata.testId}`,
    prompt: "Verify the Start-owned automation callback runtime.",
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
  const runId = createdRun.id;
  await admin.finishRun(runId, "running");

  const logPayload = JSON.stringify({
    automation_run_id: runId,
    lines: [
      {
        level: "stdout",
        content: "start-owned automation callback verified",
      },
    ],
  });
  const logResponse = await request.fetch(
    signAutomationCallbackUrl(app.dashboardBaseUrl, "/internal/automations/log", runId).toString(),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      data: logPayload,
    },
  );

  expect(logResponse.status()).toBe(200);
  await expect(logResponse.json()).resolves.toMatchObject({
    ok: true,
    ingested: 1,
  });

  const completePayload = JSON.stringify({
    automation_run_id: runId,
    status: "succeeded",
  });
  const completeResponse = await request.fetch(
    signAutomationCallbackUrl(
      app.dashboardBaseUrl,
      "/internal/automations/complete",
      runId,
    ).toString(),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      data: completePayload,
    },
  );

  expect(completeResponse.status()).toBe(200);
  await expect(completeResponse.json()).resolves.toMatchObject({
    ok: true,
    status: "succeeded",
  });

  const store = new KeppoStore(app.runtime.convexUrl, process.env.KEPPO_CONVEX_ADMIN_KEY);
  await expect
    .poll(async () => {
      const snapshot = await store.getDbSnapshot();
      return snapshot.automation_runs.find((candidate) => candidate.id === runId)?.metadata
        ?.automation_run_status;
    })
    .toBe("succeeded");

  const runDetailUrl = new URL(
    await resolveScopedDashboardPath(
      page,
      `/automations/${createdAutomation.created.automation.slug}/runs/${runId}`,
    ),
    app.dashboardBaseUrl,
  ).toString();
  await page.goto(runDetailUrl, { waitUntil: "domcontentloaded" });
  await pages.automations.expectRunDetailPage();
  await pages.automations.expectRunRowVisible(/succeeded/i);
  await page
    .getByRole("tab", { name: "Raw Logs" })
    .evaluate((element) => (element as HTMLButtonElement).click());
  await pages.automations.expectLogViewerState(/start-owned automation callback verified/i);
});
