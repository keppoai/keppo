import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { nowIso, randomIdFor } from "./_auth";
import { mutation, query, type MutationCtx } from "./_generated/server";
import {
  automationConfigVersionValidator,
  automationValidator,
  automationWithCurrentConfigValidator,
  automationSummaryValidator,
  toAutomationConfigSummary,
  toAutomationConfigVersionView,
  toAutomationView,
} from "./automations_shared";
import { createAutomationCore } from "./automations";
import {
  AUTOMATION_STATUS,
  AUTOMATION_TRIGGER_EVENT_STATUS,
  ACTION_STATUS,
  APPROVAL_DECIDER_TYPE,
  APPROVAL_DECISION,
  DEFAULT_ACTION_BEHAVIOR,
  POLICY_MODE,
  RULE_EFFECT,
  RUN_STATUS,
  SUBSCRIPTION_STATUS,
  SUBSCRIPTION_TIER,
  TOOL_CALL_STATUS,
  WORKSPACE_STATUS,
} from "./domain_constants";
import { normalizeAutomationRunStatus } from "./automation_run_status";
import { requireE2EIdentity } from "./e2e_shared";
import { cascadeDeleteAutomationDescendants } from "./cascade";
import { slugifyWorkspaceName } from "./workspaces_shared";
import { getDefaultBillingPeriod } from "../packages/shared/src/subscriptions.js";
import { inferAutomationModelClassFromLegacyFields } from "../packages/shared/src/automations.js";
import {
  automationProviderTriggerValidator,
  automationProviderTriggerDeliveryModeValidator,
  automationStatusValidator,
  jsonRecordValidator,
  automationRunEventTypeValidator,
  automationRunLogLevelValidator,
  automationRunOutcomeSourceValidator,
  automationRunStatusValidator,
  automationTriggerEventMatchStatusValidator,
  automationTriggerEventStatusValidator,
  runTriggerTypeValidator,
  subscriptionTierValidator,
} from "./validators";
import { encryptSecretValue } from "./crypto_helpers";

const refs = {
  seedUserOrg: makeFunctionReference<"mutation">("mcp:seedUserOrg"),
};

const seededAutomationFixtureValidator = v.object({
  orgId: v.string(),
  workspaceId: v.string(),
  automationId: v.string(),
  configVersionId: v.string(),
});

const createdAutomationContractValidator = v.object({
  orgId: v.string(),
  workspaceId: v.string(),
  created: v.object({
    automation: automationValidator,
    config_version: automationConfigVersionValidator,
    warning: v.union(v.string(), v.null()),
  }),
});

const createdWorkspaceAutomationValidator = v.object({
  created: v.object({
    automation: automationValidator,
    config_version: automationConfigVersionValidator,
    warning: v.union(v.string(), v.null()),
  }),
});

const automationFixtureVersionValidator = v.object({
  id: v.string(),
  version_number: v.number(),
  prompt: v.string(),
  change_summary: v.union(v.string(), v.null()),
});

const automationFixtureStateValidator = v.object({
  automation: v.union(
    v.object({
      id: v.string(),
      current_config_version_id: v.string(),
      status: automationStatusValidator,
    }),
    v.null(),
  ),
  versions: v.array(automationFixtureVersionValidator),
});

const automationFixtureRunValidator = v.object({
  id: v.string(),
  trigger_type: runTriggerTypeValidator,
  status: v.string(),
  created_at: v.string(),
});

const automationFixtureTriggerEventValidator = v.object({
  id: v.string(),
  event_id: v.string(),
  event_type: v.string(),
  status: automationTriggerEventStatusValidator,
  match_status: v.union(automationTriggerEventMatchStatusValidator, v.null()),
  failure_reason: v.union(v.string(), v.null()),
  delivery_mode: v.union(automationProviderTriggerDeliveryModeValidator, v.null()),
  config_version_id: v.union(v.string(), v.null()),
});

const automationFixtureRunDetailValidator = v.object({
  id: v.string(),
  automation_id: v.string(),
  org_id: v.string(),
  workspace_id: v.string(),
  config_version_id: v.string(),
  trigger_type: runTriggerTypeValidator,
  status: automationRunStatusValidator,
  started_at: v.union(v.string(), v.null()),
  ended_at: v.union(v.string(), v.null()),
  error_message: v.union(v.string(), v.null()),
  sandbox_id: v.union(v.string(), v.null()),
  mcp_session_id: v.union(v.string(), v.null()),
  outcome_success: v.union(v.boolean(), v.null()),
  outcome_summary: v.union(v.string(), v.null()),
  outcome_source: v.union(automationRunOutcomeSourceValidator, v.null()),
  outcome_recorded_at: v.union(v.string(), v.null()),
  created_at: v.string(),
});

