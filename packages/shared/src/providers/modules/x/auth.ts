import { getProviderDefaultScopes } from "../../../provider-default-scopes.js";
import type {
  ProviderAuthExchangeRequest,
  ProviderCredentialBundle,
  ProviderRuntimeContext,
} from "../../../providers.js";
import type { ProviderAuthFacet } from "../../registry/types.js";

const DEFAULT_FAKE_EXTERNAL_BASE_URL = "http://127.0.0.1:9901";
const X_DEFAULT_AUTH_PATH = "/x/oauth/authorize";
const X_DEFAULT_TOKEN_PATH = "/x/oauth/token";
const X_DEFAULT_API_PATH = "/x/v1";
const X_DEFAULT_CLIENT_ID = "fake-x-client-id";
const X_DEFAULT_CLIENT_SECRET = "fake-x-client-secret";
const X_DEFAULT_SCOPES = getProviderDefaultScopes("x");

const X_PROVIDER_SCOPE_MAP: Record<string, string[]> = {
  "x.read": [
    "tweet.read",
    "users.read",
    "follows.read",
    "like.read",
    "bookmark.read",
    "dm.read",
    "list.read",
    "block.read",
    "mute.read",
    "offline.access",
  ],
  "x.write": [
    "tweet.read",
    "users.read",
    "tweet.write",
    "follows.write",
    "like.write",
    "bookmark.write",
    "dm.write",
    "list.write",
    "block.write",
    "mute.write",
    "offline.access",
  ],
};

type OAuthResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
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

const unique = (values: string[]): string[] => {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
};

const expandProviderScopes = (requestedScopes: string[]): string[] => {
  return unique(
    requestedScopes.flatMap((scope) => {
      return X_PROVIDER_SCOPE_MAP[scope] ?? [scope];
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
    const requiredScopes = X_PROVIDER_SCOPE_MAP[scope];
    if (!requiredScopes || requiredScopes.length === 0) {
      return grantedScopeSet.has(scope);
    }
    return requiredScopes.every((requiredScope) => grantedScopeSet.has(requiredScope));
  });
};

const resolveEnv = (runtime: ProviderRuntimeContext) => {
  const fakeBase = runtime.secrets.KEPPO_FAKE_EXTERNAL_BASE_URL ?? DEFAULT_FAKE_EXTERNAL_BASE_URL;
  return {
    oauthAuthUrl: runtime.secrets.X_OAUTH_AUTH_URL ?? `${fakeBase}${X_DEFAULT_AUTH_PATH}`,
    oauthTokenUrl: runtime.secrets.X_OAUTH_TOKEN_URL ?? `${fakeBase}${X_DEFAULT_TOKEN_PATH}`,
    apiBaseUrl: runtime.secrets.X_API_BASE_URL ?? `${fakeBase}${X_DEFAULT_API_PATH}`,
    clientId: runtime.secrets.X_CLIENT_ID ?? X_DEFAULT_CLIENT_ID,
    clientSecret: runtime.secrets.X_CLIENT_SECRET ?? X_DEFAULT_CLIENT_SECRET,
  };
};

const loadExternalAccountId = async (
  accessToken: string,
  runtime: ProviderRuntimeContext,
): Promise<string | null> => {
  const { apiBaseUrl } = resolveEnv(runtime);
  for (const profilePath of ["/users/me", "/2/users/me", "/profile"]) {
    const response = await runtime.httpClient(`${apiBaseUrl}${profilePath}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!response.ok) {
      continue;
    }

    const profile = (await response.json()) as Record<string, unknown>;
    const me =
      profile.data && typeof profile.data === "object" && !Array.isArray(profile.data)
        ? (profile.data as Record<string, unknown>)
        : profile;
    const id = me.id;
    if (typeof id === "string" && id.trim().length > 0) {
      return id;
    }
    const username = me.username;
    if (typeof username === "string" && username.trim().length > 0) {
      return username;
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
    Array.isArray(request.scopes) && request.scopes.length > 0 ? request.scopes : X_DEFAULT_SCOPES;
  const response = await runtime.httpClient(env.oauthTokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${encodeBasicAuth(env.clientId, env.clientSecret)}`,
      "Content-Type": "application/x-www-form-urlencoded",
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
        : [...X_DEFAULT_SCOPES];
    const providerScopes = expandProviderScopes(requestedScopes);
    const authUrl = new URL(env.oauthAuthUrl);
    authUrl.searchParams.set("client_id", env.clientId);
    authUrl.searchParams.set("redirect_uri", request.redirectUri);
    authUrl.searchParams.set("response_type", "code");
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
