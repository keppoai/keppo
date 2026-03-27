import { test, expect } from "../../fixtures/golden.fixture";
import { createConvexAdmin } from "../../helpers/convex-admin";

test("audit filters and export stay scoped to filtered rows", async ({ app, auth, pages }) => {
  const admin = createConvexAdmin(app);
  const seeded = await auth.seedWorkspace("audit-filter-export", {
    subscriptionTier: "starter",
  });

  await admin.createAuditEvent({
    orgId: seeded.orgId,
    actorType: "user",
    actorId: `usr_${app.namespace}_focus`,
    eventType: "integration.connected",
    payload: {
      provider: "google",
      action_id: `act_${app.namespace}_focus`,
      workspace_id: seeded.workspaceId,
      label: "kept-row",
    },
  });
  await admin.createAuditEvent({
    orgId: seeded.orgId,
    actorType: "system",
    actorId: `system_${app.namespace}_other`,
    eventType: "rule.created",
    payload: {
      provider: "github",
      action_id: `act_${app.namespace}_other`,
      workspace_id: seeded.workspaceId,
      label: "filtered-out-row",
    },
  });
  await admin.createAuditEvent({
    orgId: seeded.orgId,
    actorType: "worker",
    actorId: `worker_${app.namespace}_other`,
    eventType: "action.created",
    payload: {
      provider: "slack",
      action_id: `act_${app.namespace}_another`,
      workspace_id: seeded.workspaceId,
      label: "filtered-out-row-2",
    },
  });

  await pages.login.login();
  await pages.audit.open();
  await pages.audit.expectLoaded();

  await pages.audit.setActorFilter(`${app.namespace}_focus`);
  await pages.audit.setEventTypeFilter("integration.connected");
  await pages.audit.setProviderFilter("google");
  await pages.audit.setActionIdFilter(`act_${app.namespace}_focus`);

  await pages.audit.expectResultsCount(1);
  await pages.audit.expectRowVisible(/integration\.connected/i);
  await pages.audit.expectNoRowVisible(/filtered-out-row/i);

  const csvExport = await pages.audit.captureExport("csv");
  expect(csvExport.download).toBe("audit.csv");
  expect(csvExport.content).toContain(`act_${app.namespace}_focus`);
  expect(csvExport.content).not.toContain(`act_${app.namespace}_other`);
  expect(csvExport.content).not.toContain(`act_${app.namespace}_another`);

  const jsonlExport = await pages.audit.captureExport("jsonl");
  expect(jsonlExport.download).toBe("audit.jsonl");
  const lines = jsonlExport.content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
    actor_id: `usr_${app.namespace}_focus`,
    event_type: "integration.connected",
    payload: {
      provider: "google",
      action_id: `act_${app.namespace}_focus`,
    },
  });
});
