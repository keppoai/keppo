import { components } from "./_generated/api";
import type { Doc, Id, TableNames } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { isActiveStripeSubscriptionStatus } from "@keppo/shared/billing-contracts";
import { DEAD_LETTER_SOURCE, RUN_STATUS } from "./domain_constants";

const CASCADE_BATCH_SIZE = 64;
const AUTH_DELETE_PAGE_SIZE = 128;

type CascadeDoc = {
  _id: Id<TableNames>;
};

type BetterAuthModel =
  | "account"
  | "invitation"
  | "member"
  | "organization"
  | "session"
  | "user"
  | "verification";

const deleteRowsInBatches = async <TRow extends CascadeDoc>(
  ctx: MutationCtx,
  loadBatch: (limit: number) => Promise<ReadonlyArray<TRow>>,
): Promise<void> => {
  for (;;) {
    const batch = await loadBatch(CASCADE_BATCH_SIZE);
    if (batch.length === 0) {
      break;
    }
    for (const row of batch) {
      await ctx.db.delete(row._id);
    }
    if (batch.length < CASCADE_BATCH_SIZE) {
      break;
    }
  }
};

const deleteBetterAuthRows = async (
  ctx: MutationCtx,
  model: BetterAuthModel,
  where: Array<{ field: string; value: string; operator?: "eq" }>,
): Promise<void> => {
  for (;;) {
    const result = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model,
      where,
      paginationOpts: {
        numItems: AUTH_DELETE_PAGE_SIZE,
        cursor: null,
      },
    })) as { page: Array<{ _id: string }>; isDone: boolean };

    if (result.page.length === 0) {
      break;
    }

    for (let index = 0; index < result.page.length; index += 16) {
      const deleteBatch = result.page.slice(index, index + 16);
      await Promise.all(
        deleteBatch.map(async (row) => {
          await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
            input: {
              model,
              where: [{ field: "_id", operator: "eq", value: row._id }],
            },
          });
        }),
      );
    }

    if (result.page.length < AUTH_DELETE_PAGE_SIZE || result.isDone) {
      break;
    }
  }
};

const runDeleteTasksInGroups = async (
  tasks: ReadonlyArray<() => Promise<void>>,
  groupSize: number,
): Promise<void> => {
  for (let index = 0; index < tasks.length; index += groupSize) {
    await Promise.all(tasks.slice(index, index + groupSize).map(async (task) => await task()));
  }
};

const deleteDeadLetterEntriesForNotificationEvent = async (
  ctx: MutationCtx,
  notificationEventId: string,
): Promise<void> => {
  await deleteRowsInBatches(ctx, (limit) =>
    ctx.db
      .query("dead_letter_queue")
      .withIndex("by_source", (q) =>
        q
          .eq("source_table", DEAD_LETTER_SOURCE.notificationEvents)
          .eq("source_id", notificationEventId),
      )
      .take(limit),
  );
};

const deleteNotificationEvent = async (
  ctx: MutationCtx,
  event: Doc<"notification_events">,
): Promise<void> => {
  await deleteDeadLetterEntriesForNotificationEvent(ctx, event.id);
  await ctx.db.delete(event._id);
};

const deleteNotificationEventsByAction = async (
  ctx: MutationCtx,
  actionId: string,
): Promise<void> => {
  for (;;) {
    const batch = await ctx.db
      .query("notification_events")
      .withIndex("by_action", (q) => q.eq("action_id", actionId))
      .take(CASCADE_BATCH_SIZE);
    if (batch.length === 0) {
      break;
    }
    for (const event of batch) {
      await deleteNotificationEvent(ctx, event);
    }
    if (batch.length < CASCADE_BATCH_SIZE) {
      break;
    }
  }
};

