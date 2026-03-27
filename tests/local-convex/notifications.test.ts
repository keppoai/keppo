import { describe, expect, it } from "vitest";
import { getTierConfig } from "../../packages/shared/src/subscriptions";
import type { DbSchema } from "../../packages/shared/src/types";
import { setUsageMeterForOrg } from "../e2e/helpers/billing-hooks";
import {
  convexUrl,
  createRandomToken,
  createMcpClient,
  createStore,
  withLocalConvexNamespace,
} from "./harness";

type Tier = "free" | "starter" | "pro";

const waitForGmailConnectorReady = async (
  callTool: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>,
): Promise<void> => {
  await expect
    .poll(
      async () => {
        try {
          await callTool("gmail.listUnread", { limit: 1 });
          return true;
        } catch {
          return false;
        }
      },
      {
        timeout: 8_000,
      },
    )
    .toBe(true);
};

const pickLatestSubscription = (
  subscriptions: DbSchema["subscriptions"],
  orgId: string,
): DbSchema["subscriptions"][number] => {
  const rows = subscriptions
    .filter((row) => row.org_id === orgId)
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  expect(rows.length).toBeGreaterThan(0);
  return rows[0]!;
};

const seedWorkspace = async (params: {
  namespace: string;
  suffix: string;
  subscriptionTier?: Tier;
  connectGoogle?: boolean;
}): Promise<{
  orgId: string;
  workspaceId: string;
  credentialSecret: string;
}> => {
  const store = createStore();
  const userToken = `${params.namespace}.${params.suffix}.${createRandomToken()}`;
  const userId = `usr_${userToken}`;
  const userEmail = `e2e+${userToken}@example.com`;
  const orgId = await store.ensurePersonalOrgForUser({
    id: userId,
    email: userEmail,
    name: "E2E User",
  });

  const subscriptionTier = params.subscriptionTier ?? "free";
  await store.setOrgSubscription({
    org_id: orgId,
    tier: subscriptionTier,
    status: "active",
  });

  const workspace = await store.createWorkspace({
    org_id: orgId,
    name: `workspace-${params.suffix}-${createRandomToken()}`,
    policy_mode: "manual_only",
    default_action_behavior: "require_approval",
  });
  const credential = await store.rotateCredential(workspace.id);

  if (params.connectGoogle) {
    await store.connectIntegration({
      org_id: orgId,
      provider: "google",
      display_name: `google-${params.suffix}`,
      scopes: [
        "gmail.readonly",
        "gmail.send",
        "gmail.modify",
        "gmail.compose",
        "gmail.settings.basic",
        "gmail.labels",
      ],
      external_account_id: `google+${userToken}@example.com`,
      access_token: "fake_gmail_access_token",
      refresh_token: "fake_gmail_refresh_token",
      credential_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      metadata: {
        e2e_namespace: params.namespace,
        provider: "google",
      },
    });
    await store.setWorkspaceIntegrations({
      workspace_id: workspace.id,
      providers: ["google"],
    });
  }

  return {
    orgId,
    workspaceId: workspace.id,
    credentialSecret: credential.secret,
  };
};

describe.sequential("Local Convex Notification Integration", { timeout: 120_000 }, () => {
  it("notification event is created for pending approvals", async () => {
    await withLocalConvexNamespace(
      "vitest.notifications",
      "approval-needed-event",
      async ({ namespace, headers }) => {
        const seeded = await seedWorkspace({
          namespace,
          suffix: "notifications-db",
          connectGoogle: true,
        });
        const store = createStore();
        await store.setToolAutoApproval({
          workspace_id: seeded.workspaceId,
          tool_name: "gmail.sendEmail",
          enabled: false,
        });

        const mcp = createMcpClient(seeded.workspaceId, seeded.credentialSecret, headers);
        try {
          await mcp.initialize();
          await waitForGmailConnectorReady((name, args) => mcp.callTool(name, args));

          const created = await mcp.callTool("gmail.sendEmail", {
            to: ["customer@example.com"],
            subject: "Need approval",
            body: "Approve this draft",
          });
          expect(created.status).toBe("approval_required");

          await expect
            .poll(async () => {
              const snapshot = await store.getDbSnapshot();
              return snapshot.notification_events.filter(
                (event) =>
                  event.org_id === seeded.orgId &&
                  event.event_type === "approval_needed" &&
                  event.channel === "in_app",
              ).length;
            })
            .toBeGreaterThan(0);
        } finally {
          await mcp.close();
        }
      },
    );
  });

  it("usage threshold notification fires when tool call count crosses 80%", async () => {
    await withLocalConvexNamespace(
      "vitest.notifications",
      "usage-threshold-warning",
      async ({ namespace, headers }) => {
        const seeded = await seedWorkspace({
          namespace,
          suffix: "notifications-usage-threshold",
          subscriptionTier: "free",
        });
        const store = createStore();
        await store.setOrgSubscription({
          org_id: seeded.orgId,
          tier: "free",
        });

        const snapshot = await store.getDbSnapshot();
        const subscription = pickLatestSubscription(snapshot.subscriptions, seeded.orgId);
        const limit = getTierConfig("free").max_tool_calls_per_month;
        const warningThreshold = Math.max(1, Math.ceil(limit * 0.8));

        await setUsageMeterForOrg({
          convexUrl,
          orgId: seeded.orgId,
          periodStart: subscription.current_period_start,
          periodEnd: subscription.current_period_end,
          toolCallCount: Math.max(0, warningThreshold - 1),
          totalToolCallTimeMs: 0,
        });

        const mcp = createMcpClient(seeded.workspaceId, seeded.credentialSecret, headers);
        try {
          await mcp.initialize();
          await mcp.callTool("keppo.list_pending_actions", {});

          await expect
            .poll(async () => {
              const after = await store.getDbSnapshot();
              return after.notification_events.filter(
                (event) =>
                  event.org_id === seeded.orgId &&
                  event.event_type === "tool_call_limit_warning" &&
                  event.channel === "in_app",
              ).length;
            })
            .toBeGreaterThan(0);
        } finally {
          await mcp.close();
        }
      },
    );
  });
});
