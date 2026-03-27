"use node";

import { type ActionCtx } from "../_generated/server";
import { ACTION_POLL_STATUS, ACTION_STATUS, type ActionStatus } from "../domain_constants";
import {
  convexActionCreationResultSchema,
  convexPendingWorkspaceActionListSchema,
  convexPollRateLimitSchema,
  convexToolCallReferenceSchema,
  parseWorkerPayload,
  type ConvexActionState,
} from "../mcp_node_shared";
import { safeParsePayload, safeRunMutation, safeRunQuery, validationMessage } from "../safe_convex";
import { isTerminalStatus, parseActionState } from "./approved_actions_helpers";
import { createExecuteApprovedActionImpl } from "./approved_actions_execution";
import { type ApprovedActionDeps, type ToolCallRecordStatus } from "./approved_actions_types";

export const createApprovedActionHandlers = (deps: ApprovedActionDeps) => {
  const executeApprovedActionImpl = createExecuteApprovedActionImpl(deps);

  const toStatusPayload = async (
    ctx: ActionCtx,
    params: {
      action: {
        id: string;
        status: ActionStatus;
        result_redacted?: Record<string, unknown> | null;
        payload_preview?: Record<string, unknown> | null;
      };
      credentialId: string;
    },
  ): Promise<Record<string, unknown>> => {
    if (params.action.status === ACTION_STATUS.pending) {
      const countRaw = await safeRunMutation("mcp_node.updatePendingPollTracker", () =>
        ctx.runMutation(deps.refs.updatePendingPollTracker, {
          actionId: params.action.id,
          credentialId: params.credentialId,
          pending: true,
        }),
      );
      const count = typeof countRaw === "number" && Number.isFinite(countRaw) ? countRaw : 0;
      const base = 2000;
      const multiplier = Math.max(0, count - 1);
      return {
        status: ACTION_POLL_STATUS.stillPending,
        action: null,
        recommended_poll_after_ms: Math.min(30_000, base * 2 ** multiplier),
      };
    }

    await safeRunMutation("mcp_node.updatePendingPollTracker", () =>
      ctx.runMutation(deps.refs.updatePendingPollTracker, {
        actionId: params.action.id,
        credentialId: params.credentialId,
        pending: false,
      }),
    );

    if (params.action.status === ACTION_STATUS.approved) {
      return {
        status: ACTION_STATUS.approved,
        action: null,
      };
    }

    if (isTerminalStatus(params.action.status)) {
      return {
        status: params.action.status,
        action: {
          id: params.action.id,
          output: params.action.result_redacted,
          payload_preview: params.action.payload_preview,
        },
      };
    }

    return {
      status: params.action.status,
      action: null,
    };
  };

  const recordPollAttempt = async (
    ctx: ActionCtx,
    credentialId: string,
  ): Promise<{
    limited: boolean;
    retry_after_ms?: number | undefined;
  }> => {
    const rateRaw = await safeRunMutation("mcp_node.recordPollAttempt", () =>
      ctx.runMutation(deps.refs.recordPollAttempt, {
        credentialId,
      }),
    );
    return safeParsePayload("mcp_node.recordPollAttempt", () =>
      parseWorkerPayload(convexPollRateLimitSchema, rateRaw, {
        message: validationMessage(
          "mcp_node.recordPollAttempt",
          "Poll rate-limit payload failed validation.",
        ),
      }),
    );
  };

  const loadActionState = async (
    ctx: ActionCtx,
    actionId: string,
  ): Promise<ConvexActionState | null> => {
    const stateRaw = await safeRunQuery("mcp_node.getActionState", () =>
      ctx.runQuery(deps.refs.getActionState, { actionId }),
    );
    return stateRaw === null
      ? null
      : parseActionState(
          stateRaw,
          validationMessage(
            "mcp_node.getActionState",
            `Action state payload for ${actionId} failed validation.`,
          ),
        );
  };

  const finalizeToolCallRecord = async (
    ctx: ActionCtx,
    params: {
      toolCallId: string;
      status: ToolCallRecordStatus;
      outputRedacted: Record<string, unknown>;
      startedAt: number;
    },
  ): Promise<void> => {
    await safeRunMutation("mcp_node.updateToolCall", () =>
      ctx.runMutation(deps.refs.updateToolCall, {
        toolCallId: params.toolCallId,
        status: params.status,
        outputRedacted: params.outputRedacted,
        latencyMs: Date.now() - params.startedAt,
      }),
    );
  };

  const listPendingActionsForInternalTool = async (ctx: ActionCtx, workspaceId: string) => {
    const pendingRaw = await safeRunQuery("mcp_node.listPendingActionsForWorkspace", () =>
      ctx.runQuery(deps.refs.listPendingActionsForWorkspace, {
        workspaceId,
      }),
    );
    return safeParsePayload("mcp_node.listPendingActionsForWorkspace", () =>
      parseWorkerPayload(convexPendingWorkspaceActionListSchema, pendingRaw, {
        message: validationMessage(
          "mcp_node.listPendingActionsForWorkspace",
          `Pending actions payload for workspace ${workspaceId} failed validation.`,
        ),
      }),
    );
  };

  const createToolCallForInternalTool = async (
    ctx: ActionCtx,
    params: {
      runId: string;
      toolName: string;
      inputRedacted: Record<string, unknown>;
    },
  ) => {
    const toolCallRaw = await safeRunMutation("mcp_node.createToolCall", () =>
      ctx.runMutation(deps.refs.createToolCall, params),
    );
    return safeParsePayload("mcp_node.createToolCall", () =>
      parseWorkerPayload(convexToolCallReferenceSchema, toolCallRaw, {
        message: validationMessage(
          "mcp_node.createToolCall",
          `Tool call creation payload for ${params.toolName} failed validation.`,
        ),
      }),
    );
  };

  const createActionFromDecisionForInternalTool = async (
    ctx: ActionCtx,
    params: {
      runId: string;
      toolCallId: string;
      toolName: string;
      actionType: string;
      riskLevel: string;
      normalizedPayload: Record<string, unknown>;
      payloadPreview: Record<string, unknown>;
      idempotencyKey: string;
      decision: {
        outcome: string;
        decider_type: string;
        decision_reason: string;
        context_snapshot: Record<string, unknown>;
      };
    },
  ) => {
    const createdRaw = await safeRunMutation("mcp_node.createActionFromDecision", () =>
      ctx.runMutation(deps.refs.createActionFromDecision, params),
    );
    return safeParsePayload("mcp_node.createActionFromDecision", () =>
      parseWorkerPayload(convexActionCreationResultSchema, createdRaw, {
        message: validationMessage(
          "mcp_node.createActionFromDecision",
          `Action creation payload for ${params.toolName} failed validation.`,
        ),
      }),
    );
  };

  return {
    executeApprovedActionImpl,
    recordPollAttempt,
    loadActionState,
    toStatusPayload,
    finalizeToolCallRecord,
    listPendingActionsForInternalTool,
    createToolCallForInternalTool,
    createActionFromDecisionForInternalTool,
  };
};
