import { describe, expect, it } from "vitest";
import { allTools } from "./tooling.js";
import { MANAGED_OAUTH_PROVIDER_IDS } from "./providers/boundaries/common.js";
import { isWebhookProviderId } from "./provider-facet-loader.js";
import {
  CANONICAL_PROVIDER_IDS,
  providerRegistry,
  resolveProvider,
  type CanonicalProviderId,
  type ProviderRuntimeContext,
} from "./providers.js";

const runtimeContext = (params?: {
  httpClient?: ProviderRuntimeContext["httpClient"];
  now?: number;
  secrets?: Record<string, string | undefined>;
}): ProviderRuntimeContext => ({
  httpClient:
    params?.httpClient ??
    (async () => {
      throw new Error("Missing test httpClient");
    }),
  clock: {
    now: () => params?.now ?? 1_700_000_000_000,
    nowIso: () => new Date(params?.now ?? 1_700_000_000_000).toISOString(),
  },
  idGenerator: {
    randomId: (prefix) => `${prefix}_test`,
  },
  logger: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  },
  secrets: {
    KEPPO_FAKE_EXTERNAL_BASE_URL: "http://127.0.0.1:9911",
    ...params?.secrets,
  },
  featureFlags: {},
});

describe("provider registry", () => {
  it("resolves canonical providers", () => {
    const resolved = resolveProvider("google");
    expect(resolved.providerId).toBe("google");
    expect(resolved.usedAlias).toBe(false);
  });

  it("rejects non-canonical aliases", () => {
    expect(() => resolveProvider("gmail")).toThrow(/Non-canonical provider id/i);
    expect(() => resolveProvider("gmail", { allowAliases: false })).toThrow(
      /Non-canonical provider id/i,
    );
  });

  it("registers one module for every canonical provider", () => {
    const registered = providerRegistry
      .listProviders()
      .map((module) => module.metadata.providerId)
      .sort();
    const canonical = [...CANONICAL_PROVIDER_IDS].sort();
    expect(registered).toEqual(canonical);
  });

  it("assigns every non-internal tool to exactly one provider module", () => {
    const expectedTools = allTools
      .filter((tool) => tool.provider !== "keppo")
      .map((tool) => tool.name)
      .sort();

    const actualTools = providerRegistry
      .listProviders()
      .flatMap((module) => providerRegistry.getProviderTools(module.metadata.providerId))
      .map((tool) => tool.name)
      .sort();

    expect(actualTools).toEqual(expectedTools);
  });

  it("enforces declared capabilities", () => {
    const webhookProviders = providerRegistry
      .listProviders({ capability: "webhook" })
      .map((module) => module.metadata.providerId);
    for (const providerId of webhookProviders) {
      expect(
        providerRegistry.assertProviderSupports(providerId, "webhook").metadata.providerId,
      ).toBe(providerId);
      expect(isWebhookProviderId(providerId)).toBe(true);
    }

    expect(() => providerRegistry.assertProviderSupports("google", "webhook")).toThrow(
      /does not support webhook/i,
    );

    expect(
      providerRegistry.assertProviderSupports("google", "automation_triggers").metadata.providerId,
    ).toBe("google");
    expect(() => providerRegistry.assertProviderSupports("github", "automation_triggers")).toThrow(
      /does not support automation triggers/i,
    );
  });

  it("treats every managed OAuth module as boundary-valid", () => {
    const managedProviders = providerRegistry
      .listProviders()
      .filter((module) => module.metadata.auth.managed)
      .map((module) => module.metadata.providerId);

    expect([...MANAGED_OAUTH_PROVIDER_IDS].sort()).toEqual([...managedProviders].sort());
    expect(MANAGED_OAUTH_PROVIDER_IDS).toContain("slack");
    expect(MANAGED_OAUTH_PROVIDER_IDS).toContain("notion");
  });

  it("refreshCredentials uses injected runtime http client and clock", async () => {
    const refresh = providerRegistry.getProviderModule("google").hooks.refreshCredentials;
    expect(refresh).toBeDefined();
    const bundle = await refresh!(
      "refresh_legacy",
      runtimeContext({
        now: 1_700_000_000_000,
        httpClient: async (url, init) => {
          expect(url).toBe("http://127.0.0.1:9911/gmail/oauth/token");
          expect(init?.method).toBe("POST");
          return new Response(
            JSON.stringify({
              access_token: "access_rotated",
              refresh_token: "refresh_rotated",
              expires_in: 120,
              scope:
                "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        },
      }),
    );

    expect(bundle).toEqual({
      accessToken: "access_rotated",
      refreshToken: "refresh_rotated",
      expiresAt: new Date(1_700_000_000_000 + 120_000).toISOString(),
      scopes: ["gmail.readonly", "gmail.send"],
      externalAccountId: null,
    });
  });

  it("refreshCredentials bubbles provider token endpoint failures", async () => {
    const refresh = providerRegistry.getProviderModule("stripe").hooks.refreshCredentials;
    await expect(
      refresh!(
        "refresh_missing",
        runtimeContext({
          httpClient: async () => new Response("invalid_refresh_token", { status: 401 }),
        }),
      ),
    ).rejects.toThrow(/invalid_refresh_token/i);
  });

  it("fails closed for managed OAuth providers when profile lookup returns no account id", async () => {
    const exchange = providerRegistry.getProviderModule("google").hooks.exchangeCredentials;

    await expect(
      exchange(
        {
          code: "oauth_code_test",
          redirectUri: "http://127.0.0.1/oauth/integrations/google/callback",
        },
        runtimeContext({
          httpClient: async (url, init) => {
            if (url === "http://127.0.0.1:9911/gmail/oauth/token") {
              expect(init?.method).toBe("POST");
              return new Response(
                JSON.stringify({
                  access_token: "access_token_test",
                  expires_in: 120,
                }),
                { status: 200, headers: { "content-type": "application/json" } },
              );
            }
            if (url === "http://127.0.0.1:9911/gmail/api/users/me/profile") {
              return new Response(JSON.stringify({}), {
                status: 200,
                headers: { "content-type": "application/json" },
              });
            }
            throw new Error(`Unexpected URL: ${url}`);
          },
        }),
      ),
    ).rejects.toThrow(/did not return a provider account identifier/i);
  });

  it("fails closed for X OAuth when profile lookup returns no account id", async () => {
    const exchange = providerRegistry.getProviderModule("x").hooks.exchangeCredentials;

    await expect(
      exchange(
        {
          code: "oauth_code_test",
          redirectUri: "http://127.0.0.1/oauth/integrations/x/callback",
          pkceCodeVerifier: "pkce_verifier_test",
        },
        runtimeContext({
          httpClient: async (url, init) => {
            if (url === "http://127.0.0.1:9911/x/oauth/token") {
              expect(init?.method).toBe("POST");
              return new Response(
                JSON.stringify({
                  access_token: "access_token_test",
                  expires_in: 120,
                }),
                { status: 200, headers: { "content-type": "application/json" } },
              );
            }
            if (url === "http://127.0.0.1:9911/x/v1/users/me") {
              return new Response("{}", {
                status: 200,
                headers: { "content-type": "application/json" },
              });
            }
            if (url === "http://127.0.0.1:9911/x/v1/2/users/me") {
              return new Response("{}", {
                status: 200,
                headers: { "content-type": "application/json" },
              });
            }
            if (url === "http://127.0.0.1:9911/x/v1/profile") {
              return new Response("{}", {
                status: 200,
                headers: { "content-type": "application/json" },
              });
            }
            throw new Error(`Unexpected URL: ${url}`);
          },
        }),
      ),
    ).rejects.toThrow(/did not return a provider account identifier/i);
  });

  it("fails closed for Reddit OAuth when profile lookup returns no account id", async () => {
    const exchange = providerRegistry.getProviderModule("reddit").hooks.exchangeCredentials;

    await expect(
      exchange(
        {
          code: "oauth_code_test",
          redirectUri: "http://127.0.0.1/oauth/integrations/reddit/callback",
        },
        runtimeContext({
          httpClient: async (url, init) => {
            if (url === "https://www.reddit.com/api/v1/access_token") {
              expect(init?.method).toBe("POST");
              return new Response(
                JSON.stringify({
                  access_token: "access_token_test",
                  expires_in: 120,
                }),
                { status: 200, headers: { "content-type": "application/json" } },
              );
            }
            if (url === "https://oauth.reddit.com/api/v1/me") {
              return new Response("{}", {
                status: 200,
                headers: { "content-type": "application/json" },
              });
            }
            if (url === "https://oauth.reddit.com/profile") {
              return new Response("{}", {
                status: 200,
                headers: { "content-type": "application/json" },
              });
            }
            throw new Error(`Unexpected URL: ${url}`);
          },
        }),
      ),
    ).rejects.toThrow(/did not return a provider account identifier/i);
  });
});
