import type { CanonicalProviderId } from "../../provider-catalog.js";
import type {
  ProviderAuthExchangeRequest,
  ProviderCredentialBundle,
  ProviderRuntimeContext,
} from "../../providers.js";
import type { ProviderAuthFacet, ProviderRefreshFacet } from "../registry/types.js";

const DEFAULT_FAKE_EXTERNAL_BASE_URL = "http://127.0.0.1:9901";

type OAuthResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};

export type ManagedOAuthConfig = {
  authUrlEnvKey: string;
  authPath: string;
  tokenUrlEnvKey: string;
  tokenPath: string;
  apiBaseUrlEnvKey: string;
  apiPath: string;
  clientIdEnvKey: string;
  clientSecretEnvKey: string;
  defaultClientId: string;
  defaultClientSecret: string;
  defaultScopes: Array<string>;
  scopeMap?: Record<string, string>;
  mapRequestedScopes?: (requestedScopes: Array<string>) => Array<string>;
  normalizeGrantedScopes?: (
    requestedScopes: Array<string>,
    tokenScope: string | undefined,
  ) => Array<string>;
  authUrlParams?: Record<string, string>;
  profilePaths: Array<string>;
  resolveExternalAccountId: (profile: Record<string, unknown>) => string | null;
};

type ResolvedManagedOAuthConfig = {
  oauthAuthUrl: string;
  oauthTokenUrl: string;
  apiBaseUrl: string;
  clientId: string;
  clientSecret: string;
} & ManagedOAuthConfig;

const unsupportedHook = (providerId: CanonicalProviderId, hook: string): never => {
  throw new Error(`${providerId}.${hook} is not implemented in this runtime.`);
};

