"use node";

import { v } from "convex/values";
import { internalAction, type ActionCtx } from "./_generated/server";
import { makeFunctionReference } from "convex/server";
import { callRemoteTool, discoverRemoteTools } from "../packages/shared/src/custom-mcp/client.js";
import { parseJsonValue } from "../packages/shared/src/providers/boundaries/json.js";
import {
  createWorkerExecutionError,
  convexActionExecutionStateSchema,
  jsonRecordSchema,
  parseWorkerExecutionErrorCode,
  parseWorkerPayload,
  stableIdempotencyKey,
  convexToolCallReferenceSchema,
  toIntegrationErrorClassification,
  toIntegrationErrorCodeFromWorkerCode,
  toWorkerExecutionError,
  type ConvexActionExecutionState,
  type WorkerExecutionErrorCode,
} from "./mcp_node_shared";
import { decryptSecretValue } from "./crypto_helpers";
import { CUSTOM_PROVIDER_ID } from "./integrations_shared";
import {
  ACTION_STATUS,
  APPROVAL_DECIDER_TYPE,
  AUDIT_ACTOR_TYPE,
  AUDIT_EVENT_TYPES,
  DECISION_OUTCOME,
  PROVIDER_METRIC_NAME,
  PROVIDER_METRIC_OUTCOME,
  TOOL_CALL_RESULT_STATUS,
  TOOL_CALL_STATUS,
  type ActionStatus,
  type ToolCallStatus,
} from "./domain_constants";
import { isActionStatusTransitionConflict } from "./mcp_node/approved_actions_helpers";
import { actionStatusValidator, jsonRecordValidator } from "./validators";

type JsonRecord = Record<string, unknown>;
type ActionStatusRecord = JsonRecord & { status: ActionStatus };

type ApprovedActionResult = {
  status: ActionStatus;
  action: JsonRecord;
};

const DEFAULT_DISCOVERY_TIMEOUT_MS = 15_000;
const DEFAULT_EXEC_TIMEOUT_MS = 30_000;

const refs = {
  getServerForDiscovery: makeFunctionReference<"query">("custom_mcp:getServerForDiscovery"),
  recordDiscoverySuccess: makeFunctionReference<"mutation">("custom_mcp:recordDiscoverySuccess"),
  recordDiscoveryFailure: makeFunctionReference<"mutation">("custom_mcp:recordDiscoveryFailure"),
  getWorkspaceCodeModeContext: makeFunctionReference<"query">("mcp:getWorkspaceCodeModeContext"),
  resolveCustomTool: makeFunctionReference<"query">("custom_mcp:resolveCustomTool"),
  loadCustomToolContext: makeFunctionReference<"query">("custom_mcp:loadCustomToolContext"),
  createToolCall: makeFunctionReference<"mutation">("mcp:createToolCall"),
  updateToolCall: makeFunctionReference<"mutation">("mcp:updateToolCall"),
  getOrgBillingForWorkspace: makeFunctionReference<"query">("billing:getOrgBillingForWorkspace"),
  beginToolCall: makeFunctionReference<"mutation">("billing:beginToolCall"),
  finishToolCall: makeFunctionReference<"mutation">("billing:finishToolCall"),
  createActionFromDecision: makeFunctionReference<"mutation">("mcp:createActionFromDecision"),
  getActionState: makeFunctionReference<"query">("mcp:getActionState"),
  getToolCall: makeFunctionReference<"query">("mcp:getToolCall"),
  setActionStatus: makeFunctionReference<"mutation">("mcp:setActionStatus"),
  createAuditEvent: makeFunctionReference<"mutation">("mcp:createAuditEvent"),
} as const;

const toRecord = (value: unknown): JsonRecord => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as JsonRecord;
};

