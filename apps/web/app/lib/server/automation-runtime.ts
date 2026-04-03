import { AI_CREDIT_ERROR_CODE, parseAiCreditErrorCode } from "@keppo/shared/ai-credit-errors";
import { CLIENT_TYPE } from "@keppo/shared/domain";
import {
  AI_KEY_MODE,
  AUTOMATION_ROUTE_ERROR_CODES,
  AUTOMATION_ROUTE_STATUS,
  AUTOMATION_RUN_LOG_LEVEL,
  type AutomationRunEventType,
  type AutomationRunLogLevel,
  AUTOMATION_MODEL_CLASS,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_RUNNER_TYPE,
  AUTOMATION_STATUS,
  coerceAutomationModelClass,
  createAutomationRouteError,
  getAiModelProviderLabel,
  inferAutomationModelClassFromLegacyFields,
  isGatewayRuntimeEnabled,
  isAutomationRouteErrorCode,
  parseAutomationRouteErrorCode,
  resolveAutomationExecutionReadiness,
  toAutomationRouteError,
  type AutomationRouteErrorCode,
  type AutomationRunTerminalStatus,
} from "@keppo/shared/automations";
import { parseJsonPayload } from "./api-runtime/app-helpers.ts";
import { ConvexInternalClient } from "./api-runtime/convex.ts";
import { getEnv } from "./api-runtime/env.ts";
import { isInternalBearerAuthorized } from "./api-runtime/internal-auth.ts";
import { logger } from "./api-runtime/logger.ts";
import {
  assertRunnerAuthSupported,
  assertSandboxCallbackBaseUrlReachable,
  buildAutomationRunnerPrompt,
  buildRunnerAuthBootstrapCommand,
  buildRunnerBootstrapCommand,
  buildRunnerCommand,
  createAutomationCallbackSignature,
  decryptStoredKey,
  extractAutomationRouteError,
  hasValidAutomationCallbackSignature,
  parseCompletionPayload,
  parseDispatchPayload,
  parseTerminatePayload,
  parseLogPayload,
  parseSessionArtifactPayload,
  preflightMcpServer,
  resolveAutomationCallbackBaseUrl,
  resolveAutomationMcpServerUrl,
  resolveVercelAutomationBypassSecret,
} from "./api-runtime/routes/automations.ts";
import {
  createAutomationSandboxProvider,
  resolveAutomationSandboxProviderMode,
  type AutomationSandboxProviderMode,
} from "./api-runtime/sandbox/index.ts";

const SECURITY_HEADER_VALUES = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
} as const;

type StartOwnedAutomationRuntimeConvex = Pick<
  ConvexInternalClient,
  | "appendAutomationRunLog"
  | "appendAutomationRunLogBatch"
  | "claimAutomationRunDispatchContext"
  | "createRun"
  | "deductAiCredit"
  | "getAiCreditBalance"
  | "getAutomationRunDispatchContext"
  | "getOrgAiKey"
  | "issueAutomationWorkspaceCredential"
  | "storeAutomationRunSessionTrace"
  | "updateAutomationRunStatus"
  | "upsertOpenAiOauthKey"
>;

type RouteLogger = Pick<typeof logger, "error" | "info">;

type SandboxProvider = ReturnType<typeof createAutomationSandboxProvider>;

type ResolvedAutomationModel = {
  modelClass: "auto" | "frontier" | "balanced" | "value";
  runnerType: "chatgpt_codex" | "claude_code";
  aiModelProvider: "openai" | "anthropic";
  aiModelName: string;
};

type StartOwnedAutomationRuntimeDeps = {
  authorizeInternalRequest: (authorizationHeader: string | undefined) => {
    ok: boolean;
    reason?: string;
  };
  convex: StartOwnedAutomationRuntimeConvex;
  createSandboxProvider?: (mode?: AutomationSandboxProviderMode) => SandboxProvider;
  getEnv: typeof getEnv;
  logger: RouteLogger;
  parseJsonPayload: typeof parseJsonPayload;
};

let convexClient: ConvexInternalClient | null = null;
const AUTOMATION_COMPLETE_UPDATE_RETRIES = 2;
const AUTOMATION_COMPLETE_RETRY_BASE_DELAY_MS = 250;
const AUTOMATION_LOG_APPEND_RETRIES = 2;
const AUTOMATION_LOG_APPEND_RETRY_BASE_DELAY_MS = 250;
const AUTOMATION_LOG_BATCH_SIZE = 50;
const AUTOMATION_LOG_MAX_LINES = 200;

