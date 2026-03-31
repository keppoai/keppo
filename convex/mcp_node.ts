"use node";

import { internal } from "./_generated/api";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { stableIdempotencyKey } from "../packages/shared/src/ids.js";
import { createApprovedActionHandlers } from "./mcp_node/approved_actions";
import { createCatalogActions } from "./mcp_node/catalog";
import { createExecuteToolCallHandler } from "./mcp_node/execution";
import { createInternalToolCallHandler } from "./mcp_node/internal_tools";
import { createMaintenanceActions } from "./mcp_node/maintenance";
import { createPollingHandlers } from "./mcp_node/polling";
import {
  assertIntegrationProviderMatch,
  assertProviderCapability,
  assertProviderRegistryPathEnabled,
  assertProviderRolloutEnabled,
  classifyIntegrationError,
  createRefreshConnectorContextAccessToken,
  createWorkerExecutionError,
  resolveToolOwnerProvider,
  toProviderRuntimeContext,
} from "./mcp_node/provider_runtime";
import { actionStatusValidator, jsonRecordValidator } from "./validators";
import { safeRunMutation } from "./safe_convex";

const refs = {
  getActionState: internal.mcp.getActionState,
  setActionStatus: internal.mcp.setActionStatus,
  listActionsByStatus: internal.mcp.listActionsByStatus,
  loadConnectorContext: internal.mcp.loadConnectorContext,
  loadGatingData: internal.mcp.loadGatingData,
  createToolCall: internal.mcp.createToolCall,
  updateToolCall: internal.mcp.updateToolCall,
  findActionByIdempotency: internal.mcp.findActionByIdempotency,
  createActionFromDecision: internal.mcp.createActionFromDecision,
  updatePendingPollTracker: internal.mcp.updatePendingPollTracker,
  recordPollAttempt: internal.mcp.recordPollAttempt,
  listPendingActionsForWorkspace: internal.mcp.listPendingActionsForWorkspace,
  getToolCall: internal.mcp.getToolCall,
  createAuditEvent: internal.mcp.createAuditEvent,
  markIntegrationHealth: internal.integrations.markIntegrationHealth,
  updateIntegrationCredential: internal.mcp.updateIntegrationCredential,
  markCredentialRefreshResult: internal.integrations.markCredentialRefreshResult,
  getOrgBillingForWorkspace: internal.billing.getOrgBillingForWorkspace,
  beginToolCall: internal.billing.beginToolCall,
  finishToolCall: internal.billing.finishToolCall,
  timeoutInactiveRuns: internal.mcp.timeoutInactiveRuns,
  expirePendingActions: internal.mcp.expirePendingActions,
  runSecurityMaintenance: internal.mcp.runSecurityMaintenance,
  recordAutomationRunOutcome: internal.automation_runs.recordAutomationRunOutcome,
  recordCronSuccess: internal.cron_heartbeats.recordSuccessInternal,
  recordCronFailure: internal.cron_heartbeats.recordFailureInternal,
  enqueueDeadLetter: internal.dead_letter.enqueue,
  getWorkspaceCodeModeContext: internal.mcp.getWorkspaceCodeModeContext,
  listCustomToolsForWorkspace: internal.custom_mcp.listToolsForWorkspace,
  executeApprovedCustomAction: internal.custom_mcp_node.executeApprovedCustomAction,
  scheduleApprovedAction: internal.mcp_dispatch.scheduleApprovedAction,
};

const refreshConnectorContextAccessToken = createRefreshConnectorContextAccessToken({
  markCredentialRefreshResult: async (ctx, args) => {
    await safeRunMutation("mcp_node.markCredentialRefreshResult", () =>
      ctx.runMutation(refs.markCredentialRefreshResult, args),
    );
  },
  updateIntegrationCredential: async (ctx, args) => {
    await safeRunMutation("mcp_node.updateIntegrationCredential", () =>
      ctx.runMutation(refs.updateIntegrationCredential, args),
    );
  },
});