const automationFixtureRunLogLineValidator = v.object({
  seq: v.number(),
  level: automationRunLogLevelValidator,
  content: v.string(),
  timestamp: v.string(),
  event_type: v.optional(automationRunEventTypeValidator),
  event_data: v.optional(jsonRecordValidator),
});

const automationFixtureHotRunLogsValidator = v.object({
  mode: v.literal("hot"),
  lines: v.array(automationFixtureRunLogLineValidator),
});

const automationFixtureColdRunLogsValidator = v.object({
  mode: v.literal("cold"),
  storage_url: v.string(),
});

const automationFixtureExpiredRunLogsValidator = v.object({
  mode: v.literal("expired"),
});

const automationFixtureRunLogsValidator = v.union(
  automationFixtureHotRunLogsValidator,
  automationFixtureColdRunLogsValidator,
  automationFixtureExpiredRunLogsValidator,
);

const automationFixturePublicViewsValidator = v.object({
  created: v.object({
    automation: automationValidator,
    config_version: automationConfigVersionValidator,
  }),
  detail: automationWithCurrentConfigValidator,
  list_entry: automationSummaryValidator,
  versions: v.array(automationConfigVersionValidator),
});

const seededAutomationCascadeFixtureValidator = v.object({
  automationId: v.string(),
  configVersionId: v.string(),
  triggerEventId: v.string(),
  runId: v.string(),
  toolCallId: v.string(),
  actionId: v.string(),
  approvalId: v.string(),
  policyDecisionId: v.string(),
  ruleId: v.string(),
  ruleMatchId: v.string(),
  sensitiveBlobId: v.string(),
});

const automationCascadeFixtureStateValidator = v.object({
  automation: v.boolean(),
  configVersion: v.boolean(),
  triggerEvent: v.boolean(),
  run: v.boolean(),
  runLogCount: v.number(),
  toolCall: v.boolean(),
  action: v.boolean(),
  approval: v.boolean(),
  policyDecision: v.boolean(),
  rule: v.boolean(),
  ruleMatch: v.boolean(),
  sensitiveBlob: v.boolean(),
});

const seedBaseAutomationFixture = async (
  ctx: MutationCtx,
  args: {
    tier?: "free" | "starter" | "pro";
    scheduleCron?: string;
  },
): Promise<{
  orgId: string;
  workspaceId: string;
  automationId: string;
  configVersionId: string;
  userId: string;
  createdAt: string;
}> => {
  const createdAt = nowIso();
  const suffix = Math.random().toString(16).slice(2, 12);
  const workspaceId = `workspace_automation_e2e_${suffix}`;
  const userId = `usr_automation_e2e_${suffix}`;
  const tier = args.tier ?? SUBSCRIPTION_TIER.free;
  const period = getDefaultBillingPeriod(new Date());
  const orgId = (await ctx.runMutation(refs.seedUserOrg, {
    userId,
    email: `automation-e2e+${suffix}@example.com`,
    name: `Automation E2E ${suffix}`,
  })) as string;

  await ctx.db.insert("subscriptions", {
    id: randomIdFor("sub"),
    org_id: orgId,
    tier,
    status: SUBSCRIPTION_STATUS.active,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    current_period_start: period.periodStart,
    current_period_end: period.periodEnd,
    created_at: createdAt,
    updated_at: createdAt,
  });

  await ctx.db.insert("workspaces", {
    id: workspaceId,
    org_id: orgId,
    slug: slugifyWorkspaceName(`automation-workspace-${suffix}`),
    name: `automation-workspace-${suffix}`,
    status: WORKSPACE_STATUS.active,
    policy_mode: POLICY_MODE.manualOnly,
    default_action_behavior: DEFAULT_ACTION_BEHAVIOR.requireApproval,
    code_mode_enabled: true,
    created_at: createdAt,
  });
  await seedActiveByokKey(ctx, {
    orgId,
    userId,
    provider: "openai",
    createdAt,
    suffix: `automation_e2e_${suffix}`,
  });

  const configVersionId = randomIdFor("acv");
  const automationId = randomIdFor("automation");
  await ctx.db.insert("automation_config_versions", {
    id: configVersionId,
    automation_id: automationId,
    version_number: 1,
    trigger_type: "schedule",
    schedule_cron: args.scheduleCron?.trim() || "* * * * *",
    provider_trigger: null,
    provider_trigger_migration_state: null,
    event_provider: null,
    event_type: null,
    event_predicate: null,
    model_class: "auto",
    runner_type: "chatgpt_codex",
    ai_model_provider: "openai",
    ai_model_name: "gpt-5",
    prompt: "Initial prompt",
    network_access: "mcp_only",
    created_by: userId,
    created_at: createdAt,
    change_summary: null,
  });

  await ctx.db.insert("automations", {
    id: automationId,
    org_id: orgId,
    workspace_id: workspaceId,
    slug: `automation-${suffix}`,
    name: `automation-${suffix}`,
    description: "Automation fixture",
    status: AUTOMATION_STATUS.active,
    current_config_version_id: configVersionId,
    created_by: userId,
    created_at: createdAt,
    updated_at: createdAt,
  });

  return {
    orgId,
    workspaceId,
    automationId,
    configVersionId,
    userId,
    createdAt,
  };
};

