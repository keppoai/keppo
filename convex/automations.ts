import { makeFunctionReference, paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { type Doc } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import {
  insertAudit,
  nowIso,
  randomIdFor,
  requireOrgMember,
  requireWorkspaceRole,
  type Role,
} from "./_auth";
import {
  AUTOMATION_STATUS,
  AUDIT_EVENT_TYPES,
  type ConfigTriggerType,
  RUN_STATUS,
  SUBSCRIPTION_TIER,
  USER_ROLE,
  USER_ROLES,
  type AutomationProviderTrigger,
  type AutomationProviderTriggerDeliveryMode,
  type AutomationProviderTriggerMigrationState,
  type AiModelProvider,
  type ModelClass,
  type NetworkAccessMode,
  type RunnerType,
} from "./domain_constants";
import {
  automationConfigVersionValidator,
  automationValidator,
  automationWithCurrentConfigValidator,
  paginatedAutomationSummariesValidator,
  toAutomationConfigSummary,
  toAutomationConfigVersionView,
  toAutomationView,
} from "./automations_shared";
import { normalizeAutomationRunStatus } from "./automation_run_status";
import {
  automationStatusValidator,
  automationProviderTriggerValidator,
  aiKeyModeValidator,
  aiModelProviderValidator,
  configTriggerTypeValidator,
  modelClassValidator,
  networkAccessValidator,
  requireBoundedString,
  runnerTypeValidator,
} from "./validators";
import { cascadeDeleteAutomationDescendants } from "./cascade";
import { getAiCreditBalanceForOrg } from "./ai_credits";
import {
  buildLegacyEventProviderTrigger,
  buildLegacyEventProviderTriggerMigrationState,
  coerceAutomationModelClass,
  computeAutomationPromptHash,
  getAiModelProviderLabel,
  inferAutomationModelClassFromLegacyFields,
  resolveAutomationExecutionReadiness,
} from "../packages/shared/src/automations.js";
import { getTierConfig } from "../packages/shared/src/subscriptions.js";
import { enforceRateLimit } from "./rate_limit_helpers";

const refs = {
  getSubscriptionForOrg: makeFunctionReference<"query">("billing:getSubscriptionForOrg"),
};

const AUTOMATION_SCAN_BUDGET = 200;
const AUTOMATION_NAME_MAX_LENGTH = 80;
const AUTOMATION_SLUG_MAX_LENGTH = 48;
const AUTOMATION_DESCRIPTION_MAX_LENGTH = 400;
const AUTOMATION_PROMPT_MAX_LENGTH = 12_000;
const AUTOMATION_MODEL_MAX_LENGTH = 120;
const AUTOMATION_EVENT_FIELD_MAX_LENGTH = 120;
const AUTOMATION_CHANGE_SUMMARY_MAX_LENGTH = 240;
const AUTOMATION_CREATE_RATE_LIMIT = {
  limit: 20,
  windowMs: 15 * 60 * 1_000,
} as const;
const AUTOMATION_CONFIG_RATE_LIMIT = {
  limit: 40,
  windowMs: 15 * 60 * 1_000,
} as const;

const orgAutomationKeyUsageValidator = v.object({
  provider: aiModelProviderValidator,
  key_mode: aiKeyModeValidator,
  count: v.number(),
});

const configInputValidator = {
  trigger_type: configTriggerTypeValidator,
  schedule_cron: v.optional(v.string()),
  provider_trigger: v.optional(automationProviderTriggerValidator),
  event_provider: v.optional(v.string()),
  event_type: v.optional(v.string()),
  event_predicate: v.optional(v.string()),
  model_class: v.optional(modelClassValidator),
  runner_type: runnerTypeValidator,
  ai_model_provider: aiModelProviderValidator,
  ai_model_name: v.string(),
  prompt: v.string(),
  network_access: networkAccessValidator,
} as const;

const requireAutomationRole = async (
  ctx: QueryCtx | MutationCtx,
  automationId: string,
  allowedRoles: readonly Role[] = USER_ROLES,
): Promise<{
  auth: Awaited<ReturnType<typeof requireWorkspaceRole>>;
  automation: Doc<"automations">;
}> => {
  const automation = await ctx.db
    .query("automations")
    .withIndex("by_custom_id", (q) => q.eq("id", automationId))
    .unique();
  if (!automation) {
    throw new Error("AutomationNotFound");
  }

  const auth = await requireWorkspaceRole(ctx, automation.workspace_id, allowedRoles);
  if (auth.orgId !== automation.org_id) {
    throw new Error("Forbidden");
  }
  return { auth, automation };
};

const slugifyAutomationName = (value: string): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, AUTOMATION_SLUG_MAX_LENGTH)
    .replace(/-+$/g, "");
  return normalized.length > 0 ? normalized : "automation";
};

const buildUniqueAutomationSlug = async (
  ctx: QueryCtx | MutationCtx,
  workspaceId: string,
  name: string,
  excludeAutomationId?: string,
): Promise<string> => {
  const baseSlug = slugifyAutomationName(name);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate =
      attempt === 0
        ? baseSlug
        : `${baseSlug}-${String(attempt + 1)}`
            .slice(0, AUTOMATION_SLUG_MAX_LENGTH)
            .replace(/-+$/g, "");
    const existing = await ctx.db
      .query("automations")
      .withIndex("by_workspace_slug", (q) =>
        q.eq("workspace_id", workspaceId).eq("slug", candidate),
      )
      .unique();
    if (!existing || existing.id === excludeAutomationId) {
      return candidate;
    }
  }
  throw new Error("automation.slug_conflict: Failed to generate a unique automation slug.");
};