const approvedActionHandlers = createApprovedActionHandlers({
  refs: {
    getActionState: refs.getActionState,
    setActionStatus: refs.setActionStatus,
    loadConnectorContext: refs.loadConnectorContext,
    createToolCall: refs.createToolCall,
    updateToolCall: refs.updateToolCall,
    createActionFromDecision: refs.createActionFromDecision,
    updatePendingPollTracker: refs.updatePendingPollTracker,
    recordPollAttempt: refs.recordPollAttempt,
    listPendingActionsForWorkspace: refs.listPendingActionsForWorkspace,
    getToolCall: refs.getToolCall,
    createAuditEvent: refs.createAuditEvent,
    markIntegrationHealth: refs.markIntegrationHealth,
    executeApprovedCustomAction: refs.executeApprovedCustomAction,
  },
  refreshConnectorContextAccessToken,
  resolveToolOwnerProvider,
  assertProviderRegistryPathEnabled,
  assertProviderCapability,
  assertProviderRolloutEnabled,
  assertIntegrationProviderMatch,
  toProviderRuntimeContext,
  classifyIntegrationError,
  createWorkerExecutionError,
});

const pollingHandlers = createPollingHandlers({
  recordPollAttempt: async (ctx, credentialId) =>
    await approvedActionHandlers.recordPollAttempt(ctx, credentialId),
  loadActionState: async (ctx, actionId) =>
    await approvedActionHandlers.loadActionState(ctx, actionId),
  toStatusPayload: async (ctx, params) => await approvedActionHandlers.toStatusPayload(ctx, params),
  executeApprovedAction: async (ctx, actionId) =>
    await approvedActionHandlers.executeApprovedActionImpl(ctx, actionId),
  isInlineApprovedActionProcessingEnabled: () =>
    process.env.KEPPO_PROCESS_APPROVED_ACTIONS_INLINE === "true",
});

export const executeApprovedAction = internalAction({
  args: {
    actionId: v.string(),
  },
  returns: v.object({
    status: actionStatusValidator,
    action: jsonRecordValidator,
  }),
  handler: async (ctx, args) => {
    const result = await approvedActionHandlers.executeApprovedActionImpl(ctx, args.actionId);
    return {
      status: result.status,
      action: { ...result.action },
    };
  },
});