const deleteNotificationEventsByEndpoint = async (
  ctx: MutationCtx,
  endpointId: string,
): Promise<void> => {
  for (;;) {
    const batch = await ctx.db
      .query("notification_events")
      .withIndex("by_endpoint", (q) => q.eq("endpoint_id", endpointId))
      .take(CASCADE_BATCH_SIZE);
    if (batch.length === 0) {
      break;
    }
    for (const event of batch) {
      await deleteNotificationEvent(ctx, event);
    }
    if (batch.length < CASCADE_BATCH_SIZE) {
      break;
    }
  }
};

const deleteNotificationEventsByOrg = async (ctx: MutationCtx, orgId: string): Promise<void> => {
  for (;;) {
    const batch = await ctx.db
      .query("notification_events")
      .withIndex("by_org_created", (q) => q.eq("org_id", orgId))
      .take(CASCADE_BATCH_SIZE);
    if (batch.length === 0) {
      break;
    }
    for (const event of batch) {
      await deleteNotificationEvent(ctx, event);
    }
    if (batch.length < CASCADE_BATCH_SIZE) {
      break;
    }
  }
};

const deleteNotificationEndpoint = async (
  ctx: MutationCtx,
  endpoint: Doc<"notification_endpoints">,
): Promise<void> => {
  await deleteNotificationEventsByEndpoint(ctx, endpoint.id);
  await ctx.db.delete(endpoint._id);
};

const deleteAutomationRun = async (
  ctx: MutationCtx,
  run: Doc<"automation_runs">,
): Promise<void> => {
  await deleteRowsInBatches(ctx, (limit) =>
    ctx.db
      .query("automation_run_logs")
      .withIndex("by_run_seq", (q) => q.eq("automation_run_id", run.id))
      .take(limit),
  );

  for (;;) {
    const actionBatch = await ctx.db
      .query("actions")
      .withIndex("by_automation_run", (q) => q.eq("automation_run_id", run.id))
      .take(CASCADE_BATCH_SIZE);
    if (actionBatch.length === 0) {
      break;
    }

    for (const action of actionBatch) {
      await Promise.all([
        deleteRowsInBatches(ctx, (limit) =>
          ctx.db
            .query("approvals")
            .withIndex("by_action", (q) => q.eq("action_id", action.id))
            .take(limit),
        ),
        deleteRowsInBatches(ctx, (limit) =>
          ctx.db
            .query("policy_decisions")
            .withIndex("by_action", (q) => q.eq("action_id", action.id))
            .take(limit),
        ),
        deleteRowsInBatches(ctx, (limit) =>
          ctx.db
            .query("cel_rule_matches")
            .withIndex("by_action", (q) => q.eq("action_id", action.id))
            .take(limit),
        ),
        deleteRowsInBatches(ctx, (limit) =>
          ctx.db
            .query("poll_trackers")
            .withIndex("by_action_credential", (q) => q.eq("action_id", action.id))
            .take(limit),
        ),
        deleteNotificationEventsByAction(ctx, action.id),
      ]);
      await ctx.db.delete(action._id);
    }

    if (actionBatch.length < CASCADE_BATCH_SIZE) {
      break;
    }
  }

  await deleteRowsInBatches(ctx, (limit) =>
    ctx.db
      .query("tool_calls")
      .withIndex("by_automation_run", (q) => q.eq("automation_run_id", run.id))
      .take(limit),
  );

  await deleteRowsInBatches(ctx, (limit) =>
    ctx.db
      .query("sensitive_blobs")
      .withIndex("by_ref_table_ref_id", (q) =>
        q.eq("ref_table", "automation_runs").eq("ref_id", run.id),
      )
      .take(limit),
  );

  if (run.log_storage_id) {
    await ctx.storage.delete(run.log_storage_id);
  }
  if (run.session_trace_storage_id) {
    await ctx.storage.delete(run.session_trace_storage_id);
  }

  await ctx.db.delete(run._id);
};