const resolveAutomationLookup = async (
  ctx: QueryCtx | MutationCtx,
  workspaceId: string,
  automationLookup: string,
): Promise<Doc<"automations"> | null> => {
  const trimmedLookup = automationLookup.trim();
  if (trimmedLookup.length === 0) {
    return null;
  }

  const byId = await ctx.db
    .query("automations")
    .withIndex("by_custom_id", (q) => q.eq("id", trimmedLookup))
    .unique();
  if (byId && byId.workspace_id === workspaceId) {
    return byId;
  }

  return await ctx.db
    .query("automations")
    .withIndex("by_workspace_slug", (q) =>
      q.eq("workspace_id", workspaceId).eq("slug", slugifyAutomationName(trimmedLookup)),
    )
    .unique();
};

const loadConfigVersion = async (
  ctx: QueryCtx | MutationCtx,
  configVersionId: string,
): Promise<Doc<"automation_config_versions"> | null> => {
  return await ctx.db
    .query("automation_config_versions")
    .withIndex("by_custom_id", (q) => q.eq("id", configVersionId))
    .unique();
};

const normalizeConfig = (
  input: {
    trigger_type: ConfigTriggerType;
    schedule_cron?: string;
    provider_trigger?: AutomationProviderTrigger;
    event_provider?: string;
    event_type?: string;
    event_predicate?: string;
    model_class?: ModelClass;
    runner_type: RunnerType;
    ai_model_provider: AiModelProvider;
    ai_model_name: string;
    prompt: string;
    network_access: NetworkAccessMode;
  },
  userId: string,
  createdAt: string,
  changeSummary?: string,
) => {
  const normalizeDeliveryMode = (
    value: AutomationProviderTriggerDeliveryMode,
  ): AutomationProviderTriggerDeliveryMode => {
    return value;
  };
  const normalizeProviderTrigger = (
    value: AutomationProviderTrigger,
  ): AutomationProviderTrigger => {
    const providerId = requireBoundedString(value.provider_id, {
      field: "provider_trigger.provider_id",
      maxLength: AUTOMATION_EVENT_FIELD_MAX_LENGTH,
    });
    const triggerKey = requireBoundedString(value.trigger_key, {
      field: "provider_trigger.trigger_key",
      maxLength: AUTOMATION_EVENT_FIELD_MAX_LENGTH,
    });
    const schemaVersion = Math.floor(value.schema_version);
    if (!Number.isFinite(schemaVersion) || schemaVersion < 1) {
      throw new Error("provider_trigger.schema_version must be a positive integer.");
    }

    const filter = { ...value.filter };
    if (typeof filter.predicate === "string") {
      filter.predicate = requireBoundedString(filter.predicate, {
        field: "provider_trigger.filter.predicate",
        maxLength: 1_000,
        allowEmpty: true,
      });
    }

    const supportedModes = Array.from(
      new Set(value.delivery.supported_modes.map((mode) => normalizeDeliveryMode(mode))),
    );
    if (supportedModes.length === 0) {
      throw new Error("provider_trigger.delivery.supported_modes must contain at least one mode.");
    }

    const preferredMode = normalizeDeliveryMode(value.delivery.preferred_mode);
    if (!supportedModes.includes(preferredMode)) {
      throw new Error(
        "provider_trigger.delivery.preferred_mode must be included in supported_modes.",
      );
    }

    const fallbackMode =
      value.delivery.fallback_mode === null
        ? null
        : normalizeDeliveryMode(value.delivery.fallback_mode);
    if (fallbackMode && !supportedModes.includes(fallbackMode)) {
      throw new Error(
        "provider_trigger.delivery.fallback_mode must be included in supported_modes.",
      );
    }

    return {
      provider_id: providerId,
      trigger_key: triggerKey,
      schema_version: schemaVersion,
      filter,
      delivery: {
        preferred_mode: preferredMode,
        supported_modes: supportedModes,
        fallback_mode: fallbackMode,
      },
      subscription_state: {
        status: "inactive",
        active_mode: null,
        last_error: null,
        updated_at: null,
      },
    };
  };
  const aiModelName = requireBoundedString(input.ai_model_name, {
    field: "ai_model_name",
    maxLength: AUTOMATION_MODEL_MAX_LENGTH,
  });
  const prompt = requireBoundedString(input.prompt, {
    field: "prompt",
    maxLength: AUTOMATION_PROMPT_MAX_LENGTH,
  });
  const scheduleCron =
    input.schedule_cron === undefined
      ? ""
      : requireBoundedString(input.schedule_cron, {
          field: "schedule_cron",
          maxLength: AUTOMATION_EVENT_FIELD_MAX_LENGTH,
          allowEmpty: true,
        });
  const eventProvider =
    input.event_provider === undefined
      ? ""
      : requireBoundedString(input.event_provider, {
          field: "event_provider",
          maxLength: AUTOMATION_EVENT_FIELD_MAX_LENGTH,
        });
  const eventType =
    input.event_type === undefined
      ? ""
      : requireBoundedString(input.event_type, {
          field: "event_type",
          maxLength: AUTOMATION_EVENT_FIELD_MAX_LENGTH,
        });
  const eventPredicate =
    input.event_predicate === undefined
      ? ""
      : requireBoundedString(input.event_predicate, {
          field: "event_predicate",
          maxLength: 1_000,
          allowEmpty: true,
        });
  const nativeProviderTrigger =
    input.provider_trigger === undefined ? null : normalizeProviderTrigger(input.provider_trigger);
  const providerTriggerMigrationState: AutomationProviderTriggerMigrationState | null =
    input.trigger_type !== "event"
      ? null
      : nativeProviderTrigger
        ? null
        : eventProvider.length > 0 && eventType.length > 0
          ? buildLegacyEventProviderTriggerMigrationState({
              eventProvider,
              eventType,
              ...(eventPredicate.length > 0 ? { eventPredicate } : {}),
            })
          : null;
  const providerTrigger: AutomationProviderTrigger | null =
    input.trigger_type !== "event"
      ? null
      : (nativeProviderTrigger ??
        (eventProvider.length > 0 && eventType.length > 0
          ? buildLegacyEventProviderTrigger({
              eventProvider,
              eventType,
              ...(eventPredicate.length > 0 ? { eventPredicate } : {}),
            })
          : null));

  if (input.trigger_type === "schedule" && scheduleCron.length === 0) {
    throw new Error("schedule_cron is required for schedule triggers");
  }
  if (input.trigger_type === "event" && providerTrigger === null) {
    throw new Error(
      "provider_trigger or event_provider and event_type are required for event triggers",
    );
  }

  const compatibilityEventProvider =
    input.trigger_type === "event" && providerTrigger ? String(providerTrigger.provider_id) : null;
  const compatibilityEventType =
    input.trigger_type === "event" && providerTrigger ? providerTrigger.trigger_key : null;
  const compatibilityEventPredicate =
    input.trigger_type === "event" &&
    providerTrigger &&
    typeof providerTrigger.filter.predicate === "string" &&
    providerTrigger.filter.predicate.trim().length > 0
      ? providerTrigger.filter.predicate.trim()
      : null;
  const modelClass = input.model_class
    ? coerceAutomationModelClass(input.model_class)
    : inferAutomationModelClassFromLegacyFields({
        aiModelProvider: input.ai_model_provider,
        aiModelName,
      });

  if (input.trigger_type === "manual") {
    return {
      trigger_type: input.trigger_type,
      schedule_cron: null,
      provider_trigger: null,
      provider_trigger_migration_state: null,
      event_provider: null,
      event_type: null,
      event_predicate: null,
      model_class: modelClass,
      runner_type: input.runner_type,
      ai_model_provider: input.ai_model_provider,
      ai_model_name: aiModelName,
      prompt,
      network_access: input.network_access,
      created_by: userId,
      created_at: createdAt,
      change_summary: changeSummary?.trim()
        ? requireBoundedString(changeSummary, {
            field: "change_summary",
            maxLength: AUTOMATION_CHANGE_SUMMARY_MAX_LENGTH,
          })
        : null,
    };
  }
  return {
    trigger_type: input.trigger_type,
    schedule_cron: input.trigger_type === "schedule" ? scheduleCron : null,
    provider_trigger: input.trigger_type === "event" ? providerTrigger : null,
    provider_trigger_migration_state:
      input.trigger_type === "event" ? providerTriggerMigrationState : null,
    event_provider: compatibilityEventProvider,
    event_type: compatibilityEventType,
    event_predicate: compatibilityEventPredicate,
    model_class: modelClass,
    runner_type: input.runner_type,
    ai_model_provider: input.ai_model_provider,
    ai_model_name: aiModelName,
    prompt,
    network_access: input.network_access,
    created_by: userId,
    created_at: createdAt,
    change_summary: changeSummary?.trim()
      ? requireBoundedString(changeSummary, {
          field: "change_summary",
          maxLength: AUTOMATION_CHANGE_SUMMARY_MAX_LENGTH,
        })
      : null,
  };
};