const parseScopeList = (scope: string | undefined): string[] => {
  if (!scope) {
    return [];
  }
  return scope
    .split(" ")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

const buildScopeReverseMap = (
  scopeMap: Record<string, string> | undefined,
): Map<string, string> => {
  if (!scopeMap) {
    return new Map();
  }
  return new Map(
    Object.entries(scopeMap).map(([requested, providerScope]) => [providerScope, requested]),
  );
};

const normalizeOAuthScopes = (
  config: ManagedOAuthConfig,
  requestedScopes: Array<string>,
  tokenScope: string | undefined,
): Array<string> => {
  if (config.normalizeGrantedScopes) {
    return config.normalizeGrantedScopes(requestedScopes, tokenScope);
  }
  const parsedScopes = parseScopeList(tokenScope);
  if (parsedScopes.length === 0) {
    return requestedScopes;
  }
  const scopeReverseMap = buildScopeReverseMap(config.scopeMap);
  if (scopeReverseMap.size === 0) {
    return parsedScopes;
  }
  return parsedScopes.map((scope) => scopeReverseMap.get(scope) ?? scope);
};

const resolveManagedOAuthConfig = (
  runtime: ProviderRuntimeContext,
  config: ManagedOAuthConfig,
): ResolvedManagedOAuthConfig => {
  const fakeBase = runtime.secrets.KEPPO_FAKE_EXTERNAL_BASE_URL ?? DEFAULT_FAKE_EXTERNAL_BASE_URL;
  return {
    ...config,
    oauthAuthUrl: runtime.secrets[config.authUrlEnvKey] ?? `${fakeBase}${config.authPath}`,
    oauthTokenUrl: runtime.secrets[config.tokenUrlEnvKey] ?? `${fakeBase}${config.tokenPath}`,
    apiBaseUrl: runtime.secrets[config.apiBaseUrlEnvKey] ?? `${fakeBase}${config.apiPath}`,
    clientId: runtime.secrets[config.clientIdEnvKey] ?? config.defaultClientId,
    clientSecret: runtime.secrets[config.clientSecretEnvKey] ?? config.defaultClientSecret,
  };
};

const loadExternalAccountId = async (
  providerId: CanonicalProviderId,
  config: ResolvedManagedOAuthConfig,
  accessToken: string,
  fallback: string | null,
  runtime: ProviderRuntimeContext,
): Promise<string | null> => {
  for (const path of config.profilePaths) {
    try {
      const response = await runtime.httpClient(`${config.apiBaseUrl}${path}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      if (!response.ok) {
        continue;
      }
      const profile = (await response.json()) as Record<string, unknown>;
      const externalAccountId = config.resolveExternalAccountId(profile);
      if (externalAccountId) {
        return externalAccountId;
      }
    } catch (error) {
      runtime.logger.warn("provider.oauth.profile.lookup_failed", {
        provider: providerId,
        path,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return fallback;
};

const exchangeOAuthCredentials = async (
  providerId: CanonicalProviderId,
  request: ProviderAuthExchangeRequest,
  runtime: ProviderRuntimeContext,
  config: ManagedOAuthConfig,
): Promise<ProviderCredentialBundle> => {
  const resolvedConfig = resolveManagedOAuthConfig(runtime, config);
  const requestedScopes =
    request.scopes && request.scopes.length > 0
      ? request.scopes
      : [...resolvedConfig.defaultScopes];

  const response = await runtime.httpClient(resolvedConfig.oauthTokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: resolvedConfig.clientId,
      client_secret: resolvedConfig.clientSecret,
      grant_type: "authorization_code",
      code: request.code,
      redirect_uri: request.redirectUri,
    }).toString(),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `OAuth token exchange failed: ${response.status}`);
  }

  const payload = (await response.json()) as OAuthResponse;
  if (!payload.access_token) {
    throw new Error("OAuth token response missing access token");
  }

  const expiresAt =
    typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in)
      ? new Date(runtime.clock.now() + payload.expires_in * 1000).toISOString()
      : null;

  const externalAccountId = await loadExternalAccountId(
    providerId,
    resolvedConfig,
    payload.access_token,
    request.externalAccountFallback ?? null,
    runtime,
  );

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    expiresAt,
    scopes: normalizeOAuthScopes(resolvedConfig, requestedScopes, payload.scope),
    externalAccountId,
  };
};

export const createManagedOAuthAuthFacet = (
  providerId: CanonicalProviderId,
  config: ManagedOAuthConfig,
): ProviderAuthFacet => {
  return {
    buildAuthRequest: async (request, runtime) => {
      const resolvedConfig = resolveManagedOAuthConfig(runtime, config);
      const scopes = request.scopes.length > 0 ? request.scopes : [...resolvedConfig.defaultScopes];
      const mappedScopes = resolvedConfig.mapRequestedScopes
        ? resolvedConfig.mapRequestedScopes(scopes)
        : scopes.map((scope) => resolvedConfig.scopeMap?.[scope] ?? scope);

      const authUrl = new URL(resolvedConfig.oauthAuthUrl);
      authUrl.searchParams.set("client_id", resolvedConfig.clientId);
      authUrl.searchParams.set("redirect_uri", request.redirectUri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", mappedScopes.join(" "));
      authUrl.searchParams.set("state", request.state);
      for (const [key, value] of Object.entries(resolvedConfig.authUrlParams ?? {})) {
        authUrl.searchParams.set(key, value);
      }
      if (request.namespace) {
        authUrl.searchParams.set("namespace", request.namespace);
      }

      return {
        oauth_start_url: authUrl.toString(),
        scopes,
      };
    },
    exchangeCredentials: async (request, runtime) => {
      return exchangeOAuthCredentials(providerId, request, runtime, config);
    },
  };
};

export const createManagedOAuthRefreshFacet = (
  providerId: CanonicalProviderId,
  config: ManagedOAuthConfig,
): ProviderRefreshFacet => {
  return {
    refreshCredentials: async (refreshToken, runtime) => {
      const resolvedConfig = resolveManagedOAuthConfig(runtime, config);

      runtime.logger.debug("provider.refresh_credentials.request", {
        provider: providerId,
        token_url: resolvedConfig.oauthTokenUrl,
      });

      const response = await runtime.httpClient(resolvedConfig.oauthTokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: resolvedConfig.clientId,
          client_secret: resolvedConfig.clientSecret,
        }).toString(),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(body || `OAuth refresh failed: ${response.status}`);
      }

      const payload = (await response.json()) as OAuthResponse;
      if (!payload.access_token) {
        throw new Error("OAuth refresh response missing access token");
      }

      const expiresAt =
        typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in)
          ? new Date(runtime.clock.now() + payload.expires_in * 1000).toISOString()
          : null;

      return {
        accessToken: payload.access_token,
        refreshToken: payload.refresh_token ?? refreshToken,
        expiresAt,
        scopes: normalizeOAuthScopes(
          resolvedConfig,
          [...resolvedConfig.defaultScopes],
          payload.scope,
        ),
        externalAccountId: null,
      };
    },
  };
};

export const createUnsupportedAuthFacet = (providerId: CanonicalProviderId): ProviderAuthFacet => {
  return {
    buildAuthRequest: async () => unsupportedHook(providerId, "buildAuthRequest"),
    exchangeCredentials: async () => unsupportedHook(providerId, "exchangeCredentials"),
  };
};
