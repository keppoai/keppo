import { describe, expect, it } from "vitest";
import {
  getProviderRuntimeSecrets,
  listProviderRuntimeSecretKeysForSyncTarget,
} from "./provider-runtime-secrets";

describe("getProviderRuntimeSecrets", () => {
  it("keeps only allowlisted provider keys", () => {
    const secrets = getProviderRuntimeSecrets({
      env: {
        GOOGLE_CLIENT_ID: "google_client",
        STRIPE_PROVIDER_WEBHOOK_SECRET: "stripe_provider_webhook_secret",
        GITHUB_WEBHOOK_SECRET: "github_webhook_secret",
        X_CLIENT_ID: "x_client",
        KEPPO_MASTER_KEY: "should_not_leak",
      },
    });

    expect(secrets).toEqual({
      GOOGLE_CLIENT_ID: "google_client",
      STRIPE_PROVIDER_WEBHOOK_SECRET: "stripe_provider_webhook_secret",
      GITHUB_WEBHOOK_SECRET: "github_webhook_secret",
      X_CLIENT_ID: "x_client",
    });
  });

  it("overrides fake external base url when explicitly provided", () => {
    const secrets = getProviderRuntimeSecrets({
      env: {
        KEPPO_FAKE_EXTERNAL_BASE_URL: "http://127.0.0.1:9901",
      },
      fakeExternalBaseUrl: "http://127.0.0.1:9911",
    });

    expect(secrets.KEPPO_FAKE_EXTERNAL_BASE_URL).toBe("http://127.0.0.1:9911");
  });

  it("includes provider endpoint overrides in local Convex sync", () => {
    expect(listProviderRuntimeSecretKeysForSyncTarget("local")).toEqual(
      expect.arrayContaining([
        "GOOGLE_OAUTH_AUTH_URL",
        "GOOGLE_OAUTH_TOKEN_URL",
        "GMAIL_API_BASE_URL",
        "REDDIT_OAUTH_AUTH_URL",
        "REDDIT_OAUTH_TOKEN_URL",
        "REDDIT_API_BASE_URL",
        "X_OAUTH_AUTH_URL",
        "X_OAUTH_TOKEN_URL",
        "X_API_BASE_URL",
      ]),
    );
  });

  it("keeps fake external routing out of common local Convex sync", () => {
    expect(listProviderRuntimeSecretKeysForSyncTarget("local")).not.toContain(
      "KEPPO_FAKE_EXTERNAL_BASE_URL",
    );
    expect(listProviderRuntimeSecretKeysForSyncTarget("e2e")).toContain(
      "KEPPO_FAKE_EXTERNAL_BASE_URL",
    );
  });

  it("keeps hosted Convex sync aligned with provider ids, secrets, and endpoint overrides", () => {
    const hostedKeys = listProviderRuntimeSecretKeysForSyncTarget("hosted");

    expect(hostedKeys).toEqual(
      expect.arrayContaining([
        "GOOGLE_OAUTH_AUTH_URL",
        "GOOGLE_OAUTH_TOKEN_URL",
        "GMAIL_API_BASE_URL",
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "STRIPE_OAUTH_AUTH_URL",
        "STRIPE_OAUTH_TOKEN_URL",
        "STRIPE_API_BASE_URL",
        "STRIPE_CLIENT_ID",
        "STRIPE_SECRET_KEY",
        "STRIPE_PROVIDER_WEBHOOK_SECRET",
        "GITHUB_OAUTH_AUTH_URL",
        "GITHUB_OAUTH_TOKEN_URL",
        "GITHUB_API_BASE_URL",
        "GITHUB_CLIENT_ID",
        "GITHUB_CLIENT_SECRET",
        "GITHUB_WEBHOOK_SECRET",
        "REDDIT_OAUTH_AUTH_URL",
        "REDDIT_OAUTH_TOKEN_URL",
        "REDDIT_API_BASE_URL",
        "REDDIT_CLIENT_ID",
        "REDDIT_CLIENT_SECRET",
        "X_OAUTH_AUTH_URL",
        "X_OAUTH_TOKEN_URL",
        "X_API_BASE_URL",
        "X_CLIENT_ID",
        "X_CLIENT_SECRET",
      ]),
    );
    expect(hostedKeys).not.toContain("KEPPO_FAKE_EXTERNAL_BASE_URL");
  });
});