const classifyWorkerExecutionError = (
  error: unknown,
): {
  error: Error;
  message: string;
  errorCode: WorkerExecutionErrorCode;
  errorCategory: ReturnType<typeof toIntegrationErrorClassification>["errorCategory"];
} => {
  const normalizedError = toWorkerExecutionError(error);
  const errorCode = parseWorkerExecutionErrorCode(normalizedError.message) ?? "execution_failed";
  const classification = toIntegrationErrorClassification(
    toIntegrationErrorCodeFromWorkerCode(errorCode),
  );
  return {
    error: normalizedError,
    message: normalizedError.message,
    errorCode,
    errorCategory: classification.errorCategory,
  };
};

const parseBillingOrgId = (payload: unknown): string => {
  const record = toRecord(payload);
  const orgId = record.org_id;
  if (typeof orgId !== "string" || orgId.trim().length === 0) {
    throw createWorkerExecutionError(
      "execution_failed",
      "custom_mcp.invalid_billing_org: Missing billing org id.",
    );
  }
  return orgId;
};

const parseActionState = (payload: unknown): ConvexActionExecutionState | null => {
  if (payload === null) {
    return null;
  }
  return parseWorkerPayload(convexActionExecutionStateSchema, payload, {
    message: "custom_mcp.invalid_action_state: Action state payload was invalid.",
  });
};

const readCurrentApprovedActionResult = async (
  ctx: ActionCtx,
  actionId: string,
): Promise<ApprovedActionResult | null> => {
  const state = parseActionState(
    await ctx.runQuery(refs.getActionState, {
      actionId,
    }),
  );
  if (!state) {
    return null;
  }
  return {
    status: state.action.status,
    action: toRecord(state.action),
  };
};

const parseActionStatusResult = (payload: unknown, message: string): ApprovedActionResult => {
  const record = toRecord(payload);
  const status = record.status;
  if (
    status !== ACTION_STATUS.pending &&
    status !== ACTION_STATUS.approved &&
    status !== ACTION_STATUS.executing &&
    status !== ACTION_STATUS.succeeded &&
    status !== ACTION_STATUS.failed &&
    status !== ACTION_STATUS.rejected &&
    status !== ACTION_STATUS.expired
  ) {
    throw new Error(message);
  }
  return {
    status: status as ActionStatus,
    action: toRecord(payload),
  };
};

const parseToolCallName = (payload: unknown): string => {
  return parseWorkerPayload(convexToolCallReferenceSchema, payload, {
    message: "custom_mcp.invalid_tool_call: Tool call payload was invalid.",
  }).tool_name;
};

const parseWorkspaceOrg = (payload: unknown): string => {
  const root = toRecord(payload);
  const workspace = toRecord(root.workspace);
  const orgId = workspace.org_id;
  if (typeof orgId !== "string" || orgId.trim().length === 0) {
    throw createWorkerExecutionError(
      "execution_failed",
      "custom_mcp.invalid_workspace_context: Missing workspace org id.",
    );
  }
  return orgId;
};

const parseNormalizedPayload = async (encoded: string): Promise<JsonRecord> => {
  try {
    const rawPayload = await decryptSecretValue(encoded, "sensitive_blob");
    return parseWorkerPayload(jsonRecordSchema, parseJsonValue(rawPayload), {
      message: "custom_mcp.invalid_action_payload: Unable to decode action payload.",
    });
  } catch {
    throw createWorkerExecutionError(
      "execution_failed",
      "custom_mcp.invalid_action_payload: Unable to decode action payload.",
    );
  }
};

const parseToolSchema = (inputSchemaJson: string): unknown => {
  try {
    return parseJsonValue(inputSchemaJson);
  } catch {
    throw createWorkerExecutionError(
      "execution_failed",
      "custom_mcp.invalid_schema: Stored tool schema is invalid JSON.",
    );
  }
};