const normalizeMermaidContent = (value: string | undefined): string | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  return (
    requireBoundedString(value, {
      field: "mermaid_content",
      maxLength: 20_000,
      allowEmpty: true,
    }) || null
  );
};

const resolveMermaidPromptHash = (params: {
  prompt: string;
  mermaidContent: string | null | undefined;
}): string | null => {
  return params.mermaidContent ? computeAutomationPromptHash(params.prompt) : null;
};

const reserveNextVersionNumber = async (
  ctx: MutationCtx,
  automation: Doc<"automations">,
): Promise<number> => {
  const current = automation.next_config_version_number;
  if (typeof current === "number" && Number.isFinite(current) && current >= 1) {
    await ctx.db.patch(automation._id, {
      next_config_version_number: current + 1,
    });
    return current;
  }
  const latest = await ctx.db
    .query("automation_config_versions")
    .withIndex("by_automation_version", (q) => q.eq("automation_id", automation.id))
    .order("desc")
    .first();
  const next = latest ? latest.version_number + 1 : 1;
  await ctx.db.patch(automation._id, {
    next_config_version_number: next + 1,
  });
  return next;
};

export type CreateAutomationCoreArgs = {
  workspace_id: string;
  name: string;
  description: string;
  mermaid_content?: string;
  trigger_type: ConfigTriggerType;
  schedule_cron?: string;
  provider_trigger?: AutomationProviderTrigger;
  event_provider?: string;
  event_type?: string;
  event_predicate?: string;
  runner_type: RunnerType;
  ai_model_provider: AiModelProvider;
  ai_model_name: string;
  prompt: string;
  network_access: NetworkAccessMode;
};

