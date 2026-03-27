import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import { components } from "../../convex/_generated/api";
import {
  automationConfigSummaryFields,
  automationConfigVersionViewFields,
  automationViewFields,
} from "../../convex/automations_shared";
import {
  AUTOMATION_STATUS,
  DEFAULT_ACTION_BEHAVIOR,
  POLICY_MODE,
  SUBSCRIPTION_STATUS,
  SUBSCRIPTION_TIER,
  WORKSPACE_STATUS,
} from "../../convex/domain_constants";
import { createConvexTestHarness } from "./harness";

const refs = {
  seedUserOrg: makeFunctionReference<"mutation">("mcp:seedUserOrg"),
  createAutomation: makeFunctionReference<"mutation">("automations:createAutomation"),
  updateAutomationConfig: makeFunctionReference<"mutation">("automations:updateAutomationConfig"),
  updateAutomationMeta: makeFunctionReference<"mutation">("automations:updateAutomationMeta"),
  getAutomation: makeFunctionReference<"query">("automations:getAutomation"),
  listAutomations: makeFunctionReference<"query">("automations:listAutomations"),
  getConfigVersion: makeFunctionReference<"query">("automations:getConfigVersion"),
  listConfigVersions: makeFunctionReference<"query">("automations:listConfigVersions"),
};

const expectExactKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
  expect(Object.keys(value).sort()).toEqual([...keys].sort());
  expect(value).not.toHaveProperty("_id");
  expect(value).not.toHaveProperty("_creationTime");
};

