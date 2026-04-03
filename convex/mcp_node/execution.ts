"use node";

import { type FunctionReference } from "convex/server";
import { type ActionCtx } from "../_generated/server";
import {
  ACTION_STATUS,
  AUDIT_ACTOR_TYPE,
  AUDIT_EVENT_TYPES,
  DECISION_OUTCOME,
  INTEGRATION_STATUS,
  TOOL_CALL_RESULT_STATUS,
  TOOL_CALL_STATUS,
  assertNever,
} from "../domain_constants";
import {
  convexActionCreationResultSchema,
  convexConnectorContextSchema,
  convexExecuteToolCallPayloadSchema,
  convexGatingDataSchema,
  convexToolCallReferenceSchema,
  evaluateGating,
  getProviderModuleV2,
  jsonRecordSchema,
  nowIso,
  parseWorkerPayload,
  parseWorkerExecutionErrorCode,
  providerRegistry,
  readFeatureFlagValue,
  shouldGateTool,
  stableIdempotencyKey,
  toolMap,
  providerRolloutFeatureFlag,
  PROVIDER_REGISTRY_PATH_FEATURE_FLAG,
  toWorkerExecutionErrorCode,
  type IntegrationErrorClassification,
  type WorkerExecutionErrorCode,
  type CanonicalProviderId,
  type ConnectorContext,
  type ConvexActionStatusPayload,
  type ConvexConnectorContext,
  type ConvexExecuteToolCallPayload,
  type ConvexGatingData,
  type PreparedWrite,
  type ProviderRuntimeContext,
  type ToolDefinition,
} from "../mcp_node_shared";
import { safeParsePayload, safeRunMutation, safeRunQuery, validationMessage } from "../safe_convex";

type AnyInternalQueryReference = FunctionReference<"query", "internal">;
type AnyInternalMutationReference = FunctionReference<"mutation", "internal">;

type ToolCallRecordStatus =
  | typeof TOOL_CALL_STATUS.completed
  | typeof TOOL_CALL_STATUS.failed
  | typeof TOOL_CALL_STATUS.approvalRequired;

type ExecuteToolCallRefs = {
  loadConnectorContext: AnyInternalQueryReference;
  loadGatingData: AnyInternalQueryReference;
  createToolCall: AnyInternalMutationReference;
  createActionFromDecision: AnyInternalMutationReference;
  createAuditEvent: AnyInternalMutationReference;
  markIntegrationHealth: AnyInternalMutationReference;
  getOrgBillingForWorkspace: AnyInternalQueryReference;
  beginToolCall: AnyInternalMutationReference;
  finishToolCall: AnyInternalMutationReference;
};

type ExecuteToolCallHandlerDeps = {
  refs: ExecuteToolCallRefs;
  handleInternalToolCall: (
    ctx: ActionCtx,
    params: {
      payload: ConvexExecuteToolCallPayload;
      tool: ToolDefinition;
      startedAt: number;
    },
  ) => Promise<Record<string, unknown>>;
  executeApprovedActionImpl: (
    ctx: ActionCtx,
    actionId: string,
  ) => Promise<{
    status: string;
    action: ConvexActionStatusPayload;
  }>;
  finalizeToolCallRecord: (
    ctx: ActionCtx,
    params: {
      toolCallId: string;
      status: ToolCallRecordStatus;
      outputRedacted: Record<string, unknown>;
      startedAt: number;
    },
  ) => Promise<void>;
  resolveToolOwnerProvider: (toolName: string) => CanonicalProviderId;
  assertProviderRegistryPathEnabled: () => void;
  assertProviderCapability: (
    provider: CanonicalProviderId,
    capability: "read" | "write" | "refresh_credentials",
  ) => void;
  assertProviderRolloutEnabled: (provider: CanonicalProviderId) => void;
  assertIntegrationProviderMatch: (
    expectedProvider: CanonicalProviderId,
    actualProvider: CanonicalProviderId | null,
  ) => void;
  refreshConnectorContextAccessToken: (
    ctx: ActionCtx,
    params: {
      provider: CanonicalProviderId;
      context: ConnectorContext;
    },
  ) => Promise<ConnectorContext>;
  toProviderRuntimeContext: (namespace: string | undefined) => ProviderRuntimeContext;
  classifyIntegrationError: (error: unknown) => IntegrationErrorClassification;
  createWorkerExecutionError: (code: WorkerExecutionErrorCode, message: string) => Error;
};