const hasActiveByokKeyForProvider = async (
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  provider: AiModelProvider,
): Promise<"byok" | "subscription_token" | null> => {
  const byokCandidates = await ctx.db
    .query("org_ai_keys")
    .withIndex("by_org_provider_mode", (q) =>
      q.eq("org_id", orgId).eq("provider", provider).eq("key_mode", "byok"),
    )
    .take(AUTOMATION_SCAN_BUDGET);
  if (byokCandidates.some((row) => row.is_active)) {
    return "byok";
  }
  if (provider !== "openai") {
    return null;
  }
  const legacyCandidates = await ctx.db
    .query("org_ai_keys")
    .withIndex("by_org_provider_mode", (q) =>
      q.eq("org_id", orgId).eq("provider", provider).eq("key_mode", "subscription_token"),
    )
    .take(AUTOMATION_SCAN_BUDGET);
  return legacyCandidates.some((row) => row.is_active) ? "subscription_token" : null;
};

const getAutomationExecutionState = async (
  ctx: QueryCtx | MutationCtx,
  params: {
    orgId: string;
    provider: AiModelProvider;
  },
): Promise<
  ReturnType<typeof resolveAutomationExecutionReadiness> & {
    key_mode: "byok" | "bundled" | "subscription_token";
  }
> => {
  const subscription = await ctx.runQuery(refs.getSubscriptionForOrg, {
    orgId: params.orgId,
  });
  const creditBalance = await getAiCreditBalanceForOrg(ctx, params.orgId, subscription);
  const activeKeyMode = await hasActiveByokKeyForProvider(ctx, params.orgId, params.provider);
  const readiness = resolveAutomationExecutionReadiness({
    bundledRuntimeEnabled: creditBalance.bundled_runtime_enabled,
    totalCreditsAvailable: creditBalance.total_available,
    hasActiveByokKey: activeKeyMode !== null,
  });

  return {
    ...readiness,
    key_mode:
      readiness.mode === "bundled"
        ? "bundled"
        : activeKeyMode === "subscription_token"
          ? "subscription_token"
          : "byok",
  };
};

export const assertAutomationExecutionReady = async (
  ctx: QueryCtx | MutationCtx,
  params: {
    orgId: string;
    provider: AiModelProvider;
  },
): Promise<void> => {
  const readiness = await getAutomationExecutionState(ctx, params);
  if (readiness.can_run) {
    return;
  }
  if (readiness.mode === "bundled") {
    throw new Error(
      "automation.ai_credits_required: No bundled AI credits are available for this org. Purchase more credits in Billing or upgrade to a higher plan.",
    );
  }
  throw new Error(
    `automation.byok_required: No active ${getAiModelProviderLabel(params.provider)} API key is configured for this org. Add one in Settings -> AI Keys.`,
  );
};

export const createAutomationCore = async (
  ctx: MutationCtx,
  auth: {
    orgId: string;
    userId: string;
    workspace: Doc<"workspaces">;
  },
  args: CreateAutomationCoreArgs,
) => {
  await enforceRateLimit(ctx, {
    key: `automation-create:${auth.workspace.id}`,
    limit: AUTOMATION_CREATE_RATE_LIMIT.limit,
    windowMs: AUTOMATION_CREATE_RATE_LIMIT.windowMs,
    message: "Too many automation creation attempts.",
  });
  const subscription = await ctx.runQuery(refs.getSubscriptionForOrg, {
    orgId: auth.orgId,
  });
  const tier = subscription?.tier ?? SUBSCRIPTION_TIER.free;
  const limits = getTierConfig(tier).automation_limits;
  const existingCount =
    typeof auth.workspace.automation_count === "number"
      ? auth.workspace.automation_count
      : (
          await ctx.db
            .query("automations")
            .withIndex("by_workspace", (q) => q.eq("workspace_id", args.workspace_id))
            .take(AUTOMATION_SCAN_BUDGET)
        ).length;

  if (existingCount >= limits.max_automations_per_workspace) {
    throw new ConvexError({
      code: "AUTOMATION_LIMIT_REACHED",
      current_count: existingCount,
      max_count: limits.max_automations_per_workspace,
      tier,
    });
  }

  const createdAt = nowIso();
  const automationId = randomIdFor("automation");
  const configId = randomIdFor("acv");
  const config = normalizeConfig(args, auth.userId, createdAt);
  await ctx.db.patch(auth.workspace._id, {
    automation_count: existingCount + 1,
  });

  await ctx.db.insert("automation_config_versions", {
    id: configId,
    automation_id: automationId,
    version_number: 1,
    ...config,
  });

  await ctx.db.insert("automations", {
    id: automationId,
    org_id: auth.orgId,
    workspace_id: args.workspace_id,
    slug: await buildUniqueAutomationSlug(ctx, args.workspace_id, args.name),
    name: requireBoundedString(args.name, {
      field: "name",
      maxLength: AUTOMATION_NAME_MAX_LENGTH,
    }),
    description: requireBoundedString(args.description, {
      field: "description",
      maxLength: AUTOMATION_DESCRIPTION_MAX_LENGTH,
      allowEmpty: true,
    }),
    mermaid_content: normalizeMermaidContent(args.mermaid_content) ?? null,
    mermaid_prompt_hash: resolveMermaidPromptHash({
      prompt: config.prompt,
      mermaidContent: normalizeMermaidContent(args.mermaid_content) ?? null,
    }),
    status: AUTOMATION_STATUS.active,
    current_config_version_id: configId,
    next_config_version_number: 2,
    created_by: auth.userId,
    created_at: createdAt,
    updated_at: createdAt,
  });

  const warning = null;

  await insertAudit(ctx, auth.orgId, auth.userId, AUDIT_EVENT_TYPES.automationCreated, {
    automation_id: automationId,
    workspace_id: args.workspace_id,
    current_config_version_id: configId,
    trigger_type: args.trigger_type,
    runner_type: args.runner_type,
    warning,
  });

  const automation = await ctx.db
    .query("automations")
    .withIndex("by_custom_id", (q) => q.eq("id", automationId))
    .unique();
  const version = await loadConfigVersion(ctx, configId);
  if (!automation || !version) {
    throw new Error("Failed to create automation");
  }
  return {
    automation: toAutomationView(automation),
    config_version: toAutomationConfigVersionView(version),
    warning,
  };
};