const seedActiveByokKey = async (
  ctx: MutationCtx,
  params: {
    orgId: string;
    userId: string;
    provider: "openai";
    createdAt: string;
    suffix: string;
  },
): Promise<void> => {
  const encryptedKey = await encryptSecretValue(
    `sk-e2e-${params.suffix}-0123456789`,
    "integration_credentials",
  );
  await ctx.db.insert("org_ai_keys", {
    id: `oaik_${params.suffix}`,
    org_id: params.orgId,
    provider: params.provider,
    key_mode: "byok",
    encrypted_key: encryptedKey,
    credential_kind: "secret",
    key_hint: "...e2e",
    key_version: 1,
    is_active: true,
    subject_email: null,
    account_id: null,
    token_expires_at: null,
    last_refreshed_at: null,
    last_validated_at: null,
    created_by: params.userId,
    created_at: params.createdAt,
    updated_at: params.createdAt,
  });
};

export const seedAutomationFixture = mutation({
  args: {
    tier: v.optional(subscriptionTierValidator),
    scheduleCron: v.optional(v.string()),
  },
  returns: seededAutomationFixtureValidator,
  handler: async (ctx, args) => {
    await requireE2EIdentity(ctx);
    const seeded = await seedBaseAutomationFixture(ctx, args);

    return {
      orgId: seeded.orgId,
      workspaceId: seeded.workspaceId,
      automationId: seeded.automationId,
      configVersionId: seeded.configVersionId,
    };
  },
});

