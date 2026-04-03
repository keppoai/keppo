"use node";

import { type ActionCtx } from "../_generated/server";
import {
  ACTION_STATUS,
  AUDIT_ACTOR_TYPE,
  AUDIT_EVENT_TYPES,
  INTEGRATION_STATUS,
  PROVIDER_METRIC_NAME,
  PROVIDER_METRIC_OUTCOME,
  assertNever,
} from "../domain_constants";
import {
  convexConnectorContextSchema,
  convexToolCallReferenceSchema,
  getProviderModuleV2,
  jsonRecordSchema,
  parseWorkerPayload,
  toolMap,
} from "../mcp_node_shared";
import {
  safeParsePayload,
  safeRunAction,
  safeRunMutation,
  safeRunQuery,
  validationMessage,
} from "../safe_convex";
import {
  isActionStatusTransitionConflict,
  isOptimisticConcurrencyControlFailure,
  parseActionExecutionState,
  parseActionStatusPayload,
  parseJsonEncodedRecord,
} from "./approved_actions_helpers";
import {
  type ApprovedActionDeps,
  type ExecuteApprovedActionResult,
} from "./approved_actions_types";

type ProviderErrorLike = Error & {
  shape?: {
    category?: string;
    code?: string;
    status?: number;
    message?: string;
    retryable?: boolean;
  };
  causeData?: unknown;
  response?: {
    status?: number;
    data?: unknown;
  };
};

const toLoggableValue = (value: unknown, depth = 3): unknown => {
  if (value === null || value === undefined) {
    return value ?? null;
  }
  if (typeof value === "string") {
    return value.length > 1000 ? `${value.slice(0, 1000)}…` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (depth <= 0) {
    return Array.isArray(value) ? `[array(${value.length})]` : "[object]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, 10).map((entry) => toLoggableValue(entry, depth - 1));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 20)
        .map(([key, entry]) => [key, toLoggableValue(entry, depth - 1)]),
    );
  }
  return String(value);
};

const extractProviderResponse = (
  error: unknown,
): {
  providerResponseStatus?: number;
  providerResponseData?: unknown;
} => {
  if (!error || typeof error !== "object") {
    return {};
  }

  const typedError = error as ProviderErrorLike;
  const responseCandidate =
    typedError.response && typeof typedError.response === "object"
      ? typedError.response
      : typedError.causeData &&
          typeof typedError.causeData === "object" &&
          "response" in typedError.causeData &&
          typedError.causeData.response &&
          typeof typedError.causeData.response === "object"
        ? (typedError.causeData.response as { status?: unknown; data?: unknown })
        : null;

  if (!responseCandidate) {
    return {};
  }

  const status =
    typeof responseCandidate.status === "number" ? responseCandidate.status : undefined;
  const data = "data" in responseCandidate ? toLoggableValue(responseCandidate.data) : undefined;

  return {
    ...(status !== undefined ? { providerResponseStatus: status } : {}),
    ...(data !== undefined ? { providerResponseData: data } : {}),
  };
};

export const buildApprovedActionFailureLogMetadata = (params: {
  actionId: string;
  toolName: string;
  provider: string;
  providerModuleVersion: number;
  workspaceId: string;
  orgId: string;
  error: unknown;
  classification: {
    errorCode: string;
    errorCategory: string;
  };
}): Record<string, unknown> => {
  const message = params.error instanceof Error ? params.error.message : String(params.error);
  const typedError = params.error as ProviderErrorLike;
  const providerShape =
    typedError?.shape && typeof typedError.shape === "object"
      ? {
          category: typedError.shape.category ?? null,
          code: typedError.shape.code ?? null,
          status: typedError.shape.status ?? null,
          retryable: typedError.shape.retryable ?? null,
          message: typedError.shape.message ?? message,
        }
      : null;

  return {
    actionId: params.actionId,
    toolName: params.toolName,
    provider: params.provider,
    providerModuleVersion: params.providerModuleVersion,
    workspaceId: params.workspaceId,
    orgId: params.orgId,
    errorMessage: message,
    errorCode: params.classification.errorCode,
    errorCategory: params.classification.errorCategory,
    ...(providerShape ? { providerError: providerShape } : {}),
    ...extractProviderResponse(params.error),
  };
};

