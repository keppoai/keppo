"use node";

import { randomUUID } from "node:crypto";
import { type ActionCtx } from "../_generated/server";
import {
  createWorkerExecutionError as createSharedWorkerExecutionError,
  getProviderRuntimeSecrets,
  getProviderModuleV2,
  nowIso,
  parseWorkerExecutionErrorCode,
  providerRolloutFeatureFlag,
  providerRegistry,
  readFeatureFlagValue,
  safeFetch,
  toIntegrationErrorClassification,
  toIntegrationErrorCodeFromWorkerCode,
  toWorkerExecutionErrorCode,
  PROVIDER_REGISTRY_PATH_FEATURE_FLAG,
  type IntegrationErrorClassification,
  type WorkerExecutionErrorCode,
  type CanonicalProviderId,
  type ConnectorContext,
  type ProviderRuntimeContext,
} from "../mcp_node_shared";

const REFRESH_GRACE_MS = 60_000;
const DEFAULT_E2E_PORT_BASE = 9900;
const DEFAULT_E2E_PORT_BLOCK_SIZE = 20;

const PROVIDER_SDK_SCOPE_ERROR_CODES = new Set([
  "insufficient_scope",
  "missing_scopes",
  "insufficient_scopes",
]);

type SafeFetchErrorLike = Error & {
  code: string;
};

type ProviderSdkErrorLike = Error & {
  shape: {
    category: string;
    code: string;
    status?: number | undefined;
    message: string;
    retryable: boolean;
  };
  causeData?: unknown;
};

const resolveWorkerExecutionErrorCode = (error: unknown): WorkerExecutionErrorCode | null => {
  if (!(error instanceof Error)) {
    return null;
  }
  return parseWorkerExecutionErrorCode(error.message);
};

const isSafeFetchErrorLike = (error: unknown): error is SafeFetchErrorLike => {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return (
    typeof code === "string" && (code === "network_blocked" || code === "network_request_failed")
  );
};

const isProviderSdkErrorLike = (error: unknown): error is ProviderSdkErrorLike => {
  if (!error || typeof error !== "object") {
    return false;
  }
  const shape = (error as { shape?: unknown }).shape;
  if (!shape || typeof shape !== "object") {
    return false;
  }
  const category = (shape as { category?: unknown }).category;
  const code = (shape as { code?: unknown }).code;
  const message = (shape as { message?: unknown }).message;
  const retryable = (shape as { retryable?: unknown }).retryable;
  return (
    typeof category === "string" &&
    typeof code === "string" &&
    typeof message === "string" &&
    typeof retryable === "boolean"
  );
};

const classifyProviderSdkError = (error: ProviderSdkErrorLike): IntegrationErrorClassification => {
  if (isSafeFetchErrorLike(error.causeData) && error.causeData.code === "network_blocked") {
    return toIntegrationErrorClassification("network_blocked");
  }
  if (error.shape.status === 429 || error.shape.category === "rate_limit") {
    return toIntegrationErrorClassification("rate_limited");
  }
  if (error.shape.category === "auth") {
    if (PROVIDER_SDK_SCOPE_ERROR_CODES.has(error.shape.code)) {
      return toIntegrationErrorClassification("missing_scopes");
    }
    return toIntegrationErrorClassification("credential_error");
  }
  if (error.shape.category === "permission") {
    if (error.shape.code === "insufficient_scope" || error.shape.code === "missing_scopes") {
      return toIntegrationErrorClassification("missing_scopes");
    }
    return toIntegrationErrorClassification("allowlist_blocked");
  }
  if (error.shape.category === "timeout" || error.shape.category === "transient") {
    return toIntegrationErrorClassification("network_blocked");
  }
  return toIntegrationErrorClassification("execution_failed");
};

const resolveProviderRolloutFlag = (provider: CanonicalProviderId): boolean => {
  return readFeatureFlagValue(providerRolloutFeatureFlag(provider));
};

const resolveRegistryPathEnabled = (): boolean => {
  return readFeatureFlagValue(PROVIDER_REGISTRY_PATH_FEATURE_FLAG);
};

const shouldRefreshAccessToken = (expiresAt: string | null | undefined): boolean => {
  if (!expiresAt) {
    return false;
  }
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return false;
  }
  return expiresAtMs - Date.now() <= REFRESH_GRACE_MS;
};