export const createAutomationViaContract = mutation({
  args: {
    tier: v.optional(subscriptionTierValidator),
    triggerType: v.optional(
      v.union(v.literal("manual"), v.literal("schedule"), v.literal("event")),
    ),
    scheduleCron: v.optional(v.string()),
    providerTrigger: v.optional(automationProviderTriggerValidator),
    eventProvider: v.optional(v.string()),
    eventType: v.optional(v.string()),
    eventPredicate: v.optional(v.string()),
    seedByokKey: v.optional(v.boolean()),
  },
  returns: createdAutomationContractValidator,
  handler: async (ctx, args) => {
    await requireE2EIdentity(ctx);
    const createdAt = nowIso();
    const suffix = Math.random().toString(16).slice(2, 12);
    const workspaceId = `workspace_automation_contract_${suffix}`;
    const userId = `usr_automation_contract_${suffix}`;
    const tier = args.tier ?? SUBSCRIPTION_TIER.free;
    const period = getDefaultBillingPeriod(new Date());
    const orgId = (await ctx.runMutation(refs.seedUserOrg, {
      userId,
      email: `automation-contract+${suffix}@example.com`,
      name: `Automation Contract ${suffix}`,
    })) as string;

    await ctx.db.insert("subscriptions", {
      id: randomIdFor("sub"),
      org_id: orgId,
      tier,
      status: SUBSCRIPTION_STATUS.active,
      stripe_customer_id: null,
      stripe_subscription_id: null,
      current_period_start: period.periodStart,
      current_period_end: period.periodEnd,
      created_at: createdAt,
      updated_at: createdAt,
    });

    await ctx.db.insert("workspaces", {
      id: workspaceId,
      org_id: orgId,
      slug: slugifyWorkspaceName(`automation-contract-workspace-${suffix}`),
      name: `automation-contract-workspace-${suffix}`,
      status: WORKSPACE_STATUS.active,
      policy_mode: POLICY_MODE.manualOnly,
      default_action_behavior: DEFAULT_ACTION_BEHAVIOR.requireApproval,
      code_mode_enabled: true,
      created_at: createdAt,
    });
    if (args.seedByokKey !== false) {
      await seedActiveByokKey(ctx, {
        orgId,
        userId,
        provider: "openai",
        createdAt,
        suffix: `automation_contract_${suffix}`,
      });
    }

    const workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_custom_id", (q) => q.eq("id", workspaceId))
      .unique();
    if (!workspace) {
      throw new Error("WorkspaceNotFound");
    }

    const created = await createAutomationCore(
      ctx,
      {
        orgId,
        userId,
        workspace,
      },
      {
        workspace_id: workspaceId,
        name: `Contract Automation ${suffix}`,
        description: "Created through the shared createAutomation contract path",
        trigger_type: args.triggerType ?? "manual",
        ...(args.scheduleCron !== undefined ? { schedule_cron: args.scheduleCron } : {}),
        ...(args.providerTrigger !== undefined ? { provider_trigger: args.providerTrigger } : {}),
        ...(args.eventProvider !== undefined ? { event_provider: args.eventProvider } : {}),
        ...(args.eventType !== undefined ? { event_type: args.eventType } : {}),
        ...(args.eventPredicate !== undefined ? { event_predicate: args.eventPredicate } : {}),
        runner_type: "chatgpt_codex",
        ai_model_provider: "openai",
        ai_model_name: "gpt-5.4",
        prompt: "Contract path prompt",
        network_access: "mcp_only",
      },
    );

    return {
      orgId,
      workspaceId,
      created,
    };
  },
});

export const createAutomationForWorkspace = mutation({
  args: {
    orgId: v.string(),
    workspaceId: v.string(),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    prompt: v.optional(v.string()),
  },
  returns: createdWorkspaceAutomationValidator,
  handler: async (ctx, args) => {
    await requireE2EIdentity(ctx);

    const workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_custom_id", (q) => q.eq("id", args.workspaceId))
      .unique();
    if (!workspace || workspace.org_id !== args.orgId) {
      throw new Error("WorkspaceNotFound");
    }

    const suffix = Math.random().toString(16).slice(2, 8);
    await seedActiveByokKey(ctx, {
      orgId: args.orgId,
      userId: `usr_e2e_automation_${suffix}`,
      provider: "openai",
      createdAt: nowIso(),
      suffix: `workspace_${suffix}`,
    });
    const created = await createAutomationCore(
      ctx,
      {
        orgId: args.orgId,
        userId: `usr_e2e_automation_${suffix}`,
        workspace,
      },
      {
        workspace_id: args.workspaceId,
        name: args.name?.trim() || `E2E Automation ${suffix}`,
        description:
          args.description?.trim() || "Created through the E2E workspace automation helper.",
        trigger_type: "manual",
        runner_type: "chatgpt_codex",
        ai_model_provider: "openai",
        ai_model_name: "gpt-5.4",
        prompt: args.prompt?.trim() || "Summarize the latest workspace activity for operators.",
        network_access: "mcp_only",
      },
    );

    return { created };
  },
});

