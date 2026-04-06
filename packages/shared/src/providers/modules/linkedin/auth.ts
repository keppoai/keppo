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
const PROFILE_LOOKUP_TIMEOUT_MS = 5_000;

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

const isLocalUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return /^(localhost|127\.0\.0\.1)$/i.test(url.hostname);
  } catch {
    return false;
  }
};

const withTimeoutSignal = (timeoutMs: number): { signal: AbortSignal; cleanup: () => void } => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeout),
  };
};

const readOAuthErrorSuffix = (body: string, status: number): string => {
  let suffix = `status ${status}`;
  const parsed = parseJsonRecord(body);
  const error = typeof parsed?.error === "string" ? parsed.error.trim() : "";
  const description =
    typeof parsed?.error_description === "string" ? parsed.error_description.trim() : "";
  if (error && description) {
    suffix = `${error}: ${description}`;
  } else if (error) {
    suffix = error;
  } else if (description) {
    suffix = description;
  }
  return suffix;
};

const parseScopeList = (scope: string | undefined): string[] => {
  if (!scope) {
    return [];
  }
  return unique(scope.split(" "));
};

const resolveGrantedScopes = (
  _requestedScopes: string[],
  grantedProviderScopes: string[],
): string[] => {
  if (grantedProviderScopes.length === 0) {
    return [];
  }
  return [...grantedProviderScopes];
};

const resolveEnv = (runtime: ProviderRuntimeContext) => {
  const oauthAuthUrl = runtime.secrets.LINKEDIN_OAUTH_AUTH_URL ?? LINKEDIN_DEFAULT_AUTH_URL;
  const oauthTokenUrl = runtime.secrets.LINKEDIN_OAUTH_TOKEN_URL ?? LINKEDIN_DEFAULT_TOKEN_URL;
  const apiBaseUrl = runtime.secrets.LINKEDIN_API_BASE_URL ?? LINKEDIN_DEFAULT_API_BASE_URL;
  const clientId = runtime.secrets.LINKEDIN_CLIENT_ID?.trim();
  const clientSecret = runtime.secrets.LINKEDIN_CLIENT_SECRET?.trim();
  const allowFakeCredentials =
    isLocalUrl(oauthAuthUrl) && isLocalUrl(oauthTokenUrl) && isLocalUrl(apiBaseUrl);

  if ((!clientId || !clientSecret) && !allowFakeCredentials) {
    throw new Error(
      "provider_misconfigured: LinkedIn OAuth client credentials are required for non-local OAuth endpoints.",
    );
  }

  return {
    oauthAuthUrl,
    oauthTokenUrl,
    apiBaseUrl,
    clientId: clientId || LINKEDIN_DEFAULT_CLIENT_ID,
    clientSecret: clientSecret || LINKEDIN_DEFAULT_CLIENT_SECRET,
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
    const { signal, cleanup } = withTimeoutSignal(PROFILE_LOOKUP_TIMEOUT_MS);
    let response: Response;
    try {
      response = await runtime.httpClient(`${apiBaseUrl}${profilePath}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "X-RestLi-Protocol-Version": "2.0.0",
        },
        signal,
      });
    } catch {
      cleanup();
      continue;
    }
    cleanup();

    if (response.status === 401) {
      throw new Error("invalid_token: LinkedIn profile lookup rejected the access token.");
    }
    if (response.status === 403 || response.status === 404) {
      continue;
    }
    if (!response.ok) {
      continue;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("json")) {
      continue;
    }

    let profile: Record<string, unknown>;
    try {
      profile = (await response.json()) as Record<string, unknown>;
    } catch {
      continue;
    }
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
    const suffix = readOAuthErrorSuffix(body, response.status);
    throw new Error(`oauth_token_exchange_failed: LinkedIn token exchange failed (${suffix}).`);
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

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