type ResolvedProviderExecutionContext = {
  provider: CanonicalProviderId;
  providerModule: ReturnType<typeof getProviderModuleV2>;
  providerModuleVersion: string | number;
  requestedNamespace: string | null;
  normalizedInput: Record<string, unknown>;
  integrationContext: ConvexConnectorContext;
  connectorContext: ConnectorContext;
  runtimeContext: ProviderRuntimeContext;
  toolCallId: string;
};

type PreparedWriteToolCall = {
  normalizedPayload: Record<string, unknown>;
  payloadPreview: Record<string, unknown>;
  idempotencyKey: string;
};

const parseBillingOrgId = (
  payload: unknown,
  createWorkerExecutionError: (code: WorkerExecutionErrorCode, message: string) => Error,
): string => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw createWorkerExecutionError("execution_failed", "Workspace billing payload is invalid.");
  }
  const orgId = (payload as { org_id?: unknown }).org_id;
  if (typeof orgId !== "string" || orgId.trim().length === 0) {
    throw createWorkerExecutionError("execution_failed", "Workspace billing org id is invalid.");
  }
  return orgId;
};

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (!(error instanceof Error)) {
    return fallback;
  }
  const message = error.message.trim();
  return message.length > 0 ? message : fallback;
};

const stripWorkerErrorPrefix = (message: string): string => {
  const parsedCode = parseWorkerExecutionErrorCode(message);
  if (!parsedCode) {
    return message;
  }
  const prefix = `${parsedCode}:`;
  return message.startsWith(prefix) ? message.slice(prefix.length).trimStart() : message;
};

const getWorkerErrorMessage = (error: unknown, fallback: string): string => {
  return stripWorkerErrorPrefix(getErrorMessage(error, fallback));
};

const maybeApplyE2eTimeoutScale = (
  timeoutMs: number,
  rawInput: Record<string, unknown>,
): number => {
  const nestedInput =
    rawInput.input && typeof rawInput.input === "object" && !Array.isArray(rawInput.input)
      ? (rawInput.input as Record<string, unknown>)
      : null;
  const rawScale = rawInput.__e2eTimeoutScale ?? nestedInput?.__e2eTimeoutScale;
  if (typeof rawScale !== "number" || !Number.isFinite(rawScale)) {
    return timeoutMs;
  }
  if (rawScale <= 0 || rawScale > 1) {
    return timeoutMs;
  }
  return Math.max(1, Math.floor(timeoutMs * rawScale));
};

