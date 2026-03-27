import { getProviderDefaultScopes } from "../../../provider-default-scopes.js";
import type {
  ProviderAuthExchangeRequest,
  ProviderCredentialBundle,
  ProviderRuntimeContext,
} from "../../../providers.js";
import type { ProviderAuthFacet } from "../../registry/types.js";

const REDDIT_DEFAULT_AUTH_URL = "https://www.reddit.com/api/v1/authorize";
const REDDIT_DEFAULT_TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const REDDIT_DEFAULT_API_BASE_URL = "https://oauth.reddit.com";
const REDDIT_DEFAULT_CLIENT_ID = "fake-reddit-client-id";
const REDDIT_DEFAULT_CLIENT_SECRET = "fake-reddit-client-secret";
const REDDIT_DEFAULT_SCOPES = getProviderDefaultScopes("reddit");
const REDDIT_USER_AGENT = "Keppo/1.0";

const REDDIT_PROVIDER_SCOPE_MAP: Record<string, string[]> = {
  "reddit.read": [
    "identity",
    "read",
    "history",
    "mysubreddits",
    "privatemessages",
    "modconfig",
    "modcontributors",
    "modflair",
    "modlog",
    "modmail",
    "modothers",
    "modposts",
    "modself",
    "modwiki",
    "wikiread",
  ],
  "reddit.write": [
    "edit",
    "flair",
    "identity",
    "modconfig",
    "modcontributors",
    "modflair",
    "modlog",
    "modmail",
    "modothers",
    "modposts",
    "modself",
    "modwiki",
    "privatemessages",
    "report",
    "save",
    "submit",
    "subscribe",
    "vote",
    "wikiedit",
  ],
};

type OAuthResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};

const unique = (values: string[]): string[] => {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
};

const expandProviderScopes = (requestedScopes: string[]): string[] => {
  return unique(
    requestedScopes.flatMap((scope) => {
      return REDDIT_PROVIDER_SCOPE_MAP[scope] ?? [scope];
    }),
  );
};

const parseScopeList = (scope: string | undefined): string[] => {
  if (!scope) {
    return [];
  }
  return unique(scope.split(" "));
};

const resolveGrantedCanonicalScopes = (
  requestedScopes: string[],
  grantedProviderScopes: string[],
): string[] => {
  if (grantedProviderScopes.length === 0) {
    return [...requestedScopes];
  }

  const grantedScopeSet = new Set(grantedProviderScopes);
  return requestedScopes.filter((scope) => {
    const requiredScopes = REDDIT_PROVIDER_SCOPE_MAP[scope];
    if (!requiredScopes || requiredScopes.length === 0) {
      return grantedScopeSet.has(scope);
    }
    return requiredScopes.every((requiredScope) => grantedScopeSet.has(requiredScope));
  });
};

const resolveEnv = (runtime: ProviderRuntimeContext) => {
  return {
    oauthAuthUrl: runtime.secrets.REDDIT_OAUTH_AUTH_URL ?? REDDIT_DEFAULT_AUTH_URL,
    oauthTokenUrl: runtime.secrets.REDDIT_OAUTH_TOKEN_URL ?? REDDIT_DEFAULT_TOKEN_URL,
    apiBaseUrl: runtime.secrets.REDDIT_API_BASE_URL ?? REDDIT_DEFAULT_API_BASE_URL,
    clientId: runtime.secrets.REDDIT_CLIENT_ID ?? REDDIT_DEFAULT_CLIENT_ID,
    clientSecret: runtime.secrets.REDDIT_CLIENT_SECRET ?? REDDIT_DEFAULT_CLIENT_SECRET,
  };
};

const loadExternalAccountId = async (
  accessToken: string,
  runtime: ProviderRuntimeContext,
): Promise<string | null> => {
  const { apiBaseUrl } = resolveEnv(runtime);
  for (const profilePath of ["/api/v1/me", "/profile"]) {
    const response = await runtime.httpClient(`${apiBaseUrl}${profilePath}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": REDDIT_USER_AGENT,
      },
    });
    if (!response.ok) {
      continue;
    }

    const profile = (await response.json()) as Record<string, unknown>;
    const name = profile.name;
    if (typeof name === "string" && name.trim().length > 0) {
      return name;
    }
    const id = profile.id;
    if (typeof id === "string" && id.trim().length > 0) {
      return id;
    }
    if (typeof id === "number" && Number.isFinite(id)) {
      return String(id);
    }
  }
  return null;
};

const exchangeCredentials = async (
  request: ProviderAuthExchangeRequest,
  runtime: ProviderRuntimeContext,
): Promise<ProviderCredentialBundle> => {
  const env = resolveEnv(runtime);
  const requestedScopes =
    Array.isArray(request.scopes) && request.scopes.length > 0
      ? request.scopes
      : [...REDDIT_DEFAULT_SCOPES];
  const response = await runtime.httpClient(env.oauthTokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${encodeBasicAuth(env.clientId, env.clientSecret)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": REDDIT_USER_AGENT,
    },
    body: new URLSearchParams({
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
  const grantedCanonicalScopes = resolveGrantedCanonicalScopes(
    requestedScopes,
    parseScopeList(payload.scope),
  );
  const externalAccountId =
    (await loadExternalAccountId(payload.access_token, runtime)) ??
    request.externalAccountFallback ??
    null;

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    expiresAt,
    scopes: grantedCanonicalScopes,
    externalAccountId,
  };
};

export const auth: ProviderAuthFacet = {
  buildAuthRequest: async (request, runtime) => {
    const env = resolveEnv(runtime);
    const requestedScopes =
      Array.isArray(request.scopes) && request.scopes.length > 0
        ? request.scopes
        : [...REDDIT_DEFAULT_SCOPES];
    const providerScopes = expandProviderScopes(requestedScopes);
    const authUrl = new URL(env.oauthAuthUrl);
    authUrl.searchParams.set("client_id", env.clientId);
    authUrl.searchParams.set("redirect_uri", request.redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("duration", "permanent");
    authUrl.searchParams.set("scope", providerScopes.join(" "));
    authUrl.searchParams.set("state", request.state);
    if (request.namespace) {
      authUrl.searchParams.set("namespace", request.namespace);
    }

    return {
      oauth_start_url: authUrl.toString(),
      scopes: requestedScopes,
    };
  },
  exchangeCredentials,
};
const encodeBasicAuth = (clientId: string, clientSecret: string): string => {
  const source = `${clientId}:${clientSecret}`;
  if (typeof btoa === "function") {
    return btoa(source);
  }
  let binary = "";
  for (const byte of new TextEncoder().encode(source)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};
