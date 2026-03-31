import { describe, expect, it, vi } from "vitest";
import { auth } from "./auth.js";

const createRuntime = (overrides?: Record<string, string>) => ({
  httpClient: vi.fn(),
  clock: {
    now: () => Date.now(),
    nowIso: () => new Date().toISOString(),
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
    X_CLIENT_ID: "client_test",
    X_CLIENT_SECRET: "secret_test",
    ...overrides,
  },
  featureFlags: {},
});

describe("x auth facet", () => {
  it("adds namespace only for the fake gateway authorize URL", async () => {
    const request = {
      redirectUri: "http://127.0.0.1/oauth/integrations/x/callback",
      state: "signed_state",
      scopes: ["x.read"],
      namespace: "e2e-x",
      pkceCodeVerifier: "pkce_verifier_test",
    };

    const fakeGateway = await auth.buildAuthRequest(request, createRuntime());
    const fakeGatewayUrl = new URL(String(fakeGateway.oauth_start_url));
    expect(fakeGatewayUrl.searchParams.get("namespace")).toBe("e2e-x");

    const realGateway = await auth.buildAuthRequest(
      request,
      createRuntime({
        X_OAUTH_AUTH_URL: "https://twitter.com/i/oauth2/authorize",
      }),
    );
    const realGatewayUrl = new URL(String(realGateway.oauth_start_url));
    expect(realGatewayUrl.searchParams.get("namespace")).toBeNull();
    expect(realGatewayUrl.searchParams.get("code_challenge")).toBeTruthy();
    expect(realGatewayUrl.searchParams.get("code_challenge_method")).toBe("S256");
  });
});