const runWithTimeout = async <T>(
  task: Promise<T>,
  timeoutMs: number,
  toolName: string,
  createWorkerExecutionError: (code: WorkerExecutionErrorCode, message: string) => Error,
): Promise<T> => {
  let handle: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        handle = setTimeout(() => {
          reject(
            createWorkerExecutionError(
              "execution_failed",
              `Tool ${toolName} exceeded ${timeoutMs}ms timeout.`,
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (handle !== null) {
      clearTimeout(handle);
    }
  }
};

const buildSummary = (toolName: string, preview: Record<string, unknown>): string => {
  if (Array.isArray(preview.to) && preview.to.length > 0) {
    const recipients = preview.to
      .map((entry) => String(entry).trim())
      .filter((entry) => entry.length > 0)
      .join(", ");
    if (recipients) {
      return `${toolName} for ${recipients}`;
    }
  }
  if (typeof preview.amount === "number" && Number.isFinite(preview.amount)) {
    const currency = typeof preview.currency === "string" ? preview.currency.toUpperCase() : "";
    return `${toolName} for ${String(preview.amount)} ${currency}`.trim();
  }
  return `Action ${toolName} requires approval`;
};

const toPreparedWrite = (
  output: Record<string, unknown> | PreparedWrite,
  toolName: string,
): PreparedWrite => {
  const record = parseWorkerPayload(jsonRecordSchema, output, {
    message: `Tool ${toolName} did not return a prepared write payload.`,
  });
  const normalizedPayload = parseWorkerPayload(jsonRecordSchema, record.normalized_payload, {
    message: `Tool ${toolName} returned an invalid normalized payload.`,
  });
  const payloadPreview = parseWorkerPayload(jsonRecordSchema, record.payload_preview, {
    message: `Tool ${toolName} returned an invalid preview payload.`,
  });

  return {
    normalized_payload: normalizedPayload,
    payload_preview: payloadPreview,
  };
};

const resolveProviderExecutionContext = async (
  ctx: ActionCtx,
  params: {
    payload: ConvexExecuteToolCallPayload;
    tool: ToolDefinition;
    deps: ExecuteToolCallHandlerDeps;
  },
): Promise<ResolvedProviderExecutionContext> => {
  const { payload, tool, deps } = params;
  const requestedNamespace =
    typeof payload.input.__e2eNamespace === "string" && payload.input.__e2eNamespace.trim()
      ? payload.input.__e2eNamespace.trim()
      : null;

  let normalizedInput: Record<string, unknown>;
  try {
    const parsed = tool.input_schema.parse(payload.input);
    normalizedInput = parseWorkerPayload(jsonRecordSchema, parsed, {
      message: "Input must be an object",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid input";
    throw deps.createWorkerExecutionError("execution_failed", `Invalid input: ${message}`);
  }

  const provider = deps.resolveToolOwnerProvider(tool.name);
  deps.assertProviderRegistryPathEnabled();
  deps.assertProviderCapability(provider, tool.capability === "read" ? "read" : "write");
  const providerModule = getProviderModuleV2(provider);
  const providerModuleVersion = providerModule.schemaVersion;
  deps.assertProviderRolloutEnabled(provider);

  const integrationContextRaw = await safeRunQuery("mcp_node.loadConnectorContext", () =>
    ctx.runQuery(deps.refs.loadConnectorContext, {
      workspaceId: payload.workspaceId,
      provider,
    }),
  );
  const integrationContext: ConvexConnectorContext = safeParsePayload(
    "mcp_node.loadConnectorContext",
    () =>
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
      `Provider ${provider} is disabled for workspace ${payload.workspaceId}`,
    );
  }

  if (!integrationContext.integration_id) {
    throw deps.createWorkerExecutionError(
      "integration_not_connected",
      `Integration ${provider} is not connected for workspace ${payload.workspaceId}`,
    );
  }
  deps.assertIntegrationProviderMatch(provider, integrationContext.integration_provider);

  const initialConnectorContext: ConnectorContext = {
    workspaceId: integrationContext.workspace.id,
    orgId: integrationContext.workspace.org_id,
    scopes: integrationContext.scopes,
    refresh_token: integrationContext.refresh_token,
    access_token_expires_at: integrationContext.access_token_expires_at,
    integration_account_id: integrationContext.integration_account_id,
    external_account_id: integrationContext.external_account_id,
    metadata: {
      ...integrationContext.metadata,
      ...(requestedNamespace ? { e2e_namespace: requestedNamespace } : {}),
    },
    ...(integrationContext.access_token ? { access_token: integrationContext.access_token } : {}),
  };
  const connectorContext = await deps.refreshConnectorContextAccessToken(ctx, {
    provider,
    context: initialConnectorContext,
  });
  const runtimeContext = deps.toProviderRuntimeContext(requestedNamespace ?? undefined);

  const inputRedacted = providerModule.connector.redact(tool.name, normalizedInput);
  const toolCallRaw = await safeRunMutation("mcp_node.createToolCall", () =>
    ctx.runMutation(deps.refs.createToolCall, {
      runId: payload.runId,
      toolName: tool.name,
      inputRedacted,
    }),
  );
  const toolCall = safeParsePayload("mcp_node.createToolCall", () =>
    parseWorkerPayload(convexToolCallReferenceSchema, toolCallRaw, {
      message: validationMessage(
        "mcp_node.createToolCall",
        `Tool call creation payload for ${tool.name} failed validation.`,
      ),
    }),
  );

  await safeRunMutation("mcp_node.createAuditEvent", () =>
    ctx.runMutation(deps.refs.createAuditEvent, {
      orgId: integrationContext.workspace.org_id,
      actorType: AUDIT_ACTOR_TYPE.automation,
      actorId: payload.runId,
      eventType: AUDIT_EVENT_TYPES.toolCallReceived,
      payload: {
        tool_name: tool.name,
        tool_call_id: toolCall.id,
        capability: tool.capability,
        provider,
        provider_module_version: providerModuleVersion,
      },
    }),
  );

  return {
    provider,
    providerModule,
    providerModuleVersion,
    requestedNamespace,
    normalizedInput,
    integrationContext,
    connectorContext,
    runtimeContext,
    toolCallId: toolCall.id,
  };
};

const executeReadToolCall = async (
  ctx: ActionCtx,
  params: {
    payload: ConvexExecuteToolCallPayload;
    tool: ToolDefinition;
    providerContext: ResolvedProviderExecutionContext;
    toolCallTimeoutMs: number;
    startedAt: number;
    deps: ExecuteToolCallHandlerDeps;
  },
): Promise<Record<string, unknown>> => {
  const { payload, tool, providerContext, toolCallTimeoutMs, startedAt, deps } = params;
  try {
    const output = await runWithTimeout(
      providerContext.providerModule.facets.tools.executeTool(
        {
          toolName: tool.name,
          input: providerContext.normalizedInput,
          context: providerContext.connectorContext,
          mode: "read",
        },
        providerContext.runtimeContext,
      ),
      toolCallTimeoutMs,
      tool.name,
      deps.createWorkerExecutionError,
    );
    const normalizedOutput = safeParsePayload("mcp_node.readTool.output", () =>
      parseWorkerPayload(jsonRecordSchema, output, {
        message: validationMessage(
          "mcp_node.readTool.output",
          `Tool ${tool.name} returned an invalid read payload.`,
        ),
      }),
    );
    const outputRedacted = providerContext.providerModule.connector.redact(
      tool.name,
      normalizedOutput,
    );
    await safeRunMutation("mcp_node.markIntegrationHealth", () =>
      ctx.runMutation(deps.refs.markIntegrationHealth, {
        orgId: providerContext.integrationContext.workspace.org_id,
        provider: providerContext.provider,
        status: INTEGRATION_STATUS.connected,
      }),
    );
    await deps.finalizeToolCallRecord(ctx, {
      toolCallId: providerContext.toolCallId,
      status: TOOL_CALL_STATUS.completed,
      outputRedacted,
      startedAt,
    });
    await safeRunMutation("mcp_node.createAuditEvent", () =>
      ctx.runMutation(deps.refs.createAuditEvent, {
        orgId: providerContext.integrationContext.workspace.org_id,
        actorType: AUDIT_ACTOR_TYPE.automation,
        actorId: payload.runId,
        eventType: AUDIT_EVENT_TYPES.toolCallCompleted,
        payload: {
          tool_name: tool.name,
          tool_call_id: providerContext.toolCallId,
        },
      }),
    );

    return {
      status: ACTION_STATUS.succeeded,
      output: outputRedacted,
    };
  } catch (error) {
    const message = getWorkerErrorMessage(error, "Unknown execution error");
    const classification = deps.classifyIntegrationError(error);
    await safeRunMutation("mcp_node.markIntegrationHealth", () =>
      ctx.runMutation(deps.refs.markIntegrationHealth, {
        orgId: providerContext.integrationContext.workspace.org_id,
        provider: providerContext.provider,
        status: INTEGRATION_STATUS.degraded,
        errorCode: classification.errorCode,
        errorCategory: classification.errorCategory,
        degradedReason: classification.degradedReason,
      }),
    );
    await deps.finalizeToolCallRecord(ctx, {
      toolCallId: providerContext.toolCallId,
      status: TOOL_CALL_STATUS.failed,
      outputRedacted: {
        error: message,
        error_code: classification.errorCode,
        error_category: classification.errorCategory,
      },
      startedAt,
    });
    throw deps.createWorkerExecutionError(
      toWorkerExecutionErrorCode(classification.errorCode),
      message,
    );
  }
};

const handleWritePreparationFailure = async (
  ctx: ActionCtx,
  params: {
    providerContext: ResolvedProviderExecutionContext;
    startedAt: number;
    error: unknown;
    deps: ExecuteToolCallHandlerDeps;
  },
): Promise<never> => {
  const { providerContext, startedAt, error, deps } = params;
  const message = getWorkerErrorMessage(error, "Unknown write preparation error");
  const classification = deps.classifyIntegrationError(error);
  await safeRunMutation("mcp_node.markIntegrationHealth", () =>
    ctx.runMutation(deps.refs.markIntegrationHealth, {
      orgId: providerContext.integrationContext.workspace.org_id,
      provider: providerContext.provider,
      status: INTEGRATION_STATUS.degraded,
      errorCode: classification.errorCode,
      errorCategory: classification.errorCategory,
      degradedReason: classification.degradedReason,
    }),
  );
  await deps.finalizeToolCallRecord(ctx, {
    toolCallId: providerContext.toolCallId,
    status: TOOL_CALL_STATUS.failed,
    outputRedacted: {
      error: message,
      error_code: classification.errorCode,
      error_category: classification.errorCategory,
    },
    startedAt,
  });
  throw deps.createWorkerExecutionError(
    toWorkerExecutionErrorCode(classification.errorCode),
    message,
  );
};

const prepareWriteToolCall = async (
  ctx: ActionCtx,
  params: {
    payload: ConvexExecuteToolCallPayload;
    tool: ToolDefinition;
    providerContext: ResolvedProviderExecutionContext;
    toolCallTimeoutMs: number;
    deps: ExecuteToolCallHandlerDeps;
  },
): Promise<PreparedWriteToolCall> => {
  const { payload, tool, providerContext, toolCallTimeoutMs, deps } = params;
  const prepared = toPreparedWrite(
    await runWithTimeout(
      providerContext.providerModule.facets.tools.executeTool(
        {
          toolName: tool.name,
          input: providerContext.normalizedInput,
          context: providerContext.connectorContext,
          mode: "prepare_write",
        },
        providerContext.runtimeContext,
      ),
      toolCallTimeoutMs,
      tool.name,
      deps.createWorkerExecutionError,
    ),
    tool.name,
  );
  const normalizedPayload = prepared.normalized_payload;
  const payloadPreview = providerContext.providerModule.connector.redact(
    tool.name,
    prepared.payload_preview,
  );

  const idempotencyKey = stableIdempotencyKey(tool.name, normalizedPayload);
  return {
    normalizedPayload,
    payloadPreview,
    idempotencyKey,
  };
};

const applyGatingDecision = async (
  ctx: ActionCtx,
  params: {
    payload: ConvexExecuteToolCallPayload;
    tool: ToolDefinition;
    providerContext: ResolvedProviderExecutionContext;
    preparedWrite: PreparedWriteToolCall;
    startedAt: number;
    deps: ExecuteToolCallHandlerDeps;
  },
): Promise<Record<string, unknown>> => {
  const { payload, tool, providerContext, preparedWrite, startedAt, deps } = params;

  const gatingRaw = await safeRunQuery("mcp_node.loadGatingData", () =>
    ctx.runQuery(deps.refs.loadGatingData, {
      workspaceId: payload.workspaceId,
    }),
  );
  const gating: ConvexGatingData = safeParsePayload("mcp_node.loadGatingData", () =>
    parseWorkerPayload(convexGatingDataSchema, gatingRaw, {
      message: validationMessage(
        "mcp_node.loadGatingData",
        `Gating payload for workspace ${payload.workspaceId} failed validation.`,
      ),
    }),
  );

  const decision = evaluateGating({
    workspace: gating.workspace,
    tool,
    payloadPreview: preparedWrite.payloadPreview,
    celRules: gating.cel_rules,
    autoApprovals: gating.tool_auto_approvals,
    policies: gating.policies,
    now: nowIso(),
  });

  const contextSnapshot = safeParsePayload("mcp_node.evaluateGating.contextSnapshot", () =>
    parseWorkerPayload(jsonRecordSchema, decision.context_snapshot, {
      message: validationMessage(
        "mcp_node.evaluateGating.contextSnapshot",
        `Gating context snapshot for ${tool.name} failed validation.`,
      ),
    }),
  );
  const createdRaw = await safeRunMutation("mcp_node.createActionFromDecision", () =>
    ctx.runMutation(deps.refs.createActionFromDecision, {
      runId: payload.runId,
      toolCallId: providerContext.toolCallId,
      toolName: tool.name,
      actionType: tool.action_type,
      riskLevel: tool.risk_level,
      normalizedPayload: preparedWrite.normalizedPayload,
      payloadPreview: preparedWrite.payloadPreview,
      idempotencyKey: preparedWrite.idempotencyKey,
      decision: {
        outcome: decision.outcome,
        decider_type: decision.decider_type,
        decision_reason: decision.decision_reason,
        matched_rule_id: decision.matched_rule_id,
        expression_snapshot: decision.trace.matched_cel_rules[0]?.expression,
        context_snapshot: contextSnapshot,
        ...(decision.policy_decision
          ? {
              policy_decision: {
                result: decision.policy_decision.result,
                explanation: decision.policy_decision.explanation,
                confidence: decision.policy_decision.confidence,
                policies: gating.policies
                  .filter((entry) => entry.enabled)
                  .map((entry) => entry.text),
              },
            }
          : {}),
      },
    }),
  );
  const created = safeParsePayload("mcp_node.createActionFromDecision", () =>
    parseWorkerPayload(convexActionCreationResultSchema, createdRaw, {
      message: validationMessage(
        "mcp_node.createActionFromDecision",
        `Action creation payload for ${tool.name} failed validation.`,
      ),
    }),
  );

  if (created.idempotencyReplayed) {
    await deps.finalizeToolCallRecord(ctx, {
      toolCallId: providerContext.toolCallId,
      status: TOOL_CALL_STATUS.completed,
      outputRedacted: {
        action_id: created.action.id,
        prior_status: created.action.status,
      },
      startedAt,
    });

    return {
      status: TOOL_CALL_RESULT_STATUS.idempotentReplay,
      action_id: created.action.id,
      action_status: created.action.status,
    };
  }

  switch (decision.outcome) {
    case DECISION_OUTCOME.deny: {
      await deps.finalizeToolCallRecord(ctx, {
        toolCallId: providerContext.toolCallId,
        status: TOOL_CALL_STATUS.completed,
        outputRedacted: {
          status: ACTION_STATUS.rejected,
          action_id: created.action.id,
          reason: decision.decision_reason,
        },
        startedAt,
      });

      return {
        status: ACTION_STATUS.rejected,
        action_id: created.action.id,
        reason: decision.decision_reason,
      };
    }
    case DECISION_OUTCOME.approve: {
      await deps.finalizeToolCallRecord(ctx, {
        toolCallId: providerContext.toolCallId,
        status: TOOL_CALL_STATUS.completed,
        outputRedacted: {
          status: ACTION_STATUS.approved,
          action_id: created.action.id,
          reason: decision.decision_reason,
        },
        startedAt,
      });

      const execution = await deps.executeApprovedActionImpl(ctx, created.action.id);
      return {
        status: execution.status,
        action_id: created.action.id,
        action: execution.action,
      };
    }
    case DECISION_OUTCOME.pending: {
      const summary = buildSummary(tool.name, preparedWrite.payloadPreview);
      await deps.finalizeToolCallRecord(ctx, {
        toolCallId: providerContext.toolCallId,
        status: TOOL_CALL_STATUS.approvalRequired,
        outputRedacted: {
          status: TOOL_CALL_STATUS.approvalRequired,
          action_id: created.action.id,
          summary,
        },
        startedAt,
      });

      return {
        status: TOOL_CALL_STATUS.approvalRequired,
        action_id: created.action.id,
        summary,
        next_tool: "keppo.wait_for_action",
      };
    }
    default:
      return assertNever(decision.outcome, "gating decision outcome");
  }
};

const resolveProviderRolloutFlag = (provider: CanonicalProviderId): boolean => {
  return readFeatureFlagValue(providerRolloutFeatureFlag(provider));
};

const resolveRegistryPathEnabled = (): boolean => {
  return readFeatureFlagValue(PROVIDER_REGISTRY_PATH_FEATURE_FLAG);
};

const resolveToolOwnerProvider = (toolName: string): CanonicalProviderId => {
  return providerRegistry.getToolOwner(toolName);
};

export const createExecuteToolCallHandler = (deps: ExecuteToolCallHandlerDeps) => {
  const resolveOwnerProvider = deps.resolveToolOwnerProvider ?? resolveToolOwnerProvider;
  const assertRegistryPathEnabled =
    deps.assertProviderRegistryPathEnabled ??
    (() => {
      if (!resolveRegistryPathEnabled()) {
        throw deps.createWorkerExecutionError(
          "provider_registry_disabled",
          "Provider registry path is disabled by kill switch.",
        );
      }
    });
  const assertRolloutEnabled =
    deps.assertProviderRolloutEnabled ??
    ((provider) => {
      if (!resolveProviderRolloutFlag(provider)) {
        throw deps.createWorkerExecutionError(
          "provider_disabled",
          `Provider ${provider} is currently disabled by rollout policy.`,
        );
      }
    });

  return async (ctx: ActionCtx, args: unknown): Promise<Record<string, unknown>> => {
    const payload = parseWorkerPayload(convexExecuteToolCallPayloadSchema, args);
    const startedAt = Date.now();
    const tool = toolMap.get(payload.toolName);

    if (!tool) {
      throw deps.createWorkerExecutionError(
        "execution_failed",
        `Unknown tool: ${payload.toolName}`,
      );
    }

    const billingWorkspace = await safeRunQuery("mcp_node.getOrgBillingForWorkspace", () =>
      ctx.runQuery(deps.refs.getOrgBillingForWorkspace, {
        workspaceId: payload.workspaceId,
      }),
    );
    const billingOrgId = parseBillingOrgId(billingWorkspace, deps.createWorkerExecutionError);
    let billingReservation: {
      tool_call_timeout_ms: number;
      period_start: string;
    } | null = null;

    try {
      const reservation = await safeRunMutation("mcp_node.beginToolCall", () =>
        ctx.runMutation(deps.refs.beginToolCall, {
          orgId: billingOrgId,
        }),
      );
      billingReservation = reservation;
      const baseToolCallTimeoutMs = Math.max(1, Math.floor(reservation.tool_call_timeout_ms));
      const toolCallTimeoutMs = maybeApplyE2eTimeoutScale(baseToolCallTimeoutMs, payload.input);

      if (tool.provider === "keppo") {
        return await deps.handleInternalToolCall(ctx, {
          payload,
          tool,
          startedAt,
        });
      }

      const providerContext = await resolveProviderExecutionContext(ctx, {
        payload,
        tool,
        deps: {
          ...deps,
          resolveToolOwnerProvider: resolveOwnerProvider,
          assertProviderRegistryPathEnabled: assertRegistryPathEnabled,
          assertProviderRolloutEnabled: assertRolloutEnabled,
        },
      });

      if (!shouldGateTool(tool)) {
        if (tool.capability !== "read") {
          throw deps.createWorkerExecutionError(
            "provider_capability_mismatch",
            `Non-gated execution for ${tool.name} requires read capability.`,
          );
        }
        return await executeReadToolCall(ctx, {
          payload,
          tool,
          providerContext,
          toolCallTimeoutMs,
          startedAt,
          deps,
        });
      }

      if (tool.capability !== "write") {
        throw deps.createWorkerExecutionError(
          "provider_capability_mismatch",
          `Gated execution for ${tool.name} requires write capability.`,
        );
      }
      let preparedWrite: PreparedWriteToolCall;
      try {
        preparedWrite = await prepareWriteToolCall(ctx, {
          payload,
          tool,
          providerContext,
          toolCallTimeoutMs,
          deps,
        });
      } catch (error) {
        return await handleWritePreparationFailure(ctx, {
          providerContext,
          startedAt,
          error,
          deps,
        });
      }

      return await applyGatingDecision(ctx, {
        payload,
        tool,
        providerContext,
        preparedWrite,
        startedAt,
        deps,
      });
    } finally {
      const reservation = billingReservation;
      try {
        if (reservation) {
          await safeRunMutation("mcp_node.finishToolCall", () =>
            ctx.runMutation(deps.refs.finishToolCall, {
              orgId: billingOrgId,
              periodStart: reservation.period_start,
              latencyMs: Date.now() - startedAt,
            }),
          );
        }
      } catch (error) {
        console.error("billing.finish_tool_call.error", error);
      }
    }
  };
};