const validateAgainstSchema = (value: unknown, schema: unknown, path = "input"): string | null => {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return null;
  }

  const schemaRecord = schema as {
    type?: unknown;
    required?: unknown;
    properties?: unknown;
    items?: unknown;
    enum?: unknown;
    anyOf?: unknown;
    oneOf?: unknown;
  };

  const anyOf = Array.isArray(schemaRecord.anyOf) ? schemaRecord.anyOf : [];
  if (anyOf.length > 0) {
    for (const branch of anyOf) {
      const error = validateAgainstSchema(value, branch, path);
      if (error === null) {
        return null;
      }
    }
    return `${path} did not match anyOf schema options`;
  }

  const oneOf = Array.isArray(schemaRecord.oneOf) ? schemaRecord.oneOf : [];
  if (oneOf.length > 0) {
    const matches = oneOf.filter((branch) => validateAgainstSchema(value, branch, path) === null);
    if (matches.length !== 1) {
      return `${path} did not match exactly one oneOf schema option`;
    }
    return null;
  }

  const allowedValues = Array.isArray(schemaRecord.enum) ? schemaRecord.enum : [];
  if (allowedValues.length > 0 && !allowedValues.some((entry) => entry === value)) {
    return `${path} value is not in enum`;
  }

  const type = typeof schemaRecord.type === "string" ? schemaRecord.type : null;
  if (!type) {
    return null;
  }

  if (type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return `${path} must be an object`;
    }

    const objectValue = value as Record<string, unknown>;
    const required = Array.isArray(schemaRecord.required)
      ? schemaRecord.required.filter((entry): entry is string => typeof entry === "string")
      : [];
    for (const key of required) {
      if (!(key in objectValue)) {
        return `${path}.${key} is required`;
      }
    }

    const properties =
      schemaRecord.properties &&
      typeof schemaRecord.properties === "object" &&
      !Array.isArray(schemaRecord.properties)
        ? (schemaRecord.properties as Record<string, unknown>)
        : {};

    for (const [key, nestedSchema] of Object.entries(properties)) {
      if (!(key in objectValue)) {
        continue;
      }
      const nestedError = validateAgainstSchema(objectValue[key], nestedSchema, `${path}.${key}`);
      if (nestedError) {
        return nestedError;
      }
    }

    return null;
  }

  if (type === "array") {
    if (!Array.isArray(value)) {
      return `${path} must be an array`;
    }
    for (const [index, item] of value.entries()) {
      const itemError = validateAgainstSchema(item, schemaRecord.items, `${path}[${index}]`);
      if (itemError) {
        return itemError;
      }
    }
    return null;
  }

  if (type === "string") {
    return typeof value === "string" ? null : `${path} must be a string`;
  }

  if (type === "boolean") {
    return typeof value === "boolean" ? null : `${path} must be a boolean`;
  }

  if (type === "number") {
    return typeof value === "number" && Number.isFinite(value) ? null : `${path} must be a number`;
  }

  if (type === "integer") {
    return typeof value === "number" && Number.isInteger(value)
      ? null
      : `${path} must be an integer`;
  }

  if (type === "null") {
    return value === null ? null : `${path} must be null`;
  }

  return null;
};

const finalizeToolCall = async (
  ctx: ActionCtx,
  params: {
    toolCallId: string;
    status: ToolCallStatus;
    output: JsonRecord;
    startedAtMs: number;
  },
): Promise<void> => {
  await ctx.runMutation(refs.updateToolCall, {
    toolCallId: params.toolCallId,
    status: params.status,
    outputRedacted: params.output,
    latencyMs: Math.max(0, Date.now() - params.startedAtMs),
  });
};

const executeRemoteToolCall = async (params: {
  serverUrl: string;
  bearerToken: string | null;
  remoteToolName: string;
  input: JsonRecord;
}): Promise<JsonRecord> => {
  const request = {
    url: params.serverUrl,
    toolName: params.remoteToolName,
    arguments: params.input,
    timeoutMs: DEFAULT_EXEC_TIMEOUT_MS,
    ...(params.bearerToken ? { bearerToken: params.bearerToken } : {}),
  };

  const result = await callRemoteTool(request);
  return {
    status: ACTION_STATUS.succeeded,
    content: result.content,
  };
};

