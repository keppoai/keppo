import { describe, expect, it, vi } from "vitest";
import type { OAuthStateDecodeResult } from "../../app/lib/server/api-runtime/app-helpers.ts";
import {
  dispatchStartOwnedOAuthApiRequest,
  handleOAuthProviderCallbackRequest,
  handleOAuthProviderConnectRequest,
} from "../../app/lib/server/oauth-api";

const createDeps = (provider: "google" | "reddit" | "x" = "google") => {
  const storedPkceCodeVerifier = provider === "x" ? "pkce_verifier_test" : null;
  const buildAuthRequest = vi.fn().mockResolvedValue({
    oauth_start_url: `https://auth.test/oauth/start?provider=${provider}`,
  });
  const exchangeCredentials = vi.fn().mockResolvedValue({
    accessToken: "access_token_test",
    refreshToken: "refresh_token_test",
    expiresAt: "2026-03-14T00:00:00.000Z",
    externalAccountId: `${provider}_account_test`,
    scopes: ["scope:read"],
  });
  const signOAuthStatePayload = vi.fn((payload: string) => `signed:${payload}`);
  const verifyAndDecodeOAuthStatePayload = vi.fn(
    (value: string | null | undefined): OAuthStateDecodeResult => {
      if (!value?.startsWith("signed:")) {
        return { ok: false, reason: "missing_state" };
      }
      return {
        ok: true,
        payloadRaw: value.slice("signed:".length),
      };
    },
  );

  return {
    buildAuthRequest,
    exchangeCredentials,
    convex: {
      claimApiDedupeKey: vi.fn().mockResolvedValue({
        claimed: true,
        status: "pending",
        payload: null,
        expiresAtMs: Date.now() + 60_000,
      }),
      completeApiDedupeKey: vi.fn().mockResolvedValue(true),
      deleteManagedOAuthConnectState: vi.fn().mockResolvedValue(undefined),
      getFeatureFlag: vi.fn().mockResolvedValue(true),
      getApiDedupeKey: vi.fn().mockResolvedValue(null),
      getManagedOAuthConnectState: vi.fn().mockResolvedValue(
        storedPkceCodeVerifier === null
          ? null
          : {
              provider,
              correlationId: "corr_x_test",
              createdAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
              pkceCodeVerifier: storedPkceCodeVerifier,
            },
      ),
      recordProviderMetric: vi.fn().mockResolvedValue(undefined),
      releaseApiDedupeKey: vi.fn().mockResolvedValue(true),
      resolveApiSessionFromToken: vi.fn().mockResolvedValue({
        userId: "user_test",
        orgId: "org_test",
        role: "owner",
      }),
      setApiDedupePayload: vi.fn().mockResolvedValue(true),
      upsertManagedOAuthConnectState: vi.fn().mockResolvedValue(undefined),
      upsertOAuthProviderForOrg: vi.fn().mockResolvedValue(undefined),
    },
    getE2ENamespace: (value: string | undefined) => value?.trim() || null,
    getProviderModule: vi.fn().mockReturnValue({
      metadata: {
        oauth: {
          defaultScopes: ["scope:read"],
          ...(provider === "x" ? { requiresPkce: true } : {}),
        },
      },
      facets: {
        auth: {
          buildAuthRequest,
          exchangeCredentials,
        },
      },
    }),
    getRedirectUri: vi
      .fn()
      .mockReturnValue(`http://127.0.0.1/oauth/integrations/${provider}/callback`),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    parseJsonPayload: (raw: string) => JSON.parse(raw),
    readBetterAuthSessionToken: (cookieHeader: string | undefined) =>
      cookieHeader?.includes("session_token") ? "session_token_test" : null,
    safeReturnToPath: (value: string | null | undefined) => {
      if (!value || !value.startsWith("/") || value.startsWith("//")) {
        return "/";
      }
      return value;
    },
    signOAuthStatePayload,
    toProviderRuntimeContext: vi.fn().mockReturnValue({}) as never,
    trackAnalyticsEvent: vi.fn(),
    verifyAndDecodeOAuthStatePayload,
  };
};

const withJson = (path: string, body: unknown, headers?: HeadersInit): Request =>
  new Request(`http://127.0.0.1${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });

const withGet = (path: string, headers?: HeadersInit): Request =>
  new Request(`http://127.0.0.1${path}`, {
    method: "GET",
    ...(headers ? { headers } : {}),
  });

