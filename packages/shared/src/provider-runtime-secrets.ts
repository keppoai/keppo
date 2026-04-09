export type ProviderRuntimeSyncTarget = "local" | "e2e" | "hosted";

type ProviderRuntimeSecretSpec = {
  key: string;
  syncTargets: ReadonlyArray<ProviderRuntimeSyncTarget>;
};

export const PROVIDER_RUNTIME_SECRET_SPECS = [
  {
    key: "KEPPO_FAKE_EXTERNAL_BASE_URL",
    syncTargets: ["e2e"],
  },
  {
    key: "GOOGLE_OAUTH_AUTH_URL",
    syncTargets: ["local", "e2e", "hosted"],
  },
  {
    key: "GOOGLE_OAUTH_TOKEN_URL",
    syncTargets: ["local", "e2e", "hosted"],
  },
  {
    key: "GMAIL_API_BASE_URL",
    syncTargets: ["local", "e2e", "hosted"],
  },
  {
    key: "GOOGLE_CLIENT_ID",
    syncTargets: ["local", "hosted"],
  },
  {
    key: "GOOGLE_CLIENT_SECRET",
    syncTargets: ["local", "hosted"],
  },
  {
    key: "STRIPE_OAUTH_AUTH_URL",
    syncTargets: ["local", "e2e", "hosted"],
  },
  {
    key: "STRIPE_OAUTH_TOKEN_URL",
    syncTargets: ["local", "e2e", "hosted"],
  },
  {
    key: "STRIPE_API_BASE_URL",
    syncTargets: ["local", "e2e", "hosted"],
  },
  {
    key: "STRIPE_CLIENT_ID",
    syncTargets: ["local", "hosted"],
  },
  {
    key: "STRIPE_SECRET_KEY",
    syncTargets: ["local", "hosted"],
  },
  {
    key: "STRIPE_PROVIDER_WEBHOOK_SECRET",
    syncTargets: ["local", "hosted"],
  },
  {
    key: "STRIPE_WEBHOOK_SECRET",
    syncTargets: ["local", "hosted"],
  },
  {
    key: "GITHUB_OAUTH_AUTH_URL",
    syncTargets: ["local", "e2e", "hosted"],
  },
  {
    key: "GITHUB_OAUTH_TOKEN_URL",
    syncTargets: ["local", "e2e", "hosted"],
  },
  {
    key: "GITHUB_API_BASE_URL",
    syncTargets: ["local", "e2e", "hosted"],
  },
  {
    key: "REDDIT_OAUTH_AUTH_URL",
    syncTargets: ["local", "e2e", "hosted"],
  },
  {
    key: "REDDIT_OAUTH_TOKEN_URL",
    syncTargets: ["local", "e2e", "hosted"],
  },
  {
    key: "REDDIT_API_BASE_URL",
    syncTargets: ["local", "e2e", "hosted"],
  },
  {
    key: "GITHUB_CLIENT_ID",
    syncTargets: ["local", "hosted"],
  },
  {
    key: "GITHUB_CLIENT_SECRET",
    syncTargets: ["local", "hosted"],
  },
  {
    key: "REDDIT_CLIENT_ID",
    syncTargets: ["local", "hosted"],
  },
  {
    key: "REDDIT_CLIENT_SECRET",
    syncTargets: ["local", "hosted"],
  },
  {
    key: "LINKEDIN_OAUTH_AUTH_URL",
    syncTargets: ["local", "e2e", "hosted"],
  },
  {
    key: "LINKEDIN_OAUTH_TOKEN_URL",
    syncTargets: ["local", "e2e", "hosted"],
  },
  {
    key: "LINKEDIN_API_BASE_URL",
    syncTargets: ["local", "e2e", "hosted"],
  },
  {
    key: "LINKEDIN_CLIENT_ID",
    syncTargets: ["local", "hosted"],
  },
  {
    key: "LINKEDIN_CLIENT_SECRET",
    syncTargets: ["local", "hosted"],
  },
  {
    key: "X_OAUTH_AUTH_URL",
    syncTargets: ["local", "e2e", "hosted"],
  },
  {
    key: "X_OAUTH_TOKEN_URL",
    syncTargets: ["local", "e2e", "hosted"],
  },
  {
    key: "X_API_BASE_URL",
    syncTargets: ["local", "e2e", "hosted"],
  },
  {
    key: "X_CLIENT_ID",
    syncTargets: ["local", "hosted"],
  },
  {
    key: "X_CLIENT_SECRET",
    syncTargets: ["local", "hosted"],
  },
  {
    key: "GITHUB_WEBHOOK_SECRET",
    syncTargets: ["local", "hosted"],
  },
] as const satisfies ReadonlyArray<ProviderRuntimeSecretSpec>;

export type ProviderRuntimeSecretKey = (typeof PROVIDER_RUNTIME_SECRET_SPECS)[number]["key"];

export const PROVIDER_RUNTIME_SECRET_KEYS: Array<ProviderRuntimeSecretKey> =
  PROVIDER_RUNTIME_SECRET_SPECS.map((spec) => spec.key);

export const listProviderRuntimeSecretKeysForSyncTarget = (
  target: ProviderRuntimeSyncTarget,
): Array<ProviderRuntimeSecretKey> =>
  PROVIDER_RUNTIME_SECRET_SPECS.filter((spec) =>
    spec.syncTargets.some((syncTarget) => syncTarget === target),
  ).map((spec) => spec.key);

export const getProviderRuntimeSecrets = (params: {
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fakeExternalBaseUrl?: string | null;
}): Record<string, string | undefined> => {
  const secrets: Record<string, string | undefined> = {};
  for (const key of PROVIDER_RUNTIME_SECRET_KEYS) {
    const value = params.env[key];
    if (typeof value === "string" && value.trim().length > 0) {
      secrets[key] = value;
    }
  }

  const fakeExternalBaseUrl = params.fakeExternalBaseUrl?.trim();
  if (fakeExternalBaseUrl) {
    secrets.KEPPO_FAKE_EXTERNAL_BASE_URL = fakeExternalBaseUrl;
  }

  return secrets;
};