const automationRouteErrorCodeSet = new Set<AutomationRouteErrorCode>(AUTOMATION_ROUTE_ERROR_CODES);
const payloadErrorCodeSet = new Set<AutomationRouteErrorCode>([
  "invalid_payload",
  "invalid_automation_run_terminal_status",
  "missing_automation_run_id",
  "missing_dispatch_token",
]);

const trimToUndefined = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const inferProviderFromModelName = (modelName: string): "openai" | "anthropic" => {
  return modelName.toLowerCase().includes("claude") ? "anthropic" : "openai";
};

const resolveConfiguredModelName = (
  env: ReturnType<typeof getEnv>,
  modelClass: ResolvedAutomationModel["modelClass"],
): string => {
  const configuredAuto = trimToUndefined(env.KEPPO_AUTOMATION_MODEL_AUTO);
  const configuredBalanced = trimToUndefined(env.KEPPO_AUTOMATION_MODEL_BALANCED);
  const configuredFrontier = trimToUndefined(env.KEPPO_AUTOMATION_MODEL_FRONTIER);
  const configuredValue = trimToUndefined(env.KEPPO_AUTOMATION_MODEL_VALUE);

  switch (modelClass) {
    case AUTOMATION_MODEL_CLASS.frontier:
      return configuredFrontier ?? "gpt-5.4";
    case AUTOMATION_MODEL_CLASS.value:
      return configuredValue ?? "gpt-5.2";
    case AUTOMATION_MODEL_CLASS.auto:
      return configuredAuto ?? configuredBalanced ?? "gpt-5.4";
    case AUTOMATION_MODEL_CLASS.balanced:
    default:
      return configuredBalanced ?? "gpt-5.4";
  }
};

const resolveAutomationModel = (
  env: ReturnType<typeof getEnv>,
  config: {
    model_class?: string | null;
    runner_type: "chatgpt_codex" | "claude_code";
    ai_model_provider: "openai" | "anthropic";
    ai_model_name: string;
  },
): ResolvedAutomationModel => {
  const modelClass =
    typeof config.model_class === "string" && config.model_class.trim().length > 0
      ? coerceAutomationModelClass(config.model_class)
      : inferAutomationModelClassFromLegacyFields({
          aiModelProvider: config.ai_model_provider,
          aiModelName: config.ai_model_name,
        });
  const aiModelName = resolveConfiguredModelName(env, modelClass);
  const aiModelProvider = inferProviderFromModelName(aiModelName);
  return {
    modelClass,
    runnerType:
      aiModelProvider === "anthropic"
        ? AUTOMATION_RUNNER_TYPE.claudeCode
        : AUTOMATION_RUNNER_TYPE.chatgptCodex,
    aiModelProvider,
    aiModelName,
  };
};

const withSecurityHeaders = (request: Request, init?: ResponseInit): ResponseInit => {
  const headers = new Headers(init?.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADER_VALUES)) {
    headers.set(key, value);
  }
  if (new URL(request.url).protocol === "https:") {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return {
    ...init,
    headers,
  };
};

const jsonResponse = (request: Request, payload: unknown, status = 200): Response => {
  return Response.json(payload, withSecurityHeaders(request, { status }));
};

const getDefaultDeps = (): StartOwnedAutomationRuntimeDeps => ({
  authorizeInternalRequest: (authorizationHeader) =>
    isInternalBearerAuthorized({
      authorizationHeader,
      allowWhenSecretMissing: false,
    }),
  convex: (convexClient ??= new ConvexInternalClient()),
  createSandboxProvider: createAutomationSandboxProvider,
  getEnv,
  logger,
  parseJsonPayload,
});

const internalUnauthorizedResponse = (request: Request, reason: string | undefined): Response => {
  const statusCode = reason === "missing_secret" ? 503 : 401;
  return jsonResponse(
    request,
    {
      ok: false,
      status: AUTOMATION_ROUTE_STATUS.unauthorized,
      reason: reason ?? AUTOMATION_ROUTE_STATUS.unauthorized,
    },
    statusCode,
  );
};