export const discoverTools = internalAction({
  args: {
    serverId: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    tool_count: v.optional(v.number()),
    error: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ success: boolean; tool_count?: number; error?: string }> => {
    const server = await ctx.runQuery(refs.getServerForDiscovery, {
      serverId: args.serverId,
    });

    if (!server) {
      return {
        success: false,
        error: "custom_mcp.server_not_found: Server not found.",
      };
    }

    const discovery = await discoverRemoteTools({
      url: server.url,
      bearerToken: server.bearer_token_enc ?? undefined,
      timeoutMs: DEFAULT_DISCOVERY_TIMEOUT_MS,
    });

    if (!discovery.success) {
      const errorMessage = discovery.error ?? "Unknown discovery failure";
      await ctx.runMutation(refs.recordDiscoveryFailure, {
        serverId: server.id,
        error: errorMessage,
      });
      return {
        success: false,
        error: errorMessage,
      };
    }

    const discoveryAt = new Date().toISOString();
    const tools = discovery.tools.map((tool) => ({
      remote_tool_name: tool.name,
      description: tool.description,
      input_schema_json: JSON.stringify(tool.inputSchema ?? { type: "object", properties: {} }),
    }));

    const record = await ctx.runMutation(refs.recordDiscoverySuccess, {
      serverId: server.id,
      discoveredAt: discoveryAt,
      tools,
    });

    return {
      success: true,
      tool_count: record.tool_count,
    };
  },
});

