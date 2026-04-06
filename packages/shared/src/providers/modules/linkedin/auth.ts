import { getProviderDefaultScopes } from "../../../provider-default-scopes.js";
import type {
  ProviderAuthExchangeRequest,
  ProviderCredentialBundle,
  ProviderRuntimeContext,
} from "../../../providers.js";
import type { ProviderAuthFacet } from "../../registry/types.js";

const LINKEDIN_DEFAULT_AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const LINKEDIN_DEFAULT_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const LINKEDIN_DEFAULT_API_BASE_URL = "https://api.linkedin.com";
const LINKEDIN_DEFAULT_CLIENT_ID = "fake-linkedin-client-id";
const LINKEDIN_DEFAULT_CLIENT_SECRET = "fake-linkedin-client-secret";
const LINKEDIN_DEFAULT_SCOPES = getProviderDefaultScopes("linkedin");
const MISSING_EXTERNAL_ACCOUNT_ID_ERROR =
  "OAuth profile lookup did not return a provider account identifier.";

type OAuthResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  [key: string]: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

const unique = (values: string[]): string[] => {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
};

const parseScopeList = (scope: string | undefined): string[] => {
  if (!scope) {
    return [];
  }
  return unique(scope.split(" "));
};

const resolveGrantedScopes = (
  requestedScopes: string[],
  grantedProviderScopes: string[],
): string[] => {
  if (grantedProviderScopes.length === 0) {
    return [...requestedScopes];
  }
  const grantedScopeSet = new Set(grantedProviderScopes);
  return requestedScopes.filter((scope) => grantedScopeSet.has(scope));
};

const resolveEnv = (runtime: ProviderRuntimeContext) => {
  const oauthAuthUrl = runtime.secrets.LINKEDIN_OAUTH_AUTH_URL ?? LINKEDIN_DEFAULT_AUTH_URL;
  return {
    oauthAuthUrl,
    oauthTokenUrl: runtime.secrets.LINKEDIN_OAUTH_TOKEN_URL ?? LINKEDIN_DEFAULT_TOKEN_URL,
    apiBaseUrl: runtime.secrets.LINKEDIN_API_BASE_URL ?? LINKEDIN_DEFAULT_API_BASE_URL,
    clientId: runtime.secrets.LINKEDIN_CLIENT_ID ?? LINKEDIN_DEFAULT_CLIENT_ID,
    clientSecret: runtime.secrets.LINKEDIN_CLIENT_SECRET ?? LINKEDIN_DEFAULT_CLIENT_SECRET,
    isLocalAuthUrl: /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?/i.test(oauthAuthUrl),
  };
};

const readExternalAccountId = (profile: Record<string, unknown>): string | null => {
  const sub = profile.sub;
  if (typeof sub === "string" && sub.trim().length > 0) {
    return sub.trim();
  }
  const id = profile.id;
  if (typeof id === "string" && id.trim().length > 0) {
    return id.trim();
  }
  return null;
};

const loadExternalAccountId = async (
  accessToken: string,
  runtime: ProviderRuntimeContext,
): Promise<string> => {
  const { apiBaseUrl } = resolveEnv(runtime);
  for (const profilePath of ["/v2/userinfo", "/v2/me", "/rest/me"]) {
    const response = await runtime.httpClient(`${apiBaseUrl}${profilePath}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "X-RestLi-Protocol-Version": "2.0.0",
      },
    });
    if (!response.ok) {
      continue;
    }

    const profile = (await response.json()) as Record<string, unknown>;
    const externalAccountId = readExternalAccountId(profile);
    if (externalAccountId) {
      return externalAccountId;
    }
  }

  throw new Error(MISSING_EXTERNAL_ACCOUNT_ID_ERROR);
};

const exchangeCredentials = async (
  request: ProviderAuthExchangeRequest,
  runtime: ProviderRuntimeContext,
): Promise<ProviderCredentialBundle> => {
  const env = resolveEnv(runtime);
  const requestedScopes =
    Array.isArray(request.scopes) && request.scopes.length > 0
      ? request.scopes
      : [...LINKEDIN_DEFAULT_SCOPES];

  const response = await runtime.httpClient(env.oauthTokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: request.code,
      redirect_uri: request.redirectUri,
      client_id: env.clientId,
      client_secret: env.clientSecret,
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

  const externalAccountId =
    isRecord(payload) && readExternalAccountId(payload)
      ? readExternalAccountId(payload)
      : await loadExternalAccountId(payload.access_token, runtime);

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    expiresAt,
    scopes: resolveGrantedScopes(requestedScopes, parseScopeList(payload.scope)),
    externalAccountId,
  };
};

export const auth: ProviderAuthFacet = {
  buildAuthRequest: async (request, runtime) => {
    const env = resolveEnv(runtime);
    const requestedScopes =
      Array.isArray(request.scopes) && request.scopes.length > 0
        ? request.scopes
        : [...LINKEDIN_DEFAULT_SCOPES];
    const authUrl = new URL(env.oauthAuthUrl);
    authUrl.searchParams.set("client_id", env.clientId);
    authUrl.searchParams.set("redirect_uri", request.redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", unique(requestedScopes).join(" "));
    authUrl.searchParams.set("state", request.state);
    if (request.namespace && env.isLocalAuthUrl) {
      authUrl.searchParams.set("namespace", request.namespace);
    }

    return {
      oauth_start_url: authUrl.toString(),
      scopes: requestedScopes,
    };
  },
  exchangeCredentials,
};