export const listAutomations = query({
  args: {
    workspace_id: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginatedAutomationSummariesValidator,
  handler: async (ctx, args) => {
    await requireWorkspaceRole(ctx, args.workspace_id);
    const automationsPage = await ctx.db
      .query("automations")
      .withIndex("by_workspace", (q) => q.eq("workspace_id", args.workspace_id))
      .order("desc")
      .paginate(args.paginationOpts);
    const page = await Promise.all(
      automationsPage.page.map(async (automation) => {
        const currentConfig = await loadConfigVersion(ctx, automation.current_config_version_id);
        const latestRun = await ctx.db
          .query("automation_runs")
          .withIndex("by_automation", (q) => q.eq("automation_id", automation.id))
          .order("desc")
          .first();
        return {
          automation: toAutomationView(automation),
          current_config_version: currentConfig ? toAutomationConfigSummary(currentConfig) : null,
          latest_run: latestRun
            ? {
                id: latestRun.id,
                automation_id: latestRun.automation_id ?? automation.id,
                org_id: latestRun.org_id ?? automation.org_id,
                workspace_id: latestRun.workspace_id ?? automation.workspace_id,
                config_version_id:
                  latestRun.config_version_id ?? automation.current_config_version_id,
                trigger_type: latestRun.trigger_type ?? currentConfig?.trigger_type ?? "manual",
                status: normalizeAutomationRunStatus(latestRun),
                created_at: latestRun.created_at ?? latestRun.started_at ?? nowIso(),
                started_at: latestRun.started_at ?? null,
                ended_at: latestRun.ended_at ?? null,
                error_message: latestRun.error_message ?? null,
              }
            : null,
        };
      }),
    );
    return {
      page,
      isDone: automationsPage.isDone,
      continueCursor: automationsPage.continueCursor,
    };
  },
});

export const listOrgAutomationKeyUsage = query({
  args: {
    org_id: v.string(),
  },
  returns: v.array(orgAutomationKeyUsageValidator),
  handler: async (ctx, args) => {
    const auth = await requireOrgMember(ctx);
    if (auth.orgId !== args.org_id) {
      throw new Error("Forbidden");
    }

    const automations = await ctx.db
      .query("automations")
      .withIndex("by_org", (q) => q.eq("org_id", args.org_id))
      .take(AUTOMATION_SCAN_BUDGET);
    const counts = new Map<
      string,
      {
        provider: "openai" | "anthropic";
        key_mode: "byok" | "bundled" | "subscription_token";
        count: number;
      }
    >();

    const providers = new Set<AiModelProvider>();
    const automationConfigs = new Map<string, Doc<"automation_config_versions">>();
    for (const automation of automations) {
      const config = await loadConfigVersion(ctx, automation.current_config_version_id);
      if (!config) {
        continue;
      }
      automationConfigs.set(automation.id, config);
      providers.add(config.ai_model_provider);
    }

    const executionStateByProvider = new Map<
      AiModelProvider,
      Awaited<ReturnType<typeof getAutomationExecutionState>>
    >();
    for (const provider of providers) {
      executionStateByProvider.set(
        provider,
        await getAutomationExecutionState(ctx, {
          orgId: args.org_id,
          provider,
        }),
      );
    }

    for (const automation of automations) {
      const config = automationConfigs.get(automation.id);
      if (!config) {
        continue;
      }
      const readiness = executionStateByProvider.get(config.ai_model_provider);
      if (!readiness) {
        continue;
      }
      const key = `${config.ai_model_provider}:${readiness.key_mode}`;
      const existing = counts.get(key);
      if (existing) {
        existing.count += 1;
        continue;
      }
      counts.set(key, {
        provider: config.ai_model_provider,
        key_mode: readiness.key_mode,
        count: 1,
      });
    }

    return [...counts.values()].sort((a, b) => b.count - a.count);
  },
});

export const getAutomation = query({
  args: {
    automation_id: v.string(),
    workspace_id: v.optional(v.string()),
  },
  returns: v.union(automationWithCurrentConfigValidator, v.null()),
  handler: async (ctx, args) => {
    const automation =
      args.workspace_id === undefined
        ? (await requireAutomationRole(ctx, args.automation_id)).automation
        : await resolveAutomationLookup(ctx, args.workspace_id, args.automation_id);
    if (!automation) {
      return null;
    }
    const auth = await requireWorkspaceRole(ctx, automation.workspace_id);
    if (auth.orgId !== automation.org_id) {
      throw new Error("Forbidden");
    }
    const currentConfig = await loadConfigVersion(ctx, automation.current_config_version_id);
    return {
      automation: toAutomationView(automation),
      current_config_version: currentConfig ? toAutomationConfigVersionView(currentConfig) : null,
    };
  },
});

export const listConfigVersions = query({
  args: { automation_id: v.string() },
  returns: v.array(automationConfigVersionValidator),
  handler: async (ctx, args) => {
    await requireAutomationRole(ctx, args.automation_id);
    const versions = await ctx.db
      .query("automation_config_versions")
      .withIndex("by_automation_version", (q) => q.eq("automation_id", args.automation_id))
      .order("desc")
      .take(AUTOMATION_SCAN_BUDGET);
    return versions.map(toAutomationConfigVersionView);
  },
});

export const getConfigVersion = query({
  args: { config_version_id: v.string() },
  returns: v.union(automationConfigVersionValidator, v.null()),
  handler: async (ctx, args) => {
    const config = await loadConfigVersion(ctx, args.config_version_id);
    if (!config) {
      return null;
    }
    await requireAutomationRole(ctx, config.automation_id);
    return toAutomationConfigVersionView(config);
  },
});

export const createAutomation = mutation({
  args: {
    workspace_id: v.string(),
    name: v.string(),
    description: v.string(),
    mermaid_content: v.optional(v.string()),
    ...configInputValidator,
  },
  returns: v.object({
    automation: automationValidator,
    config_version: automationConfigVersionValidator,
    warning: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const auth = await requireWorkspaceRole(ctx, args.workspace_id, [
      USER_ROLE.owner,
      USER_ROLE.admin,
    ]);
    return await createAutomationCore(ctx, auth, args);
  },
});

export const updateAutomationConfig = mutation({
  args: {
    automation_id: v.string(),
    change_summary: v.optional(v.string()),
    ...configInputValidator,
  },
  returns: v.object({
    automation: automationValidator,
    config_version: automationConfigVersionValidator,
  }),
  handler: async (ctx, args) => {
    const resolved = await requireAutomationRole(ctx, args.automation_id, [
      USER_ROLE.owner,
      USER_ROLE.admin,
    ]);
    await enforceRateLimit(ctx, {
      key: `automation-config:${resolved.automation.workspace_id}`,
      limit: AUTOMATION_CONFIG_RATE_LIMIT.limit,
      windowMs: AUTOMATION_CONFIG_RATE_LIMIT.windowMs,
      message: "Too many automation configuration changes.",
    });
    const createdAt = nowIso();
    const versionNumber = await reserveNextVersionNumber(ctx, resolved.automation);
    const configId = randomIdFor("acv");
    const config = normalizeConfig(args, resolved.auth.userId, createdAt, args.change_summary);

    await ctx.db.insert("automation_config_versions", {
      id: configId,
      automation_id: args.automation_id,
      version_number: versionNumber,
      ...config,
    });

    await ctx.db.patch(resolved.automation._id, {
      current_config_version_id: configId,
      updated_at: createdAt,
    });

    await insertAudit(
      ctx,
      resolved.auth.orgId,
      resolved.auth.userId,
      AUDIT_EVENT_TYPES.automationConfigUpdated,
      {
        automation_id: args.automation_id,
        config_version_id: configId,
        version_number: versionNumber,
        change_summary: config.change_summary,
      },
    );

    const updatedAutomation = await ctx.db
      .query("automations")
      .withIndex("by_custom_id", (q) => q.eq("id", args.automation_id))
      .unique();
    const version = await loadConfigVersion(ctx, configId);
    if (!updatedAutomation || !version) {
      throw new Error("Failed to update automation config");
    }
    return {
      automation: toAutomationView(updatedAutomation),
      config_version: toAutomationConfigVersionView(version),
    };
  },
});

export const rollbackAutomationConfig = mutation({
  args: {
    automation_id: v.string(),
    config_version_id: v.string(),
  },
  returns: automationValidator,
  handler: async (ctx, args) => {
    const resolved = await requireAutomationRole(ctx, args.automation_id, [
      USER_ROLE.owner,
      USER_ROLE.admin,
    ]);
    const targetVersion = await loadConfigVersion(ctx, args.config_version_id);
    if (!targetVersion || targetVersion.automation_id !== args.automation_id) {
      throw new Error("ConfigVersionNotFound");
    }

    await ctx.db.patch(resolved.automation._id, {
      current_config_version_id: args.config_version_id,
      updated_at: nowIso(),
    });

    await insertAudit(
      ctx,
      resolved.auth.orgId,
      resolved.auth.userId,
      AUDIT_EVENT_TYPES.automationConfigRolledBack,
      {
        automation_id: args.automation_id,
        config_version_id: args.config_version_id,
        target_version_number: targetVersion.version_number,
      },
    );

    const updated = await ctx.db
      .query("automations")
      .withIndex("by_custom_id", (q) => q.eq("id", args.automation_id))
      .unique();
    if (!updated) {
      throw new Error("AutomationNotFound");
    }
    return toAutomationView(updated);
  },
});

export const updateAutomationStatus = mutation({
  args: {
    automation_id: v.string(),
    status: automationStatusValidator,
  },
  returns: automationValidator,
  handler: async (ctx, args) => {
    const resolved = await requireAutomationRole(ctx, args.automation_id, [
      USER_ROLE.owner,
      USER_ROLE.admin,
    ]);
    if (resolved.automation.status === args.status) {
      return toAutomationView(resolved.automation);
    }

    if (args.status === AUTOMATION_STATUS.active) {
      const config = await loadConfigVersion(ctx, resolved.automation.current_config_version_id);
      if (!config) {
        throw new Error("ConfigVersionNotFound");
      }
      await assertAutomationExecutionReady(ctx, {
        orgId: resolved.auth.orgId,
        provider: config.ai_model_provider,
      });
    }

    const updatedAt = nowIso();
    await ctx.db.patch(resolved.automation._id, {
      status: args.status,
      updated_at: updatedAt,
    });

    if (args.status === AUTOMATION_STATUS.paused) {
      const runs = await ctx.db
        .query("automation_runs")
        .withIndex("by_automation", (q) => q.eq("automation_id", args.automation_id))
        .take(AUTOMATION_SCAN_BUDGET);
      const activeRuns = runs.filter((run) => run.status === RUN_STATUS.active);
      for (const run of activeRuns) {
        await ctx.db.patch(run._id, {
          status: RUN_STATUS.ended,
          ended_at: run.ended_at ?? updatedAt,
          error_message: run.error_message ?? "Run cancelled because automation was paused",
        });
      }
    }

    await insertAudit(
      ctx,
      resolved.auth.orgId,
      resolved.auth.userId,
      AUDIT_EVENT_TYPES.automationStatusUpdated,
      {
        automation_id: args.automation_id,
        previous_status: resolved.automation.status,
        status: args.status,
      },
    );

    const updated = await ctx.db
      .query("automations")
      .withIndex("by_custom_id", (q) => q.eq("id", args.automation_id))
      .unique();
    if (!updated) {
      throw new Error("AutomationNotFound");
    }
    return toAutomationView(updated);
  },
});

export const deleteAutomation = mutation({
  args: { automation_id: v.string() },
  returns: v.object({ deleted: v.boolean() }),
  handler: async (ctx, args) => {
    const resolved = await requireAutomationRole(ctx, args.automation_id, [
      USER_ROLE.owner,
      USER_ROLE.admin,
    ]);

    const currentWorkspaceCount =
      typeof resolved.auth.workspace.automation_count === "number"
        ? resolved.auth.workspace.automation_count
        : (
            await ctx.db
              .query("automations")
              .withIndex("by_workspace", (q) =>
                q.eq("workspace_id", resolved.automation.workspace_id),
              )
              .take(AUTOMATION_SCAN_BUDGET)
          ).length;
    await ctx.db.patch(resolved.auth.workspace._id, {
      automation_count: Math.max(0, currentWorkspaceCount - 1),
    });

    await cascadeDeleteAutomationDescendants(ctx, args.automation_id);
    await ctx.db.delete(resolved.automation._id);
    await insertAudit(
      ctx,
      resolved.auth.orgId,
      resolved.auth.userId,
      AUDIT_EVENT_TYPES.automationDeleted,
      {
        automation_id: args.automation_id,
        workspace_id: resolved.automation.workspace_id,
      },
    );
    return { deleted: true };
  },
});

export const updateAutomationMeta = mutation({
  args: {
    automation_id: v.string(),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    mermaid_content: v.optional(v.string()),
    prompt: v.optional(v.string()),
  },
  returns: automationValidator,
  handler: async (ctx, args) => {
    const resolved = await requireAutomationRole(ctx, args.automation_id, [
      USER_ROLE.owner,
      USER_ROLE.admin,
    ]);
    const name = args.name?.trim();
    const description = args.description?.trim();
    const mermaidContent = args.mermaid_content?.trim();
    if (name === undefined && description === undefined && mermaidContent === undefined) {
      return toAutomationView(resolved.automation);
    }

    const nextName =
      name &&
      requireBoundedString(name, {
        field: "name",
        maxLength: AUTOMATION_NAME_MAX_LENGTH,
      });
    const nextDescription =
      description === undefined
        ? undefined
        : requireBoundedString(description, {
            field: "description",
            maxLength: AUTOMATION_DESCRIPTION_MAX_LENGTH,
            allowEmpty: true,
          });
    const nextMermaidContent =
      mermaidContent === undefined ? undefined : normalizeMermaidContent(mermaidContent);
    let currentPrompt: string | undefined;
    if (nextMermaidContent !== undefined) {
      const currentConfig = await loadConfigVersion(
        ctx,
        resolved.automation.current_config_version_id,
      );
      if (!currentConfig) {
        throw new Error("ConfigVersionNotFound");
      }
      currentPrompt = currentConfig.prompt;
    }
    const nextMermaidPromptHash =
      nextMermaidContent === undefined
        ? undefined
        : resolveMermaidPromptHash({
            prompt: args.prompt?.trim() || currentPrompt || "",
            mermaidContent: nextMermaidContent,
          });
    const nextSlug =
      nextName && nextName !== resolved.automation.name
        ? await buildUniqueAutomationSlug(
            ctx,
            resolved.automation.workspace_id,
            nextName,
            resolved.automation.id,
          )
        : resolved.automation.slug;

    await ctx.db.patch(resolved.automation._id, {
      ...(nextName
        ? {
            name: nextName,
            slug: nextSlug,
          }
        : {}),
      ...(nextDescription !== undefined
        ? {
            description: nextDescription,
          }
        : {}),
      ...(nextMermaidContent !== undefined
        ? {
            mermaid_content: nextMermaidContent,
            mermaid_prompt_hash: nextMermaidPromptHash,
          }
        : {}),
      updated_at: nowIso(),
    });

    await insertAudit(
      ctx,
      resolved.auth.orgId,
      resolved.auth.userId,
      AUDIT_EVENT_TYPES.automationMetaUpdated,
      {
        automation_id: args.automation_id,
        ...(nextName
          ? {
              name: nextName,
              slug: nextSlug,
            }
          : {}),
        ...(nextDescription !== undefined
          ? {
              description: nextDescription,
            }
          : {}),
        ...(nextMermaidContent !== undefined
          ? {
              mermaid_content: nextMermaidContent,
              mermaid_prompt_hash: nextMermaidPromptHash,
            }
          : {}),
      },
    );

    const updated = await ctx.db
      .query("automations")
      .withIndex("by_custom_id", (q) => q.eq("id", args.automation_id))
      .unique();
    if (!updated) {
      throw new Error("AutomationNotFound");
    }
    return toAutomationView(updated);
  },
});

export const regenerateAutomationMermaid = mutation({
  args: {
    automation_id: v.string(),
    mermaid_content: v.string(),
  },
  returns: automationValidator,
  handler: async (ctx, args) => {
    const resolved = await requireAutomationRole(ctx, args.automation_id, [
      USER_ROLE.owner,
      USER_ROLE.admin,
    ]);
    const currentConfig = await loadConfigVersion(
      ctx,
      resolved.automation.current_config_version_id,
    );
    if (!currentConfig) {
      throw new Error("ConfigVersionNotFound");
    }
    const mermaidContent = normalizeMermaidContent(args.mermaid_content) ?? null;
    await ctx.db.patch(resolved.automation._id, {
      mermaid_content: mermaidContent,
      mermaid_prompt_hash: resolveMermaidPromptHash({
        prompt: currentConfig.prompt,
        mermaidContent,
      }),
      updated_at: nowIso(),
    });

    await insertAudit(
      ctx,
      resolved.auth.orgId,
      resolved.auth.userId,
      AUDIT_EVENT_TYPES.automationMetaUpdated,
      {
        automation_id: args.automation_id,
        mermaid_content: mermaidContent,
      },
    );

    const updated = await ctx.db
      .query("automations")
      .withIndex("by_custom_id", (q) => q.eq("id", args.automation_id))
      .unique();
    if (!updated) {
      throw new Error("AutomationNotFound");
    }
    return toAutomationView(updated);
  },
});

export const applyAutomationDraft = mutation({
  args: {
    automation_id: v.string(),
    name: v.string(),
    description: v.string(),
    mermaid_content: v.string(),
    change_summary: v.optional(v.string()),
    ...configInputValidator,
  },
  returns: v.object({
    automation: automationValidator,
    config_version: automationConfigVersionValidator,
  }),
  handler: async (ctx, args) => {
    const resolved = await requireAutomationRole(ctx, args.automation_id, [
      USER_ROLE.owner,
      USER_ROLE.admin,
    ]);
    await enforceRateLimit(ctx, {
      key: `automation-config:${resolved.automation.workspace_id}`,
      limit: AUTOMATION_CONFIG_RATE_LIMIT.limit,
      windowMs: AUTOMATION_CONFIG_RATE_LIMIT.windowMs,
      message: "Too many automation configuration changes.",
    });

    const createdAt = nowIso();
    const versionNumber = await reserveNextVersionNumber(ctx, resolved.automation);
    const configId = randomIdFor("acv");
    const config = normalizeConfig(args, resolved.auth.userId, createdAt, args.change_summary);
    const nextName = requireBoundedString(args.name, {
      field: "name",
      maxLength: AUTOMATION_NAME_MAX_LENGTH,
    });
    const nextDescription = requireBoundedString(args.description, {
      field: "description",
      maxLength: AUTOMATION_DESCRIPTION_MAX_LENGTH,
      allowEmpty: true,
    });
    const nextMermaidContent = normalizeMermaidContent(args.mermaid_content) ?? null;
    const nextSlug =
      nextName !== resolved.automation.name
        ? await buildUniqueAutomationSlug(
            ctx,
            resolved.automation.workspace_id,
            nextName,
            resolved.automation.id,
          )
        : resolved.automation.slug;

    await ctx.db.insert("automation_config_versions", {
      id: configId,
      automation_id: args.automation_id,
      version_number: versionNumber,
      ...config,
    });

    await ctx.db.patch(resolved.automation._id, {
      name: nextName,
      slug: nextSlug,
      description: nextDescription,
      mermaid_content: nextMermaidContent,
      mermaid_prompt_hash: resolveMermaidPromptHash({
        prompt: config.prompt,
        mermaidContent: nextMermaidContent,
      }),
      current_config_version_id: configId,
      updated_at: createdAt,
    });

    await insertAudit(
      ctx,
      resolved.auth.orgId,
      resolved.auth.userId,
      AUDIT_EVENT_TYPES.automationConfigUpdated,
      {
        automation_id: args.automation_id,
        config_version_id: configId,
        version_number: versionNumber,
        change_summary: config.change_summary,
        applied_via: "ai_edit",
      },
    );

    await insertAudit(
      ctx,
      resolved.auth.orgId,
      resolved.auth.userId,
      AUDIT_EVENT_TYPES.automationMetaUpdated,
      {
        automation_id: args.automation_id,
        name: nextName,
        slug: nextSlug,
        description: nextDescription,
        mermaid_content: nextMermaidContent,
      },
    );

    const updatedAutomation = await ctx.db
      .query("automations")
      .withIndex("by_custom_id", (q) => q.eq("id", args.automation_id))
      .unique();
    const version = await loadConfigVersion(ctx, configId);
    if (!updatedAutomation || !version) {
      throw new Error("Failed to apply automation draft");
    }
    return {
      automation: toAutomationView(updatedAutomation),
      config_version: toAutomationConfigVersionView(version),
    };
  },
});
