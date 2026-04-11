import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { getEnv, parseApiEnv } from "./env.js";
import { resetApiRuntimeEnvForTest } from "./runtime-env.js";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const ORIGINAL_ENV = { ...process.env };

const restoreProcessEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value;
  }
};

const parseDotenv = (raw: string): NodeJS.ProcessEnv => {
  const output: NodeJS.ProcessEnv = {};
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const normalized = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const separator = normalized.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = normalized.slice(0, separator).trim();
    const value = normalized.slice(separator + 1).trim();
    output[key] = value;
  }
  return output;
};

afterEach(() => {
  restoreProcessEnv();
  resetApiRuntimeEnvForTest();
});

describe("api env schema", () => {
  it(".env.example satisfies required API env keys", () => {
    const examplePath = resolve(TEST_DIR, "../../../../../../", ".env.example");
    const parsed = parseDotenv(readFileSync(examplePath, "utf8"));
    expect(() =>
      parseApiEnv(parsed, {
        validateRequired: true,
        mode: "strict",
      }),
    ).not.toThrow();
  });

  it("derives API callback and notification defaults from core env values", () => {
    const env = parseApiEnv(
      {
        NODE_ENV: "production",
        CONVEX_URL: "https://example.convex.cloud",
        KEPPO_CONVEX_ADMIN_KEY: "convex-admin-key",
        KEPPO_MASTER_KEY: "master-key",
        KEPPO_URL: "https://dashboard.keppo.ai",
        STRIPE_SECRET_KEY: "stripe-secret",
        STRIPE_PROVIDER_WEBHOOK_SECRET: "stripe-provider-webhook-secret",
        STRIPE_BILLING_WEBHOOK_SECRET: "stripe-billing-webhook-secret",
        GOOGLE_CLIENT_ID: "google-client-id",
        GOOGLE_CLIENT_SECRET: "google-client-secret",
        STRIPE_CLIENT_ID: "stripe-client-id",
        GITHUB_CLIENT_ID: "github-client-id",
        GITHUB_CLIENT_SECRET: "github-client-secret",
        REDDIT_CLIENT_ID: "reddit-client-id",
        REDDIT_CLIENT_SECRET: "reddit-client-secret",
        OPENAI_API_KEY: "openai-api-key",
        KEPPO_OAUTH_STATE_SECRET: "oauth-state-secret",
        KEPPO_CALLBACK_HMAC_SECRET: "callback-hmac-secret",
        BETTER_AUTH_SECRET: "better-auth-secret-better-auth-secret",
        KEPPO_CRON_SECRET: "cron-secret",
        KEPPO_API_INTERNAL_BASE_URL: "https://api.keppo.ai",
      },
      {
        validateRequired: true,
        mode: "strict",
      },
    );

    expect(env.GOOGLE_REDIRECT_URI).toBe("https://api.keppo.ai/oauth/integrations/google/callback");
    expect(env.STRIPE_REDIRECT_URI).toBe("https://api.keppo.ai/oauth/integrations/stripe/callback");
    expect(env.GITHUB_REDIRECT_URI).toBe("https://api.keppo.ai/oauth/integrations/github/callback");
    expect(env.KEPPO_AUTOMATION_MCP_SERVER_URL).toBe("https://api.keppo.ai/mcp");
    expect(env.CORS_ALLOWED_ORIGINS).toBe("https://dashboard.keppo.ai");
    expect(env.MAILGUN_FROM_EMAIL).toBe("notifications@keppo.ai");
  });

  it("derives same-origin hosted defaults from KEPPO_URL when API env is unset", () => {
    const env = parseApiEnv(
      {
        NODE_ENV: "production",
        KEPPO_URL: "https://keppo.ai",
        CONVEX_URL: "https://example.convex.cloud",
        KEPPO_CONVEX_ADMIN_KEY: "convex-admin-key",
        KEPPO_MASTER_KEY: "master-key",
        STRIPE_SECRET_KEY: "stripe-secret",
        STRIPE_PROVIDER_WEBHOOK_SECRET: "stripe-provider-webhook-secret",
        STRIPE_BILLING_WEBHOOK_SECRET: "stripe-billing-webhook-secret",
        GOOGLE_CLIENT_ID: "google-client-id",
        GOOGLE_CLIENT_SECRET: "google-client-secret",
        STRIPE_CLIENT_ID: "stripe-client-id",
        GITHUB_CLIENT_ID: "github-client-id",
        GITHUB_CLIENT_SECRET: "github-client-secret",
        REDDIT_CLIENT_ID: "reddit-client-id",
        REDDIT_CLIENT_SECRET: "reddit-client-secret",
        OPENAI_API_KEY: "openai-api-key",
        KEPPO_OAUTH_STATE_SECRET: "oauth-state-secret",
        KEPPO_CALLBACK_HMAC_SECRET: "callback-hmac-secret",
        BETTER_AUTH_SECRET: "better-auth-secret-better-auth-secret",
        KEPPO_CRON_SECRET: "cron-secret",
      },
      {
        validateRequired: true,
        mode: "strict",
      },
    );

    expect(env.KEPPO_DASHBOARD_ORIGIN).toBe("https://keppo.ai");
    expect(env.KEPPO_API_INTERNAL_BASE_URL).toBe("https://keppo.ai/api");
    expect(env.CORS_ALLOWED_ORIGINS).toBe("https://keppo.ai");
    expect(env.GOOGLE_REDIRECT_URI).toBe("https://keppo.ai/oauth/integrations/google/callback");
    expect(env.STRIPE_REDIRECT_URI).toBe("https://keppo.ai/oauth/integrations/stripe/callback");
    expect(env.GITHUB_REDIRECT_URI).toBe("https://keppo.ai/oauth/integrations/github/callback");
    expect(env.KEPPO_AUTOMATION_MCP_SERVER_URL).toBe("https://keppo.ai/mcp");
  });

  it("derives dashboard origin from KEPPO_API_INTERNAL_BASE_URL when it is the only hosted origin input", () => {
    const env = parseApiEnv(
      {
        NODE_ENV: "production",
        KEPPO_API_INTERNAL_BASE_URL: "https://keppo.ai/api",
        CONVEX_URL: "https://example.convex.cloud",
        KEPPO_CONVEX_ADMIN_KEY: "convex-admin-key",
        KEPPO_MASTER_KEY: "master-key",
        STRIPE_SECRET_KEY: "stripe-secret",
        STRIPE_PROVIDER_WEBHOOK_SECRET: "stripe-provider-webhook-secret",
        STRIPE_BILLING_WEBHOOK_SECRET: "stripe-billing-webhook-secret",
        GOOGLE_CLIENT_ID: "google-client-id",
        GOOGLE_CLIENT_SECRET: "google-client-secret",
        STRIPE_CLIENT_ID: "stripe-client-id",
        GITHUB_CLIENT_ID: "github-client-id",
        GITHUB_CLIENT_SECRET: "github-client-secret",
        REDDIT_CLIENT_ID: "reddit-client-id",
        REDDIT_CLIENT_SECRET: "reddit-client-secret",
        OPENAI_API_KEY: "openai-api-key",
        KEPPO_OAUTH_STATE_SECRET: "oauth-state-secret",
        KEPPO_CALLBACK_HMAC_SECRET: "callback-hmac-secret",
        BETTER_AUTH_SECRET: "better-auth-secret-better-auth-secret",
        KEPPO_CRON_SECRET: "cron-secret",
      },
      {
        validateRequired: true,
        mode: "strict",
      },
    );

    expect(env.KEPPO_DASHBOARD_ORIGIN).toBe("https://keppo.ai");
    expect(env.CORS_ALLOWED_ORIGINS).toBe("https://keppo.ai");
    expect(env.GOOGLE_REDIRECT_URI).toBe("https://keppo.ai/oauth/integrations/google/callback");
    expect(env.STRIPE_REDIRECT_URI).toBe("https://keppo.ai/oauth/integrations/stripe/callback");
    expect(env.GITHUB_REDIRECT_URI).toBe("https://keppo.ai/oauth/integrations/github/callback");
    expect(env.KEPPO_AUTOMATION_MCP_SERVER_URL).toBe("https://keppo.ai/mcp");
  });

  it("requires BETTER_AUTH_SECRET in strict mode", () => {
    expect(() =>
      parseApiEnv(
        {
          NODE_ENV: "production",
          CONVEX_URL: "https://example.convex.cloud",
          KEPPO_CONVEX_ADMIN_KEY: "convex-admin-key",
          KEPPO_MASTER_KEY: "master-key",
          KEPPO_URL: "https://dashboard.keppo.ai",
          STRIPE_SECRET_KEY: "stripe-secret",
          STRIPE_PROVIDER_WEBHOOK_SECRET: "stripe-provider-webhook-secret",
          STRIPE_BILLING_WEBHOOK_SECRET: "stripe-billing-webhook-secret",
          GOOGLE_CLIENT_ID: "google-client-id",
          GOOGLE_CLIENT_SECRET: "google-client-secret",
          STRIPE_CLIENT_ID: "stripe-client-id",
          GITHUB_CLIENT_ID: "github-client-id",
          GITHUB_CLIENT_SECRET: "github-client-secret",
          REDDIT_CLIENT_ID: "reddit-client-id",
          REDDIT_CLIENT_SECRET: "reddit-client-secret",
          OPENAI_API_KEY: "openai-api-key",
          KEPPO_OAUTH_STATE_SECRET: "oauth-state-secret",
          KEPPO_CALLBACK_HMAC_SECRET: "callback-hmac-secret",
          KEPPO_CRON_SECRET: "cron-secret",
          KEPPO_API_INTERNAL_BASE_URL: "https://api.keppo.ai",
        },
        {
          validateRequired: true,
          mode: "strict",
        },
      ),
    ).toThrow("BETTER_AUTH_SECRET");
  });

  it("requires bundled gateway env when KEPPO_STRICT_MODE is truthy", () => {
    expect(() =>
      parseApiEnv(
        {
          NODE_ENV: "development",
          KEPPO_STRICT_MODE: "1",
          CONVEX_URL: "https://example.convex.cloud",
          KEPPO_CONVEX_ADMIN_KEY: "convex-admin-key",
          KEPPO_MASTER_KEY: "master-key",
          KEPPO_URL: "https://dashboard.keppo.ai",
          STRIPE_SECRET_KEY: "stripe-secret",
          OPENAI_API_KEY: "openai-api-key",
        },
        {
          validateRequired: true,
        },
      ),
    ).toThrow("KEPPO_LLM_GATEWAY_URL");
  });

  it("accepts bundled gateway env when KEPPO_STRICT_MODE is truthy", () => {
    expect(() =>
      parseApiEnv(
        {
          NODE_ENV: "development",
          KEPPO_STRICT_MODE: "yes",
          CONVEX_URL: "https://example.convex.cloud",
          KEPPO_CONVEX_ADMIN_KEY: "convex-admin-key",
          KEPPO_MASTER_KEY: "master-key",
          KEPPO_URL: "https://dashboard.keppo.ai",
          STRIPE_SECRET_KEY: "stripe-secret",
          STRIPE_BILLING_WEBHOOK_SECRET: "stripe-billing-webhook-secret",
          OPENAI_API_KEY: "openai-api-key",
          KEPPO_LLM_GATEWAY_URL: "https://gateway.keppo.ai",
          KEPPO_LLM_GATEWAY_MASTER_KEY: "gateway-master-key",
          KEPPO_LLM_GATEWAY_TEAM_ID: "team_keppo",
        },
        {
          validateRequired: true,
        },
      ),
    ).not.toThrow();
  });

  it("requires unikraft automation credentials and image in strict mode when selected", () => {
    expect(() =>
      parseApiEnv(
        {
          NODE_ENV: "production",
          CONVEX_URL: "https://example.convex.cloud",
          KEPPO_CONVEX_ADMIN_KEY: "convex-admin-key",
          KEPPO_MASTER_KEY: "master-key",
          KEPPO_URL: "https://dashboard.keppo.ai",
          STRIPE_SECRET_KEY: "stripe-secret",
          STRIPE_PROVIDER_WEBHOOK_SECRET: "stripe-provider-webhook-secret",
          STRIPE_BILLING_WEBHOOK_SECRET: "stripe-billing-webhook-secret",
          GOOGLE_CLIENT_ID: "google-client-id",
          GOOGLE_CLIENT_SECRET: "google-client-secret",
          STRIPE_CLIENT_ID: "stripe-client-id",
          GITHUB_CLIENT_ID: "github-client-id",
          GITHUB_CLIENT_SECRET: "github-client-secret",
          REDDIT_CLIENT_ID: "reddit-client-id",
          REDDIT_CLIENT_SECRET: "reddit-client-secret",
          OPENAI_API_KEY: "openai-api-key",
          KEPPO_OAUTH_STATE_SECRET: "oauth-state-secret",
          KEPPO_CALLBACK_HMAC_SECRET: "callback-hmac-secret",
          BETTER_AUTH_SECRET: "better-auth-secret-better-auth-secret",
          KEPPO_CRON_SECRET: "cron-secret",
          KEPPO_SANDBOX_PROVIDER: "unikraft",
        },
        {
          validateRequired: true,
          mode: "strict",
        },
      ),
    ).toThrow("UNIKRAFT_SANDBOX_IMAGE");
  });

  it("requires unikraft code-mode credentials and bridge URL in strict mode when selected", () => {
    expect(() =>
      parseApiEnv(
        {
          NODE_ENV: "production",
          CONVEX_URL: "https://example.convex.cloud",
          KEPPO_CONVEX_ADMIN_KEY: "convex-admin-key",
          KEPPO_MASTER_KEY: "master-key",
          KEPPO_URL: "https://dashboard.keppo.ai",
          STRIPE_SECRET_KEY: "stripe-secret",
          STRIPE_PROVIDER_WEBHOOK_SECRET: "stripe-provider-webhook-secret",
          STRIPE_BILLING_WEBHOOK_SECRET: "stripe-billing-webhook-secret",
          GOOGLE_CLIENT_ID: "google-client-id",
          GOOGLE_CLIENT_SECRET: "google-client-secret",
          STRIPE_CLIENT_ID: "stripe-client-id",
          GITHUB_CLIENT_ID: "github-client-id",
          GITHUB_CLIENT_SECRET: "github-client-secret",
          REDDIT_CLIENT_ID: "reddit-client-id",
          REDDIT_CLIENT_SECRET: "reddit-client-secret",
          OPENAI_API_KEY: "openai-api-key",
          KEPPO_OAUTH_STATE_SECRET: "oauth-state-secret",
          KEPPO_CALLBACK_HMAC_SECRET: "callback-hmac-secret",
          BETTER_AUTH_SECRET: "better-auth-secret-better-auth-secret",
          KEPPO_CRON_SECRET: "cron-secret",
          KEPPO_CODE_MODE_SANDBOX_PROVIDER: "unikraft",
          UNIKRAFT_API_TOKEN: "uk_test",
          UNIKRAFT_METRO: "fra0",
        },
        {
          validateRequired: true,
          mode: "strict",
        },
      ),
    ).toThrow("UNIKRAFT_CODE_MODE_BRIDGE_BASE_URL");
  });

  it("rejects the jslite code-mode sandbox provider in strict mode", () => {
    expect(() =>
      parseApiEnv(
        {
          NODE_ENV: "production",
          CONVEX_URL: "https://example.convex.cloud",
          KEPPO_CONVEX_ADMIN_KEY: "convex-admin-key",
          KEPPO_MASTER_KEY: "master-key",
          KEPPO_URL: "https://dashboard.keppo.ai",
          STRIPE_SECRET_KEY: "stripe-secret",
          STRIPE_PROVIDER_WEBHOOK_SECRET: "stripe-provider-webhook-secret",
          STRIPE_BILLING_WEBHOOK_SECRET: "stripe-billing-webhook-secret",
          GOOGLE_CLIENT_ID: "google-client-id",
          GOOGLE_CLIENT_SECRET: "google-client-secret",
          STRIPE_CLIENT_ID: "stripe-client-id",
          GITHUB_CLIENT_ID: "github-client-id",
          GITHUB_CLIENT_SECRET: "github-client-secret",
          REDDIT_CLIENT_ID: "reddit-client-id",
          REDDIT_CLIENT_SECRET: "reddit-client-secret",
          OPENAI_API_KEY: "openai-api-key",
          KEPPO_OAUTH_STATE_SECRET: "oauth-state-secret",
          KEPPO_CALLBACK_HMAC_SECRET: "callback-hmac-secret",
          BETTER_AUTH_SECRET: "better-auth-secret-better-auth-secret",
          KEPPO_CRON_SECRET: "cron-secret",
          KEPPO_CODE_MODE_SANDBOX_PROVIDER: "jslite",
        },
        {
          validateRequired: true,
          mode: "strict",
        },
      ),
    ).toThrow("KEPPO_CODE_MODE_SANDBOX_PROVIDER=jslite is development-only");
  });

  it("maps legacy STRIPE_WEBHOOK_SECRET into both split webhook secrets", () => {
    const env = parseApiEnv(
      {
        NODE_ENV: "production",
        CONVEX_URL: "https://example.convex.cloud",
        KEPPO_CONVEX_ADMIN_KEY: "convex-admin-key",
        KEPPO_MASTER_KEY: "master-key",
        KEPPO_URL: "https://dashboard.keppo.ai",
        STRIPE_SECRET_KEY: "stripe-secret",
        STRIPE_WEBHOOK_SECRET: "legacy-stripe-webhook-secret",
        GOOGLE_CLIENT_ID: "google-client-id",
        GOOGLE_CLIENT_SECRET: "google-client-secret",
        STRIPE_CLIENT_ID: "stripe-client-id",
        GITHUB_CLIENT_ID: "github-client-id",
        GITHUB_CLIENT_SECRET: "github-client-secret",
        REDDIT_CLIENT_ID: "reddit-client-id",
        REDDIT_CLIENT_SECRET: "reddit-client-secret",
        OPENAI_API_KEY: "openai-api-key",
        KEPPO_OAUTH_STATE_SECRET: "oauth-state-secret",
        KEPPO_CALLBACK_HMAC_SECRET: "callback-hmac-secret",
        BETTER_AUTH_SECRET: "better-auth-secret-better-auth-secret",
        KEPPO_CRON_SECRET: "cron-secret",
      },
      {
        validateRequired: true,
        mode: "strict",
      },
    );

    expect(env.STRIPE_PROVIDER_WEBHOOK_SECRET).toBe("legacy-stripe-webhook-secret");
    expect(env.STRIPE_BILLING_WEBHOOK_SECRET).toBe("legacy-stripe-webhook-secret");
  });

  it("loads hosted staging env from the repo root before parsing process.env", () => {
    delete process.env.CONVEX_URL;
    delete process.env.VITE_CONVEX_URL;
    process.env.KEPPO_ENVIRONMENT = "staging";

    const env = getEnv();

    expect(env.CONVEX_URL).toBe("https://convex-cloud.staging.keppo.ai");
    expect(env.VITE_CONVEX_URL).toBe("https://convex-cloud.staging.keppo.ai");
  });
});