export const seedAutomationCascadeFixture = mutation({
  args: {
    tier: v.optional(subscriptionTierValidator),
    scheduleCron: v.optional(v.string()),
  },
  returns: seededAutomationCascadeFixtureValidator,
  handler: async (ctx, args) => {
    await requireE2EIdentity(ctx);
    const seeded = await seedBaseAutomationFixture(ctx, args);

    const triggerEventId = randomIdFor("event");
    await ctx.db.insert("automation_trigger_events", {
      id: triggerEventId,
      automation_id: seeded.automationId,
      event_provider: "fixture",
      event_type: "fixture.event",
      event_id: randomIdFor("evt"),
      event_payload_ref: null,
      status: AUTOMATION_TRIGGER_EVENT_STATUS.pending,
      automation_run_id: null,
      created_at: seeded.createdAt,
    });

    const runId = randomIdFor("run");
    await ctx.db.insert("automation_runs", {
      id: runId,
      automation_id: seeded.automationId,
      org_id: seeded.orgId,
      config_version_id: seeded.configVersionId,
      trigger_type: "manual",
      error_message: null,
      sandbox_id: null,
      log_storage_id: null,
      created_at: seeded.createdAt,
      workspace_id: seeded.workspaceId,
      mcp_session_id: null,
      client_type: "chatgpt",
      metadata: {},
      started_at: seeded.createdAt,
      ended_at: null,
      status: RUN_STATUS.active,
    });

    await ctx.db.insert("automation_run_logs", {
      automation_run_id: runId,
      seq: 1,
      level: "system",
      content: "seeded run log",
      timestamp: seeded.createdAt,
    });

    const toolCallId = randomIdFor("tool");
    await ctx.db.insert("tool_calls", {
      id: toolCallId,
      automation_run_id: runId,
      tool_name: "fixture.write",
      input_redacted: {},
      output_redacted: null,
      status: TOOL_CALL_STATUS.received,
      raw_input_blob_id: null,
      raw_output_blob_id: null,
      latency_ms: 1,
      created_at: seeded.createdAt,
    });

    const actionId = randomIdFor("action");
    await ctx.db.insert("actions", {
      id: actionId,
      workspace_id: seeded.workspaceId,
      automation_run_id: runId,
      tool_call_id: toolCallId,
      action_type: "fixture_action",
      risk_level: "low",
      normalized_payload_enc: "encrypted_payload",
      payload_preview: {},
      payload_purged_at: null,
      status: ACTION_STATUS.pending,
      idempotency_key: randomIdFor("idem"),
      created_at: seeded.createdAt,
      resolved_at: null,
      result_redacted: null,
    });

    const approvalId = randomIdFor("approval");
    await ctx.db.insert("approvals", {
      id: approvalId,
      action_id: actionId,
      decider_type: APPROVAL_DECIDER_TYPE.human,
      decision: APPROVAL_DECISION.approve,
      reason: "fixture approve",
      rule_id: null,
      confidence: null,
      created_at: seeded.createdAt,
    });

    const policyDecisionId = randomIdFor("decision");
    await ctx.db.insert("policy_decisions", {
      id: policyDecisionId,
      action_id: actionId,
      policies_evaluated: ["fixture_policy"],
      result: "approve",
      explanation: "fixture decision",
      confidence: 1,
      created_at: seeded.createdAt,
    });

    const ruleId = randomIdFor("rule");
    await ctx.db.insert("cel_rules", {
      id: ruleId,
      workspace_id: seeded.workspaceId,
      name: "fixture rule",
      description: "fixture",
      expression: "true",
      effect: RULE_EFFECT.approve,
      enabled: true,
      created_by: seeded.userId,
      created_at: seeded.createdAt,
    });

    const ruleMatchId = randomIdFor("match");
    await ctx.db.insert("cel_rule_matches", {
      id: ruleMatchId,
      action_id: actionId,
      cel_rule_id: ruleId,
      effect: RULE_EFFECT.approve,
      expression_snapshot: "true",
      context_snapshot: {},
      created_at: seeded.createdAt,
    });

    const sensitiveBlobId = randomIdFor("blob");
    await ctx.db.insert("sensitive_blobs", {
      id: sensitiveBlobId,
      org_id: seeded.orgId,
      ref_table: "automation_runs",
      ref_id: runId,
      ref_field: "input",
      blob_enc: "encrypted_blob",
      key_version: "convex_first_v1",
      expires_at: null,
      purged_at: null,
      created_at: seeded.createdAt,
    });

    return {
      automationId: seeded.automationId,
      configVersionId: seeded.configVersionId,
      triggerEventId,
      runId,
      toolCallId,
      actionId,
      approvalId,
      policyDecisionId,
      ruleId,
      ruleMatchId,
      sensitiveBlobId,
    };
  },
});

