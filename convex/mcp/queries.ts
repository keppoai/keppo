import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import { decryptSecretValue } from "../crypto_helpers";
import { ACTION_STATUS, INTEGRATION_STATUS, RUN_STATUS } from "../domain_constants";
import { listConnectedProviderIdsForOrg } from "../integrations/read_model";
import { normalizeJsonRecord } from "../mcp_runtime_shared";
import { assertCanonicalStoredProvider, canonicalizeProvider } from "../provider_ids";
import { toWorkspaceBoundary } from "../workspaces_shared";
import {
  actionStatusValidator,
  jsonRecordValidator,
  providerValidator,
  ruleEffectValidator,
} from "../validators";
import {
  createMcpExecutionFailedError,
  actionValidator,
  findOrgIntegrationByProvider,
  integrationContextValidator,
  runValidator,
  toolCallValidator,
  workspaceValidator,
} from "./shared";

const normalizeNullableString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const normalizeStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

export const getRunBySession = internalQuery({
  args: {
    workspaceId: v.string(),
    sessionId: v.string(),
  },
  returns: v.union(runValidator, v.null()),
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("automation_runs")
      .withIndex("by_workspace_session_status", (q) =>
        q
          .eq("workspace_id", args.workspaceId)
          .eq("mcp_session_id", args.sessionId)
          .eq("status", RUN_STATUS.active),
      )
      .first();
    if (!run) {
      return null;
    }
    return {
      id: run.id,
      workspace_id: run.workspace_id ?? args.workspaceId,
      mcp_session_id: run.mcp_session_id,
      client_type: run.client_type,
      metadata: normalizeJsonRecord(run.metadata),
      started_at: run.started_at,
      ended_at: run.ended_at,
      status: run.status,
    };
  },
});

export const getToolCall = internalQuery({
  args: {
    toolCallId: v.string(),
  },
  returns: v.union(toolCallValidator, v.null()),
  handler: async (ctx, args) => {
    const toolCall = await ctx.db
      .query("tool_calls")
      .withIndex("by_custom_id", (q) => q.eq("id", args.toolCallId))
      .unique();
    if (!toolCall) {
      return null;
    }
    return {
      id: toolCall.id,
      automation_run_id: toolCall.automation_run_id,
      tool_name: toolCall.tool_name,
      input_redacted: normalizeJsonRecord(toolCall.input_redacted),
      output_redacted: toolCall.output_redacted
        ? normalizeJsonRecord(toolCall.output_redacted)
        : null,
      status: toolCall.status,
      raw_input_blob_id: toolCall.raw_input_blob_id,
      raw_output_blob_id: toolCall.raw_output_blob_id,
      latency_ms: toolCall.latency_ms,
      created_at: toolCall.created_at,
    };
  },
});

export const findActionByIdempotency = internalQuery({
  args: {
    workspaceId: v.string(),
    idempotencyKey: v.string(),
  },
  returns: v.union(actionValidator, v.null()),
  handler: async (ctx, args) => {
    const candidates = await ctx.db
      .query("actions")
      .withIndex("by_idempotency_key", (q) => q.eq("idempotency_key", args.idempotencyKey))
      .collect();

    // Idempotency keys are payload-derived and can repeat across workspaces.
    // Match only directly-owned workspace rows and ignore legacy rows that still
    // require a run lookup.
    const sortedCandidates = [...candidates].sort((a, b) =>
      a.created_at.localeCompare(b.created_at),
    );
    for (const action of sortedCandidates) {
      if (action.workspace_id !== args.workspaceId) {
        continue;
      }

      return {
        id: action.id,
        automation_run_id: action.automation_run_id,
        tool_call_id: action.tool_call_id,
        action_type: action.action_type,
        risk_level: action.risk_level,
        normalized_payload_enc: action.normalized_payload_enc,
        payload_preview: normalizeJsonRecord(action.payload_preview),
        payload_purged_at: action.payload_purged_at,
        status: action.status,
        idempotency_key: action.idempotency_key,
        created_at: action.created_at,
        resolved_at: action.resolved_at,
        result_redacted: action.result_redacted
          ? normalizeJsonRecord(action.result_redacted)
          : null,
      };
    }

    return null;
  },
});

