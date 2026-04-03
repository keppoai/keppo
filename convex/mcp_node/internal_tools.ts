"use node";

import { type ActionCtx } from "../_generated/server";
import {
  APPROVAL_DECIDER_TYPE,
  DECISION_OUTCOME,
  TOOL_CALL_STATUS,
  type ActionRiskLevel,
  type ActionStatus,
  type ApprovalDeciderType,
  type DecisionOutcome,
} from "../domain_constants";
import { type WorkerExecutionErrorCode } from "../mcp_node_shared";

type JsonRecord = Record<string, unknown>;

type InternalToolDefinition = {
  name: string;
  input_schema: {
    parse: (input: unknown) => unknown;
  };
};

type InternalToolPayload = {
  workspaceId: string;
  runId: string;
  automationRunId?: string | undefined;
  credentialId: string;
  input: JsonRecord;
};

type InternalToolActionState = {
  workspace: {
    id: string;
  };
  action: {
    id: string;
    status: ActionStatus;
    result_redacted: JsonRecord | null;
    payload_preview: JsonRecord;
  };
};

type InternalPendingWorkspaceAction = {
  id: string;
  status: string;
  payload_preview: JsonRecord;
  created_at: string;
};

type InternalToolCallReference = {
  id: string;
};

type InternalActionCreationResult = {
  idempotencyReplayed: boolean;
  action: {
    id: string;
    status?: ActionStatus | undefined;
  };
};

type InternalToolHandlerDeps = {
  waitForActionImpl: (
    ctx: ActionCtx,
    params: {
      workspaceId: string;
      credentialId: string;
      actionId: string;
      maxBlockMs: number;
    },
  ) => Promise<JsonRecord>;
  waitForActionsImpl: (
    ctx: ActionCtx,
    params: {
      workspaceId: string;
      credentialId: string;
      actionIds: string[];
      maxBlockMs: number;
    },
  ) => Promise<JsonRecord>;
  loadActionState: (ctx: ActionCtx, actionId: string) => Promise<InternalToolActionState | null>;
  toStatusPayload: (
    ctx: ActionCtx,
    params: {
      action: InternalToolActionState["action"];
      credentialId: string;
    },
  ) => Promise<JsonRecord>;
  listPendingActionsForWorkspace: (
    ctx: ActionCtx,
    workspaceId: string,
  ) => Promise<InternalPendingWorkspaceAction[]>;
  createToolCall: (
    ctx: ActionCtx,
    params: {
      runId: string;
      toolName: string;
      inputRedacted: JsonRecord;
    },
  ) => Promise<InternalToolCallReference>;
  createActionFromDecision: (
    ctx: ActionCtx,
    params: {
      runId: string;
      toolCallId: string;
      toolName: string;
      actionType: string;
      riskLevel: ActionRiskLevel;
      normalizedPayload: JsonRecord;
      payloadPreview: JsonRecord;
      idempotencyKey: string;
      decision: {
        outcome: DecisionOutcome;
        decider_type: ApprovalDeciderType;
        decision_reason: string;
        context_snapshot: JsonRecord;
      };
    },
  ) => Promise<InternalActionCreationResult>;
  finalizeToolCallRecord: (
    ctx: ActionCtx,
    params: {
      toolCallId: string;
      status:
        | typeof TOOL_CALL_STATUS.completed
        | typeof TOOL_CALL_STATUS.failed
        | typeof TOOL_CALL_STATUS.approvalRequired;
      outputRedacted: JsonRecord;
      startedAt: number;
    },
  ) => Promise<void>;
  addAutomationMemory: (
    ctx: ActionCtx,
    params: {
      workspaceId: string;
      automationRunId: string;
      memory: string;
    },
  ) => Promise<{
    memory: string;
    memory_length: number;
    remaining_characters: number;
  }>;
  editAutomationMemory: (
    ctx: ActionCtx,
    params: {
      workspaceId: string;
      automationRunId: string;
      search: string;
      replace: string;
      replaceAll?: boolean;
    },
  ) => Promise<{
    memory: string;
    memory_length: number;
    remaining_characters: number;
    replacements: number;
  }>;
  recordAutomationRunOutcome: (
    ctx: ActionCtx,
    params: {
      workspaceId: string;
      automationRunId: string;
      success: boolean;
      summary: string;
    },
  ) => Promise<{
    success: boolean;
    summary: string;
    source: string;
    recorded_at: string;
  }>;
  stableIdempotencyKey: (toolName: string, payload: JsonRecord) => string;
  createWorkerExecutionError: (code: WorkerExecutionErrorCode, message: string) => Error;
};