describe("automation public view contracts", () => {
  it("returns only projected public fields for dashboard-facing automation mutations and queries", async () => {
    const t = createConvexTestHarness();
    const userId = "usr_automation_public_view";
    const email = "automation-public-view@example.com";
    const name = "Automation Public View";
    const orgId = await t.mutation(refs.seedUserOrg, {
      userId,
      email,
      name,
    });
    const authUserId = await t.run(async (ctx) => {
      const user = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "user",
        where: [{ field: "email", value: email }],
      })) as { _id?: string } | null;
      return user?._id ?? null;
    });
    expect(authUserId).toBeTruthy();
    const authT = t.withIdentity({
      subject: authUserId!,
      email,
      name,
      activeOrganizationId: orgId,
    });
    const workspaceId = "workspace_automation_public_view";
    const now = new Date().toISOString();

    await t.run(async (ctx) => {
      await ctx.db.insert("subscriptions", {
        id: "sub_automation_public_view",
        org_id: orgId,
        tier: SUBSCRIPTION_TIER.free,
        status: SUBSCRIPTION_STATUS.active,
        stripe_customer_id: null,
        stripe_subscription_id: null,
        current_period_start: now,
        current_period_end: new Date(Date.now() + 60_000).toISOString(),
        created_at: now,
        updated_at: now,
      });

      await ctx.db.insert("workspaces", {
        id: workspaceId,
        org_id: orgId,
        slug: "automation-public-view-workspace",
        name: "automation-public-view-workspace",
        status: WORKSPACE_STATUS.active,
        policy_mode: POLICY_MODE.manualOnly,
        default_action_behavior: DEFAULT_ACTION_BEHAVIOR.requireApproval,
        code_mode_enabled: true,
        created_at: now,
        automation_count: 0,
      });

      await ctx.db.insert("org_ai_keys", {
        id: "oaik_public_view_openai_byok",
        org_id: orgId,
        provider: "openai",
        key_mode: "byok",
        encrypted_key: "keppo-v1.fakeiv.fakecipher",
        credential_kind: "secret",
        key_hint: "...view",
        key_version: 1,
        is_active: true,
        subject_email: null,
        account_id: null,
        token_expires_at: null,
        last_refreshed_at: null,
        last_validated_at: null,
        created_by: userId,
        created_at: now,
        updated_at: now,
      });
    });

    const created = await authT.mutation(refs.createAutomation, {
      workspace_id: workspaceId,
      name: "Public Contract Automation",
      description: "Covers public return shapes",
      mermaid_content: "flowchart TD\nA-->B",
      trigger_type: "manual",
      runner_type: "chatgpt_codex",
      ai_model_provider: "openai",
      ai_model_name: "gpt-5",
      prompt: "Summarize new tickets.",
      network_access: "mcp_only",
    });

    expectExactKeys(created.automation, automationViewFields);
    expectExactKeys(created.config_version, automationConfigVersionViewFields);
    expect(created.automation.current_config_version_id).toBe(created.config_version.id);
    expect(created.automation.mermaid_prompt_hash).toMatch(/^[a-f0-9]{8}$/);

    const fetched = await authT.query(refs.getAutomation, {
      automation_id: created.automation.id,
      workspace_id: workspaceId,
    });
    expect(fetched).not.toBeNull();
    expectExactKeys(fetched!.automation, automationViewFields);
    expectExactKeys(fetched!.current_config_version!, automationConfigVersionViewFields);

    const listed = await authT.query(refs.listAutomations, {
      workspace_id: workspaceId,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(listed.page).toHaveLength(1);
    expectExactKeys(listed.page[0]!.automation, automationViewFields);
    expectExactKeys(listed.page[0]!.current_config_version!, automationConfigSummaryFields);

    const updated = await authT.mutation(refs.updateAutomationConfig, {
      automation_id: created.automation.id,
      change_summary: "Switch to scheduled follow-up",
      trigger_type: "schedule",
      schedule_cron: "0 * * * *",
      runner_type: "chatgpt_codex",
      ai_model_provider: "openai",
      ai_model_name: "gpt-5",
      prompt: "Check for escalations hourly.",
      network_access: "mcp_and_web",
    });
    expectExactKeys(updated.automation, automationViewFields);
    expectExactKeys(updated.config_version, automationConfigVersionViewFields);

    const noOpMeta = await authT.mutation(refs.updateAutomationMeta, {
      automation_id: created.automation.id,
    });
    expectExactKeys(noOpMeta, automationViewFields);

    const updatedMeta = await authT.mutation(refs.updateAutomationMeta, {
      automation_id: created.automation.id,
      mermaid_content: "flowchart TD\nB-->C",
    });
    expectExactKeys(updatedMeta, automationViewFields);
    expect(updatedMeta.mermaid_content).toBe("flowchart TD\nB-->C");
    expect(updatedMeta.mermaid_prompt_hash).toBeTruthy();

    const currentVersion = await authT.query(refs.getConfigVersion, {
      config_version_id: updated.config_version.id,
    });
    expect(currentVersion).not.toBeNull();
    expectExactKeys(currentVersion!, automationConfigVersionViewFields);

    const versions = await authT.query(refs.listConfigVersions, {
      automation_id: created.automation.id,
    });
    expect(versions).toHaveLength(2);
    for (const version of versions) {
      expectExactKeys(version, automationConfigVersionViewFields);
    }

    expect(updated.config_version.id).not.toBe(created.config_version.id);
    expect(updated.config_version.version_number).toBe(2);
    expect(noOpMeta.status).toBe(AUTOMATION_STATUS.active);
  });

  it("allows creating automations for free-tier orgs without an API key", async () => {
    const t = createConvexTestHarness();
    const userId = "usr_bundled_runtime_guard";
    const email = "bundled-runtime-guard@example.com";
    const name = "Bundled Runtime Guard";
    const orgId = await t.mutation(refs.seedUserOrg, {
      userId,
      email,
      name,
    });
    const authUserId = await t.run(async (ctx) => {
      const user = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "user",
        where: [{ field: "email", value: email }],
      })) as { _id?: string } | null;
      return user?._id ?? null;
    });
    const authT = t.withIdentity({
      subject: authUserId!,
      email,
      name,
      activeOrganizationId: orgId,
    });
    const workspaceId = "workspace_bundled_runtime_guard";
    const now = new Date().toISOString();

    await t.run(async (ctx) => {
      await ctx.db.insert("subscriptions", {
        id: "sub_bundled_runtime_guard",
        org_id: orgId,
        tier: SUBSCRIPTION_TIER.free,
        status: SUBSCRIPTION_STATUS.active,
        stripe_customer_id: null,
        stripe_subscription_id: null,
        current_period_start: now,
        current_period_end: new Date(Date.now() + 60_000).toISOString(),
        created_at: now,
        updated_at: now,
      });

      await ctx.db.insert("workspaces", {
        id: workspaceId,
        org_id: orgId,
        slug: "bundled-runtime-guard-workspace",
        name: "bundled-runtime-guard-workspace",
        status: WORKSPACE_STATUS.active,
        policy_mode: POLICY_MODE.manualOnly,
        default_action_behavior: DEFAULT_ACTION_BEHAVIOR.requireApproval,
        code_mode_enabled: true,
        created_at: now,
        automation_count: 0,
      });
    });

    const created = await authT.mutation(refs.createAutomation, {
      workspace_id: workspaceId,
      name: "Free tier can create",
      description: "Creation allowed without API key; execution blocked at run time",
      trigger_type: "manual",
      runner_type: "chatgpt_codex",
      ai_model_provider: "openai",
      ai_model_name: "gpt-5",
      prompt: "Summarize new tickets.",
      network_access: "mcp_only",
    });
    expect(created.automation.id).toBeTruthy();
    expect(created.automation.status).toBe(AUTOMATION_STATUS.active);
  });
});
