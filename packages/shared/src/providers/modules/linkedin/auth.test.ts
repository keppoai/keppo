import { describe, expect, it, vi } from "vitest";
import { auth } from "./auth.js";

const createRuntime = (httpClient = vi.fn(), overrides?: Record<string, string | undefined>) => ({
  httpClient,
  clock: {
    now: () => 1_700_000_000_000,
    nowIso: () => new Date(1_700_000_000_000).toISOString(),
  },
  idGenerator: {
    randomId: (prefix: string) => `${prefix}_test`,
  },
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  secrets: {
    KEPPO_FAKE_EXTERNAL_BASE_URL: "http://127.0.0.1:9901",
    LINKEDIN_CLIENT_ID: "linkedin_client_test",
    LINKEDIN_CLIENT_SECRET: "linkedin_secret_test",
    ...overrides,
  },
  featureFlags: {},
});

describe("linkedin auth facet", () => {
  it("fails closed when non-local LinkedIn OAuth credentials are missing", async () => {
    await expect(
      auth.buildAuthRequest(
        {
          redirectUri: "http://127.0.0.1/oauth/integrations/linkedin/callback",
          state: "signed_state",
          scopes: ["openid"],
        },
        createRuntime(vi.fn(), {
          LINKEDIN_CLIENT_ID: undefined,
          LINKEDIN_CLIENT_SECRET: undefined,
        }),
      ),
    ).rejects.toThrow(/provider_misconfigured/i);
  });

  it("allows fake credentials for explicit local LinkedIn endpoints", async () => {
    const result = await auth.buildAuthRequest(
      {
        redirectUri: "http://127.0.0.1/oauth/integrations/linkedin/callback",
        state: "signed_state",
        scopes: ["openid"],
        namespace: "linkedin-e2e",
      },
      createRuntime(vi.fn(), {
        LINKEDIN_CLIENT_ID: undefined,
        LINKEDIN_CLIENT_SECRET: undefined,
        LINKEDIN_OAUTH_AUTH_URL: "http://127.0.0.1:9901/linkedin/oauth/authorize",
        LINKEDIN_OAUTH_TOKEN_URL: "http://127.0.0.1:9901/linkedin/oauth/token",
        LINKEDIN_API_BASE_URL: "http://127.0.0.1:9901/linkedin/v1",
      }),
    );

    const authUrl = new URL(String(result.oauth_start_url));
    expect(authUrl.searchParams.get("client_id")).toBe("fake-linkedin-client-id");
    expect(authUrl.searchParams.get("namespace")).toBe("linkedin-e2e");
  });

  it("sanitizes token exchange failures", async () => {
    const httpClient = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          error: "invalid_client",
          error_description: "client authentication failed",
          request_id: "req_123",
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      );
    });

    await expect(
      auth.exchangeCredentials(
        {
          code: "oauth_code",
          redirectUri: "http://127.0.0.1/oauth/integrations/linkedin/callback",
          scopes: ["openid", "profile", "email"],
        },
        createRuntime(httpClient),
      ),
    ).rejects.toThrow(
      /oauth_token_exchange_failed: LinkedIn token exchange failed \(invalid_client: client authentication failed\)\./i,
    );
  });

  it("treats omitted provider scopes as least privilege", async () => {
    const httpClient = vi.fn(async (url: string) => {
      if (url === "https://www.linkedin.com/oauth/v2/accessToken") {
        return new Response(
          JSON.stringify({
            access_token: "linkedin_access_token",
            expires_in: 120,
            sub: "member_123",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const bundle = await auth.exchangeCredentials(
      {
        code: "oauth_code",
        redirectUri: "http://127.0.0.1/oauth/integrations/linkedin/callback",
        scopes: ["openid", "profile", "email"],
      },
      createRuntime(httpClient),
    );

    expect(bundle.scopes).toEqual([]);
  });

  it("continues profile probing after non-JSON 2xx responses", async () => {
    const httpClient = vi.fn(async (url: string) => {
      if (url === "https://www.linkedin.com/oauth/v2/accessToken") {
        return new Response(
          JSON.stringify({
            access_token: "linkedin_access_token",
            expires_in: 120,
            scope: "w_member_social",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url === "https://api.linkedin.com/v2/userinfo") {
        return new Response("<html>ok</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
      if (url === "https://api.linkedin.com/v2/me") {
        return new Response(JSON.stringify({ id: "member_123" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const bundle = await auth.exchangeCredentials(
      {
        code: "oauth_code",
        redirectUri: "http://127.0.0.1/oauth/integrations/linkedin/callback",
        scopes: ["w_member_social"],
      },
      createRuntime(httpClient),
    );

    expect(bundle.externalAccountId).toBe("member_123");
    expect(bundle.scopes).toEqual(["w_member_social"]);
  });
});