export const executeCustomToolCall = internalAction({
  args: {
    workspaceId: v.string(),
    runId: v.string(),
    toolName: v.string(),
    input: jsonRecordValidator,
    credentialId: v.string(),
  },
  returns: jsonRecordValidator,
  handler: async (ctx, args): Promise<JsonRecord> => {
    const startedAtMs = Date.now();
    const workspaceContext = await ctx.runQuery(refs.getWorkspaceCodeModeContext, {
      workspaceId: args.workspaceId,
    });
    const orgId = parseWorkspaceOrg(workspaceContext);

    const tool = await ctx.runQuery(refs.resolveCustomTool, {
      orgId,
      toolName: args.toolName,
    });
    if (!tool) {
      throw createWorkerExecutionError("execution_failed", `unknown_custom_tool: ${args.toolName}`);
    }

    const context = await ctx.runQuery(refs.loadCustomToolContext, {
      workspaceId: args.workspaceId,
      serverId: tool.server_id,
    });
    if (!context) {
      throw createWorkerExecutionError(
        "provider_disabled",
        "custom_server_not_available: Server is disabled, missing, or out of scope.",
      );
    }

    const schema = parseToolSchema(tool.input_schema_json);
    const schemaError = validateAgainstSchema(args.input, schema);
    if (schemaError) {
      throw createWorkerExecutionError(
        "execution_failed",
        `invalid_custom_tool_input: ${schemaError}`,
      );
    }

    const toolCall = await ctx.runMutation(refs.createToolCall, {
      runId: args.runId,
      toolName: args.toolName,
      inputRedacted: args.input,
    });

    const toolCallId = toRecord(toolCall).id;
    if (typeof toolCallId !== "string" || toolCallId.length === 0) {
      throw createWorkerExecutionError(
        "execution_failed",
        "custom_mcp.tool_call_failed: Failed to create tool call record.",
      );
    }

    const billingWorkspace = await ctx.runQuery(refs.getOrgBillingForWorkspace, {
      workspaceId: args.workspaceId,
    });
    const billingOrgId = parseBillingOrgId(billingWorkspace);
    const reservation = await ctx.runMutation(refs.beginToolCall, {
      orgId: billingOrgId,
    });
    const periodStart = toRecord(reservation).period_start;

    try {
      if (tool.requires_approval) {
        const normalizedPayload: JsonRecord = {
          server_id: tool.server_id,
          remote_tool_name: tool.remote_tool_name,
          input: args.input,
        };
        const idempotencyKey = stableIdempotencyKey(args.toolName, normalizedPayload);

        const created = await ctx.runMutation(refs.createActionFromDecision, {
          runId: args.runId,
          toolCallId,
          toolName: args.toolName,
          actionType: "custom_mcp_call",
          riskLevel: tool.risk_level,
          normalizedPayload,
          payloadPreview: {
            tool_name: args.toolName,
            input: args.input,
          },
          idempotencyKey,
          decision: {
            outcome: DECISION_OUTCOME.pending,
            decider_type: APPROVAL_DECIDER_TYPE.human,
            decision_reason: "Manual approval is required for this custom MCP tool.",
            context_snapshot: {
              tool: {
                name: args.toolName,
                description: tool.description,
              },
              custom_mcp: {
                server_id: tool.server_id,
                remote_tool_name: tool.remote_tool_name,
              },
            },
          },
        });

        const createdRecord = toRecord(created);
        const createdActionRecord = toRecord(createdRecord.action);
        if (createdRecord.idempotencyReplayed === true) {
          await finalizeToolCall(ctx, {
            toolCallId,
            status: TOOL_CALL_STATUS.completed,
            output: {
              status: TOOL_CALL_RESULT_STATUS.idempotentReplay,
              action_id: createdActionRecord.id,
              action_status: createdActionRecord.status,
            },
            startedAtMs,
          });
          return {
            status: TOOL_CALL_RESULT_STATUS.idempotentReplay,
            action_id: createdActionRecord.id,
            action_status: createdActionRecord.status,
          };
        }

        const actionId = createdActionRecord.id;
        if (typeof actionId !== "string" || actionId.length === 0) {
          throw createWorkerExecutionError(
            "execution_failed",
            "custom_mcp.action_creation_failed: Failed to create approval action.",
          );
        }

        await finalizeToolCall(ctx, {
          toolCallId,
          status: TOOL_CALL_STATUS.approvalRequired,
          output: {
            status: TOOL_CALL_STATUS.approvalRequired,
            action_id: actionId,
            summary: `Approval required for ${args.toolName}`,
          },
          startedAtMs,
        });

        return {
          status: TOOL_CALL_STATUS.approvalRequired,
          action_id: actionId,
          summary: `Approval required for ${args.toolName}`,
          next_tool: "keppo.wait_for_action",
        };
      }

      try {
        const result = await executeRemoteToolCall({
          serverUrl: context.server_url,
          bearerToken: context.bearer_token_enc,
          remoteToolName: tool.remote_tool_name,
          input: args.input,
        });

        await finalizeToolCall(ctx, {
          toolCallId,
          status: TOOL_CALL_STATUS.completed,
          output: result,
          startedAtMs,
        });

        return result;
      } catch (error) {
        const details = classifyWorkerExecutionError(error);
        await finalizeToolCall(ctx, {
          toolCallId,
          status: TOOL_CALL_STATUS.failed,
          output: {
            status: ACTION_STATUS.failed,
            error: details.message,
            error_code: details.errorCode,
            error_category: details.errorCategory,
          },
          startedAtMs,
        });
        throw createWorkerExecutionError(
          details.errorCode,
          `custom_server_error: ${details.message}`,
        );
      }
    } finally {
      if (typeof periodStart === "string" && periodStart.length > 0) {
        try {
          await ctx.runMutation(refs.finishToolCall, {
            orgId: billingOrgId,
            periodStart,
            latencyMs: Math.max(0, Date.now() - startedAtMs),
          });
        } catch (error) {
          console.error("custom_mcp.finish_tool_call.error", error);
        }
      }
    }
  },
});

