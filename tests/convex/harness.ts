import { convexTest } from "convex-test";
import {
  AUTOMATION_STATUS,
  DEFAULT_ACTION_BEHAVIOR,
  POLICY_MODE,
  SUBSCRIPTION_STATUS,
  SUBSCRIPTION_TIER,
  WORKSPACE_STATUS,
} from "../../convex/domain_constants";
import schema from "../../convex/schema";
import betterAuthSchema from "../../convex/betterAuth/schema";

const modules = import.meta.glob(["../../convex/**/*.{ts,js}", "!../../convex/tests/**/*.ts"]);

process.env.BETTER_AUTH_SECRET ??= "better-auth-secret-for-convex-tests-0123456789";
process.env.KEPPO_URL ??= "http://localhost:3000";

export const createConvexTestHarness = () => {
  const t = convexTest(schema, modules);
  t.registerComponent(
    "betterAuth",
    betterAuthSchema,
    import.meta.glob("../../convex/betterAuth/**/*.{ts,js}"),
  );
  return t;
};

const currentMonthlyPeriod = () => {
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const periodEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  ).toISOString();
  return { periodStart, periodEnd };
};

export const seedAutomationFixture = async (
  t: ReturnType<typeof createConvexTestHarness>,
  orgId: string,
  options: {
    hasActiveAiKey?: boolean;
  } = {},
) => {
  const now = new Date().toISOString();
  const period = currentMonthlyPeriod();
  const workspaceId = `workspace_${orgId}`;
  const automationId = `automation_${orgId}`;
  const configVersionId = `acv_${orgId}`;
  const hasActiveAiKey = options.hasActiveAiKey ?? true;

  await t.run(async (ctx) => {
    await ctx.db.insert("subscriptions", {
      id: `sub_${orgId}`,
      org_id: orgId,
      tier: SUBSCRIPTION_TIER.free,
      status: SUBSCRIPTION_STATUS.active,
      stripe_customer_id: null,
      stripe_subscription_id: null,
      workspace_count: 1,
      current_period_start: period.periodStart,
      current_period_end: period.periodEnd,
      created_at: now,
      updated_at: now,
    });

    await ctx.db.insert("workspaces", {
      id: workspaceId,
      org_id: orgId,
      slug: `slug-${orgId}`,
      name: `workspace-${orgId}`,
      status: WORKSPACE_STATUS.active,
      policy_mode: POLICY_MODE.manualOnly,
      default_action_behavior: DEFAULT_ACTION_BEHAVIOR.requireApproval,
      created_at: now,
      automation_count: 1,
    });

    await ctx.db.insert("automation_config_versions", {
      id: configVersionId,
      automation_id: automationId,
      version_number: 1,
      trigger_type: "schedule",
      schedule_cron: "* * * * *",
      provider_trigger: null,
      provider_trigger_migration_state: null,
      event_provider: null,
      event_type: null,
      event_predicate: null,
      runner_type: "chatgpt_codex",
      ai_model_provider: "openai",
      ai_model_name: "gpt-5",
      prompt: "Test prompt",
      network_access: "mcp_only",
      created_by: "usr_test",
      created_at: now,
      change_summary: null,
    });

    await ctx.db.insert("automations", {
      id: automationId,
      org_id: orgId,
      workspace_id: workspaceId,
      slug: `automation-${orgId}`,
      name: `automation-${orgId}`,
      description: "Automation fixture",
      status: AUTOMATION_STATUS.active,
      current_config_version_id: configVersionId,
      created_by: "usr_test",
      created_at: now,
      updated_at: now,
      next_config_version_number: 2,
    });

    if (hasActiveAiKey) {
      await ctx.db.insert("org_ai_keys", {
        id: `key_${orgId}`,
        org_id: orgId,
        provider: "openai",
        key_mode: "byok",
        encrypted_key: "encrypted-test-key",
        credential_kind: "secret",
        key_hint: "test-key",
        key_version: 1,
        is_active: true,
        subject_email: null,
        account_id: null,
        token_expires_at: null,
        last_refreshed_at: null,
        last_validated_at: now,
        created_by: "usr_test",
        created_at: now,
        updated_at: now,
      });
    }
  });

  return { workspaceId, automationId, configVersionId };
};