const deleteAutomation = async (
  ctx: MutationCtx,
  automation: Doc<"automations">,
): Promise<void> => {
  await deleteRowsInBatches(ctx, (limit) =>
    ctx.db
      .query("automation_trigger_events")
      .withIndex("by_automation", (q) => q.eq("automation_id", automation.id))
      .take(limit),
  );

  await deleteRowsInBatches(ctx, (limit) =>
    ctx.db
      .query("automation_config_versions")
      .withIndex("by_automation", (q) => q.eq("automation_id", automation.id))
      .take(limit),
  );

  for (;;) {
    const runBatch = await ctx.db
      .query("automation_runs")
      .withIndex("by_automation", (q) => q.eq("automation_id", automation.id))
      .take(CASCADE_BATCH_SIZE);
    if (runBatch.length === 0) {
      break;
    }
    for (const run of runBatch) {
      await deleteAutomationRun(ctx, run);
    }
    if (runBatch.length < CASCADE_BATCH_SIZE) {
      break;
    }
  }

  await ctx.db.delete(automation._id);
};

const deleteIntegration = async (
  ctx: MutationCtx,
  integration: Doc<"integrations">,
): Promise<void> => {
  for (;;) {
    const accountBatch = await ctx.db
      .query("integration_accounts")
      .withIndex("by_integration", (q) => q.eq("integration_id", integration.id))
      .take(CASCADE_BATCH_SIZE);
    if (accountBatch.length === 0) {
      break;
    }
    for (const account of accountBatch) {
      await deleteRowsInBatches(ctx, (limit) =>
        ctx.db
          .query("integration_credentials")
          .withIndex("by_integration_account", (q) => q.eq("integration_account_id", account.id))
          .take(limit),
      );
      await ctx.db.delete(account._id);
    }
    if (accountBatch.length < CASCADE_BATCH_SIZE) {
      break;
    }
  }

  await ctx.db.delete(integration._id);
};

const deleteCustomMcpServer = async (
  ctx: MutationCtx,
  server: Doc<"custom_mcp_servers">,
): Promise<void> => {
  await deleteRowsInBatches(ctx, (limit) =>
    ctx.db
      .query("workspace_custom_servers")
      .withIndex("by_server", (q) => q.eq("server_id", server.id))
      .take(limit),
  );
  await deleteRowsInBatches(ctx, (limit) =>
    ctx.db
      .query("custom_mcp_tools")
      .withIndex("by_server", (q) => q.eq("server_id", server.id))
      .take(limit),
  );
  await ctx.db.delete(server._id);
};

