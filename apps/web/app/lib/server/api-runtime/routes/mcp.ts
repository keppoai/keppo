import { randomUUID } from "node:crypto";
import {
  CODE_MODE_STRUCTURED_EXECUTION_ERROR_CODE,
  CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPE,
  createCodeModeStructuredExecutionError,
  parseCodeModeStructuredExecutionError,
} from "@keppo/shared/code-mode/structured-execution-error";
import {
  ACTION_STATUS,
  CLIENT_TYPE,
  DECISION_OUTCOME,
  PROVIDER_METRIC_NAME,
  PROVIDER_METRIC_OUTCOME,
  TOOL_CALL_RESULT_STATUS,
  TOOL_CALL_STATUS,
  type ActionStatus,
} from "@keppo/shared/domain";
import { MCP_CREDENTIAL_AUTH_STATUS } from "@keppo/shared/mcp-auth";
import {
  buildBoundaryErrorEnvelope,
  parseBearerAuthorizationHeader,
  parseMcpErrorEnvelope,
  parseMcpSessionHeader,
  parseMcpWorkspaceParams,
} from "@keppo/shared/providers/boundaries/error-boundary";
import {
  createWorkerExecutionError,
  parseWorkerExecutionErrorCode,
} from "@keppo/shared/execution-errors";
import type {
  ProviderMetricName,
  ProviderMetricOutcome,
} from "@keppo/shared/providers/boundaries/types";
import type { CanonicalProviderId } from "@keppo/shared/provider-ids";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  type ListToolsResult,
  McpError,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { getEnv } from "../env.js";
import type { ConvexInternalClient } from "../convex.js";
import type { RateLimiter } from "../rate-limit.js";

type McpRoutesDeps = {
  convex: Pick<
    ConvexInternalClient,
    | "authenticateCredential"
    | "closeRunBySession"
    | "createRun"
    | "getRunBySession"
    | "executeCustomToolCall"
    | "executeToolCall"
    | "getWorkspaceCodeModeContext"
    | "listToolCatalogForWorkspace"
    | "markCredentialUsed"
    | "searchTools"
    | "seedToolIndex"
    | "touchRun"
  >;
  getE2ENamespace: (headerValue: string | undefined) => string | null;
  hashIpAddress: (value: string) => string;
  resolveClientIp: (request: Request) => string;
  resolveRegistryPathEnabled: () => Promise<boolean>;
  recordRateLimitedEvent: (params: {
    orgId?: string;
    route: string;
    key: string;
    ipHash: string;
    retryAfterMs: number;
  }) => void;
  recordProviderMetric: (params: {
    metric: ProviderMetricName;
    orgId?: string;
    provider?: CanonicalProviderId;
    providerInput?: string;
    route?: string;
    outcome?: ProviderMetricOutcome;
    reasonCode?: string;
    value?: number;
  }) => void;
  mcpAuthFailureLimiter: RateLimiter;
  mcpCredentialLimiter: RateLimiter;
  mcpAuthFailuresPerMinute: number;
  mcpRequestsPerCredentialPerMinute: number;
  systemMetricsOrgId: string;
  logger: {
    info: (message: string, metadata?: Record<string, unknown>) => void;
    warn: (message: string, metadata?: Record<string, unknown>) => void;
    error: (message: string, metadata?: Record<string, unknown>) => void;
  };
};

const MCP_ROUTE_PATH = "/mcp/:workspaceId";
const AUTOMATION_OUTCOME_TOOL_NAME = "record_outcome";

type McpRequestAuthContext = {
  workspaceId: string;
  credentialId: string;
  orgId: string;
  codeModeEnabled: boolean;
  e2eNamespace: string | null;
  testId: string | null;
  scenarioId: string | null;
  runId?: string;
  automationRunId?: string;
};

type McpSessionState = {
  workspaceId: string;
  sessionId: string | null;
  runId: string | null;
  transport: WebStandardStreamableHTTPServerTransport;
  server: Server;
  requestChain: Promise<void>;
  /** True for sessions recovered from Convex after a serverless instance miss. */
  recovered?: boolean;
};

type McpRequestContext = {
  request: Request;
  workspaceIdParam: string;
};

type McpToolInputSchema = {
  type: "object";
  properties?: Record<string, object>;
  required?: string[];
  [key: string]: unknown;
};

type ExecuteCodeResultPayload = {
  status: string;
  tool_name: string;
  reason: string;
  error_code?: string;
  action_id?: string;
};

type ToolsCoreModule = typeof import("@keppo/shared/tools-core");
type CodeModeRuntimeModule = typeof import("@keppo/shared/code-mode-runtime");

let toolsCoreModulePromise: Promise<ToolsCoreModule> | null = null;
let codeModeRuntimeModulePromise: Promise<CodeModeRuntimeModule> | null = null;

const loadToolsCoreModule = async (): Promise<ToolsCoreModule> => {
  toolsCoreModulePromise ??= import("@keppo/shared/tools-core");
  return await toolsCoreModulePromise;
};

const loadCodeModeRuntimeModule = async (): Promise<CodeModeRuntimeModule> => {
  codeModeRuntimeModulePromise ??= import("@keppo/shared/code-mode-runtime");
  return await codeModeRuntimeModulePromise;
};

const recordTypedToolCallFailureMetrics = (
  deps: Pick<McpRoutesDeps, "recordProviderMetric">,
  params: {
    errorMessage: string | undefined;
    orgId: string | undefined;
    provider?: CanonicalProviderId;
  },
): void => {
  const workerErrorCode = parseWorkerExecutionErrorCode(params.errorMessage);
  const structuredError =
    workerErrorCode === null && params.errorMessage
      ? parseCodeModeStructuredExecutionError(params.errorMessage)
      : null;
  const reasonCode = workerErrorCode ?? structuredError?.errorCode ?? structuredError?.type;
  if (!reasonCode) {
    return;
  }

  deps.recordProviderMetric({
    metric: PROVIDER_METRIC_NAME.toolCallFailure,
    route: MCP_ROUTE_PATH,
    outcome: workerErrorCode ? PROVIDER_METRIC_OUTCOME.failure : PROVIDER_METRIC_OUTCOME.blocked,
    reasonCode,
    ...(params.provider ? { provider: params.provider } : {}),
    ...(params.orgId ? { orgId: params.orgId } : {}),
  });

  if (workerErrorCode === "provider_capability_mismatch") {
    deps.recordProviderMetric({
      metric: PROVIDER_METRIC_NAME.capabilityMismatchBlock,
      route: MCP_ROUTE_PATH,
      outcome: PROVIDER_METRIC_OUTCOME.blocked,
      reasonCode: workerErrorCode,
      ...(params.provider ? { provider: params.provider } : {}),
      ...(params.orgId ? { orgId: params.orgId } : {}),
    });
  }
};

const isKeppoInternalToolName = (toolName: string): boolean => {
  return toolName === AUTOMATION_OUTCOME_TOOL_NAME || toolName.startsWith("keppo.");
};

const resolveToolOwner = async (toolName: string): Promise<CanonicalProviderId | undefined> => {
  const { toolMap } = await loadToolsCoreModule();
  const tool = toolMap.get(toolName);
  return tool ? (tool.provider as CanonicalProviderId) : undefined;
};

const buildMcpError = (
  id: string | number | null,
  message: string,
  data?: ReturnType<typeof buildBoundaryErrorEnvelope>["error"],
): ReturnType<typeof parseMcpErrorEnvelope> =>
  parseMcpErrorEnvelope({
    jsonrpc: "2.0",
    id,
    error: {
      code: -32000,
      message,
      ...(data ? { data } : {}),
    },
  });

const SENSITIVE_MCP_ERROR_PATTERNS = [
  /\b(?:authorization|bearer|access[_-]?token|refresh[_-]?token|api[_-]?key|client[_-]?secret|session[_-]?token|password)\b/i,
  /\b(?:sk_(?:live|test)_[a-z0-9]+|gh[pousr]_[a-z0-9]+|xox[baprs]-[a-z0-9-]+)\b/i,
  /bearer\s+[a-z0-9._~+/-]{8,}/i,
  /https?:\/\/\S*[?&](?:access_token|refresh_token|token|code|state)=\S+/i,
] as const;