const toJsonRecord = (
  value: unknown,
  message: string,
  createWorkerExecutionError: (code: WorkerExecutionErrorCode, message: string) => Error,
): JsonRecord => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw createWorkerExecutionError("execution_failed", message);
  }
  return value as JsonRecord;
};

const toRequestedToolList = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
};

const requireAutomationRunId = (
  automationRunId: string | undefined,
  toolName: string,
  createWorkerExecutionError: (code: WorkerExecutionErrorCode, message: string) => Error,
): string => {
  const normalized = automationRunId?.trim();
  if (!normalized) {
    throw createWorkerExecutionError(
      "execution_failed",
      `${toolName} is only available inside automation runs.`,
    );
  }
  return normalized;
};

const normalizeAutomationMemoryMutationError = (toolName: string, error: unknown): string => {
  const message = error instanceof Error ? error.message.trim() : "";
  switch (message) {
    case "automation_memory_required: Memory text is required.":
      return `${toolName} requires non-empty memory text.`;
    case "automation_memory_too_long: Automation memory must be 20000 characters or fewer.":
      return "Automation memory must be 20,000 characters or fewer.";
    case "automation_memory_limit_exceeded: Automation memory cannot exceed 20000 characters. Use edit_memory to remove or compact older memory before adding more.":
      return "Automation memory would exceed 20,000 characters. Use edit_memory to remove or compact older memory before adding more.";
    case "automation_memory_search_required: edit_memory requires a non-empty search string.":
      return "edit_memory requires a non-empty search string.";
    case "automation_memory_search_not_found: edit_memory could not find the provided search string in automation memory.":
      return "edit_memory could not find the provided search string in automation memory.";
    case "automation_memory_search_ambiguous: edit_memory found multiple matches. Use a more specific search string or set replace_all to true.":
      return "edit_memory found multiple matches. Use a more specific search string or set replace_all to true.";
    case "AutomationRunWorkspaceMismatch":
      return `${toolName} does not match the active workspace.`;
    case "AutomationRunNotFound":
    case "AutomationNotFound":
      return `${toolName} could not load automation memory for this run.`;
    default:
      return message || `Failed to execute ${toolName}.`;
  }
};