export const updateAutomationFixtureConfig = mutation({
  args: {
    automationId: v.string(),
    prompt: v.optional(v.string()),
    changeSummary: v.optional(v.string()),
  },
  returns: v.object({
    configVersionId: v.string(),
    versionNumber: v.number(),
    currentConfigVersionId: v.string(),
  }),
  handler: async (ctx, args) => {
    await requireE2EIdentity(ctx);
    const automation = await ctx.db
      .query("automations")
      .withIndex("by_custom_id", (q) => q.eq("id", args.automationId))
      .unique();
    if (!automation) {
      throw new Error("AutomationNotFound");
    }

    const latestVersion = await ctx.db
      .query("automation_config_versions")
      .withIndex("by_automation_version", (q) => q.eq("automation_id", args.automationId))
      .order("desc")
      .first();
    if (!latestVersion) {
      throw new Error("AutomationConfigNotFound");
    }

    const configVersionId = randomIdFor("acv");
    const versionNumber = latestVersion.version_number + 1;
    const createdAt = nowIso();
    await ctx.db.insert("automation_config_versions", {
      id: configVersionId,
      automation_id: args.automationId,
      version_number: versionNumber,
      trigger_type: latestVersion.trigger_type,
      schedule_cron: latestVersion.schedule_cron,
      provider_trigger: latestVersion.provider_trigger ?? null,
      provider_trigger_migration_state: latestVersion.provider_trigger_migration_state ?? null,
      event_provider: latestVersion.event_provider,
      event_type: latestVersion.event_type,
      event_predicate: latestVersion.event_predicate,
      model_class:
        latestVersion.model_class ??
        inferAutomationModelClassFromLegacyFields({
          aiModelProvider: latestVersion.ai_model_provider,
          aiModelName: latestVersion.ai_model_name,
        }),
      runner_type: latestVersion.runner_type,
      ai_model_provider: latestVersion.ai_model_provider,
      ai_model_name: latestVersion.ai_model_name,
      prompt: args.prompt ?? `${latestVersion.prompt}\nupdated`,
      network_access: latestVersion.network_access,
      created_by: latestVersion.created_by,
      created_at: createdAt,
      change_summary: args.changeSummary?.trim() ? args.changeSummary.trim() : null,
    });

    await ctx.db.patch(automation._id, {
      current_config_version_id: configVersionId,
      updated_at: createdAt,
    });

    return {
      configVersionId,
      versionNumber,
      currentConfigVersionId: configVersionId,
    };
  },
});

export const rollbackAutomationFixtureConfig = mutation({
  args: {
    automationId: v.string(),
    configVersionId: v.string(),
  },
  returns: v.object({
    currentConfigVersionId: v.string(),
  }),
  handler: async (ctx, args) => {
    await requireE2EIdentity(ctx);
    const automation = await ctx.db
      .query("automations")
      .withIndex("by_custom_id", (q) => q.eq("id", args.automationId))
      .unique();
    if (!automation) {
      throw new Error("AutomationNotFound");
    }

    const target = await ctx.db
      .query("automation_config_versions")
      .withIndex("by_custom_id", (q) => q.eq("id", args.configVersionId))
      .unique();
    if (!target || target.automation_id !== args.automationId) {
      throw new Error("ConfigVersionNotFound");
    }

    await ctx.db.patch(automation._id, {
      current_config_version_id: args.configVersionId,
      updated_at: nowIso(),
    });

    return {
      currentConfigVersionId: args.configVersionId,
    };
  },
});