const MAX_CLIENT_ERROR_MESSAGE_LENGTH = 240;

const nextMcpErrorReference = (): string => {
  return `mcp_err_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
};

const mcpJsonResponse = (payload: unknown, status: number, headers?: HeadersInit): Response => {
  return Response.json(payload, {
    status,
    ...(headers ? { headers } : {}),
  });
};

const cloneBufferedResponse = async (response: Response): Promise<Response> => {
  const body = response.body === null ? null : await response.arrayBuffer();
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
};

const resolveAuthenticatedWorkspace = async (
  requestContext: McpRequestContext,
  deps: Pick<
    McpRoutesDeps,
    | "convex"
    | "hashIpAddress"
    | "resolveClientIp"
    | "mcpAuthFailureLimiter"
    | "mcpAuthFailuresPerMinute"
    | "logger"
    | "recordRateLimitedEvent"
  >,
): Promise<
  | {
      ok: true;
      workspaceId: string;
      ipHash: string;
      auth: NonNullable<Awaited<ReturnType<McpRoutesDeps["convex"]["authenticateCredential"]>>>;
    }
  | { ok: false; response: Response }
> => {
  const { request, workspaceIdParam } = requestContext;
  let token: string;
  try {
    token = parseBearerAuthorizationHeader(request.headers.get("authorization") ?? undefined);
  } catch {
    return {
      ok: false,
      response: mcpJsonResponse(buildMcpError(null, "Missing bearer token"), 401),
    };
  }

  let workspaceId: string;
  try {
    workspaceId = parseMcpWorkspaceParams({
      workspaceId: workspaceIdParam,
    }).workspaceId;
  } catch (error) {
    const boundaryEnvelope = buildBoundaryErrorEnvelope(error, {
      defaultCode: "invalid_request",
      defaultMessage: "Invalid MCP workspace path parameter.",
      source: "api",
    });
    return {
      ok: false,
      response: mcpJsonResponse(
        buildMcpError(
          null,
          `${boundaryEnvelope.error.code}: ${boundaryEnvelope.error.message}`,
          boundaryEnvelope.error,
        ),
        400,
      ),
    };
  }

  const ipHash = deps.hashIpAddress(deps.resolveClientIp(request));
  const auth = await deps.convex.authenticateCredential(workspaceId, token, ipHash);
  if (!auth) {
    const authFailure = await deps.mcpAuthFailureLimiter.check(
      `mcp-auth-failure:${ipHash}`,
      deps.mcpAuthFailuresPerMinute,
      60_000,
    );
    if (!authFailure.allowed) {
      deps.logger.warn("security.rate_limit.hit", {
        bucket: "mcp_auth_failure_ip",
        route: MCP_ROUTE_PATH,
        ip_hash: ipHash,
        remaining: authFailure.remaining,
        retry_after_ms: authFailure.retryAfterMs,
      });
      deps.recordRateLimitedEvent({
        route: MCP_ROUTE_PATH,
        key: "mcp_auth_failure_ip",
        ipHash,
        retryAfterMs: authFailure.retryAfterMs,
      });
      return {
        ok: false,
        response: mcpJsonResponse(
          buildMcpError(null, "Too many failed authentication attempts. Try again later."),
          429,
          {
            "Retry-After": String(Math.max(1, Math.ceil(authFailure.retryAfterMs / 1000))),
          },
        ),
      };
    }
    return {
      ok: false,
      response: mcpJsonResponse(buildMcpError(null, "Invalid bearer token"), 403),
    };
  }

  return {
    ok: true,
    workspaceId,
    ipHash,
    auth,
  };
};

const extractMcpErrorMessage = (rawMessage: string): string => {
  const trimmed = rawMessage.trim();
  if (!trimmed) {
    return "";
  }

  const uncaughtMatch = /Uncaught Error:\s*([^\n]+)/u.exec(trimmed);
  if (uncaughtMatch?.[1]) {
    return uncaughtMatch[1].trim();
  }

  const withoutRequestPrefix = trimmed
    .replace(/^\[Request ID:[^\]]+\]\s*Server Error\s*/u, "")
    .trim();
  const firstLine = withoutRequestPrefix
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return firstLine ?? trimmed;
};

export const sanitizeMcpClientErrorMessage = (
  rawMessage: string | undefined,
  fallbackMessage: string,
): {
  message: string;
  redacted: boolean;
  referenceId: string | null;
} => {
  const normalized = typeof rawMessage === "string" ? extractMcpErrorMessage(rawMessage) : "";
  if (!normalized) {
    return {
      message: fallbackMessage,
      redacted: false,
      referenceId: null,
    };
  }

  const shouldRedact =
    normalized.length > MAX_CLIENT_ERROR_MESSAGE_LENGTH ||
    SENSITIVE_MCP_ERROR_PATTERNS.some((pattern) => pattern.test(normalized));
  if (!shouldRedact) {
    return {
      message: normalized,
      redacted: false,
      referenceId: null,
    };
  }

  const referenceId = nextMcpErrorReference();
  return {
    message: `${fallbackMessage} (ref: ${referenceId})`,
    redacted: true,
    referenceId,
  };
};

const resolveLoggedMcpErrorCode = (rawMessage: string | undefined): string | null => {
  const workerErrorCode = parseWorkerExecutionErrorCode(rawMessage);
  if (workerErrorCode) {
    return workerErrorCode;
  }
  const structuredError = rawMessage ? parseCodeModeStructuredExecutionError(rawMessage) : null;
  return structuredError?.errorCode ?? structuredError?.type ?? null;
};

const buildMcpFailureLogMetadata = (params: {
  workspaceId: string;
  runId: string;
  orgId: string;
  toolName: string;
  sessionId?: string;
  provider?: CanonicalProviderId;
  rawMessage: string | undefined;
  sanitized: ReturnType<typeof sanitizeMcpClientErrorMessage>;
  errorCode?: string;
}): Record<string, unknown> => ({
  route: MCP_ROUTE_PATH,
  method: "tools/call",
  workspace_id: params.workspaceId,
  run_id: params.runId,
  org_id: params.orgId,
  tool_name: params.toolName,
  ...(params.sessionId ? { session_id: params.sessionId } : {}),
  ...(params.provider ? { provider: params.provider } : {}),
  ...((resolveLoggedMcpErrorCode(params.rawMessage) ?? params.errorCode)
    ? { error_code: resolveLoggedMcpErrorCode(params.rawMessage) ?? params.errorCode }
    : {}),
  client_message: params.sanitized.message,
  message_redacted: params.sanitized.redacted,
  ...(params.sanitized.referenceId ? { reference_id: params.sanitized.referenceId } : {}),
});

const logReturnedMcpErrorResult = (
  deps: Pick<McpRoutesDeps, "logger">,
  params: {
    eventName: string;
    redactedEventName: string;
    workspaceId: string;
    runId: string;
    orgId: string;
    toolName: string;
    sessionId?: string;
    provider?: CanonicalProviderId;
    rawMessage: string | undefined;
    clientMessage: string;
    errorCode?: string;
  },
): void => {
  const sanitized = {
    message: params.clientMessage,
    redacted: false,
    referenceId: null,
  } satisfies ReturnType<typeof sanitizeMcpClientErrorMessage>;
  deps.logger.warn(
    params.eventName,
    buildMcpFailureLogMetadata({
      workspaceId: params.workspaceId,
      runId: params.runId,
      orgId: params.orgId,
      toolName: params.toolName,
      ...(params.sessionId ? { sessionId: params.sessionId } : {}),
      ...(params.provider ? { provider: params.provider } : {}),
      rawMessage: params.rawMessage,
      sanitized,
      ...(params.errorCode ? { errorCode: params.errorCode } : {}),
    }),
  );
};

const parseSearchToolsArgs = (
  args: Record<string, unknown>,
): {
  query: string;
  provider?: string;
  capability?: string;
  limit?: number;
} => {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) {
    throw createWorkerExecutionError(
      "execution_failed",
      "search_tools requires a non-empty query string.",
    );
  }
  const provider = typeof args.provider === "string" ? args.provider.trim() : undefined;
  const capability = typeof args.capability === "string" ? args.capability.trim() : undefined;
  const limitRaw = args.limit;
  const limit =
    typeof limitRaw === "number" && Number.isFinite(limitRaw) ? Math.floor(limitRaw) : undefined;
  return {
    query,
    ...(provider ? { provider } : {}),
    ...(capability ? { capability } : {}),
    ...(typeof limit === "number" ? { limit } : {}),
  };
};

const parseExecuteCodeArgs = (
  args: Record<string, unknown>,
): {
  code: string;
  description: string;
} => {
  const description = typeof args.description === "string" ? args.description.trim() : "";
  if (!description) {
    throw createCodeModeStructuredExecutionError({
      type: CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPE.executionFailed,
      toolName: "execute_code",
      errorCode: CODE_MODE_STRUCTURED_EXECUTION_ERROR_CODE.validationFailed,
      reason: "execute_code requires a non-empty description string.",
    });
  }
  const code = typeof args.code === "string" ? args.code : "";
  if (!code.trim()) {
    throw createCodeModeStructuredExecutionError({
      type: CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPE.executionFailed,
      toolName: "execute_code",
      errorCode: CODE_MODE_STRUCTURED_EXECUTION_ERROR_CODE.validationFailed,
      reason: "execute_code requires a non-empty code string.",
    });
  }
  return { code, description };
};

const formatExecuteCodeStructuredResultText = (payload: ExecuteCodeResultPayload): string =>
  payload.tool_name === "execute_code"
    ? `${payload.status}: ${payload.reason}`
    : `${payload.status}: ${payload.tool_name}: ${payload.reason}`;

const buildExecuteCodeStructuredResult = (payload: ExecuteCodeResultPayload): CallToolResult => {
  return buildStructuredToolResult(payload, {
    text: formatExecuteCodeStructuredResultText(payload),
  });
};

const parseExecuteCodeStructuredResultPayload = (
  errorMessage: string | undefined,
): ExecuteCodeResultPayload | null => {
  const structured = parseCodeModeStructuredExecutionError(errorMessage);
  if (!structured) {
    return null;
  }
  return {
    status: structured.type,
    tool_name: structured.toolName,
    reason: structured.reason,
    ...(structured.errorCode ? { error_code: structured.errorCode } : {}),
    ...(structured.actionId ? { action_id: structured.actionId } : {}),
  };
};

const parseExecuteCodeWorkerFailurePayload = (
  errorMessage: string | undefined,
): ExecuteCodeResultPayload | null => {
  const errorCode = parseWorkerExecutionErrorCode(errorMessage);
  if (
    errorCode !== "execution_failed" &&
    errorCode !== "provider_disabled" &&
    errorCode !== "integration_not_connected"
  ) {
    return null;
  }
  const message = typeof errorMessage === "string" ? extractMcpErrorMessage(errorMessage) : "";
  if (errorCode === "provider_disabled" || errorCode === "integration_not_connected") {
    const normalizedMessage = message.replace(/^[a-z_]+:\s*/i, "");
    const provider = message.match(/Provider ([a-z0-9_]+)/i)?.[1] ?? "unknown";
    return {
      status: CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPE.blocked,
      tool_name: provider,
      reason: normalizedMessage || "Tool call is not available in this workspace.",
      error_code: errorCode,
    };
  }
  if (
    !message.includes("requires a non-empty code string") &&
    !message.includes("requires a non-empty description string")
  ) {
    return null;
  }
  return {
    status: CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPE.executionFailed,
    tool_name: "execute_code",
    reason: message || "Code execution failed.",
    error_code: CODE_MODE_STRUCTURED_EXECUTION_ERROR_CODE.validationFailed,
  };
};

type ExecuteCodeToolCallStatus =
  | ActionStatus
  | typeof TOOL_CALL_STATUS.approvalRequired
  | typeof TOOL_CALL_RESULT_STATUS.idempotentReplay;

const EXECUTE_CODE_TOOL_CALL_STATUSES = new Set<ExecuteCodeToolCallStatus>([
  ACTION_STATUS.pending,
  ACTION_STATUS.approved,
  ACTION_STATUS.rejected,
  ACTION_STATUS.executing,
  ACTION_STATUS.succeeded,
  ACTION_STATUS.failed,
  ACTION_STATUS.expired,
  TOOL_CALL_STATUS.approvalRequired,
  TOOL_CALL_RESULT_STATUS.idempotentReplay,
]);

const parseExecuteCodeToolCallStatus = (value: unknown): ExecuteCodeToolCallStatus => {
  if (
    typeof value === "string" &&
    EXECUTE_CODE_TOOL_CALL_STATUSES.has(value as ExecuteCodeToolCallStatus)
  ) {
    return value as ExecuteCodeToolCallStatus;
  }
  throw createWorkerExecutionError(
    "execution_failed",
    `execute_code returned unsupported tool status: ${String(value)}`,
  );
};

const assertNever = (value: never, context: string): never => {
  throw createWorkerExecutionError("execution_failed", `Unexpected ${context}: ${String(value)}`);
};

let knownToolNamespacesPromise: Promise<Set<string>> | null = null;

const getKnownToolNamespaces = async (): Promise<Set<string>> => {
  knownToolNamespacesPromise ??= (async () => {
    const { allTools } = await loadToolsCoreModule();
    return new Set(
      allTools
        .map((tool) => {
          const separatorIndex = tool.name.indexOf(".");
          if (separatorIndex <= 0) {
            return null;
          }
          return tool.name.slice(0, separatorIndex);
        })
        .filter((namespace): namespace is string => typeof namespace === "string"),
    );
  })();
  return await knownToolNamespacesPromise;
};

const MCP_TOOL_INPUT_SCHEMA_DEFAULT: McpToolInputSchema = {
  type: "object",
  properties: {},
};

const MCP_TOOL_INPUT_SCHEMAS: Record<string, McpToolInputSchema> = {
  search_tools: {
    type: "object",
    properties: {
      query: { type: "string" },
      provider: { type: "string" },
      capability: { type: "string" },
      limit: { type: "integer" },
    },
    required: ["query"],
  },
  execute_code: {
    type: "object",
    properties: {
      description: {
        type: "string",
        description:
          "Required 1-2 sentence operator-facing summary of what the code is about to do.",
      },
      code: { type: "string" },
    },
    required: ["description", "code"],
  },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringifyToolPayload = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const buildStructuredToolResult = (
  value: Record<string, unknown>,
  options?: { isError?: boolean; text?: string },
): CallToolResult => ({
  content: [{ type: "text", text: options?.text ?? stringifyToolPayload(value) }],
  structuredContent: value,
  ...(options?.isError ? { isError: true } : {}),
});

const buildToolErrorResult = (message: string): CallToolResult => ({
  content: [{ type: "text", text: message }],
  isError: true,
});

const resolveToolInputSchema = async (toolName: string): Promise<McpToolInputSchema> => {
  const predefined = MCP_TOOL_INPUT_SCHEMAS[toolName];
  if (predefined) {
    return predefined;
  }

  const { toolMap } = await loadToolsCoreModule();
  const { zodToJsonSchema } = await import("@keppo/shared/code-mode");
  const tool = toolMap.get(toolName);
  if (!tool) {
    return MCP_TOOL_INPUT_SCHEMA_DEFAULT;
  }

  const schema = zodToJsonSchema(tool.input_schema);
  if (!isRecord(schema) || schema.type !== "object") {
    return MCP_TOOL_INPUT_SCHEMA_DEFAULT;
  }

  return {
    ...schema,
    type: "object",
    ...(isRecord(schema.properties)
      ? { properties: schema.properties as Record<string, object> }
      : {}),
    ...(Array.isArray(schema.required)
      ? {
          required: schema.required.filter((entry): entry is string => typeof entry === "string"),
        }
      : {}),
  };
};

const containsInitializeRequest = (payload: unknown): boolean => {
  const messages = Array.isArray(payload) ? payload : [payload];
  return messages.some((entry) => isRecord(entry) && entry.method === "initialize");
};

const createSessionMissingError = (): McpError =>
  new McpError(
    ErrorCode.InvalidRequest,
    "MCP session not found or expired; re-initialize required",
  );

const resolveHandlerContext = (
  sessionStates: Map<string, McpSessionState>,
  extra: {
    sessionId?: string;
    authInfo?: {
      extra?: Record<string, unknown>;
    };
  },
): {
  workspaceId: string;
  runId: string;
  credentialId: string;
  orgId: string;
  codeModeEnabled: boolean;
  e2eNamespace: string | null;
  automationRunId: string | null;
} => {
  const authContext = extra.authInfo?.extra;
  if (!authContext) {
    throw new McpError(ErrorCode.InvalidRequest, "Missing MCP auth context.");
  }

  const sessionId = extra.sessionId;
  const session = sessionId ? sessionStates.get(sessionId) : undefined;

  const workspaceId = typeof authContext.workspaceId === "string" ? authContext.workspaceId : null;
  if (!workspaceId) {
    throw createSessionMissingError();
  }
  if (session && workspaceId !== session.workspaceId) {
    throw createSessionMissingError();
  }

  const runId =
    session?.runId ?? (typeof authContext.runId === "string" ? authContext.runId : null);
  if (!runId) {
    throw createSessionMissingError();
  }

  const credentialId =
    typeof authContext.credentialId === "string" ? authContext.credentialId : null;
  const orgId = typeof authContext.orgId === "string" ? authContext.orgId : null;
  if (!credentialId || !orgId) {
    throw new McpError(ErrorCode.InvalidRequest, "Missing MCP auth context.");
  }

  return {
    workspaceId,
    runId,
    credentialId,
    orgId,
    codeModeEnabled:
      typeof authContext.codeModeEnabled === "boolean" ? authContext.codeModeEnabled : true,
    e2eNamespace: typeof authContext.e2eNamespace === "string" ? authContext.e2eNamespace : null,
    automationRunId:
      typeof authContext.automationRunId === "string" ? authContext.automationRunId : null,
  };
};

const createMcpServer = (
  deps: McpRoutesDeps,
  sessionStates: Map<string, McpSessionState>,
): Server => {
  const server = new Server(
    {
      name: "keppo",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(
    ListToolsRequestSchema,
    async (_request, extra): Promise<ListToolsResult> => {
      const handlerContext = resolveHandlerContext(sessionStates, extra);
      await deps.convex.touchRun(handlerContext.runId);
      const listedTools = await deps.convex.listToolCatalogForWorkspace(handlerContext.workspaceId);
      const tools = listedTools.filter((tool) => tool.name !== AUTOMATION_OUTCOME_TOOL_NAME);
      if (handlerContext.automationRunId) {
        const { toolMap } = await loadToolsCoreModule();
        const outcomeTool = toolMap.get(AUTOMATION_OUTCOME_TOOL_NAME);
        if (outcomeTool) {
          tools.push({
            name: outcomeTool.name,
            description: outcomeTool.description,
          });
        }
      }

      const result = {
        tools: await Promise.all(
          tools.map(async (tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: await resolveToolInputSchema(tool.name),
          })),
        ),
      };

      deps.logger.info("mcp.tools_list.completed", {
        route: MCP_ROUTE_PATH,
        method: "tools/list",
        workspace_id: handlerContext.workspaceId,
        run_id: handlerContext.runId,
        org_id: handlerContext.orgId,
        ...(extra.sessionId ? { session_id: extra.sessionId } : {}),
        tool_count: tools.length,
        automation_run: handlerContext.automationRunId !== null,
        code_mode_enabled: handlerContext.codeModeEnabled,
      });

      return result;
    },
  );

  server.setRequestHandler(
    CallToolRequestSchema,
    async (request, extra): Promise<CallToolResult> => {
      const handlerContext = resolveHandlerContext(sessionStates, extra);
      await deps.convex.touchRun(handlerContext.runId);

      const toolName = request.params.name;
      const toolArgs = isRecord(request.params.arguments) ? request.params.arguments : {};

      deps.logger.info("mcp.tool_call.received", {
        route: MCP_ROUTE_PATH,
        method: "tools/call",
        workspace_id: handlerContext.workspaceId,
        run_id: handlerContext.runId,
        org_id: handlerContext.orgId,
        ...(extra.sessionId ? { session_id: extra.sessionId } : {}),
        tool_name: toolName,
        automation_run: handlerContext.automationRunId !== null,
        code_mode_enabled: handlerContext.codeModeEnabled,
      });

      if (toolName === AUTOMATION_OUTCOME_TOOL_NAME && !handlerContext.automationRunId) {
        const message = "record_outcome is only available inside automation runs.";
        logReturnedMcpErrorResult(deps, {
          eventName: "mcp.tool_call.failed",
          redactedEventName: "mcp.tool_call.error_redacted",
          workspaceId: handlerContext.workspaceId,
          runId: handlerContext.runId,
          orgId: handlerContext.orgId,
          ...(extra.sessionId ? { sessionId: extra.sessionId } : {}),
          toolName,
          rawMessage: message,
          clientMessage: message,
        });
        return buildToolErrorResult(message);
      }

      if (toolName === "search_tools") {
        if (!handlerContext.codeModeEnabled) {
          const message = "Code Mode is disabled for this workspace.";
          logReturnedMcpErrorResult(deps, {
            eventName: "mcp.search_tools.failed",
            redactedEventName: "mcp.search_tools.error_redacted",
            workspaceId: handlerContext.workspaceId,
            runId: handlerContext.runId,
            orgId: handlerContext.orgId,
            ...(extra.sessionId ? { sessionId: extra.sessionId } : {}),
            toolName: "search_tools",
            rawMessage: message,
            clientMessage: message,
          });
          return buildToolErrorResult(message);
        }
        try {
          await deps.convex.seedToolIndex();
          const parsed = parseSearchToolsArgs(toolArgs);
          const workspaceContext = await deps.convex.getWorkspaceCodeModeContext(
            handlerContext.workspaceId,
          );
          const availableProviders = new Set(workspaceContext.available_providers);
          const results = await deps.convex.searchTools(parsed);
          const filtered = results.filter((entry) =>
            availableProviders.has(entry.provider as CanonicalProviderId),
          );

          deps.logger.info("mcp.search_tools.completed", {
            route: MCP_ROUTE_PATH,
            method: "tools/call",
            workspace_id: handlerContext.workspaceId,
            run_id: handlerContext.runId,
            org_id: handlerContext.orgId,
            ...(extra.sessionId ? { session_id: extra.sessionId } : {}),
            tool_name: "search_tools",
            results_count: filtered.length,
            query_length: parsed.query.length,
            provider_filter: parsed.provider ?? null,
            capability_filter: parsed.capability ?? null,
            limit: parsed.limit ?? null,
          });

          return buildStructuredToolResult({ results: filtered });
        } catch (error) {
          const rawMessage = error instanceof Error ? error.message : undefined;
          recordTypedToolCallFailureMetrics(deps, {
            errorMessage: rawMessage,
            orgId: handlerContext.orgId,
          });
          const sanitized = sanitizeMcpClientErrorMessage(rawMessage, "search_tools failed");
          deps.logger.warn(
            "mcp.search_tools.failed",
            buildMcpFailureLogMetadata({
              workspaceId: handlerContext.workspaceId,
              runId: handlerContext.runId,
              orgId: handlerContext.orgId,
              toolName: "search_tools",
              ...(extra.sessionId ? { sessionId: extra.sessionId } : {}),
              rawMessage,
              sanitized,
            }),
          );
          if (sanitized.redacted) {
            deps.logger.error(
              "mcp.search_tools.error_redacted",
              buildMcpFailureLogMetadata({
                workspaceId: handlerContext.workspaceId,
                runId: handlerContext.runId,
                orgId: handlerContext.orgId,
                toolName: "search_tools",
                ...(extra.sessionId ? { sessionId: extra.sessionId } : {}),
                rawMessage,
                sanitized,
              }),
            );
          }
          return buildToolErrorResult(sanitized.message);
        }
      }

      if (toolName === "execute_code") {
        if (!handlerContext.codeModeEnabled) {
          const message = "Code Mode is disabled for this workspace.";
          logReturnedMcpErrorResult(deps, {
            eventName: "mcp.execute_code.failed",
            redactedEventName: "mcp.execute_code.error_redacted",
            workspaceId: handlerContext.workspaceId,
            runId: handlerContext.runId,
            orgId: handlerContext.orgId,
            ...(extra.sessionId ? { sessionId: extra.sessionId } : {}),
            toolName: "execute_code",
            rawMessage: message,
            clientMessage: message,
          });
          return buildToolErrorResult(message);
        }

        let lastExecuteCodeToolProvider: CanonicalProviderId | undefined;
        try {
          const [{ allTools, toolMap }, codeMode] = await Promise.all([
            loadToolsCoreModule(),
            loadCodeModeRuntimeModule(),
          ]);
          const {
            CodeModeGatingError,
            createGatedToolHandler,
            createSandboxProvider,
            extractToolReferences,
            generateCodeModeSDK,
          } = codeMode;
          const { code, description } = parseExecuteCodeArgs(toolArgs);
          await deps.convex.seedToolIndex();
          const workspaceContext = await deps.convex.getWorkspaceCodeModeContext(
            handlerContext.workspaceId,
          );
          const enabledProviders = new Set(workspaceContext.enabled_providers);
          const connectedProviders = new Set(workspaceContext.connected_providers);
          const availableProviders = new Set(workspaceContext.available_providers);
          const resolveProviderAvailabilityError = (
            provider: CanonicalProviderId,
            candidateToolName?: string,
          ): Error | null => {
            const toolName = candidateToolName ?? provider;
            if (workspaceContext.enabled_providers.length > 0 && !enabledProviders.has(provider)) {
              return createCodeModeStructuredExecutionError({
                type: CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPE.blocked,
                toolName,
                errorCode: CODE_MODE_STRUCTURED_EXECUTION_ERROR_CODE.providerDisabled,
                reason: `Provider ${provider} is disabled for this workspace.`,
              });
            }
            if (!connectedProviders.has(provider)) {
              return createCodeModeStructuredExecutionError({
                type: CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPE.blocked,
                toolName,
                errorCode: CODE_MODE_STRUCTURED_EXECUTION_ERROR_CODE.integrationNotConnected,
                reason: `Provider ${provider} is not connected for this workspace.`,
              });
            }
            return null;
          };

          const indexedTools = allTools.filter((tool) => tool.provider !== "keppo");
          const allowedToolNames = new Set(indexedTools.map((tool) => tool.name));
          const preApprovedTools = new Set(extractToolReferences(code, allowedToolNames));

          const env = getEnv();
          const sandboxMode = env.KEPPO_CODE_MODE_SANDBOX_PROVIDER;
          const sandbox = await createSandboxProvider(sandboxMode);
          const sdkSource = generateCodeModeSDK(indexedTools);

          const executeToolCallFn = async (
            candidateToolName: string,
            input: Record<string, unknown>,
          ): Promise<unknown> => {
            const tool = toolMap.get(candidateToolName);
            if (!tool || tool.provider === "keppo") {
              throw createWorkerExecutionError(
                "execution_failed",
                `Unknown tool: ${candidateToolName}`,
              );
            }
            const provider = tool.provider as CanonicalProviderId;
            const availabilityError = resolveProviderAvailabilityError(provider, candidateToolName);
            if (availabilityError) {
              throw availabilityError;
            }
            lastExecuteCodeToolProvider = provider;

            const result = await deps.convex.executeToolCall({
              workspaceId: handlerContext.workspaceId,
              runId: handlerContext.runId,
              ...(handlerContext.automationRunId
                ? { automationRunId: handlerContext.automationRunId }
                : {}),
              toolName: candidateToolName,
              input: {
                ...input,
                ...(handlerContext.e2eNamespace
                  ? { __e2eNamespace: handlerContext.e2eNamespace }
                  : {}),
              },
              credentialId: handlerContext.credentialId,
            });

            const status = parseExecuteCodeToolCallStatus(result.status);
            switch (status) {
              case TOOL_CALL_STATUS.approvalRequired:
                return {
                  status: "approval_pending",
                  action_id: typeof result.action_id === "string" ? result.action_id : null,
                  message:
                    "Action received. Waiting for human approval (this may take a while). Please continue with your other tasks.",
                };
              case ACTION_STATUS.rejected:
                throw createCodeModeStructuredExecutionError({
                  type: CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPE.blocked,
                  toolName: candidateToolName,
                  errorCode:
                    typeof result.error_code === "string"
                      ? result.error_code
                      : CODE_MODE_STRUCTURED_EXECUTION_ERROR_CODE.actionRejected,
                  ...(typeof result.action_id === "string" ? { actionId: result.action_id } : {}),
                  reason:
                    typeof result.reason === "string"
                      ? result.reason
                      : typeof result.summary === "string"
                        ? result.summary
                        : "Blocked by workspace policy.",
                });
              case ACTION_STATUS.pending:
              case ACTION_STATUS.approved:
              case ACTION_STATUS.executing:
              case ACTION_STATUS.succeeded:
              case ACTION_STATUS.failed:
              case ACTION_STATUS.expired:
              case TOOL_CALL_RESULT_STATUS.idempotentReplay:
                return result;
              default:
                return assertNever(status, "execute_code tool status");
            }
          };

          const gatedToolHandler = createGatedToolHandler({
            preApprovedTools,
            gatingFn: async (candidateToolName) => {
              const tool = toolMap.get(candidateToolName);
              if (!tool || tool.provider === "keppo") {
                return {
                  outcome: DECISION_OUTCOME.deny,
                  reason: `Unknown tool ${candidateToolName}`,
                };
              }
              const availabilityError = resolveProviderAvailabilityError(
                tool.provider as CanonicalProviderId,
                candidateToolName,
              );
              if (availabilityError) {
                const parsedAvailabilityError = parseCodeModeStructuredExecutionError(
                  availabilityError.message,
                );
                return {
                  outcome: DECISION_OUTCOME.deny,
                  reason: parsedAvailabilityError?.reason ?? "Tool call is not available.",
                };
              }
              return {
                outcome: DECISION_OUTCOME.pending,
                reason: "Tool was not pre-approved by static analysis.",
              };
            },
            executeFn: executeToolCallFn,
          });

          const sandboxResult = await sandbox.execute({
            code,
            sdkSource,
            timeoutMs: env.KEPPO_CODE_MODE_TIMEOUT_MS,
            toolCallHandler: async (candidateToolName, input) => {
              try {
                return await gatedToolHandler(candidateToolName, input);
              } catch (error) {
                if (error instanceof CodeModeGatingError) {
                  if (error.decision.outcome === DECISION_OUTCOME.pending) {
                    return await executeToolCallFn(candidateToolName, input);
                  }
                  throw createCodeModeStructuredExecutionError({
                    type: CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPE.blocked,
                    toolName: error.toolName,
                    errorCode: CODE_MODE_STRUCTURED_EXECUTION_ERROR_CODE.policyDenied,
                    reason: error.decision.reason ?? "Blocked by workspace policy.",
                  });
                }
                throw error;
              }
            },
            searchToolsHandler: async (query, options) => {
              const searchParams: {
                query: string;
                provider?: string;
                capability?: string;
                limit?: number;
              } = {
                query,
              };
              if (typeof options?.provider === "string") {
                searchParams.provider = options.provider;
              }
              if (typeof options?.capability === "string") {
                searchParams.capability = options.capability;
              }
              if (typeof options?.limit === "number") {
                searchParams.limit = options.limit;
              }
              const searchResults = await deps.convex.searchTools(searchParams);
              return searchResults.filter((entry) =>
                availableProviders.has(entry.provider as CanonicalProviderId),
              );
            },
          });

          if (!sandboxResult.success) {
            const structuredPayload = parseExecuteCodeStructuredResultPayload(sandboxResult.error);
            if (structuredPayload) {
              recordTypedToolCallFailureMetrics(deps, {
                errorMessage: sandboxResult.error,
                orgId: handlerContext.orgId,
                ...(lastExecuteCodeToolProvider ? { provider: lastExecuteCodeToolProvider } : {}),
              });
              logReturnedMcpErrorResult(deps, {
                eventName: "mcp.execute_code.failed",
                redactedEventName: "mcp.execute_code.error_redacted",
                workspaceId: handlerContext.workspaceId,
                runId: handlerContext.runId,
                orgId: handlerContext.orgId,
                ...(extra.sessionId ? { sessionId: extra.sessionId } : {}),
                toolName: "execute_code",
                ...(lastExecuteCodeToolProvider ? { provider: lastExecuteCodeToolProvider } : {}),
                rawMessage: sandboxResult.error,
                clientMessage: formatExecuteCodeStructuredResultText(structuredPayload),
                ...(structuredPayload.error_code
                  ? { errorCode: structuredPayload.error_code }
                  : {}),
              });
              return buildExecuteCodeStructuredResult(structuredPayload);
            }
            const workerFailurePayload = parseExecuteCodeWorkerFailurePayload(sandboxResult.error);
            if (workerFailurePayload) {
              recordTypedToolCallFailureMetrics(deps, {
                errorMessage: sandboxResult.error,
                orgId: handlerContext.orgId,
                ...(lastExecuteCodeToolProvider ? { provider: lastExecuteCodeToolProvider } : {}),
              });
              logReturnedMcpErrorResult(deps, {
                eventName: "mcp.execute_code.failed",
                redactedEventName: "mcp.execute_code.error_redacted",
                workspaceId: handlerContext.workspaceId,
                runId: handlerContext.runId,
                orgId: handlerContext.orgId,
                ...(extra.sessionId ? { sessionId: extra.sessionId } : {}),
                toolName: "execute_code",
                ...(lastExecuteCodeToolProvider ? { provider: lastExecuteCodeToolProvider } : {}),
                rawMessage: sandboxResult.error,
                clientMessage: formatExecuteCodeStructuredResultText(workerFailurePayload),
                ...(workerFailurePayload.error_code
                  ? { errorCode: workerFailurePayload.error_code }
                  : {}),
              });
              return buildExecuteCodeStructuredResult(workerFailurePayload);
            }
            if (sandboxResult.failure) {
              const structuredFailure = createCodeModeStructuredExecutionError({
                type: sandboxResult.failure.type,
                toolName: "execute_code",
                reason: sandboxResult.failure.reason,
                ...(sandboxResult.failure.errorCode
                  ? { errorCode: sandboxResult.failure.errorCode }
                  : {}),
              }).message;
              const structuredFailurePayload: ExecuteCodeResultPayload = {
                status: sandboxResult.failure.type,
                tool_name: "execute_code",
                reason: sandboxResult.failure.reason,
                ...(sandboxResult.failure.errorCode
                  ? { error_code: sandboxResult.failure.errorCode }
                  : {}),
              };
              recordTypedToolCallFailureMetrics(deps, {
                errorMessage: structuredFailure,
                orgId: handlerContext.orgId,
                ...(lastExecuteCodeToolProvider ? { provider: lastExecuteCodeToolProvider } : {}),
              });
              logReturnedMcpErrorResult(deps, {
                eventName: "mcp.execute_code.failed",
                redactedEventName: "mcp.execute_code.error_redacted",
                workspaceId: handlerContext.workspaceId,
                runId: handlerContext.runId,
                orgId: handlerContext.orgId,
                ...(extra.sessionId ? { sessionId: extra.sessionId } : {}),
                toolName: "execute_code",
                ...(lastExecuteCodeToolProvider ? { provider: lastExecuteCodeToolProvider } : {}),
                rawMessage: structuredFailure,
                clientMessage: formatExecuteCodeStructuredResultText(structuredFailurePayload),
                ...(structuredFailurePayload.error_code
                  ? { errorCode: structuredFailurePayload.error_code }
                  : {}),
              });
              return buildExecuteCodeStructuredResult(structuredFailurePayload);
            }
            recordTypedToolCallFailureMetrics(deps, {
              errorMessage: sandboxResult.error,
              orgId: handlerContext.orgId,
              ...(lastExecuteCodeToolProvider ? { provider: lastExecuteCodeToolProvider } : {}),
            });
            const sanitized = sanitizeMcpClientErrorMessage(
              sandboxResult.error,
              "Code execution failed in sandbox.",
            );
            deps.logger.warn(
              "mcp.execute_code.sandbox_failed",
              buildMcpFailureLogMetadata({
                workspaceId: handlerContext.workspaceId,
                runId: handlerContext.runId,
                orgId: handlerContext.orgId,
                toolName: "execute_code",
                ...(extra.sessionId ? { sessionId: extra.sessionId } : {}),
                ...(lastExecuteCodeToolProvider ? { provider: lastExecuteCodeToolProvider } : {}),
                rawMessage: sandboxResult.error,
                sanitized,
              }),
            );
            if (sanitized.redacted) {
              deps.logger.error(
                "mcp.execute_code.sandbox_error_redacted",
                buildMcpFailureLogMetadata({
                  workspaceId: handlerContext.workspaceId,
                  runId: handlerContext.runId,
                  orgId: handlerContext.orgId,
                  toolName: "execute_code",
                  ...(extra.sessionId ? { sessionId: extra.sessionId } : {}),
                  ...(lastExecuteCodeToolProvider ? { provider: lastExecuteCodeToolProvider } : {}),
                  rawMessage: sandboxResult.error,
                  sanitized,
                }),
              );
            }
            return buildToolErrorResult(sanitized.message);
          }

          const output =
            sandboxResult.output && isRecord(sandboxResult.output) ? sandboxResult.output : {};
          const logs = Array.isArray(output.logs)
            ? output.logs
                .filter((entry): entry is string => typeof entry === "string")
                .map((entry) => entry.trim())
                .filter((entry) => entry.length > 0)
            : [];
          const lines = [...logs];
          if ("returnValue" in output && output.returnValue !== undefined) {
            try {
              lines.push(`return: ${JSON.stringify(output.returnValue)}`);
            } catch {
              lines.push(`return: ${String(output.returnValue)}`);
            }
          }
          if (lines.length === 0) {
            lines.push("(no output)");
          }

          deps.logger.info("mcp.execute_code.completed", {
            route: MCP_ROUTE_PATH,
            method: "tools/call",
            workspace_id: handlerContext.workspaceId,
            run_id: handlerContext.runId,
            org_id: handlerContext.orgId,
            ...(extra.sessionId ? { session_id: extra.sessionId } : {}),
            tool_name: "execute_code",
            description_length: description.length,
            log_lines: lines.length,
          });

          return {
            content: [{ type: "text", text: lines.join("\n") }],
          };
        } catch (error) {
          const rawMessage = error instanceof Error ? error.message : undefined;
          const structuredPayload = parseExecuteCodeStructuredResultPayload(rawMessage);
          if (structuredPayload) {
            recordTypedToolCallFailureMetrics(deps, {
              errorMessage: rawMessage,
              orgId: handlerContext.orgId,
              ...(lastExecuteCodeToolProvider ? { provider: lastExecuteCodeToolProvider } : {}),
            });
            logReturnedMcpErrorResult(deps, {
              eventName: "mcp.execute_code.failed",
              redactedEventName: "mcp.execute_code.error_redacted",
              workspaceId: handlerContext.workspaceId,
              runId: handlerContext.runId,
              orgId: handlerContext.orgId,
              ...(extra.sessionId ? { sessionId: extra.sessionId } : {}),
              toolName: "execute_code",
              ...(lastExecuteCodeToolProvider ? { provider: lastExecuteCodeToolProvider } : {}),
              rawMessage,
              clientMessage: formatExecuteCodeStructuredResultText(structuredPayload),
              ...(structuredPayload.error_code ? { errorCode: structuredPayload.error_code } : {}),
            });
            return buildExecuteCodeStructuredResult(structuredPayload);
          }
          const workerFailurePayload = parseExecuteCodeWorkerFailurePayload(rawMessage);
          if (workerFailurePayload) {
            recordTypedToolCallFailureMetrics(deps, {
              errorMessage: rawMessage,
              orgId: handlerContext.orgId,
              ...(lastExecuteCodeToolProvider ? { provider: lastExecuteCodeToolProvider } : {}),
            });
            logReturnedMcpErrorResult(deps, {
              eventName: "mcp.execute_code.failed",
              redactedEventName: "mcp.execute_code.error_redacted",
              workspaceId: handlerContext.workspaceId,
              runId: handlerContext.runId,
              orgId: handlerContext.orgId,
              ...(extra.sessionId ? { sessionId: extra.sessionId } : {}),
              toolName: "execute_code",
              ...(lastExecuteCodeToolProvider ? { provider: lastExecuteCodeToolProvider } : {}),
              rawMessage,
              clientMessage: formatExecuteCodeStructuredResultText(workerFailurePayload),
              ...(workerFailurePayload.error_code
                ? { errorCode: workerFailurePayload.error_code }
                : {}),
            });
            return buildExecuteCodeStructuredResult(workerFailurePayload);
          }
          recordTypedToolCallFailureMetrics(deps, {
            errorMessage: rawMessage,
            orgId: handlerContext.orgId,
            ...(lastExecuteCodeToolProvider ? { provider: lastExecuteCodeToolProvider } : {}),
          });
          const sanitized = sanitizeMcpClientErrorMessage(rawMessage, "execute_code failed");
          deps.logger.warn(
            "mcp.execute_code.failed",
            buildMcpFailureLogMetadata({
              workspaceId: handlerContext.workspaceId,
              runId: handlerContext.runId,
              orgId: handlerContext.orgId,
              toolName: "execute_code",
              ...(extra.sessionId ? { sessionId: extra.sessionId } : {}),
              ...(lastExecuteCodeToolProvider ? { provider: lastExecuteCodeToolProvider } : {}),
              rawMessage,
              sanitized,
            }),
          );
          if (sanitized.redacted) {
            deps.logger.error(
              "mcp.execute_code.error_redacted",
              buildMcpFailureLogMetadata({
                workspaceId: handlerContext.workspaceId,
                runId: handlerContext.runId,
                orgId: handlerContext.orgId,
                toolName: "execute_code",
                ...(extra.sessionId ? { sessionId: extra.sessionId } : {}),
                ...(lastExecuteCodeToolProvider ? { provider: lastExecuteCodeToolProvider } : {}),
                rawMessage,
                sanitized,
              }),
            );
          }
          return buildToolErrorResult(sanitized.message);
        }
      }

      let toolProvider: CanonicalProviderId | null = null;
      try {
        toolProvider = (await resolveToolOwner(toolName)) ?? null;
      } catch {
        toolProvider = null;
      }
      const separatorIndex = toolName.indexOf(".");
      const toolNamespace = separatorIndex > 0 ? toolName.slice(0, separatorIndex) : "";
      const knownToolNamespaces = await getKnownToolNamespaces();
      const isLikelyCustomTool =
        toolProvider === null && separatorIndex > 0 && !knownToolNamespaces.has(toolNamespace);

      if (
        !(await deps.resolveRegistryPathEnabled()) &&
        toolProvider !== null &&
        !isKeppoInternalToolName(toolName)
      ) {
        const message =
          "provider_registry_disabled: Provider registry path is disabled by kill switch.";
        logReturnedMcpErrorResult(deps, {
          eventName: "mcp.tool_call.failed",
          redactedEventName: "mcp.tool_call.error_redacted",
          workspaceId: handlerContext.workspaceId,
          runId: handlerContext.runId,
          orgId: handlerContext.orgId,
          ...(extra.sessionId ? { sessionId: extra.sessionId } : {}),
          toolName,
          ...(toolProvider ? { provider: toolProvider } : {}),
          rawMessage: message,
          clientMessage: message,
        });
        return buildToolErrorResult(message);
      }

      try {
        const result = isLikelyCustomTool
          ? await deps.convex.executeCustomToolCall({
              workspaceId: handlerContext.workspaceId,
              runId: handlerContext.runId,
              toolName,
              input: {
                ...toolArgs,
                ...(handlerContext.e2eNamespace
                  ? { __e2eNamespace: handlerContext.e2eNamespace }
                  : {}),
              },
              credentialId: handlerContext.credentialId,
            })
          : await deps.convex.executeToolCall({
              workspaceId: handlerContext.workspaceId,
              runId: handlerContext.runId,
              ...(handlerContext.automationRunId
                ? { automationRunId: handlerContext.automationRunId }
                : {}),
              toolName,
              input: {
                ...toolArgs,
                ...(handlerContext.e2eNamespace
                  ? { __e2eNamespace: handlerContext.e2eNamespace }
                  : {}),
              },
              credentialId: handlerContext.credentialId,
            });

        deps.logger.info("mcp.tool_call.completed", {
          route: MCP_ROUTE_PATH,
          method: "tools/call",
          workspace_id: handlerContext.workspaceId,
          run_id: handlerContext.runId,
          org_id: handlerContext.orgId,
          ...(extra.sessionId ? { session_id: extra.sessionId } : {}),
          tool_name: toolName,
          is_custom_tool: isLikelyCustomTool,
          ...(toolProvider ? { provider: toolProvider } : {}),
          ...(typeof result.status === "string" ? { result_status: result.status } : {}),
        });

        return buildStructuredToolResult(result);
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : undefined;
        recordTypedToolCallFailureMetrics(deps, {
          errorMessage: rawMessage,
          orgId: handlerContext.orgId,
          ...(toolProvider ? { provider: toolProvider } : {}),
        });
        const sanitized = sanitizeMcpClientErrorMessage(rawMessage, "Unknown tool failure");
        deps.logger.warn(
          "mcp.tool_call.failed",
          buildMcpFailureLogMetadata({
            workspaceId: handlerContext.workspaceId,
            runId: handlerContext.runId,
            orgId: handlerContext.orgId,
            toolName,
            ...(extra.sessionId ? { sessionId: extra.sessionId } : {}),
            ...(toolProvider ? { provider: toolProvider } : {}),
            rawMessage,
            sanitized,
          }),
        );
        if (sanitized.redacted) {
          deps.logger.error(
            "mcp.tool_call.error_redacted",
            buildMcpFailureLogMetadata({
              workspaceId: handlerContext.workspaceId,
              runId: handlerContext.runId,
              orgId: handlerContext.orgId,
              toolName,
              ...(extra.sessionId ? { sessionId: extra.sessionId } : {}),
              ...(toolProvider ? { provider: toolProvider } : {}),
              rawMessage,
              sanitized,
            }),
          );
        }
        return buildToolErrorResult(sanitized.message);
      }
    },
  );

  return server;
};

export const createMcpRouteDispatcher = (
  deps: McpRoutesDeps,
): ((requestContext: McpRequestContext) => Promise<Response>) => {
  const sessionStates = new Map<string, McpSessionState>();

  const createSessionState = async (params: {
    workspaceId: string;
    e2eNamespace: string | null;
    testId: string | null;
    scenarioId: string | null;
  }): Promise<McpSessionState> => {
    let state: McpSessionState;
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => `mcp_${randomUUID().replace(/-/g, "")}`,
      enableJsonResponse: true,
      onsessioninitialized: async (sessionId) => {
        const run = await deps.convex.createRun({
          workspaceId: params.workspaceId,
          sessionId,
          clientType: CLIENT_TYPE.chatgpt,
          metadata: {
            source: "mcp",
            ...(params.e2eNamespace ? { e2e_namespace: params.e2eNamespace } : {}),
            ...(params.testId ? { e2e_test_id: params.testId } : {}),
            ...(params.scenarioId ? { e2e_scenario_id: params.scenarioId } : {}),
          },
        });
        state.sessionId = sessionId;
        state.runId = run.id;
        sessionStates.set(sessionId, state);
        deps.logger.info("mcp.session.initialized", {
          route: MCP_ROUTE_PATH,
          workspace_id: params.workspaceId,
          session_id: sessionId,
          run_id: run.id,
          client_type: CLIENT_TYPE.chatgpt,
        });
      },
      onsessionclosed: async (sessionId) => {
        sessionStates.delete(sessionId);
        await deps.convex.closeRunBySession(params.workspaceId, sessionId);
        deps.logger.info("mcp.session.closed", {
          route: MCP_ROUTE_PATH,
          workspace_id: params.workspaceId,
          session_id: sessionId,
        });
      },
    });
    const server = createMcpServer(deps, sessionStates);
    state = {
      workspaceId: params.workspaceId,
      sessionId: null,
      runId: null,
      transport,
      server,
      requestChain: Promise.resolve(),
    };
    await server.connect(transport);
    return state;
  };

  return async (requestContext: McpRequestContext): Promise<Response> => {
    const { request } = requestContext;
    const authResult = await resolveAuthenticatedWorkspace(requestContext, deps);
    if ("response" in authResult) {
      return authResult.response;
    }

    const { workspaceId, ipHash, auth } = authResult;
    if (auth.status === MCP_CREDENTIAL_AUTH_STATUS.locked) {
      deps.logger.warn("security.rate_limit.hit", {
        bucket: "mcp_credential_lockout",
        route: MCP_ROUTE_PATH,
        ip_hash: ipHash,
        remaining: 0,
        retry_after_ms: auth.retry_after_ms,
      });
      deps.recordRateLimitedEvent({
        route: MCP_ROUTE_PATH,
        key: "mcp_credential_lockout",
        ipHash,
        retryAfterMs: auth.retry_after_ms,
        orgId: deps.systemMetricsOrgId,
      });
      return mcpJsonResponse(
        buildMcpError(null, "Too many failed attempts. Try again later."),
        429,
        {
          "Retry-After": String(Math.max(1, Math.ceil(auth.retry_after_ms / 1000))),
        },
      );
    }

    if (auth.status === MCP_CREDENTIAL_AUTH_STATUS.suspended) {
      return mcpJsonResponse(buildMcpError(null, "Organization suspended"), 403);
    }

    if (request.method === "GET") {
      return mcpJsonResponse(
        buildMcpError(
          null,
          "Method not allowed: hosted MCP does not offer a common GET stream; use POST request/response transport.",
        ),
        405,
        {
          Allow: "POST, DELETE",
        },
      );
    }

    if (request.method === "POST" || request.method === "DELETE") {
      const credentialRateLimit = await deps.mcpCredentialLimiter.check(
        `mcp-credential:${auth.credential_id}`,
        deps.mcpRequestsPerCredentialPerMinute,
        60_000,
      );
      if (!credentialRateLimit.allowed) {
        deps.logger.warn("security.rate_limit.hit", {
          bucket: "mcp_credential_requests",
          route: MCP_ROUTE_PATH,
          ip_hash: ipHash,
          credential_id: auth.credential_id,
          remaining: credentialRateLimit.remaining,
          retry_after_ms: credentialRateLimit.retryAfterMs,
        });
        deps.recordRateLimitedEvent({
          route: MCP_ROUTE_PATH,
          key: `credential:${auth.credential_id}`,
          orgId: auth.workspace.org_id,
          ipHash,
          retryAfterMs: credentialRateLimit.retryAfterMs,
        });
        return mcpJsonResponse(buildMcpError(null, "Too many requests. Try again later."), 429, {
          "Retry-After": String(Math.max(1, Math.ceil(credentialRateLimit.retryAfterMs / 1000))),
        });
      }
    }

    await deps.convex.markCredentialUsed(auth.credential_id, ipHash);

    const e2eNamespace = deps.getE2ENamespace(
      request.headers.get("x-keppo-e2e-namespace") ?? undefined,
    );
    const testId = deps.getE2ENamespace(request.headers.get("x-e2e-test-id") ?? undefined);
    const scenarioId = deps.getE2ENamespace(request.headers.get("x-e2e-scenario-id") ?? undefined);

    let parsedBody: unknown;
    if (request.method === "POST") {
      try {
        parsedBody = await request.json();
      } catch (error) {
        const boundaryEnvelope = buildBoundaryErrorEnvelope(error, {
          defaultCode: "invalid_request",
          defaultMessage: "Invalid MCP request payload",
          source: "api",
        });
        return mcpJsonResponse(
          buildMcpError(
            null,
            `${boundaryEnvelope.error.code}: ${boundaryEnvelope.error.message}`,
            boundaryEnvelope.error,
          ),
          400,
        );
      }
    }

    const sessionHeader = request.headers.get("mcp-session-id") ?? undefined;
    let sessionId: string | null = null;
    if (sessionHeader !== undefined) {
      try {
        sessionId = parseMcpSessionHeader(sessionHeader);
      } catch (error) {
        const boundaryEnvelope = buildBoundaryErrorEnvelope(error, {
          defaultCode: "invalid_request",
          defaultMessage: "Invalid MCP session header.",
          source: "api",
        });
        return mcpJsonResponse(
          buildMcpError(
            null,
            `${boundaryEnvelope.error.code}: ${boundaryEnvelope.error.message}`,
            boundaryEnvelope.error,
          ),
          400,
        );
      }
    }

    const isInitialize = request.method === "POST" && containsInitializeRequest(parsedBody);
    let sessionState: McpSessionState | undefined;

    if (isInitialize) {
      sessionState = await createSessionState({
        workspaceId,
        e2eNamespace,
        testId,
        scenarioId,
      });
    } else {
      if (!sessionId) {
        if (request.method === "DELETE") {
          return mcpJsonResponse(
            buildMcpError(
              null,
              "Method not allowed: hosted MCP only supports DELETE for explicit session teardown.",
            ),
            405,
            {
              Allow: "POST, DELETE",
            },
          );
        }
        return mcpJsonResponse(buildMcpError(null, createSessionMissingError().message), 409);
      }
      sessionState = sessionStates.get(sessionId);
      if (!sessionState || sessionState.workspaceId !== workspaceId) {
        if (request.method === "DELETE") {
          await deps.convex.closeRunBySession(workspaceId, sessionId);
          return new Response(null, { status: 200 });
        }

        const run = await deps.convex.getRunBySession(workspaceId, sessionId);
        if (!run) {
          return mcpJsonResponse(buildMcpError(null, createSessionMissingError().message), 409);
        }

        const transport = new WebStandardStreamableHTTPServerTransport({
          enableJsonResponse: true,
        });
        const server = createMcpServer(deps, sessionStates);
        await server.connect(transport);
        sessionState = {
          workspaceId,
          sessionId,
          runId: run.id,
          transport,
          server,
          requestChain: Promise.resolve(),
          recovered: true,
        };
        sessionStates.set(sessionId, sessionState);
        deps.logger.info("mcp.session.recovered", {
          route: MCP_ROUTE_PATH,
          workspace_id: workspaceId,
          session_id: sessionId,
          run_id: run.id,
        });
      }

      if (sessionState.recovered) {
        const transport = new WebStandardStreamableHTTPServerTransport({
          enableJsonResponse: true,
        });
        const server = createMcpServer(deps, sessionStates);
        await server.connect(transport);
        sessionState.transport = transport;
        sessionState.server = server;
      }
    }

    const authInfo: AuthInfo = {
      token: "workspace_credential",
      clientId: auth.credential_id,
      scopes: [`workspace:${workspaceId}`],
      extra: {
        workspaceId,
        credentialId: auth.credential_id,
        orgId: auth.workspace.org_id,
        codeModeEnabled: auth.workspace.code_mode_enabled ?? true,
        e2eNamespace,
        testId,
        scenarioId,
        ...(typeof auth.automation_run_id === "string"
          ? { automationRunId: auth.automation_run_id }
          : {}),
        ...(sessionState.runId ? { runId: sessionState.runId } : {}),
      } satisfies McpRequestAuthContext,
    };

    const handleRequest = async (): Promise<Response> => {
      try {
        const response = await sessionState.transport.handleRequest(request, {
          authInfo,
          ...(request.method === "POST" ? { parsedBody } : {}),
        });
        return sessionState.sessionId ? await cloneBufferedResponse(response) : response;
      } catch (error) {
        if (isInitialize && sessionState.sessionId) {
          sessionStates.delete(sessionState.sessionId);
        }
        throw error;
      }
    };

    if (sessionState.sessionId && !sessionState.recovered) {
      const previous = sessionState.requestChain;
      let release!: () => void;
      sessionState.requestChain = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await handleRequest();
      } finally {
        release();
      }
    }

    return await handleRequest();
  };
};