export const loadGatingData = internalQuery({
  args: {
    workspaceId: v.string(),
  },
  returns: v.object({
    workspace: workspaceValidator,
    cel_rules: v.array(
      v.object({
        id: v.string(),
        workspace_id: v.string(),
        name: v.string(),
        description: v.string(),
        expression: v.string(),
        effect: ruleEffectValidator,
        enabled: v.boolean(),
        created_by: v.string(),
        created_at: v.string(),
      }),
    ),
    tool_auto_approvals: v.array(
      v.object({
        id: v.string(),
        workspace_id: v.string(),
        tool_name: v.string(),
        enabled: v.boolean(),
        created_by: v.string(),
        created_at: v.string(),
      }),
    ),
    policies: v.array(
      v.object({
        id: v.string(),
        workspace_id: v.string(),
        text: v.string(),
        enabled: v.boolean(),
        created_by: v.string(),
        created_at: v.string(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_custom_id", (q) => q.eq("id", args.workspaceId))
      .unique();
    if (!workspace) {
      throw createMcpExecutionFailedError("Workspace not found");
    }

    const [celRules, autoApprovals, policies] = await Promise.all([
      ctx.db
        .query("cel_rules")
        .withIndex("by_workspace", (q) => q.eq("workspace_id", args.workspaceId))
        .collect(),
      ctx.db
        .query("tool_auto_approvals")
        .withIndex("by_workspace", (q) => q.eq("workspace_id", args.workspaceId))
        .collect(),
      ctx.db
        .query("policies")
        .withIndex("by_workspace", (q) => q.eq("workspace_id", args.workspaceId))
        .collect(),
    ]);

    return {
      workspace: toWorkspaceBoundary(workspace),
      cel_rules: celRules.map((row) => ({
        id: row.id,
        workspace_id: row.workspace_id,
        name: row.name,
        description: row.description,
        expression: row.expression,
        effect: row.effect,
        enabled: row.enabled,
        created_by: row.created_by,
        created_at: row.created_at,
      })),
      tool_auto_approvals: autoApprovals.map((row) => ({
        id: row.id,
        workspace_id: row.workspace_id,
        tool_name: row.tool_name,
        enabled: row.enabled,
        created_by: row.created_by,
        created_at: row.created_at,
      })),
      policies: policies.map((row) => ({
        id: row.id,
        workspace_id: row.workspace_id,
        text: row.text,
        enabled: row.enabled,
        created_by: row.created_by,
        created_at: row.created_at,
      })),
    };
  },
});

export const getActionState = internalQuery({
  args: {
    actionId: v.string(),
  },
  returns: v.union(
    v.object({
      action: actionValidator,
      run: runValidator,
      workspace: workspaceValidator,
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const action = await ctx.db
      .query("actions")
      .withIndex("by_custom_id", (q) => q.eq("id", args.actionId))
      .unique();
    if (!action) {
      return null;
    }

    const run = await ctx.db
      .query("automation_runs")
      .withIndex("by_custom_id", (q) => q.eq("id", action.automation_run_id))
      .unique();
    if (!run?.workspace_id) {
      return null;
    }

    const workspaceId = run.workspace_id;
    const workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_custom_id", (q) => q.eq("id", workspaceId))
      .unique();
    if (!workspace) {
      return null;
    }

    return {
      action: {
        id: action.id,
        automation_run_id: action.automation_run_id,
        tool_call_id: action.tool_call_id,
        action_type: action.action_type,
        risk_level: action.risk_level,
        normalized_payload_enc: action.normalized_payload_enc,
        payload_preview: normalizeJsonRecord(action.payload_preview),
        payload_purged_at: action.payload_purged_at,
        status: action.status,
        idempotency_key: action.idempotency_key,
        created_at: action.created_at,
        resolved_at: action.resolved_at,
        result_redacted: action.result_redacted
          ? normalizeJsonRecord(action.result_redacted)
          : null,
      },
      run: {
        id: run.id,
        workspace_id: run.workspace_id,
        mcp_session_id: run.mcp_session_id,
        client_type: run.client_type,
        metadata: normalizeJsonRecord(run.metadata),
        started_at: run.started_at,
        ended_at: run.ended_at,
        status: run.status,
      },
      workspace: toWorkspaceBoundary(workspace),
    };
  },
});

export const listActionsByStatus = internalQuery({
  args: {
    status: actionStatusValidator,
    limit: v.optional(v.number()),
  },
  returns: v.array(actionValidator),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("actions")
      .withIndex("by_status_created", (q) => q.eq("status", args.status))
      .order("desc")
      .take(Math.max(1, args.limit ?? 50));
    return rows.map((row) => ({
      id: row.id,
      automation_run_id: row.automation_run_id,
      tool_call_id: row.tool_call_id,
      action_type: row.action_type,
      risk_level: row.risk_level,
      normalized_payload_enc: row.normalized_payload_enc,
      payload_preview: normalizeJsonRecord(row.payload_preview),
      payload_purged_at: row.payload_purged_at,
      status: row.status,
      idempotency_key: row.idempotency_key,
      created_at: row.created_at,
      resolved_at: row.resolved_at,
      result_redacted: row.result_redacted ? normalizeJsonRecord(row.result_redacted) : null,
    }));
  },
});

export const listApprovedActionDispatches = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      actionId: v.string(),
      workspaceId: v.string(),
      idempotencyKey: v.string(),
      createdAt: v.string(),
      e2eNamespace: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const limit = Math.max(0, Math.floor(args.limit ?? 50));
    if (limit === 0) {
      return [];
    }
    const approvedActions = await ctx.db
      .query("actions")
      .withIndex("by_status_created", (q) => q.eq("status", ACTION_STATUS.approved))
      .order("desc")
      .take(limit);

    const uniqueRunIds = [...new Set(approvedActions.map((action) => action.automation_run_id))];
    const runs = await Promise.all(
      uniqueRunIds.map(async (runId) => {
        const run = await ctx.db
          .query("automation_runs")
          .withIndex("by_custom_id", (q) => q.eq("id", runId))
          .unique();
        const metadata = normalizeJsonRecord(run?.metadata);
        const e2eNamespace =
          typeof metadata.e2e_namespace === "string" && metadata.e2e_namespace.trim()
            ? metadata.e2e_namespace.trim()
            : null;
        return run ? { runId, workspaceId: run.workspace_id, e2eNamespace } : null;
      }),
    );
    const workspaceByRunId = new Map(
      runs
        .filter(
          (entry): entry is { runId: string; workspaceId: string; e2eNamespace: string | null } =>
            entry !== null,
        )
        .map((entry) => [entry.runId, entry]),
    );

    return approvedActions.flatMap((action) => {
      const runContext = workspaceByRunId.get(action.automation_run_id);
      if (!runContext) {
        return [];
      }
      return [
        {
          actionId: action.id,
          workspaceId: runContext.workspaceId,
          idempotencyKey: action.idempotency_key,
          createdAt: action.created_at,
          ...(runContext.e2eNamespace ? { e2eNamespace: runContext.e2eNamespace } : {}),
        },
      ];
    });
  },
});

export const listPendingActionsForWorkspace = internalQuery({
  args: {
    workspaceId: v.string(),
  },
  returns: v.array(
    v.object({
      id: v.string(),
      status: actionStatusValidator,
      payload_preview: jsonRecordValidator,
      created_at: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const actions = await ctx.db
      .query("actions")
      .withIndex("by_workspace_status_created", (q) =>
        q.eq("workspace_id", args.workspaceId).eq("status", ACTION_STATUS.pending),
      )
      .order("desc")
      .collect();

    return actions.map((action) => ({
      id: action.id,
      status: action.status,
      payload_preview: normalizeJsonRecord(action.payload_preview),
      created_at: action.created_at,
    }));
  },
});

export const loadConnectorContext = internalQuery({
  args: {
    workspaceId: v.string(),
    provider: providerValidator,
  },
  returns: integrationContextValidator,
  handler: async (ctx, args) => {
    const provider = canonicalizeProvider(args.provider);
    const workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_custom_id", (q) => q.eq("id", args.workspaceId))
      .unique();
    if (!workspace) {
      throw createMcpExecutionFailedError("Workspace not found");
    }

    const workspaceIntegrations = await ctx.db
      .query("workspace_integrations")
      .withIndex("by_workspace", (q) => q.eq("workspace_id", args.workspaceId))
      .collect();
    const providerEnabled =
      workspaceIntegrations.length === 0
        ? true
        : (workspaceIntegrations.find((entry) => entry.provider === provider)?.enabled ?? false);

    const integration = await findOrgIntegrationByProvider(ctx, workspace.org_id, provider);

    if (!integration || integration.status === INTEGRATION_STATUS.disconnected) {
      const payload = {
        workspace: toWorkspaceBoundary(workspace),
        provider_enabled: providerEnabled,
        integration_id: null,
        integration_provider: null,
        scopes: [],
        access_token: null,
        refresh_token: null,
        access_token_expires_at: null,
        integration_account_id: null,
        external_account_id: null,
        metadata: {},
      };
      return payload;
    }

    const account = await ctx.db
      .query("integration_accounts")
      .withIndex("by_integration", (q) => q.eq("integration_id", integration.id))
      .unique();
    const credential = account
      ? await ctx.db
          .query("integration_credentials")
          .withIndex("by_integration_account", (q) => q.eq("integration_account_id", account.id))
          .unique()
      : null;
    const accessToken =
      credential === null
        ? null
        : await decryptSecretValue(credential.access_token_enc, "integration_credentials");
    const refreshToken =
      credential?.refresh_token_enc === null || credential?.refresh_token_enc === undefined
        ? null
        : await decryptSecretValue(credential.refresh_token_enc, "integration_credentials");

    const payload = {
      workspace: toWorkspaceBoundary(workspace),
      provider_enabled: providerEnabled,
      integration_id: integration.id,
      integration_provider: assertCanonicalStoredProvider(
        integration.provider,
        `integrations:${integration.id}`,
      ),
      scopes: normalizeStringArray(account?.scopes),
      access_token: normalizeNullableString(accessToken),
      refresh_token: normalizeNullableString(refreshToken),
      access_token_expires_at: normalizeNullableString(credential?.expires_at),
      integration_account_id: normalizeNullableString(account?.id),
      external_account_id: normalizeNullableString(account?.external_account_id),
      metadata: normalizeJsonRecord(account?.metadata),
    };
    return payload;
  },
});

export const getWorkspaceCodeModeContext = internalQuery({
  args: {
    workspaceId: v.string(),
  },
  returns: v.object({
    workspace: workspaceValidator,
    enabled_providers: v.array(providerValidator),
    connected_providers: v.array(providerValidator),
    available_providers: v.array(providerValidator),
  }),
  handler: async (ctx, args) => {
    const workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_custom_id", (q) => q.eq("id", args.workspaceId))
      .unique();
    if (!workspace) {
      throw createMcpExecutionFailedError("Workspace not found");
    }

    const workspaceIntegrations = await ctx.db
      .query("workspace_integrations")
      .withIndex("by_workspace", (q) => q.eq("workspace_id", args.workspaceId))
      .collect();

    const enabledProviders = workspaceIntegrations
      .filter((row) => row.enabled)
      .map((row) => {
        return canonicalizeProvider(row.provider);
      });
    const connectedProviders = await listConnectedProviderIdsForOrg(ctx, workspace.org_id);
    const availableProviders =
      workspaceIntegrations.length === 0
        ? connectedProviders
        : enabledProviders.filter((provider) => connectedProviders.includes(provider));

    return {
      workspace: toWorkspaceBoundary(workspace),
      enabled_providers: enabledProviders,
      connected_providers: connectedProviders,
      available_providers: availableProviders,
    };
  },
});