export const dispatchApprovedAction = internalAction({
  args: {
    actionId: v.string(),
    source: v.optional(v.string()),
  },
  returns: v.object({
    dispatched: v.boolean(),
    reason: v.string(),
    messageId: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ dispatched: boolean; reason: string; messageId?: string }> =>
    await ctx.runMutation(refs.scheduleApprovedAction, {
      actionId: args.actionId,
      ...(args.source ? { source: args.source } : {}),
    }),
});

export const waitForAction = internalAction({
  args: {
    workspaceId: v.string(),
    credentialId: v.string(),
    actionId: v.string(),
    maxBlockMs: v.optional(v.number()),
  },
  returns: jsonRecordValidator,
  handler: async (ctx, args) => {
    return await pollingHandlers.waitForActionImpl(ctx, {
      workspaceId: args.workspaceId,
      credentialId: args.credentialId,
      actionId: args.actionId,
      maxBlockMs: Math.max(500, Math.min(10_000, args.maxBlockMs ?? 5000)),
    });
  },
});

export const waitForActions = internalAction({
  args: {
    workspaceId: v.string(),
    credentialId: v.string(),
    actionIds: v.array(v.string()),
    maxBlockMs: v.optional(v.number()),
  },
  returns: v.object({
    actions: v.array(jsonRecordValidator),
  }),
  handler: async (ctx, args) => {
    return await pollingHandlers.waitForActionsImpl(ctx, args);
  },
});

const handleInternalToolCall = createInternalToolCallHandler({
  waitForActionImpl: async (ctx, params) => await pollingHandlers.waitForActionImpl(ctx, params),
  waitForActionsImpl: async (ctx, params) => await pollingHandlers.waitForActionsImpl(ctx, params),
  loadActionState: async (ctx, actionId) =>
    await approvedActionHandlers.loadActionState(ctx, actionId),
  toStatusPayload: async (ctx, params) => await approvedActionHandlers.toStatusPayload(ctx, params),
  listPendingActionsForWorkspace: async (ctx, workspaceId) =>
    await approvedActionHandlers.listPendingActionsForInternalTool(ctx, workspaceId),
  createToolCall: async (ctx, params) =>
    await approvedActionHandlers.createToolCallForInternalTool(ctx, params),
  createActionFromDecision: async (ctx, params) =>
    await approvedActionHandlers.createActionFromDecisionForInternalTool(ctx, params),
  finalizeToolCallRecord: async (ctx, params) =>
    await approvedActionHandlers.finalizeToolCallRecord(ctx, params),
  recordAutomationRunOutcome: async (ctx, params) =>
    await ctx.runMutation(refs.recordAutomationRunOutcome, {
      workspace_id: params.workspaceId,
      automation_run_id: params.automationRunId,
      success: params.success,
      summary: params.summary,
    }),
  stableIdempotencyKey,
  createWorkerExecutionError,
});

const executeToolCallHandler = createExecuteToolCallHandler({
  refs: {
    loadConnectorContext: refs.loadConnectorContext,
    loadGatingData: refs.loadGatingData,
    createToolCall: refs.createToolCall,
    findActionByIdempotency: refs.findActionByIdempotency,
    createActionFromDecision: refs.createActionFromDecision,
    createAuditEvent: refs.createAuditEvent,
    markIntegrationHealth: refs.markIntegrationHealth,
    getOrgBillingForWorkspace: refs.getOrgBillingForWorkspace,
    beginToolCall: refs.beginToolCall,
    finishToolCall: refs.finishToolCall,
  },
  handleInternalToolCall: async (ctx, params) => await handleInternalToolCall(ctx, params),
  executeApprovedActionImpl: async (ctx, actionId) =>
    await approvedActionHandlers.executeApprovedActionImpl(ctx, actionId),
  finalizeToolCallRecord: async (ctx, params) =>
    await approvedActionHandlers.finalizeToolCallRecord(ctx, params),
  resolveToolOwnerProvider,
  assertProviderRegistryPathEnabled,
  assertProviderCapability,
  assertProviderRolloutEnabled,
  assertIntegrationProviderMatch,
  refreshConnectorContextAccessToken,
  toProviderRuntimeContext,
  classifyIntegrationError,
  createWorkerExecutionError,
});

export const executeToolCall = internalAction({
  args: {
    workspaceId: v.string(),
    runId: v.string(),
    automationRunId: v.optional(v.string()),
    toolName: v.string(),
    input: jsonRecordValidator,
    credentialId: v.string(),
  },
  returns: jsonRecordValidator,
  handler: async (ctx, args) => {
    return await executeToolCallHandler(ctx, args);
  },
});

const maintenanceActions = createMaintenanceActions({
  listActionsByStatusRef: refs.listActionsByStatus,
  scheduleApprovedActionRef: refs.scheduleApprovedAction,
  expirePendingActionsRef: refs.expirePendingActions,
  timeoutInactiveRunsRef: refs.timeoutInactiveRuns,
  runSecurityMaintenanceRef: refs.runSecurityMaintenance,
  recordCronSuccessRef: refs.recordCronSuccess,
  recordCronFailureRef: refs.recordCronFailure,
  enqueueDeadLetterRef: refs.enqueueDeadLetter,
});

export const processApprovedActions = maintenanceActions.processApprovedActions;
export const runMaintenanceTick = maintenanceActions.runMaintenanceTick;

const catalogActions = createCatalogActions({
  getWorkspaceCodeModeContextRef: refs.getWorkspaceCodeModeContext,
  listCustomToolsForWorkspaceRef: refs.listCustomToolsForWorkspace,
});

export const listToolCatalog = catalogActions.listToolCatalog;
export const listToolCatalogForWorkspace = catalogActions.listToolCatalogForWorkspace;