export const executeApprovedCustomAction = internalAction({
  args: {
    actionId: v.string(),
  },
  returns: v.object({
    status: actionStatusValidator,
    action: jsonRecordValidator,
  }),
  handler: async (ctx, args): Promise<ApprovedActionResult> => {
    const statePayload = await ctx.runQuery(refs.getActionState, {
      actionId: args.actionId,
    });
    const state = parseActionState(statePayload);
    if (!state) {
      throw createWorkerExecutionError(
        "execution_failed",
        `custom_mcp.action_not_found: ${args.actionId}`,
      );
    }

    if (
      state.action.status === ACTION_STATUS.executing ||
      state.action.status === ACTION_STATUS.succeeded ||
      state.action.status === ACTION_STATUS.failed ||
      state.action.status === ACTION_STATUS.rejected ||
      state.action.status === ACTION_STATUS.expired
    ) {
      return {
        status: state.action.status,
        action: toRecord(state.action),
      };
    }

    if (state.action.status !== ACTION_STATUS.approved) {
      throw createWorkerExecutionError(
        "execution_failed",
        `custom_mcp.action_not_approved: ${args.actionId}`,
      );
    }

    const toolCallPayload = await ctx.runQuery(refs.getToolCall, {
      toolCallId: state.action.tool_call_id,
    });
    const toolName = parseToolCallName(toolCallPayload);

    const tool = await ctx.runQuery(refs.resolveCustomTool, {
      orgId: state.workspace.org_id,
      toolName,
    });
    if (!tool) {
      throw createWorkerExecutionError("execution_failed", `unknown_custom_tool: ${toolName}`);
    }

    const context = await ctx.runQuery(refs.loadCustomToolContext, {
      workspaceId: state.workspace.id,
      serverId: tool.server_id,
    });
    if (!context) {
      throw createWorkerExecutionError(
        "provider_disabled",
        "custom_server_not_available: Server is disabled, missing, or out of scope.",
      );
    }

    const normalizedPayload = await parseNormalizedPayload(state.action.normalized_payload_enc);
    const payloadInput = toRecord(normalizedPayload.input);
    const remoteToolName =
      typeof normalizedPayload.remote_tool_name === "string" &&
      normalizedPayload.remote_tool_name.trim().length > 0
        ? normalizedPayload.remote_tool_name
        : tool.remote_tool_name;

    const startedAtMs = Date.now();

    let setExecuting: ActionStatusRecord | null;
    try {
      setExecuting = (await ctx.runMutation(refs.setActionStatus, {
        actionId: args.actionId,
        status: ACTION_STATUS.executing,
        allowedCurrentStatuses: [ACTION_STATUS.approved],
      })) as ActionStatusRecord | null;
    } catch (error) {
      if (isActionStatusTransitionConflict(error)) {
        const current = await readCurrentApprovedActionResult(ctx, args.actionId);
        if (current && current.status !== ACTION_STATUS.approved) {
          return current;
        }
      }
      throw error;
    }
    if (!setExecuting) {
      throw createWorkerExecutionError(
        "execution_failed",
        `custom_mcp.action_not_found: ${args.actionId}`,
      );
    }
    const executing = parseActionStatusResult(
      setExecuting,
      `custom_mcp.invalid_action_status: ${args.actionId} executing transition payload was invalid.`,
    );
    if (executing.status !== ACTION_STATUS.executing) {
      return executing;
    }

    await ctx.runMutation(refs.createAuditEvent, {
      orgId: state.workspace.org_id,
      actorType: AUDIT_ACTOR_TYPE.worker,
      actorId: "custom_mcp.execution",
      eventType: AUDIT_EVENT_TYPES.actionExecutionStarted,
      payload: {
        action_id: args.actionId,
        tool_name: toolName,
        server_id: tool.server_id,
      },
    });

    try {
      const result = await executeRemoteToolCall({
        serverUrl: context.server_url,
        bearerToken: context.bearer_token_enc,
        remoteToolName,
        input: payloadInput,
      });

      let succeeded: ActionStatusRecord | null;
      try {
        succeeded = (await ctx.runMutation(refs.setActionStatus, {
          actionId: args.actionId,
          status: ACTION_STATUS.succeeded,
          resultRedacted: result,
          allowedCurrentStatuses: [ACTION_STATUS.executing],
        })) as ActionStatusRecord | null;
      } catch (error) {
        if (isActionStatusTransitionConflict(error)) {
          const current = await readCurrentApprovedActionResult(ctx, args.actionId);
          if (current && current.status !== ACTION_STATUS.executing) {
            return current;
          }
        }
        throw error;
      }
      if (!succeeded) {
        throw createWorkerExecutionError(
          "execution_failed",
          `custom_mcp.action_not_found: ${args.actionId}`,
        );
      }
      const successResult = parseActionStatusResult(
        succeeded,
        `custom_mcp.invalid_action_status: ${args.actionId} success transition payload was invalid.`,
      );
      if (successResult.status !== ACTION_STATUS.succeeded) {
        return successResult;
      }

      await ctx.runMutation(refs.updateToolCall, {
        toolCallId: state.action.tool_call_id,
        status: TOOL_CALL_STATUS.completed,
        outputRedacted: result,
        latencyMs: Math.max(0, Date.now() - startedAtMs),
      });

      await ctx.runMutation(refs.createAuditEvent, {
        orgId: state.workspace.org_id,
        actorType: AUDIT_ACTOR_TYPE.worker,
        actorId: "custom_mcp.execution",
        eventType: AUDIT_EVENT_TYPES.actionExecutionCompleted,
        payload: {
          action_id: args.actionId,
          tool_name: toolName,
        },
      });

      return {
        status: ACTION_STATUS.succeeded,
        action: toRecord(succeeded),
      };
    } catch (error) {
      const details = classifyWorkerExecutionError(error);
      const failedPayload = {
        status: ACTION_STATUS.failed,
        error: details.message,
        error_code: details.errorCode,
        error_category: details.errorCategory,
      };

      let failed: ActionStatusRecord | null;
      try {
        failed = (await ctx.runMutation(refs.setActionStatus, {
          actionId: args.actionId,
          status: ACTION_STATUS.failed,
          resultRedacted: failedPayload,
          allowedCurrentStatuses: [ACTION_STATUS.executing],
        })) as ActionStatusRecord | null;
      } catch (error) {
        if (isActionStatusTransitionConflict(error)) {
          const current = await readCurrentApprovedActionResult(ctx, args.actionId);
          if (current && current.status !== ACTION_STATUS.executing) {
            return current;
          }
        }
        throw error;
      }
      if (!failed) {
        throw createWorkerExecutionError(
          "execution_failed",
          `custom_mcp.action_not_found: ${args.actionId}`,
        );
      }
      const failedResult = parseActionStatusResult(
        failed,
        `custom_mcp.invalid_action_status: ${args.actionId} failure transition payload was invalid.`,
      );
      if (failedResult.status !== ACTION_STATUS.failed) {
        return failedResult;
      }

      await ctx.runMutation(refs.updateToolCall, {
        toolCallId: state.action.tool_call_id,
        status: TOOL_CALL_STATUS.failed,
        outputRedacted: failedPayload,
        latencyMs: Math.max(0, Date.now() - startedAtMs),
      });

      await ctx.runMutation(refs.createAuditEvent, {
        orgId: state.workspace.org_id,
        actorType: AUDIT_ACTOR_TYPE.worker,
        actorId: "custom_mcp.execution",
        eventType: AUDIT_EVENT_TYPES.actionExecutionFailed,
        payload: {
          action_id: args.actionId,
          tool_name: toolName,
          error: details.message,
          error_code: details.errorCode,
          error_category: details.errorCategory,
        },
      });
      await ctx.runMutation(refs.createAuditEvent, {
        orgId: state.workspace.org_id,
        actorType: AUDIT_ACTOR_TYPE.worker,
        actorId: "custom_mcp.execution",
        eventType: AUDIT_EVENT_TYPES.providerMetric,
        payload: {
          metric: PROVIDER_METRIC_NAME.toolCallFailure,
          provider: CUSTOM_PROVIDER_ID,
          outcome: PROVIDER_METRIC_OUTCOME.failure,
          reason_code: details.errorCode,
          route: "custom_mcp.executeApprovedCustomAction",
          value: 1,
        },
      });

      return {
        status: ACTION_STATUS.failed,
        action: toRecord(failed),
      };
    }
  },
});