export const deleteAutomationFixture = mutation({
  args: {
    automationId: v.string(),
  },
  returns: v.object({
    deleted: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireE2EIdentity(ctx);
    const automation = await ctx.db
      .query("automations")
      .withIndex("by_custom_id", (q) => q.eq("id", args.automationId))
      .unique();
    if (!automation) {
      return { deleted: false };
    }
    await cascadeDeleteAutomationDescendants(ctx, args.automationId);
    await ctx.db.delete(automation._id);
    return { deleted: true };
  },
});

export const getAutomationFixtureState = query({
  args: {
    automationId: v.string(),
  },
  returns: automationFixtureStateValidator,
  handler: async (ctx, args) => {
    await requireE2EIdentity(ctx);
    const automation = await ctx.db
      .query("automations")
      .withIndex("by_custom_id", (q) => q.eq("id", args.automationId))
      .unique();
    const versions = await ctx.db
      .query("automation_config_versions")
      .withIndex("by_automation_version", (q) => q.eq("automation_id", args.automationId))
      .order("desc")
      .collect();
    return {
      automation: automation
        ? {
            id: automation.id,
            current_config_version_id: automation.current_config_version_id,
            status: automation.status,
          }
        : null,
      versions: versions.map((version) => ({
        id: version.id,
        version_number: version.version_number,
        prompt: version.prompt,
        change_summary: version.change_summary,
      })),
    };
  },
});

export const getAutomationCascadeFixtureState = query({
  args: {
    automationId: v.string(),
    configVersionId: v.string(),
    triggerEventId: v.string(),
    runId: v.string(),
    toolCallId: v.string(),
    actionId: v.string(),
    approvalId: v.string(),
    policyDecisionId: v.string(),
    ruleId: v.string(),
    ruleMatchId: v.string(),
    sensitiveBlobId: v.string(),
  },
  returns: automationCascadeFixtureStateValidator,
  handler: async (ctx, args) => {
    await requireE2EIdentity(ctx);

    const automation = await ctx.db
      .query("automations")
      .withIndex("by_custom_id", (q) => q.eq("id", args.automationId))
      .unique();
    const configVersion = await ctx.db
      .query("automation_config_versions")
      .withIndex("by_custom_id", (q) => q.eq("id", args.configVersionId))
      .unique();
    const triggerEvent = await ctx.db
      .query("automation_trigger_events")
      .withIndex("by_custom_id", (q) => q.eq("id", args.triggerEventId))
      .unique();
    const run = await ctx.db
      .query("automation_runs")
      .withIndex("by_custom_id", (q) => q.eq("id", args.runId))
      .unique();
    const toolCall = await ctx.db
      .query("tool_calls")
      .withIndex("by_custom_id", (q) => q.eq("id", args.toolCallId))
      .unique();
    const action = await ctx.db
      .query("actions")
      .withIndex("by_custom_id", (q) => q.eq("id", args.actionId))
      .unique();
    const approval = await ctx.db
      .query("approvals")
      .withIndex("by_custom_id", (q) => q.eq("id", args.approvalId))
      .unique();
    const policyDecision = await ctx.db
      .query("policy_decisions")
      .withIndex("by_custom_id", (q) => q.eq("id", args.policyDecisionId))
      .unique();
    const rule = await ctx.db
      .query("cel_rules")
      .withIndex("by_custom_id", (q) => q.eq("id", args.ruleId))
      .unique();

    const runLogs = await ctx.db
      .query("automation_run_logs")
      .withIndex("by_run_seq", (q) => q.eq("automation_run_id", args.runId))
      .take(2);
    const ruleMatch = await ctx.db
      .query("cel_rule_matches")
      .withIndex("by_custom_id", (q) => q.eq("id", args.ruleMatchId))
      .unique();
    const sensitiveBlob = await ctx.db
      .query("sensitive_blobs")
      .withIndex("by_custom_id", (q) => q.eq("id", args.sensitiveBlobId))
      .unique();

    return {
      automation: automation !== null,
      configVersion: configVersion !== null,
      triggerEvent: triggerEvent !== null,
      run: run !== null,
      runLogCount: runLogs.length,
      toolCall: toolCall !== null,
      action: action !== null,
      approval: approval !== null,
      policyDecision: policyDecision !== null,
      rule: rule !== null,
      ruleMatch: ruleMatch !== null,
      sensitiveBlob: sensitiveBlob !== null,
    };
  },
});

export const listAutomationFixtureRuns = query({
  args: {
    automationId: v.string(),
  },
  returns: v.array(automationFixtureRunValidator),
  handler: async (ctx, args) => {
    await requireE2EIdentity(ctx);
    const rows = await ctx.db
      .query("automation_runs")
      .withIndex("by_automation", (q) => q.eq("automation_id", args.automationId))
      .order("desc")
      .collect();
    return rows
      .filter((row) => typeof row.trigger_type === "string" && typeof row.created_at === "string")
      .map((row) => ({
        id: row.id,
        trigger_type: row.trigger_type as "schedule" | "event" | "manual",
        status: row.status,
        created_at: row.created_at as string,
      }));
  },
});

export const listAutomationFixtureTriggerEvents = query({
  args: {
    automationId: v.string(),
  },
  returns: v.array(automationFixtureTriggerEventValidator),
  handler: async (ctx, args) => {
    await requireE2EIdentity(ctx);
    const rows = await ctx.db
      .query("automation_trigger_events")
      .withIndex("by_automation", (q) => q.eq("automation_id", args.automationId))
      .order("desc")
      .collect();
    return rows.map((row) => ({
      id: row.id,
      event_id: row.event_id,
      event_type: row.event_type,
      status: row.status,
      match_status: row.match_status ?? null,
      failure_reason: row.failure_reason ?? null,
      delivery_mode: row.delivery_mode ?? null,
      config_version_id: row.config_version_id ?? null,
    }));
  },
});

export const getAutomationFixtureRun = query({
  args: {
    automationRunId: v.string(),
  },
  returns: v.union(automationFixtureRunDetailValidator, v.null()),
  handler: async (ctx, args) => {
    await requireE2EIdentity(ctx);
    const run = await ctx.db
      .query("automation_runs")
      .withIndex("by_custom_id", (q) => q.eq("id", args.automationRunId))
      .unique();
    if (
      !run ||
      !run.automation_id ||
      !run.org_id ||
      !run.workspace_id ||
      !run.config_version_id ||
      !run.trigger_type
    ) {
      return null;
    }
    return {
      id: run.id,
      automation_id: run.automation_id,
      org_id: run.org_id,
      workspace_id: run.workspace_id,
      config_version_id: run.config_version_id,
      trigger_type: run.trigger_type,
      status: normalizeAutomationRunStatus(run),
      started_at: run.started_at ?? null,
      ended_at: run.ended_at ?? null,
      error_message: run.error_message ?? null,
      sandbox_id: run.sandbox_id ?? null,
      mcp_session_id: run.mcp_session_id ?? null,
      outcome_success: run.outcome_success ?? null,
      outcome_summary: run.outcome_summary ?? null,
      outcome_source: run.outcome_source ?? null,
      outcome_recorded_at: run.outcome_recorded_at ?? null,
      created_at: run.created_at ?? run.started_at ?? nowIso(),
    };
  },
});

export const getAutomationFixtureRunLogs = query({
  args: {
    automationRunId: v.string(),
  },
  returns: automationFixtureRunLogsValidator,
  handler: async (ctx, args) => {
    await requireE2EIdentity(ctx);
    const run = await ctx.db
      .query("automation_runs")
      .withIndex("by_custom_id", (q) => q.eq("id", args.automationRunId))
      .unique();
    if (run?.log_storage_id) {
      const storageUrl = await ctx.storage.getUrl(run.log_storage_id);
      if (!storageUrl) {
        return { mode: "expired" as const };
      }
      return { mode: "cold" as const, storage_url: storageUrl };
    }
    const lines = await ctx.db
      .query("automation_run_logs")
      .withIndex("by_run_seq", (q) => q.eq("automation_run_id", args.automationRunId))
      .take(500);
    return {
      mode: "hot" as const,
      lines: lines.map((line) => ({
        seq: line.seq,
        level: line.level,
        content: line.content,
        timestamp: line.timestamp,
        ...(line.event_type !== undefined ? { event_type: line.event_type } : {}),
        ...(line.event_data !== undefined ? { event_data: line.event_data } : {}),
      })),
    };
  },
});

export const getAutomationFixturePublicViews = query({
  args: {
    automationId: v.string(),
    workspaceId: v.string(),
    configVersionId: v.string(),
  },
  returns: automationFixturePublicViewsValidator,
  handler: async (ctx, args) => {
    await requireE2EIdentity(ctx);

    const automation = await ctx.db
      .query("automations")
      .withIndex("by_custom_id", (q) => q.eq("id", args.automationId))
      .unique();
    const currentConfig = await ctx.db
      .query("automation_config_versions")
      .withIndex("by_custom_id", (q) => q.eq("id", args.configVersionId))
      .unique();
    if (!automation || !currentConfig) {
      throw new Error("AutomationFixtureNotFound");
    }

    const listRows = await ctx.db
      .query("automations")
      .withIndex("by_workspace", (q) => q.eq("workspace_id", args.workspaceId))
      .collect();
    const versions = await ctx.db
      .query("automation_config_versions")
      .withIndex("by_automation_version", (q) => q.eq("automation_id", args.automationId))
      .order("desc")
      .collect();
    const listEntry = listRows.find((row) => row.id === args.automationId);
    if (!listEntry) {
      throw new Error("AutomationFixtureNotFound");
    }

    return {
      created: {
        automation: toAutomationView(automation),
        config_version: toAutomationConfigVersionView(currentConfig),
      },
      detail: {
        automation: toAutomationView(automation),
        current_config_version: toAutomationConfigVersionView(currentConfig),
      },
      list_entry: {
        automation: toAutomationView(listEntry),
        current_config_version: toAutomationConfigSummary(currentConfig),
        latest_run: null,
      },
      versions: versions.map(toAutomationConfigVersionView),
    };
  },
});