const deleteWorkspace = async (ctx: MutationCtx, workspace: Doc<"workspaces">): Promise<void> => {
  await deleteRowsInBatches(ctx, (limit) =>
    ctx.db
      .query("workspace_integrations")
      .withIndex("by_workspace", (q) => q.eq("workspace_id", workspace.id))
      .take(limit),
  );
  await deleteRowsInBatches(ctx, (limit) =>
    ctx.db
      .query("workspace_custom_servers")
      .withIndex("by_workspace", (q) => q.eq("workspace_id", workspace.id))
      .take(limit),
  );
  await deleteRowsInBatches(ctx, (limit) =>
    ctx.db
      .query("credential_auth_failures")
      .withIndex("by_workspace_locked", (q) => q.eq("workspace_id", workspace.id))
      .take(limit),
  );

  for (;;) {
    const credentialBatch = await ctx.db
      .query("workspace_credentials")
      .withIndex("by_workspace", (q) => q.eq("workspace_id", workspace.id))
      .take(CASCADE_BATCH_SIZE);
    if (credentialBatch.length === 0) {
      break;
    }
    for (const credential of credentialBatch) {
      await deleteRowsInBatches(ctx, (limit) =>
        ctx.db
          .query("credential_usage_observations")
          .withIndex("by_credential", (q) => q.eq("credential_id", credential.id))
          .take(limit),
      );
      await ctx.db.delete(credential._id);
    }
    if (credentialBatch.length < CASCADE_BATCH_SIZE) {
      break;
    }
  }

  for (;;) {
    const rulesBatch = await ctx.db
      .query("cel_rules")
      .withIndex("by_workspace", (q) => q.eq("workspace_id", workspace.id))
      .take(CASCADE_BATCH_SIZE);
    if (rulesBatch.length === 0) {
      break;
    }
    for (const rule of rulesBatch) {
      await deleteRowsInBatches(ctx, (limit) =>
        ctx.db
          .query("cel_rule_matches")
          .withIndex("by_cel_rule", (q) => q.eq("cel_rule_id", rule.id))
          .take(limit),
      );
      await ctx.db.delete(rule._id);
    }
    if (rulesBatch.length < CASCADE_BATCH_SIZE) {
      break;
    }
  }

  await deleteRowsInBatches(ctx, (limit) =>
    ctx.db
      .query("tool_auto_approvals")
      .withIndex("by_workspace", (q) => q.eq("workspace_id", workspace.id))
      .take(limit),
  );
  await deleteRowsInBatches(ctx, (limit) =>
    ctx.db
      .query("policies")
      .withIndex("by_workspace", (q) => q.eq("workspace_id", workspace.id))
      .take(limit),
  );

  for (;;) {
    const automationBatch = await ctx.db
      .query("automations")
      .withIndex("by_workspace", (q) => q.eq("workspace_id", workspace.id))
      .take(CASCADE_BATCH_SIZE);
    if (automationBatch.length === 0) {
      break;
    }
    for (const automation of automationBatch) {
      await deleteAutomation(ctx, automation);
    }
    if (automationBatch.length < CASCADE_BATCH_SIZE) {
      break;
    }
  }

  for (;;) {
    const orphanRunBatch = await ctx.db
      .query("automation_runs")
      .withIndex("by_workspace", (q) => q.eq("workspace_id", workspace.id))
      .take(CASCADE_BATCH_SIZE);
    if (orphanRunBatch.length === 0) {
      break;
    }
    for (const run of orphanRunBatch) {
      await deleteAutomationRun(ctx, run);
    }
    if (orphanRunBatch.length < CASCADE_BATCH_SIZE) {
      break;
    }
  }

  await ctx.db.delete(workspace._id);
};

const assertNoActiveStripeSubscription = async (ctx: MutationCtx, orgId: string): Promise<void> => {
  const rows = await ctx.db
    .query("subscriptions")
    .withIndex("by_org", (q) => q.eq("org_id", orgId))
    .collect();
  for (const subscription of rows) {
    if (
      typeof subscription.stripe_subscription_id === "string" &&
      subscription.stripe_subscription_id.length > 0 &&
      isActiveStripeSubscriptionStatus(subscription.status)
    ) {
      throw new Error(
        "Cancel the active Stripe subscription before permanently deleting this organization.",
      );
    }
  }
};