const mapInvalidPayloadError = (error: unknown): Record<string, unknown> | null => {
  const typedError = toAutomationRouteError(error, "invalid_payload");
  const fullMessage = typedError instanceof Error ? typedError.message : String(typedError);
  const code = parseAutomationRouteErrorCode(fullMessage);
  if (!code || !isAutomationRouteErrorCode(code) || !automationRouteErrorCodeSet.has(code)) {
    return null;
  }
  if (!payloadErrorCodeSet.has(code)) {
    return null;
  }

  const { message } = extractAutomationRouteError(typedError);
  return {
    ok: false,
    status: AUTOMATION_ROUTE_STATUS.invalidPayload,
    error: message,
    error_code: code,
  };
};

const updateAutomationRunCompletionWithRetry = async (
  deps: StartOwnedAutomationRuntimeDeps,
  payload: {
    automation_run_id: string;
    status: AutomationRunTerminalStatus;
    error_message?: string;
  },
): Promise<unknown | null> => {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= AUTOMATION_COMPLETE_UPDATE_RETRIES; attempt += 1) {
    try {
      await deps.convex.updateAutomationRunStatus({
        automationRunId: payload.automation_run_id,
        status: payload.status,
        ...(payload.error_message ? { errorMessage: payload.error_message } : {}),
      });
      return null;
    } catch (error) {
      lastError = error;
      if (attempt >= AUTOMATION_COMPLETE_UPDATE_RETRIES) {
        break;
      }
      await sleep(AUTOMATION_COMPLETE_RETRY_BASE_DELAY_MS * 2 ** attempt);
    }
  }

  return lastError;
};

const appendAutomationRunLogBatchWithRetry = async (
  deps: StartOwnedAutomationRuntimeDeps,
  params: {
    automationRunId: string;
    lines: Array<{
      level: AutomationRunLogLevel;
      content: string;
      eventType?: AutomationRunEventType;
      eventData?: Record<string, unknown>;
    }>;
  },
): Promise<unknown | null> => {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= AUTOMATION_LOG_APPEND_RETRIES; attempt += 1) {
    try {
      await deps.convex.appendAutomationRunLogBatch(params);
      return null;
    } catch (error) {
      lastError = error;
      if (attempt >= AUTOMATION_LOG_APPEND_RETRIES) {
        break;
      }
      await sleep(AUTOMATION_LOG_APPEND_RETRY_BASE_DELAY_MS * 2 ** attempt);
    }
  }

  return lastError;
};

const parseRequestPayload = <T>(
  request: Request,
  deps: StartOwnedAutomationRuntimeDeps,
  parser: (value: unknown) => T,
): Promise<T> =>
  request
    .text()
    .then((raw) => parser(deps.parseJsonPayload(raw)))
    .catch((error: unknown) => {
      throw error;
    });

export const handleInternalAutomationTerminateRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response> => {
  const auth = deps.authorizeInternalRequest(request.headers.get("authorization") ?? undefined);
  if (!auth.ok) {
    return internalUnauthorizedResponse(request, auth.reason);
  }

  let payload: { automation_run_id: string };
  try {
    payload = await parseRequestPayload(request, deps, parseTerminatePayload);
  } catch (error) {
    const invalidPayload = mapInvalidPayloadError(error);
    if (invalidPayload) {
      return jsonResponse(request, invalidPayload, 400);
    }
    throw error;
  }

  const context = await deps.convex.getAutomationRunDispatchContext({
    automationRunId: payload.automation_run_id,
  });
  if (!context) {
    return jsonResponse(
      request,
      {
        ok: false,
        status: AUTOMATION_ROUTE_STATUS.runNotFound,
      },
      404,
    );
  }

  const sandboxId = context.run.sandbox_id?.trim();
  if (!sandboxId) {
    return jsonResponse(
      request,
      {
        ok: false,
        status: AUTOMATION_ROUTE_STATUS.sandboxMissing,
      },
      409,
    );
  }

  try {
    const sandbox = (deps.createSandboxProvider ?? createAutomationSandboxProvider)();
    await sandbox.terminate(sandboxId);
    await deps.convex.appendAutomationRunLog({
      automationRunId: context.run.id,
      level: AUTOMATION_RUN_LOG_LEVEL.system,
      content: `Terminated sandbox ${sandboxId}`,
    });

    return jsonResponse(request, {
      ok: true,
      terminated: true,
      sandbox_id: sandboxId,
    });
  } catch (error) {
    const typedError = toAutomationRouteError(error, "automation_route_failed");
    const { code, message } = extractAutomationRouteError(typedError);
    deps.logger.error("automation.terminate.failed", {
      automation_run_id: context.run.id,
      sandbox_id: sandboxId,
      error: message,
      ...(code ? { error_code: code } : {}),
    });
    return jsonResponse(
      request,
      {
        ok: false,
        status: AUTOMATION_ROUTE_STATUS.terminateFailed,
        error: message,
        ...(code ? { error_code: code } : {}),
      },
      500,
    );
  }
};

export const handleInternalAutomationDispatchRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response> => {
  const auth = deps.authorizeInternalRequest(request.headers.get("authorization") ?? undefined);
  if (!auth.ok) {
    return internalUnauthorizedResponse(request, auth.reason);
  }

  let payload: { automation_run_id: string; dispatch_token: string };
  try {
    payload = await parseRequestPayload(request, deps, parseDispatchPayload);
  } catch (error) {
    const invalidPayload = mapInvalidPayloadError(error);
    if (invalidPayload) {
      return jsonResponse(request, invalidPayload, 400);
    }
    throw error;
  }

  const context = await deps.convex.claimAutomationRunDispatchContext({
    automationRunId: payload.automation_run_id,
    dispatchToken: payload.dispatch_token,
  });
  if (!context) {
    return jsonResponse(
      request,
      {
        ok: false,
        status: AUTOMATION_ROUTE_STATUS.runNotFound,
      },
      404,
    );
  }
  if (context.automation.status !== AUTOMATION_STATUS.active) {
    return jsonResponse(
      request,
      {
        ok: false,
        status: AUTOMATION_ROUTE_STATUS.automationPaused,
      },
      409,
    );
  }
  if (context.run.status !== AUTOMATION_RUN_STATUS.pending) {
    return jsonResponse(
      request,
      {
        ok: false,
        status: AUTOMATION_ROUTE_STATUS.runNotPending,
        run_status: context.run.status,
      },
      409,
    );
  }

  try {
    const env = deps.getEnv();
    const resolvedModel = resolveAutomationModel(env, context.config);
    const gatewayEnabled = isGatewayRuntimeEnabled(env.KEPPO_LLM_GATEWAY_URL);
    const callbackBaseUrl = resolveAutomationCallbackBaseUrl(request.url);
    const providerMode = resolveAutomationSandboxProviderMode();
    assertSandboxCallbackBaseUrlReachable(callbackBaseUrl, providerMode);
    const [creditBalance, byoKey, legacyOpenAiKey] = await Promise.all([
      deps.convex.getAiCreditBalance({ orgId: context.automation.org_id }),
      gatewayEnabled
        ? Promise.resolve(null)
        : deps.convex.getOrgAiKey({
            orgId: context.automation.org_id,
            provider: resolvedModel.aiModelProvider,
            keyMode: AI_KEY_MODE.byok,
          }),
      !gatewayEnabled && resolvedModel.aiModelProvider === "openai"
        ? deps.convex.getOrgAiKey({
            orgId: context.automation.org_id,
            provider: resolvedModel.aiModelProvider,
            keyMode: AI_KEY_MODE.subscriptionToken,
          })
        : Promise.resolve(null),
    ]);
    const activeNonBundledKey =
      byoKey?.is_active === true
        ? byoKey
        : legacyOpenAiKey?.is_active === true
          ? legacyOpenAiKey
          : null;
    const resolvedKeyMode = resolveAutomationExecutionReadiness({
      bundledRuntimeEnabled: creditBalance.bundled_runtime_enabled,
      totalCreditsAvailable: creditBalance.total_available,
      hasActiveByokKey: activeNonBundledKey !== null,
    }).mode;
    const authKeyMode = gatewayEnabled
      ? AI_KEY_MODE.bundled
      : resolvedKeyMode === AI_KEY_MODE.bundled
        ? AI_KEY_MODE.bundled
        : (activeNonBundledKey?.key_mode ?? AI_KEY_MODE.byok);

    assertRunnerAuthSupported({
      runnerType: resolvedModel.runnerType,
      aiModelProvider: resolvedModel.aiModelProvider,
      aiKeyMode: authKeyMode,
    });

    if (gatewayEnabled && !creditBalance.bundled_runtime_enabled) {
      await deps.convex
        .updateAutomationRunStatus({
          automationRunId: context.run.id,
          status: AUTOMATION_RUN_STATUS.cancelled,
          errorMessage: "Bundled automation runtime is unavailable for this organization.",
        })
        .catch(() => undefined);
      return jsonResponse(
        request,
        {
          ok: false,
          status: AUTOMATION_ROUTE_STATUS.bundledNotAvailable,
        },
        402,
      );
    }

    const key =
      !gatewayEnabled && resolvedKeyMode === AI_KEY_MODE.byok
        ? activeNonBundledKey
        : await deps.convex.getOrgAiKey({
            orgId: context.automation.org_id,
            provider: resolvedModel.aiModelProvider,
            keyMode: AI_KEY_MODE.bundled,
          });

    if (!key || !key.is_active) {
      const providerLabel = getAiModelProviderLabel(resolvedModel.aiModelProvider);
      const friendlyMessage =
        gatewayEnabled || resolvedKeyMode === AI_KEY_MODE.bundled
          ? `Bundled ${providerLabel} access is unavailable for this org. Please contact support.`
          : `No active ${providerLabel} API key found. Add or activate one in Settings -> AI Keys.`;
      await deps.convex
        .updateAutomationRunStatus({
          automationRunId: context.run.id,
          status: AUTOMATION_RUN_STATUS.cancelled,
          errorMessage: friendlyMessage,
        })
        .catch(() => undefined);
      return jsonResponse(
        request,
        {
          ok: false,
          status: AUTOMATION_ROUTE_STATUS.missingAiKey,
          provider: resolvedModel.aiModelProvider,
          key_mode: authKeyMode,
        },
        400,
      );
    }

    const mcpSessionId = `automation_${context.automation.id}_${Date.now().toString(36)}`;
    await deps.convex.createRun({
      workspaceId: context.automation.workspace_id,
      sessionId: mcpSessionId,
      clientType:
        resolvedModel.runnerType === AUTOMATION_RUNNER_TYPE.claudeCode
          ? CLIENT_TYPE.claudeCode
          : CLIENT_TYPE.chatgpt,
      metadata: {
        automation_run_id: context.run.id,
        automation_id: context.automation.id,
      },
    });

    const timeoutMs = Math.max(60_000, deps.getEnv().KEPPO_AUTOMATION_DEFAULT_TIMEOUT_MS);
    const expiresMs = Date.now() + timeoutMs + 5 * 60_000;
    const createSignedUrl = (pathname: string): string => {
      const url = new URL(pathname, `${callbackBaseUrl}/`);
      url.searchParams.set("automation_run_id", context.run.id);
      url.searchParams.set("expires", String(expiresMs));
      const signatureRequest = new Request(url);
      const signature = (() => {
        const signed = new URL(signatureRequest.url);
        signed.searchParams.delete("signature");
        const probe = signed.searchParams.get("automation_run_id");
        if (!probe) {
          throw createAutomationRouteError("automation_route_failed", "Missing callback run id.");
        }
        return createAutomationCallbackSignature(signed.pathname, probe, expiresMs, deps.getEnv());
      })();
      url.searchParams.set("signature", signature);
      return url.toString();
    };

    const mcpServerUrl = resolveAutomationMcpServerUrl(
      deps.getEnv().KEPPO_AUTOMATION_MCP_SERVER_URL,
      callbackBaseUrl,
      context.automation.workspace_id,
    );
    const mcpBearerToken = await deps.convex.issueAutomationWorkspaceCredential({
      workspaceId: context.automation.workspace_id,
      automationRunId: context.run.id,
    });
    await preflightMcpServer(mcpServerUrl, mcpBearerToken);

    let gatewayBaseUrl: string | null = null;
    if (resolvedKeyMode === AI_KEY_MODE.bundled) {
      gatewayBaseUrl = env.KEPPO_LLM_GATEWAY_URL?.trim() ?? null;
      if (!gatewayBaseUrl) {
        throw createAutomationRouteError(
          "missing_env",
          `Missing KEPPO_LLM_GATEWAY_URL for bundled ${resolvedModel.aiModelProvider === "openai" ? "OpenAI" : "Anthropic"} runtime.`,
        );
      }

      try {
        await deps.convex.deductAiCredit({
          orgId: context.automation.org_id,
          usageSource: "runtime",
        });
      } catch (error) {
        if (parseAiCreditErrorCode(error) === AI_CREDIT_ERROR_CODE.limitReached) {
          await deps.convex
            .updateAutomationRunStatus({
              automationRunId: context.run.id,
              status: AUTOMATION_RUN_STATUS.cancelled,
              errorMessage:
                "Bundled AI credits are exhausted. Purchase more credits in Billing or upgrade to a higher plan and retry.",
            })
            .catch(() => undefined);
          return jsonResponse(
            request,
            {
              ok: false,
              status: AUTOMATION_ROUTE_STATUS.aiCreditLimitReached,
            },
            402,
          );
        }
        if (parseAiCreditErrorCode(error) !== AI_CREDIT_ERROR_CODE.limitReached) {
          await deps.convex
            .updateAutomationRunStatus({
              automationRunId: context.run.id,
              status: AUTOMATION_RUN_STATUS.cancelled,
              errorMessage: "Bundled AI credit deduction failed before dispatch.",
            })
            .catch(() => undefined);
          return jsonResponse(
            request,
            {
              ok: false,
              status: AUTOMATION_ROUTE_STATUS.creditDeductionFailed,
            },
            500,
          );
        }
      }
    }

    const decryptedKey = await decryptStoredKey(key.encrypted_key);
    const runnerCommand = buildRunnerCommand({
      runnerType: resolvedModel.runnerType,
      aiModelProvider: resolvedModel.aiModelProvider,
      aiKeyMode: authKeyMode,
      credentialKind: key.credential_kind,
      networkAccess: context.config.network_access,
      model: resolvedModel.aiModelName,
      prompt: buildAutomationRunnerPrompt(context.config.prompt, context.automation.memory),
    });
    const bootstrapCommand = buildRunnerBootstrapCommand({
      runnerType: resolvedModel.runnerType,
      providerMode,
    });
    const runtimeBootstrapCommand = buildRunnerAuthBootstrapCommand({
      runnerType: resolvedModel.runnerType,
      providerMode,
      aiModelProvider: resolvedModel.aiModelProvider,
      aiKeyMode: authKeyMode,
      credentialKind: key.credential_kind,
    });
    const sandbox = (deps.createSandboxProvider ?? createAutomationSandboxProvider)();

    const runtimeEnv: Record<string, string> = {
      KEPPO_AUTOMATION_RUN_ID: context.run.id,
      KEPPO_MCP_SESSION_ID: mcpSessionId,
      KEPPO_MCP_SERVER_URL: mcpServerUrl,
      KEPPO_MCP_BEARER_TOKEN: mcpBearerToken,
    };
    const e2eOpenAiBaseUrl = env.KEPPO_E2E_OPENAI_BASE_URL?.trim();
    if (env.KEPPO_E2E_MODE && e2eOpenAiBaseUrl) {
      runtimeEnv.KEPPO_E2E_OPENAI_BASE_URL = e2eOpenAiBaseUrl;
    }
    const vercelAutomationBypassSecret = resolveVercelAutomationBypassSecret(env);
    if (vercelAutomationBypassSecret) {
      runtimeEnv.VERCEL_AUTOMATION_BYPASS_SECRET = vercelAutomationBypassSecret;
    }
    if (resolvedModel.aiModelProvider === "openai") {
      if (authKeyMode === AI_KEY_MODE.subscriptionToken && key.credential_kind === "openai_oauth") {
        runtimeEnv.OPENAI_CODEX_AUTH_JSON = decryptedKey;
      } else if (authKeyMode === AI_KEY_MODE.byok) {
        runtimeEnv.OPENAI_API_KEY = decryptedKey;
      } else if (authKeyMode === AI_KEY_MODE.bundled) {
        runtimeEnv.OPENAI_API_KEY = decryptedKey;
        runtimeEnv.OPENAI_BASE_URL = gatewayBaseUrl!;
      }
    } else {
      if (authKeyMode === AI_KEY_MODE.byok) {
        runtimeEnv.ANTHROPIC_API_KEY = decryptedKey;
      } else if (authKeyMode === AI_KEY_MODE.bundled) {
        runtimeEnv.ANTHROPIC_API_KEY = decryptedKey;
        runtimeEnv.ANTHROPIC_BASE_URL = gatewayBaseUrl!;
      }
    }

    deps.logger.info("automation.dispatch.runtime_configured", {
      automation_id: context.automation.id,
      automation_run_id: context.run.id,
      workspace_id: context.automation.workspace_id,
      runner_type: resolvedModel.runnerType,
      ai_model_provider: resolvedModel.aiModelProvider,
      ai_key_mode: authKeyMode,
      network_access: context.config.network_access,
      has_e2e_openai_base_url: Boolean(runtimeEnv.KEPPO_E2E_OPENAI_BASE_URL),
      has_openai_base_url: Boolean(runtimeEnv.OPENAI_BASE_URL),
      has_openai_api_key: Boolean(runtimeEnv.OPENAI_API_KEY),
      runner_uses_custom_openai_provider: runnerCommand.includes(
        'model_provider="keppo_openai_api"',
      ),
      runner_bypasses_approvals: runnerCommand.includes(
        "--dangerously-bypass-approvals-and-sandbox",
      ),
    });

    const dispatch = await sandbox.dispatch({
      bootstrap: {
        command: bootstrapCommand,
        env: {},
        network_access: "package_registry_only",
      },
      runtime: {
        bootstrap_command: runtimeBootstrapCommand,
        command: runnerCommand,
        env: runtimeEnv,
        network_access: context.config.network_access,
        callbacks: {
          log_url: createSignedUrl("/internal/automations/log"),
          complete_url: createSignedUrl("/internal/automations/complete"),
          session_artifact_url: createSignedUrl("/internal/automations/session-artifact"),
        },
      },
      timeout_ms: timeoutMs,
    });

    await deps.convex.updateAutomationRunStatus({
      automationRunId: context.run.id,
      status: AUTOMATION_RUN_STATUS.running,
      sandboxId: dispatch.sandbox_id,
      mcpSessionId,
    });
    await deps.convex.appendAutomationRunLog({
      automationRunId: context.run.id,
      level: AUTOMATION_RUN_LOG_LEVEL.system,
      content: `Dispatched sandbox ${dispatch.sandbox_id}`,
    });

    deps.logger.info("automation.dispatch.succeeded", {
      automation_id: context.automation.id,
      automation_run_id: context.run.id,
      workspace_id: context.automation.workspace_id,
      sandbox_id: dispatch.sandbox_id,
    });

    return jsonResponse(request, {
      ok: true,
      sandbox_id: dispatch.sandbox_id,
    });
  } catch (error) {
    const typedError = toAutomationRouteError(error, "automation_route_failed");
    const { code, message } = extractAutomationRouteError(typedError);
    await deps.convex
      .updateAutomationRunStatus({
        automationRunId: context.run.id,
        status: AUTOMATION_RUN_STATUS.cancelled,
        errorMessage: `Dispatch failed: ${typedError.message}`,
      })
      .catch(() => undefined);

    deps.logger.error("automation.dispatch.failed", {
      automation_id: context.automation.id,
      automation_run_id: context.run.id,
      workspace_id: context.automation.workspace_id,
      error: message,
      ...(code ? { error_code: code } : {}),
    });
    return jsonResponse(
      request,
      {
        ok: false,
        status: AUTOMATION_ROUTE_STATUS.dispatchFailed,
        error: message,
        ...(code ? { error_code: code } : {}),
      },
      500,
    );
  }
};