export const createInternalToolCallHandler = (deps: InternalToolHandlerDeps) => {
  return async (
    ctx: ActionCtx,
    params: {
      payload: InternalToolPayload;
      tool: InternalToolDefinition;
      startedAt: number;
    },
  ): Promise<JsonRecord> => {
    const { payload, tool, startedAt } = params;
    if (tool.name === "keppo.wait_for_action") {
      return await deps.waitForActionImpl(ctx, {
        workspaceId: payload.workspaceId,
        credentialId: payload.credentialId,
        actionId: String(payload.input.action_id ?? ""),
        maxBlockMs: 5000,
      });
    }

    if (tool.name === "keppo.wait_for_actions") {
      const actionIds = Array.isArray(payload.input.action_ids)
        ? payload.input.action_ids.filter((entry): entry is string => typeof entry === "string")
        : [];
      return await deps.waitForActionsImpl(ctx, {
        workspaceId: payload.workspaceId,
        credentialId: payload.credentialId,
        actionIds,
        maxBlockMs: 5000,
      });
    }

    if (tool.name === "keppo.get_action") {
      const actionId = String(payload.input.action_id ?? "");
      const state = await deps.loadActionState(ctx, actionId);
      if (!state || state.workspace.id !== payload.workspaceId) {
        throw deps.createWorkerExecutionError("execution_failed", `Action ${actionId} not found`);
      }
      return await deps.toStatusPayload(ctx, {
        action: state.action,
        credentialId: payload.credentialId,
      });
    }

    if (tool.name === "keppo.list_pending_actions") {
      const pending = await deps.listPendingActionsForWorkspace(ctx, payload.workspaceId);
      return {
        actions: pending,
      };
    }

    if (tool.name === "add_memory") {
      const automationRunId = requireAutomationRunId(
        payload.automationRunId,
        tool.name,
        deps.createWorkerExecutionError,
      );
      const normalizedInput = toJsonRecord(
        tool.input_schema.parse(payload.input),
        `${tool.name} normalized input failed validation.`,
        deps.createWorkerExecutionError,
      );
      const memory = typeof normalizedInput.memory === "string" ? normalizedInput.memory : "";

      const toolCall = await deps.createToolCall(ctx, {
        runId: payload.runId,
        toolName: tool.name,
        inputRedacted: {
          memory_length: memory.trim().length,
        },
      });

      try {
        const updated = await deps.addAutomationMemory(ctx, {
          workspaceId: payload.workspaceId,
          automationRunId,
          memory,
        });
        await deps.finalizeToolCallRecord(ctx, {
          toolCallId: toolCall.id,
          status: TOOL_CALL_STATUS.completed,
          outputRedacted: {
            status: "updated",
            operation: "append",
            memory_length: updated.memory_length,
            remaining_characters: updated.remaining_characters,
          },
          startedAt,
        });
        return {
          status: "updated",
          operation: "append",
          memory_length: updated.memory_length,
          remaining_characters: updated.remaining_characters,
        };
      } catch (error) {
        const normalizedMessage = normalizeAutomationMemoryMutationError(tool.name, error);
        await deps.finalizeToolCallRecord(ctx, {
          toolCallId: toolCall.id,
          status: TOOL_CALL_STATUS.failed,
          outputRedacted: {
            status: "failed",
            error: normalizedMessage,
          },
          startedAt,
        });
        throw deps.createWorkerExecutionError("execution_failed", normalizedMessage);
      }
    }

    if (tool.name === "edit_memory") {
      const automationRunId = requireAutomationRunId(
        payload.automationRunId,
        tool.name,
        deps.createWorkerExecutionError,
      );
      const normalizedInput = toJsonRecord(
        tool.input_schema.parse(payload.input),
        `${tool.name} normalized input failed validation.`,
        deps.createWorkerExecutionError,
      );
      const search = typeof normalizedInput.search === "string" ? normalizedInput.search : "";
      const replace = typeof normalizedInput.replace === "string" ? normalizedInput.replace : "";
      const replaceAll = normalizedInput.replace_all === true;

      const toolCall = await deps.createToolCall(ctx, {
        runId: payload.runId,
        toolName: tool.name,
        inputRedacted: {
          search_length: search.length,
          replace_length: replace.length,
          replace_all: replaceAll,
        },
      });

      try {
        const updated = await deps.editAutomationMemory(ctx, {
          workspaceId: payload.workspaceId,
          automationRunId,
          search,
          replace,
          replaceAll,
        });
        await deps.finalizeToolCallRecord(ctx, {
          toolCallId: toolCall.id,
          status: TOOL_CALL_STATUS.completed,
          outputRedacted: {
            status: "updated",
            operation: "replace",
            replacements: updated.replacements,
            memory_length: updated.memory_length,
            remaining_characters: updated.remaining_characters,
          },
          startedAt,
        });
        return {
          status: "updated",
          operation: "replace",
          replacements: updated.replacements,
          memory_length: updated.memory_length,
          remaining_characters: updated.remaining_characters,
        };
      } catch (error) {
        const normalizedMessage = normalizeAutomationMemoryMutationError(tool.name, error);
        await deps.finalizeToolCallRecord(ctx, {
          toolCallId: toolCall.id,
          status: TOOL_CALL_STATUS.failed,
          outputRedacted: {
            status: "failed",
            error: normalizedMessage,
          },
          startedAt,
        });
        throw deps.createWorkerExecutionError("execution_failed", normalizedMessage);
      }
    }

    if (tool.name === "keppo.request_more_access") {
      const normalizedInput = toJsonRecord(
        tool.input_schema.parse(payload.input),
        `${tool.name} normalized input failed validation.`,
        deps.createWorkerExecutionError,
      );
      const reason = typeof normalizedInput.reason === "string" ? normalizedInput.reason : "";
      const requestedTools = toRequestedToolList(normalizedInput.requested_tools);

      const toolCall = await deps.createToolCall(ctx, {
        runId: payload.runId,
        toolName: tool.name,
        inputRedacted: {
          requested_tools: requestedTools,
          reason: "[redacted]",
        },
      });

      const created = await deps.createActionFromDecision(ctx, {
        runId: payload.runId,
        toolCallId: toolCall.id,
        toolName: tool.name,
        actionType: "request_more_access",
        riskLevel: "medium",
        normalizedPayload: {
          reason,
          requested_tools: requestedTools,
        },
        payloadPreview: {
          reason: "[redacted]",
          requested_tools: requestedTools,
        },
        idempotencyKey: deps.stableIdempotencyKey(tool.name, {
          reason,
          requested_tools: requestedTools,
        }),
        decision: {
          outcome: DECISION_OUTCOME.pending,
          decider_type: APPROVAL_DECIDER_TYPE.human,
          decision_reason: "Manual approval is required.",
          context_snapshot: {
            tool: { name: tool.name },
            action: { preview: { requested_tools: requestedTools } },
          },
        },
      });

      if (created.idempotencyReplayed) {
        await deps.finalizeToolCallRecord(ctx, {
          toolCallId: toolCall.id,
          status: TOOL_CALL_STATUS.completed,
          outputRedacted: {
            status: "idempotent_replay",
            action_id: created.action.id,
            action_status: created.action.status ?? "unknown",
          },
          startedAt,
        });

        return {
          status: "idempotent_replay",
          action_id: created.action.id,
          action_status: created.action.status ?? "unknown",
          next_tool: "keppo.wait_for_action",
        };
      }

      await deps.finalizeToolCallRecord(ctx, {
        toolCallId: toolCall.id,
        status: TOOL_CALL_STATUS.approvalRequired,
        outputRedacted: {
          status: TOOL_CALL_STATUS.approvalRequired,
          action_id: created.action.id,
          summary: "Access request requires approval",
        },
        startedAt,
      });

      return {
        status: TOOL_CALL_STATUS.approvalRequired,
        action_id: created.action.id,
        next_tool: "keppo.wait_for_action",
      };
    }

    if (tool.name === "record_outcome") {
      const automationRunId = payload.automationRunId?.trim();
      if (!automationRunId) {
        throw deps.createWorkerExecutionError(
          "execution_failed",
          "record_outcome is only available inside automation runs.",
        );
      }

      const normalizedInput = toJsonRecord(
        tool.input_schema.parse(payload.input),
        `${tool.name} normalized input failed validation.`,
        deps.createWorkerExecutionError,
      );
      const success = normalizedInput.success === true;
      const summary = typeof normalizedInput.summary === "string" ? normalizedInput.summary : "";

      const toolCall = await deps.createToolCall(ctx, {
        runId: payload.runId,
        toolName: tool.name,
        inputRedacted: {
          success,
          summary,
        },
      });

      try {
        const recorded = await deps.recordAutomationRunOutcome(ctx, {
          workspaceId: payload.workspaceId,
          automationRunId,
          success,
          summary,
        });
        await deps.finalizeToolCallRecord(ctx, {
          toolCallId: toolCall.id,
          status: TOOL_CALL_STATUS.completed,
          outputRedacted: {
            status: "recorded",
            success: recorded.success,
            summary: recorded.summary,
            source: recorded.source,
            recorded_at: recorded.recorded_at,
          },
          startedAt,
        });
        return {
          status: "recorded",
          success: recorded.success,
          summary: recorded.summary,
          source: recorded.source,
          recorded_at: recorded.recorded_at,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message.trim() : "Failed to record automation outcome.";
        const normalizedMessage =
          message === "AutomationRunOutcomeAlreadyRecorded"
            ? "record_outcome may only be called once per automation run."
            : message === "AutomationRunOutcomeSummaryRequired"
              ? "record_outcome requires a non-empty plain-text summary."
              : message === "AutomationRunOutcomeSummaryTooLong"
                ? "record_outcome summary must be 2000 characters or fewer."
                : message === "AutomationRunWorkspaceMismatch"
                  ? "record_outcome does not match the active workspace."
                  : message || "Failed to record automation outcome.";
        await deps.finalizeToolCallRecord(ctx, {
          toolCallId: toolCall.id,
          status: TOOL_CALL_STATUS.failed,
          outputRedacted: {
            status: "failed",
            error: normalizedMessage,
          },
          startedAt,
        });
        throw deps.createWorkerExecutionError("execution_failed", normalizedMessage);
      }
    }

    throw deps.createWorkerExecutionError("execution_failed", `Unknown internal tool ${tool.name}`);
  };
};