export const hardDeleteOrganizationCascade = async (
  ctx: MutationCtx,
  orgId: string,
): Promise<void> => {
  await assertNoActiveStripeSubscription(ctx, orgId);

  for (;;) {
    const endpointBatch = await ctx.db
      .query("notification_endpoints")
      .withIndex("by_org", (q) => q.eq("org_id", orgId))
      .take(CASCADE_BATCH_SIZE);
    if (endpointBatch.length === 0) {
      break;
    }
    for (const endpoint of endpointBatch) {
      await deleteNotificationEndpoint(ctx, endpoint);
    }
    if (endpointBatch.length < CASCADE_BATCH_SIZE) {
      break;
    }
  }

  for (;;) {
    const serverBatch = await ctx.db
      .query("custom_mcp_servers")
      .withIndex("by_org", (q) => q.eq("org_id", orgId))
      .take(CASCADE_BATCH_SIZE);
    if (serverBatch.length === 0) {
      break;
    }
    for (const server of serverBatch) {
      await deleteCustomMcpServer(ctx, server);
    }
    if (serverBatch.length < CASCADE_BATCH_SIZE) {
      break;
    }
  }

  for (;;) {
    const integrationBatch = await ctx.db
      .query("integrations")
      .withIndex("by_org", (q) => q.eq("org_id", orgId))
      .take(CASCADE_BATCH_SIZE);
    if (integrationBatch.length === 0) {
      break;
    }
    for (const integration of integrationBatch) {
      await deleteIntegration(ctx, integration);
    }
    if (integrationBatch.length < CASCADE_BATCH_SIZE) {
      break;
    }
  }

  for (;;) {
    const workspaceBatch = await ctx.db
      .query("workspaces")
      .withIndex("by_org", (q) => q.eq("org_id", orgId))
      .take(CASCADE_BATCH_SIZE);
    if (workspaceBatch.length === 0) {
      break;
    }
    for (const workspace of workspaceBatch) {
      await deleteWorkspace(ctx, workspace);
    }
    if (workspaceBatch.length < CASCADE_BATCH_SIZE) {
      break;
    }
  }

  for (;;) {
    const automationBatch = await ctx.db
      .query("automations")
      .withIndex("by_org", (q) => q.eq("org_id", orgId))
      .take(CASCADE_BATCH_SIZE);
    if (automationBatch.length === 0) {
      break;
    }
    for (const automation of automationBatch) {
      await deleteAutomation(ctx, automation);
    }
    if (automationBatch.length < CASCADE_BATCH_SIZE) {
      break;
    }
  }

  for (;;) {
    const orphanRunBatch = await ctx.db
      .query("automation_runs")
      .withIndex("by_org_status_created", (q) =>
        q.eq("org_id", orgId).eq("status", RUN_STATUS.active),
      )
      .take(CASCADE_BATCH_SIZE);
    if (orphanRunBatch.length === 0) {
      break;
    }
    for (const run of orphanRunBatch) {
      await deleteAutomationRun(ctx, run);
    }
    if (orphanRunBatch.length < CASCADE_BATCH_SIZE) {
      break;
    }
  }
  for (const status of [RUN_STATUS.ended, RUN_STATUS.timedOut] as const) {
    for (;;) {
      const runBatch = await ctx.db
        .query("automation_runs")
        .withIndex("by_org_status_created", (q) => q.eq("org_id", orgId).eq("status", status))
        .take(CASCADE_BATCH_SIZE);
      if (runBatch.length === 0) {
        break;
      }
      for (const run of runBatch) {
        await deleteAutomationRun(ctx, run);
      }
      if (runBatch.length < CASCADE_BATCH_SIZE) {
        break;
      }
    }
  }

  await deleteNotificationEventsByOrg(ctx, orgId);

  await runDeleteTasksInGroups(
    [
      () =>
        deleteRowsInBatches(ctx, (limit) =>
          ctx.db
            .query("invites")
            .withIndex("by_org", (q) => q.eq("org_id", orgId))
            .take(limit),
        ),
      () =>
        deleteRowsInBatches(ctx, (limit) =>
          ctx.db
            .query("e2e_invite_tokens")
            .withIndex("by_org_email", (q) => q.eq("org_id", orgId))
            .take(limit),
        ),
      () =>
        deleteRowsInBatches(ctx, (limit) =>
          ctx.db
            .query("invite_code_redemptions")
            .withIndex("by_org", (q) => q.eq("org_id", orgId))
            .take(limit),
        ),
      () =>
        deleteRowsInBatches(ctx, (limit) =>
          ctx.db
            .query("usage_meters")
            .withIndex("by_org_period", (q) => q.eq("org_id", orgId))
            .take(limit),
        ),
      () =>
        deleteRowsInBatches(ctx, (limit) =>
          ctx.db
            .query("subscriptions")
            .withIndex("by_org", (q) => q.eq("org_id", orgId))
            .take(limit),
        ),
      () =>
        deleteRowsInBatches(ctx, (limit) =>
          ctx.db
            .query("org_suspensions")
            .withIndex("by_org", (q) => q.eq("org_id", orgId))
            .take(limit),
        ),
      () =>
        deleteRowsInBatches(ctx, (limit) =>
          ctx.db
            .query("abuse_flags")
            .withIndex("by_org", (q) => q.eq("org_id", orgId))
            .take(limit),
        ),
      () =>
        deleteRowsInBatches(ctx, (limit) =>
          ctx.db
            .query("ai_credits")
            .withIndex("by_org_period", (q) => q.eq("org_id", orgId))
            .take(limit),
        ),
      () =>
        deleteRowsInBatches(ctx, (limit) =>
          ctx.db
            .query("ai_credit_purchases")
            .withIndex("by_org", (q) => q.eq("org_id", orgId))
            .take(limit),
        ),
      () =>
        deleteRowsInBatches(ctx, (limit) =>
          ctx.db
            .query("automation_run_topups")
            .withIndex("by_org_period", (q) => q.eq("org_id", orgId))
            .take(limit),
        ),
      () =>
        deleteRowsInBatches(ctx, (limit) =>
          ctx.db
            .query("automation_run_topup_purchases")
            .withIndex("by_org", (q) => q.eq("org_id", orgId))
            .take(limit),
        ),
      () =>
        deleteRowsInBatches(ctx, (limit) =>
          ctx.db
            .query("org_ai_keys")
            .withIndex("by_org", (q) => q.eq("org_id", orgId))
            .take(limit),
        ),
      () =>
        deleteRowsInBatches(ctx, (limit) =>
          ctx.db
            .query("dogfood_orgs")
            .withIndex("by_org", (q) => q.eq("org_id", orgId))
            .take(limit),
        ),
      () =>
        deleteRowsInBatches(ctx, (limit) =>
          ctx.db
            .query("provider_metrics")
            .withIndex("by_org_created", (q) => q.eq("org_id", orgId))
            .take(limit),
        ),
      () =>
        deleteRowsInBatches(ctx, (limit) =>
          ctx.db
            .query("audit_events")
            .withIndex("by_org", (q) => q.eq("org_id", orgId))
            .take(limit),
        ),
      () =>
        deleteRowsInBatches(ctx, (limit) =>
          ctx.db
            .query("sensitive_blobs")
            .withIndex("by_org", (q) => q.eq("org_id", orgId))
            .take(limit),
        ),
      () =>
        deleteRowsInBatches(ctx, (limit) =>
          ctx.db
            .query("retention_policies")
            .withIndex("by_org", (q) => q.eq("org_id", orgId))
            .take(limit),
        ),
    ],
    4,
  );

  await deleteBetterAuthRows(ctx, "invitation", [{ field: "organizationId", value: orgId }]);
  await deleteBetterAuthRows(ctx, "member", [{ field: "organizationId", value: orgId }]);
  await deleteBetterAuthRows(ctx, "session", [{ field: "activeOrganizationId", value: orgId }]);
  await deleteBetterAuthRows(ctx, "organization", [{ field: "_id", value: orgId, operator: "eq" }]);
};