describe("start-owned oauth api handlers", () => {
  it("requires authentication for OAuth connect", async () => {
    const deps = createDeps();

    const response = await handleOAuthProviderConnectRequest(
      withJson("/api/oauth/integrations/google/connect", {
        org_id: "org_test",
        return_to: "/integrations",
      }),
      deps,
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "unauthorized",
        message: "Authentication required.",
        provider: "google",
      },
    });
  });

  it("builds a Start-owned OAuth connect response with a normalized return path", async () => {
    const deps = createDeps();

    const response = await handleOAuthProviderConnectRequest(
      withJson(
        "/api/oauth/integrations/google/connect",
        {
          org_id: "org_test",
          return_to: "https://evil.example/escape",
        },
        {
          cookie: "better-auth.session_token=session_token_test",
          "x-keppo-e2e-namespace": "oauth-connect",
        },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "requires_oauth",
      oauth_start_url: "https://auth.test/oauth/start?provider=google",
      provider: "google",
    });
    expect(deps.getRedirectUri).toHaveBeenCalledWith(
      "http://127.0.0.1/api/oauth/integrations/google/connect",
      "google",
    );
    expect(deps.signOAuthStatePayload).toHaveBeenCalledTimes(1);
    expect(JSON.parse(deps.signOAuthStatePayload.mock.calls[0]?.[0] ?? "{}")).toMatchObject({
      org_id: "org_test",
      provider: "google",
      return_to: "/",
      scopes: ["scope:read"],
      e2e_namespace: "oauth-connect",
    });
    expect(deps.buildAuthRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        redirectUri: "http://127.0.0.1/oauth/integrations/google/callback",
        scopes: ["scope:read"],
      }),
      {},
    );
    expect(deps.convex.recordProviderMetric).toHaveBeenCalledWith(
      expect.objectContaining({
        metric: "oauth_connect",
        orgId: "system",
        provider: "google",
      }),
    );
    expect(deps.convex.recordProviderMetric).toHaveBeenCalledWith(
      expect.objectContaining({
        metric: "oauth_connect",
        orgId: "org_test",
        provider: "google",
        outcome: "success",
      }),
    );
  });

  it("dispatches only matching Start-owned OAuth connect routes", async () => {
    const deps = createDeps();

    const handled = await dispatchStartOwnedOAuthApiRequest(
      withJson(
        "/api/oauth/integrations/google/connect",
        {
          org_id: "org_test",
          return_to: "/integrations",
        },
        {
          cookie: "better-auth.session_token=session_token_test",
        },
      ),
      deps,
    );
    const unhandled = await dispatchStartOwnedOAuthApiRequest(
      withJson("/api/oauth/integrations/google/callback", {
        code: "oauth_code_test",
      }),
      deps,
    );

    expect(handled?.status).toBe(200);
    expect(unhandled).toBeNull();
  });

  it("stores X PKCE verifier server-side instead of embedding it in OAuth state", async () => {
    const deps = createDeps("x");

    const response = await handleOAuthProviderConnectRequest(
      withJson(
        "/api/oauth/integrations/x/connect",
        {
          org_id: "org_test",
          return_to: "/integrations",
        },
        {
          cookie: "better-auth.session_token=session_token_test",
          "x-keppo-e2e-namespace": "oauth-x",
        },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.signOAuthStatePayload).toHaveBeenCalledTimes(1);
    expect(JSON.parse(deps.signOAuthStatePayload.mock.calls[0]?.[0] ?? "{}")).not.toHaveProperty(
      "pkce_code_verifier",
    );
    expect(deps.convex.upsertManagedOAuthConnectState).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org_test",
        provider: "x",
        pkceCodeVerifier: expect.any(String),
      }),
    );
    expect(deps.buildAuthRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        pkceCodeVerifier: expect.any(String),
      }),
      {},
    );
  });

  it("completes OAuth callback natively in Start and redirects back into the app", async () => {
    const deps = createDeps();
    const signedState = `signed:${JSON.stringify({
      org_id: "org_test",
      provider: "google",
      return_to: "/integrations",
      scopes: ["scope:read"],
      display_name: "Google",
      correlation_id: "corr_test",
      created_at: new Date().toISOString(),
      e2e_namespace: "oauth-callback",
    })}`;

    const response = await handleOAuthProviderCallbackRequest(
      withGet(
        `/oauth/integrations/google/callback?code=oauth_code_test&state=${encodeURIComponent(signedState)}`,
      ),
      deps,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1/integrations?integration_connected=google",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(deps.exchangeCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "oauth_code_test",
        redirectUri: "http://127.0.0.1/oauth/integrations/google/callback",
        externalAccountFallback: "org_test",
      }),
      {},
    );
    expect(deps.convex.upsertOAuthProviderForOrg).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org_test",
        provider: "google",
        displayName: "Google",
        externalAccountId: "google_account_test",
      }),
    );
  });

  it("loads the X PKCE verifier from server-side state during callback", async () => {
    const deps = createDeps("x");
    const signedState = `signed:${JSON.stringify({
      org_id: "org_test",
      provider: "x",
      return_to: "/integrations",
      scopes: ["scope:read"],
      display_name: "X",
      correlation_id: "corr_x_test",
      created_at: new Date().toISOString(),
      e2e_namespace: "oauth-x",
    })}`;

    const response = await handleOAuthProviderCallbackRequest(
      withGet(
        `/oauth/integrations/x/callback?code=oauth_code_test&state=${encodeURIComponent(signedState)}`,
      ),
      deps,
    );

    expect(response.status).toBe(302);
    expect(deps.convex.getManagedOAuthConnectState).toHaveBeenCalledWith({
      orgId: "org_test",
      provider: "x",
      correlationId: "corr_x_test",
    });
    expect(deps.exchangeCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        pkceCodeVerifier: "pkce_verifier_test",
      }),
      {},
    );
    expect(deps.convex.deleteManagedOAuthConnectState).toHaveBeenCalledWith({
      orgId: "org_test",
      provider: "x",
      correlationId: "corr_x_test",
    });
  });

  it("fails closed when a PKCE-required callback cannot load server-side verifier state", async () => {
    const deps = createDeps("x");
    deps.convex.getManagedOAuthConnectState = vi.fn().mockResolvedValue(null);
    const signedState = `signed:${JSON.stringify({
      org_id: "org_test",
      provider: "x",
      return_to: "/integrations",
      scopes: ["scope:read"],
      display_name: "X",
      correlation_id: "corr_x_test",
      created_at: new Date().toISOString(),
      e2e_namespace: "oauth-x",
    })}`;

    const response = await handleOAuthProviderCallbackRequest(
      withGet(
        `/oauth/integrations/x/callback?code=oauth_code_test&state=${encodeURIComponent(signedState)}`,
      ),
      deps,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "invalid_state",
        message: "Missing OAuth PKCE verifier; restart the connection flow.",
        provider: "x",
      },
    });
    expect(deps.exchangeCredentials).not.toHaveBeenCalled();
  });

  it("supports Reddit as a managed OAuth provider in Start-owned routes", async () => {
    const deps = createDeps("reddit");
    const connectResponse = await handleOAuthProviderConnectRequest(
      withJson(
        "/api/oauth/integrations/reddit/connect",
        {
          org_id: "org_test",
          return_to: "/integrations",
        },
        {
          cookie: "better-auth.session_token=session_token_test",
          "x-keppo-e2e-namespace": "oauth-reddit",
        },
      ),
      deps,
    );

    expect(connectResponse.status).toBe(200);
    await expect(connectResponse.json()).resolves.toMatchObject({
      status: "requires_oauth",
      oauth_start_url: "https://auth.test/oauth/start?provider=reddit",
      provider: "reddit",
    });
    expect(deps.getRedirectUri).toHaveBeenCalledWith(
      "http://127.0.0.1/api/oauth/integrations/reddit/connect",
      "reddit",
    );

    const signedState = `signed:${JSON.stringify({
      org_id: "org_test",
      provider: "reddit",
      return_to: "/integrations",
      scopes: ["scope:read"],
      display_name: "Reddit",
      correlation_id: "corr_reddit_test",
      created_at: new Date().toISOString(),
      e2e_namespace: "oauth-reddit",
    })}`;

    const callbackResponse = await handleOAuthProviderCallbackRequest(
      withGet(
        `/oauth/integrations/reddit/callback?code=oauth_code_test&state=${encodeURIComponent(signedState)}`,
      ),
      deps,
    );

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.get("location")).toBe(
      "http://127.0.0.1/integrations?integration_connected=reddit",
    );
    expect(deps.exchangeCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "oauth_code_test",
        redirectUri: "http://127.0.0.1/oauth/integrations/reddit/callback",
        externalAccountFallback: "org_test",
      }),
      {},
    );
    expect(deps.convex.upsertOAuthProviderForOrg).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org_test",
        provider: "reddit",
        displayName: "Reddit",
        externalAccountId: "reddit_account_test",
      }),
    );
  });
});