const resolveNamespaceFakeGatewayBase = (namespace?: string): string | null => {
  if (!namespace) {
    return null;
  }
  const segments = namespace.split(".");
  if (segments.length < 4) {
    return null;
  }
  const workerIndex = Number(segments[1]);
  if (!Number.isInteger(workerIndex) || workerIndex < 0) {
    return null;
  }
  const basePort = Number.parseInt(process.env.KEPPO_E2E_PORT_BASE ?? "", 10);
  const blockSize = Number.parseInt(process.env.KEPPO_E2E_PORT_BLOCK_SIZE ?? "", 10);
  const safeBase =
    Number.isInteger(basePort) && basePort >= 1024 ? basePort : DEFAULT_E2E_PORT_BASE;
  const safeBlockSize =
    Number.isInteger(blockSize) && blockSize >= 5 ? blockSize : DEFAULT_E2E_PORT_BLOCK_SIZE;
  const fakeGatewayPort = safeBase + workerIndex * safeBlockSize + 1;
  return `http://127.0.0.1:${fakeGatewayPort}`;
};

const toSafeFetchOptions = (
  namespace: string | undefined,
  runtimeSecrets: Record<string, string | undefined>,
): {
  namespace?: string;
  extraAllowedHosts?: string[];
} => {
  const extraAllowedHosts = [
    runtimeSecrets.KEPPO_FAKE_EXTERNAL_BASE_URL,
    runtimeSecrets.GMAIL_API_BASE_URL,
    runtimeSecrets.GOOGLE_OAUTH_AUTH_URL,
    runtimeSecrets.GOOGLE_OAUTH_TOKEN_URL,
    runtimeSecrets.STRIPE_API_BASE_URL,
    runtimeSecrets.STRIPE_OAUTH_AUTH_URL,
    runtimeSecrets.STRIPE_OAUTH_TOKEN_URL,
    runtimeSecrets.GITHUB_API_BASE_URL,
    runtimeSecrets.GITHUB_OAUTH_AUTH_URL,
    runtimeSecrets.GITHUB_OAUTH_TOKEN_URL,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  return {
    ...(namespace ? { namespace } : {}),
    ...(extraAllowedHosts.length > 0 ? { extraAllowedHosts } : {}),
  };
};

export const createWorkerExecutionError = (
  code: WorkerExecutionErrorCode,
  message: string,
): Error => {
  return createSharedWorkerExecutionError(code, message);
};

export const classifyIntegrationError = (error: unknown): IntegrationErrorClassification => {
  const workerErrorCode = resolveWorkerExecutionErrorCode(error);
  if (workerErrorCode) {
    return toIntegrationErrorClassification(toIntegrationErrorCodeFromWorkerCode(workerErrorCode));
  }
  if (isSafeFetchErrorLike(error)) {
    if (error.code === "network_blocked") {
      return toIntegrationErrorClassification("network_blocked");
    }
    return toIntegrationErrorClassification("execution_failed");
  }
  if (isProviderSdkErrorLike(error)) {
    return classifyProviderSdkError(error);
  }
  return toIntegrationErrorClassification("execution_failed");
};

export const resolveToolOwnerProvider = (toolName: string): CanonicalProviderId => {
  return providerRegistry.getToolOwner(toolName);
};

export const assertProviderRegistryPathEnabled = (): void => {
  if (!resolveRegistryPathEnabled()) {
    throw createWorkerExecutionError(
      "provider_registry_disabled",
      "Provider registry path is disabled by kill switch.",
    );
  }
};

export const assertProviderRolloutEnabled = (provider: CanonicalProviderId): void => {
  if (!resolveProviderRolloutFlag(provider)) {
    throw createWorkerExecutionError(
      "provider_disabled",
      `Provider ${provider} is currently disabled by rollout policy.`,
    );
  }
};

export const assertProviderCapability = (
  provider: CanonicalProviderId,
  capability: "read" | "write" | "refresh_credentials",
): void => {
  const module = getProviderModuleV2(provider);
  const supportsCapability =
    capability === "read"
      ? module.metadata.capabilities.read
      : capability === "write"
        ? module.metadata.capabilities.write
        : module.metadata.capabilities.refreshCredentials;
  if (!supportsCapability) {
    throw createWorkerExecutionError(
      "provider_capability_mismatch",
      `Provider ${provider} does not support ${capability}.`,
    );
  }
};

export const assertIntegrationProviderMatch = (
  expectedProvider: CanonicalProviderId,
  actualProvider: CanonicalProviderId | null,
): void => {
  if (actualProvider && actualProvider !== expectedProvider) {
    throw createWorkerExecutionError(
      "provider_mismatch",
      `Tool owner provider ${expectedProvider} does not match integration provider ${actualProvider}.`,
    );
  }
};

export const toProviderRuntimeContext = (namespace: string | undefined): ProviderRuntimeContext => {
  const namespaceFakeBase = resolveNamespaceFakeGatewayBase(namespace);
  const runtimeSecrets = getProviderRuntimeSecrets({
    env: process.env,
    fakeExternalBaseUrl: namespaceFakeBase,
  });
  return {
    httpClient: (url, init) =>
      safeFetch(
        url,
        init,
        "worker.provider.runtime.http",
        toSafeFetchOptions(namespace, runtimeSecrets),
      ),
    clock: {
      now: () => Date.now(),
      nowIso: () => nowIso(),
    },
    idGenerator: {
      randomId: (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    },
    logger: {
      debug: (message, metadata) => console.debug(message, metadata ?? {}),
      info: (message, metadata) => console.info(message, metadata ?? {}),
      warn: (message, metadata) => console.warn(message, metadata ?? {}),
      error: (message, metadata) => console.error(message, metadata ?? {}),
    },
    secrets: runtimeSecrets,
    featureFlags: {},
  };
};

type RefreshResultSuccessArgs = {
  orgId: string;
  provider: CanonicalProviderId;
  success: true;
  accessToken: string;
  refreshToken: string;
  expiresAt: string | null;
};

type RefreshResultFailureArgs = {
  orgId: string;
  provider: CanonicalProviderId;
  success: false;
  errorCode: IntegrationErrorClassification["errorCode"];
  errorCategory: IntegrationErrorClassification["errorCategory"];
};

type RefreshResultArgs = RefreshResultSuccessArgs | RefreshResultFailureArgs;

type RefreshConnectorContextDeps = {
  markCredentialRefreshResult: (ctx: ActionCtx, args: RefreshResultArgs) => Promise<void>;
  updateIntegrationCredential: (
    ctx: ActionCtx,
    args: {
      orgId: string;
      provider: CanonicalProviderId;
      accessToken: string;
      refreshToken: string;
      expiresAt: string | null;
    },
  ) => Promise<void>;
};

export const createRefreshConnectorContextAccessToken = (deps: RefreshConnectorContextDeps) => {
  return async (
    ctx: ActionCtx,
    params: {
      provider: CanonicalProviderId;
      context: ConnectorContext;
    },
  ): Promise<ConnectorContext> => {
    const module = getProviderModuleV2(params.provider);
    if (!module.metadata.capabilities.refreshCredentials) {
      return params.context;
    }
    if (!shouldRefreshAccessToken(params.context.access_token_expires_at)) {
      return params.context;
    }
    assertProviderCapability(params.provider, "refresh_credentials");
    if (!params.context.refresh_token) {
      const classification = toIntegrationErrorClassification("credential_error");
      await deps.markCredentialRefreshResult(ctx, {
        orgId: params.context.orgId,
        provider: params.provider,
        success: false,
        errorCode: classification.errorCode,
        errorCategory: classification.errorCategory,
      });
      throw createWorkerExecutionError(
        "missing_refresh_token",
        `${params.provider} access token expired and no refresh token is available. Reconnect integration.`,
      );
    }

    const namespace =
      typeof params.context.metadata?.e2e_namespace === "string" &&
      params.context.metadata.e2e_namespace.trim()
        ? params.context.metadata.e2e_namespace.trim()
        : undefined;
    const runtimeContext = toProviderRuntimeContext(namespace);
    if (!module.facets.refresh) {
      throw createWorkerExecutionError(
        "provider_capability_mismatch",
        `Provider ${params.provider} declares refresh capability but has no refresh hook.`,
      );
    }

    try {
      const refreshed = await module.facets.refresh.refreshCredentials(
        params.context.refresh_token,
        runtimeContext,
      );
      const refreshToken = refreshed.refreshToken ?? params.context.refresh_token;
      const expiresAt = refreshed.expiresAt;

      await deps.updateIntegrationCredential(ctx, {
        orgId: params.context.orgId,
        provider: params.provider,
        accessToken: refreshed.accessToken,
        refreshToken,
        expiresAt,
      });

      await deps.markCredentialRefreshResult(ctx, {
        orgId: params.context.orgId,
        provider: params.provider,
        success: true,
        accessToken: refreshed.accessToken,
        refreshToken,
        expiresAt,
      });

      return {
        ...params.context,
        access_token: refreshed.accessToken,
        refresh_token: refreshToken,
        access_token_expires_at: expiresAt,
        ...(refreshed.scopes.length > 0 ? { scopes: refreshed.scopes } : {}),
        ...(refreshed.externalAccountId !== null
          ? { external_account_id: refreshed.externalAccountId }
          : {}),
      };
    } catch (error) {
      const classification = classifyIntegrationError(error);
      await deps.markCredentialRefreshResult(ctx, {
        orgId: params.context.orgId,
        provider: params.provider,
        success: false,
        errorCode: classification.errorCode,
        errorCategory: classification.errorCategory,
      });
      const message =
        error instanceof Error ? error.message : `${params.provider} credential refresh failed.`;
      throw createWorkerExecutionError(
        toWorkerExecutionErrorCode(classification.errorCode),
        message,
      );
    }
  };
};