export const hardDeleteUserCascade = async (
  ctx: MutationCtx,
  params: {
    userId: string;
    organizationIds: readonly string[];
    email: string;
  },
): Promise<void> => {
  for (const orgId of params.organizationIds) {
    await hardDeleteOrganizationCascade(ctx, orgId);
  }

  for (;;) {
    const endpointBatch = await ctx.db
      .query("notification_endpoints")
      .withIndex("by_user", (q) => q.eq("user_id", params.userId))
      .take(CASCADE_BATCH_SIZE);
    if (endpointBatch.length === 0) {
      break;
    }
    for (const endpoint of endpointBatch) {
      await deleteNotificationEndpoint(ctx, endpoint);
    }
    if (endpointBatch.length < CASCADE_BATCH_SIZE) {
      break;
    }
  }

  await deleteBetterAuthRows(ctx, "verification", [{ field: "identifier", value: params.email }]);
  await deleteBetterAuthRows(ctx, "session", [{ field: "userId", value: params.userId }]);
  await deleteBetterAuthRows(ctx, "account", [{ field: "userId", value: params.userId }]);
  await deleteBetterAuthRows(ctx, "member", [{ field: "userId", value: params.userId }]);
  await deleteBetterAuthRows(ctx, "user", [{ field: "_id", value: params.userId, operator: "eq" }]);
};