export const handleInternalAutomationLogRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response> => {
  let payload: ReturnType<typeof parseLogPayload>;
  try {
    payload = await parseRequestPayload(request, deps, parseLogPayload);
  } catch (error) {
    const invalidPayload = mapInvalidPayloadError(error);
    if (invalidPayload) {
      return jsonResponse(request, invalidPayload, 400);
    }
    throw error;
  }

  if (!hasValidAutomationCallbackSignature(request, payload.automation_run_id)) {
    return jsonResponse(
      request,
      {
        ok: false,
        status: AUTOMATION_ROUTE_STATUS.invalidSignature,
      },
      401,
    );
  }

  const limited = payload.lines.slice(0, AUTOMATION_LOG_MAX_LINES);
  for (let i = 0; i < limited.length; i += AUTOMATION_LOG_BATCH_SIZE) {
    const chunk = limited.slice(i, i + AUTOMATION_LOG_BATCH_SIZE);
    const appendError = await appendAutomationRunLogBatchWithRetry(deps, {
      automationRunId: payload.automation_run_id,
      lines: chunk.map((line) => ({
        level: line.level,
        content: line.content,
        ...(line.event_type !== undefined ? { eventType: line.event_type } : {}),
        ...(line.event_data !== undefined ? { eventData: line.event_data } : {}),
      })),
    });
    if (appendError) {
      const typedError = toAutomationRouteError(appendError, "automation_route_failed");
      const { code, message } = extractAutomationRouteError(typedError);
      deps.logger.error("automation.log.failed", {
        automation_run_id: payload.automation_run_id,
        batch_index: i / AUTOMATION_LOG_BATCH_SIZE,
        batch_size: chunk.length,
        ingested_before_failure: i,
        error: message,
        ...(code ? { error_code: code } : {}),
      });
      return jsonResponse(
        request,
        {
          ok: false,
          status: AUTOMATION_ROUTE_STATUS.logFailed,
          error: message,
          ...(code ? { error_code: code } : {}),
        },
        500,
      );
    }
  }

  return jsonResponse(request, {
    ok: true,
    ingested: limited.length,
  });
};

export const handleInternalAutomationSessionArtifactRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response> => {
  let payload: ReturnType<typeof parseSessionArtifactPayload>;
  try {
    payload = await parseRequestPayload(request, deps, parseSessionArtifactPayload);
  } catch (error) {
    const invalidPayload = mapInvalidPayloadError(error);
    if (invalidPayload) {
      return jsonResponse(request, invalidPayload, 400);
    }
    throw error;
  }

  if (!hasValidAutomationCallbackSignature(request, payload.automation_run_id)) {
    return jsonResponse(
      request,
      {
        ok: false,
        status: AUTOMATION_ROUTE_STATUS.invalidSignature,
      },
      401,
    );
  }

  const stored = await deps.convex.storeAutomationRunSessionTrace({
    automationRunId: payload.automation_run_id,
    relativePath: payload.relative_path,
    contentBase64: payload.content_base64,
  });

  return jsonResponse(request, {
    ok: true,
    stored: stored.stored,
  });
};

export const handleInternalAutomationCompleteRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response> => {
  let payload: {
    automation_run_id: string;
    status: AutomationRunTerminalStatus;
    error_message?: string;
  };
  try {
    payload = await parseRequestPayload(request, deps, parseCompletionPayload);
  } catch (error) {
    const invalidPayload = mapInvalidPayloadError(error);
    if (invalidPayload) {
      return jsonResponse(request, invalidPayload, 400);
    }
    throw error;
  }

  if (!hasValidAutomationCallbackSignature(request, payload.automation_run_id)) {
    return jsonResponse(
      request,
      {
        ok: false,
        status: AUTOMATION_ROUTE_STATUS.invalidSignature,
      },
      401,
    );
  }

  const completionError = await updateAutomationRunCompletionWithRetry(deps, payload);
  if (completionError) {
    const typedError = toAutomationRouteError(completionError, "automation_route_failed");
    const { code, message } = extractAutomationRouteError(typedError);
    deps.logger.error("automation.complete.failed", {
      automation_run_id: payload.automation_run_id,
      status: payload.status,
      error: message,
      attempts: AUTOMATION_COMPLETE_UPDATE_RETRIES + 1,
      ...(code ? { error_code: code } : {}),
    });
    return jsonResponse(
      request,
      {
        ok: false,
        status: AUTOMATION_ROUTE_STATUS.completeFailed,
        error: message,
        ...(code ? { error_code: code } : {}),
      },
      500,
    );
  }

  return jsonResponse(request, {
    ok: true,
    status: payload.status,
  });
};

export const dispatchStartOwnedAutomationRuntimeRequest = async (
  request: Request,
  deps?: StartOwnedAutomationRuntimeDeps,
): Promise<Response | null> => {
  const pathname = new URL(request.url).pathname;

  if (request.method === "POST" && pathname === "/internal/automations/dispatch") {
    return await handleInternalAutomationDispatchRequest(request, deps ?? getDefaultDeps());
  }
  if (request.method === "POST" && pathname === "/internal/automations/terminate") {
    return await handleInternalAutomationTerminateRequest(request, deps ?? getDefaultDeps());
  }
  if (request.method === "POST" && pathname === "/internal/automations/log") {
    return await handleInternalAutomationLogRequest(request, deps ?? getDefaultDeps());
  }
  if (request.method === "POST" && pathname === "/internal/automations/session-artifact") {
    return await handleInternalAutomationSessionArtifactRequest(request, deps ?? getDefaultDeps());
  }
  if (request.method === "POST" && pathname === "/internal/automations/complete") {
    return await handleInternalAutomationCompleteRequest(request, deps ?? getDefaultDeps());
  }

  return null;
};
