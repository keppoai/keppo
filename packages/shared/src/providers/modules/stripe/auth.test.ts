import { describe, expect, it, vi } from "vitest";
import { auth } from "./auth.js";
import { refresh } from "./refresh.js";

const createRuntime = (httpClient = vi.fn(), overrides?: Record<string, string>) => ({
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
    STRIPE_CLIENT_ID: "stripe_client_test",
    STRIPE_SECRET_KEY: "stripe_secret_test",
    ...overrides,
  },
  featureFlags: {},
});

describe("stripe auth facet", () => {
  it("requests Stripe provider scopes instead of canonical app scopes", async () => {
    const request = {
      redirectUri: "http://127.0.0.1/oauth/integrations/stripe/callback",
      state: "signed_state",
      scopes: ["stripe.read", "stripe.write"],
      namespace: "e2e-stripe",
    };

    const result = await auth.buildAuthRequest(request, createRuntime());
    const authUrl = new URL(String(result.oauth_start_url));

    expect(authUrl.searchParams.get("scope")).toBe("read_write");
    expect(authUrl.searchParams.get("namespace")).toBe("e2e-stripe");
    expect(result.scopes).toEqual(["stripe.read", "stripe.write"]);
  });

  it("normalizes Stripe read_write grants back to canonical app scopes", async () => {
    const httpClient = vi.fn(async (url: string) => {
      if (url === "http://127.0.0.1:9901/stripe/oauth/token") {
        return new Response(
          JSON.stringify({
            access_token: "stripe_access_token",
            refresh_token: "stripe_refresh_token",
            expires_in: 120,
            scope: "read_write",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url === "http://127.0.0.1:9901/stripe/v1/profile") {
        return new Response(JSON.stringify({ id: "acct_123" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const bundle = await auth.exchangeCredentials(
      {
        code: "oauth_code",
        redirectUri: "http://127.0.0.1/oauth/integrations/stripe/callback",
        scopes: ["stripe.read", "stripe.write"],
      },
      createRuntime(httpClient),
    );

    expect(bundle).toEqual({
      accessToken: "stripe_access_token",
      refreshToken: "stripe_refresh_token",
      expiresAt: new Date(1_700_000_000_000 + 120_000).toISOString(),
      scopes: ["stripe.read", "stripe.write"],
      externalAccountId: "acct_123",
    });
  });

  it("normalizes Stripe refresh grants back to canonical app scopes", async () => {
    const httpClient = vi.fn(async (url: string) => {
      if (url === "http://127.0.0.1:9901/stripe/oauth/token") {
        return new Response(
          JSON.stringify({
            access_token: "stripe_access_token_rotated",
            refresh_token: "stripe_refresh_token_rotated",
            expires_in: 120,
            scope: "read_write",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const bundle = await refresh.refreshCredentials(
      "stripe_refresh_token",
      createRuntime(httpClient),
    );

    expect(bundle).toEqual({
      accessToken: "stripe_access_token_rotated",
      refreshToken: "stripe_refresh_token_rotated",
      expiresAt: new Date(1_700_000_000_000 + 120_000).toISOString(),
      scopes: ["stripe.read", "stripe.write"],
      externalAccountId: null,
    });
  });
});