export const createExecuteApprovedActionImpl = (deps: ApprovedActionDeps) => {
  const readCurrentActionExecutionState = async (
    ctx: ActionCtx,
    actionId: string,
  ): Promise<ExecuteApprovedActionResult | null> => {
    const stateRaw = await safeRunQuery("mcp_node.getActionState", () =>
      ctx.runQuery(deps.refs.getActionState, { actionId }),
    );
    const state =
      stateRaw === null
        ? null
        : parseActionExecutionState(
            stateRaw,
            validationMessage(
              "mcp_node.getActionState",
              `Action state payload for ${actionId} failed validation during OCC reconciliation.`,
            ),
          );
    if (!state) {
      return null;
    }
    return {
      status: state.action.status,
      action: state.action,
    };
  };

  const requireActionStatusPayload = (actionId: string, payload: unknown) => {
    if (payload === null) {
      throw deps.createWorkerExecutionError("execution_failed", `Action ${actionId} not found`);
    }
    return parseActionStatusPayload(
      payload,
      validationMessage(
        "mcp_node.setActionStatus",
        `Action status payload for ${actionId} failed validation.`,
      ),
    );
  };

  return async (ctx: ActionCtx, actionId: string): Promise<ExecuteApprovedActionResult> => {
    const stateRaw = await safeRunQuery("mcp_node.getActionState", () =>
      ctx.runQuery(deps.refs.getActionState, { actionId }),
    );
    const state =
      stateRaw === null
        ? null
        : parseActionExecutionState(
            stateRaw,
            validationMessage(
              "mcp_node.getActionState",
              `Action state payload for ${actionId} failed validation.`,
            ),
          );

    if (!state) {
      throw deps.createWorkerExecutionError("execution_failed", `Action ${actionId} not found`);
    }
    switch (state.action.status) {
      case ACTION_STATUS.executing:
      case ACTION_STATUS.succeeded:
      case ACTION_STATUS.failed:
      case ACTION_STATUS.rejected:
      case ACTION_STATUS.expired:
        return {
          status: state.action.status,
          action: state.action,
        };
      case ACTION_STATUS.approved:
        break;
      case ACTION_STATUS.pending:
        throw deps.createWorkerExecutionError(
          "execution_failed",
          `Action ${actionId} is not approved`,
        );
      default:
        return assertNever(state.action.status, "approved action status");
    }

    const toolCallRaw = await safeRunQuery("mcp_node.getToolCall", () =>
      ctx.runQuery(deps.refs.getToolCall, {
        toolCallId: state.action.tool_call_id,
      }),
    );
    const toolCall =
      toolCallRaw === null
        ? null
        : safeParsePayload("mcp_node.getToolCall", () =>
            parseWorkerPayload(convexToolCallReferenceSchema, toolCallRaw, {
              message: validationMessage(
                "mcp_node.getToolCall",
                `Tool call payload for ${state.action.tool_call_id} failed validation.`,
              ),
            }),
          );

    if (!toolCall) {
      throw deps.createWorkerExecutionError(
        "execution_failed",
        `Tool call ${state.action.tool_call_id} not found`,
      );
    }

    const tool = toolMap.get(toolCall.tool_name);
    if (!tool) {
      const customExecutionRaw = await safeRunAction("mcp_node.executeApprovedCustomAction", () =>
        ctx.runAction(deps.refs.executeApprovedCustomAction, {
          actionId,
        }),
      );
      const customExecution = safeParsePayload("mcp_node.executeApprovedCustomAction", () => {
        if (
          !customExecutionRaw ||
          typeof customExecutionRaw !== "object" ||
          Array.isArray(customExecutionRaw)
        ) {
          throw deps.createWorkerExecutionError(
            "execution_failed",
            validationMessage(
              "mcp_node.executeApprovedCustomAction",
              `Custom approved-action payload for ${actionId} failed validation.`,
            ),
          );
        }
        const record = customExecutionRaw as {
          status?: unknown;
          action?: unknown;
        };
        if (typeof record.status !== "string") {
          throw deps.createWorkerExecutionError(
            "execution_failed",
            validationMessage(
              "mcp_node.executeApprovedCustomAction",
              `Custom approved-action status for ${actionId} failed validation.`,
            ),
          );
        }
        if (!record.action || typeof record.action !== "object" || Array.isArray(record.action)) {
          throw deps.createWorkerExecutionError(
            "execution_failed",
            validationMessage(
              "mcp_node.executeApprovedCustomAction",
              `Custom approved-action body for ${actionId} failed validation.`,
            ),
          );
        }
        return {
          status: record.status,
          action: record.action as Record<string, unknown>,
        };
      });
      const parsedCustomAction = parseActionStatusPayload(
        customExecution.action,
        validationMessage(
          "mcp_node.executeApprovedCustomAction",
          `Custom approved-action status payload for ${actionId} failed validation.`,
        ),
      );
      if (customExecution.status !== parsedCustomAction.status) {
        throw deps.createWorkerExecutionError(
          "execution_failed",
          validationMessage(
            "mcp_node.executeApprovedCustomAction",
            `Custom approved-action status mismatch for ${actionId}.`,
          ),
        );
      }

      return {
        status: parsedCustomAction.status,
        action: parsedCustomAction,
      };
    }
    if (tool.provider === "keppo") {
      throw deps.createWorkerExecutionError(
        "provider_capability_mismatch",
        `Tool ${toolCall.tool_name} is not executable by a connector`,
      );
    }
    if (tool.capability !== "write") {
      throw deps.createWorkerExecutionError(
        "provider_capability_mismatch",
        `Approved action tool ${tool.name} must be a write capability.`,
      );
    }
    const provider = deps.resolveToolOwnerProvider(tool.name);
    deps.assertProviderRegistryPathEnabled();
    deps.assertProviderCapability(provider, "write");
    const providerModule = getProviderModuleV2(provider);
    const providerModuleVersion = providerModule.schemaVersion;
    deps.assertProviderRolloutEnabled(provider);

    const runtimeNamespace =
      typeof state.run.metadata?.e2e_namespace === "string" &&
      state.run.metadata.e2e_namespace.trim()
        ? state.run.metadata.e2e_namespace.trim()
        : undefined;

    const integrationContextRaw = await safeRunQuery("mcp_node.loadConnectorContext", () =>
      ctx.runQuery(deps.refs.loadConnectorContext, {
        workspaceId: state.workspace.id,
        provider,
      }),
    );
    const integrationContext = safeParsePayload("mcp_node.loadConnectorContext", () =>
      parseWorkerPayload(convexConnectorContextSchema, integrationContextRaw, {
        message: validationMessage(
          "mcp_node.loadConnectorContext",
          `Connector context payload for provider ${provider} failed validation.`,
        ),
      }),
    );

    if (!integrationContext.provider_enabled) {
      throw deps.createWorkerExecutionError(
        "provider_disabled",
        `Provider ${provider} is disabled for workspace ${state.workspace.id}`,
      );
    }
    if (!integrationContext.integration_id) {
      throw deps.createWorkerExecutionError(
        "integration_not_connected",
        `Integration ${provider} is not connected for workspace ${state.workspace.id}`,
      );
    }
    deps.assertIntegrationProviderMatch(provider, integrationContext.integration_provider);

    const initialContext = {
      workspaceId: state.workspace.id,
      orgId: state.workspace.org_id,
      scopes: integrationContext.scopes,
      refresh_token: integrationContext.refresh_token,
      access_token_expires_at: integrationContext.access_token_expires_at,
      integration_account_id: integrationContext.integration_account_id,
      external_account_id: integrationContext.external_account_id,
      metadata: {
        ...integrationContext.metadata,
        ...(runtimeNamespace ? { e2e_namespace: runtimeNamespace } : {}),
      },
      ...(integrationContext.access_token ? { access_token: integrationContext.access_token } : {}),
    };
    const context = await deps.refreshConnectorContextAccessToken(ctx, {
      provider,
      context: initialContext,
    });

    let normalizedPayload: Record<string, unknown>;
    try {
      normalizedPayload = await parseJsonEncodedRecord(
        state.action.normalized_payload_enc,
        "Action payload decode failed",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Action payload decode failed";
      throw deps.createWorkerExecutionError("execution_failed", message);
    }

    try {
      const executingRaw = await safeRunMutation("mcp_node.setActionStatus", () =>
        ctx.runMutation(deps.refs.setActionStatus, {
          actionId,
          status: ACTION_STATUS.executing,
          allowedCurrentStatuses: [ACTION_STATUS.approved],
        }),
      );
      const executing = requireActionStatusPayload(actionId, executingRaw);
      if (executing.status !== ACTION_STATUS.executing) {
        return {
          status: executing.status,
          action: executing,
        };
      }
    } catch (error) {
      if (isOptimisticConcurrencyControlFailure(error) || isActionStatusTransitionConflict(error)) {
        const concurrent = await readCurrentActionExecutionState(ctx, actionId);
        if (concurrent && concurrent.status !== ACTION_STATUS.approved) {
          return concurrent;
        }
      }
      throw error;
    }

    await safeRunMutation("mcp_node.createAuditEvent", () =>
      ctx.runMutation(deps.refs.createAuditEvent, {
        orgId: state.workspace.org_id,
        actorType: AUDIT_ACTOR_TYPE.worker,
        actorId: "execution",
        eventType: AUDIT_EVENT_TYPES.actionExecutionStarted,
        payload: {
          action_id: actionId,
          tool_name: tool.name,
          provider,
          provider_module_version: providerModuleVersion,
        },
      }),
    );

    try {
      const output = await providerModule.facets.tools.executeTool(
        {
          toolName: tool.name,
          input: normalizedPayload,
          context,
          mode: "execute_write",
        },
        deps.toProviderRuntimeContext(runtimeNamespace),
      );
      const normalizedOutput = safeParsePayload("mcp_node.executeApprovedAction.output", () =>
        parseWorkerPayload(jsonRecordSchema, output, {
          message: validationMessage(
            "mcp_node.executeApprovedAction.output",
            `Tool ${tool.name} returned an invalid execution payload.`,
          ),
        }),
      );
      const redactedOutput = providerModule.connector.redact(tool.name, normalizedOutput);
      await safeRunMutation("mcp_node.markIntegrationHealth", () =>
        ctx.runMutation(deps.refs.markIntegrationHealth, {
          orgId: state.workspace.org_id,
          provider,
          status: INTEGRATION_STATUS.connected,
        }),
      );
      const updatedRaw = await safeRunMutation("mcp_node.setActionStatus", () =>
        ctx.runMutation(deps.refs.setActionStatus, {
          actionId,
          status: ACTION_STATUS.succeeded,
          resultRedacted: redactedOutput,
          allowedCurrentStatuses: [ACTION_STATUS.executing],
        }),
      );
      const updated = requireActionStatusPayload(actionId, updatedRaw);
      if (updated.status !== ACTION_STATUS.succeeded) {
        return {
          status: updated.status,
          action: updated,
        };
      }

      await safeRunMutation("mcp_node.createAuditEvent", () =>
        ctx.runMutation(deps.refs.createAuditEvent, {
          orgId: state.workspace.org_id,
          actorType: AUDIT_ACTOR_TYPE.worker,
          actorId: "execution",
          eventType: AUDIT_EVENT_TYPES.actionExecutionCompleted,
          payload: {
            action_id: actionId,
            status: ACTION_STATUS.succeeded,
            output: redactedOutput,
            attempts: 1,
            provider,
            provider_module_version: providerModuleVersion,
          },
        }),
      );

      return {
        status: ACTION_STATUS.succeeded,
        action: updated,
      };
    } catch (error) {
      if (isOptimisticConcurrencyControlFailure(error) || isActionStatusTransitionConflict(error)) {
        const concurrent = await readCurrentActionExecutionState(ctx, actionId);
        if (concurrent && concurrent.status !== ACTION_STATUS.executing) {
          return concurrent;
        }
        throw error;
      }

      const message = error instanceof Error ? error.message : "Unknown worker failure";
      const classification = deps.classifyIntegrationError(error);
      console.error(
        "approved_action.execution_failed",
        buildApprovedActionFailureLogMetadata({
          actionId,
          toolName: tool.name,
          provider,
          providerModuleVersion,
          workspaceId: state.workspace.id,
          orgId: state.workspace.org_id,
          error,
          classification,
        }),
      );
      await safeRunMutation("mcp_node.markIntegrationHealth", () =>
        ctx.runMutation(deps.refs.markIntegrationHealth, {
          orgId: state.workspace.org_id,
          provider,
          status: INTEGRATION_STATUS.degraded,
          errorCode: classification.errorCode,
          errorCategory: classification.errorCategory,
          degradedReason: classification.degradedReason,
        }),
      );
      let updatedRaw;
      try {
        updatedRaw = await safeRunMutation("mcp_node.setActionStatus", () =>
          ctx.runMutation(deps.refs.setActionStatus, {
            actionId,
            status: ACTION_STATUS.failed,
            resultRedacted: {
              error: message,
              error_code: classification.errorCode,
              error_category: classification.errorCategory,
            },
            allowedCurrentStatuses: [ACTION_STATUS.executing],
          }),
        );
      } catch (transitionError) {
        if (
          isOptimisticConcurrencyControlFailure(transitionError) ||
          isActionStatusTransitionConflict(transitionError)
        ) {
          const concurrent = await readCurrentActionExecutionState(ctx, actionId);
          if (concurrent && concurrent.status !== ACTION_STATUS.executing) {
            return concurrent;
          }
        }
        throw transitionError;
      }
      const updated = requireActionStatusPayload(actionId, updatedRaw);
      if (updated.status !== ACTION_STATUS.failed) {
        return {
          status: updated.status,
          action: updated,
        };
      }

      await safeRunMutation("mcp_node.createAuditEvent", () =>
        ctx.runMutation(deps.refs.createAuditEvent, {
          orgId: state.workspace.org_id,
          actorType: AUDIT_ACTOR_TYPE.worker,
          actorId: "execution",
          eventType: AUDIT_EVENT_TYPES.actionExecutionCompleted,
          payload: {
            action_id: actionId,
            status: ACTION_STATUS.failed,
            error: message,
            error_code: classification.errorCode,
            error_category: classification.errorCategory,
            attempts: 1,
            provider,
            provider_module_version: providerModuleVersion,
          },
        }),
      );
      await safeRunMutation("mcp_node.createAuditEvent.providerMetricToolCallFailure", () =>
        ctx.runMutation(deps.refs.createAuditEvent, {
          orgId: state.workspace.org_id,
          actorType: AUDIT_ACTOR_TYPE.worker,
          actorId: "execution",
          eventType: AUDIT_EVENT_TYPES.providerMetric,
          payload: {
            metric: PROVIDER_METRIC_NAME.toolCallFailure,
            provider,
            outcome: PROVIDER_METRIC_OUTCOME.failure,
            reason_code: classification.errorCode,
            route: "mcp_node.executeApprovedAction",
            value: 1,
          },
        }),
      );

      return {
        status: ACTION_STATUS.failed,
        action: updated,
      };
    }
  };
};
