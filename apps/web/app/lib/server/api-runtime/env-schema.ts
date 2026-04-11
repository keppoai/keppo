import { z } from "zod";

const toTrimmedString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const optionalString = z.preprocess((value) => toTrimmedString(value), z.string().optional());

const booleanWithDefault = (defaultValue: boolean) =>
  z.preprocess((value) => {
    const normalized = toTrimmedString(value);
    if (!normalized) {
      return defaultValue;
    }
    if (normalized.toLowerCase() === "true") {
      return true;
    }
    if (normalized.toLowerCase() === "false") {
      return false;
    }
    return value;
  }, z.boolean());

const truthyEnvFlagSchema = z.preprocess((value) => {
  const normalized = toTrimmedString(value)?.toLowerCase();
  if (!normalized) {
    return false;
  }
  if (normalized === "1" || normalized === "true" || normalized === "yes") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no") {
    return false;
  }
  return value;
}, z.boolean());

const positiveIntegerWithDefault = (defaultValue: number) =>
  z.preprocess((value) => {
    const normalized = toTrimmedString(value);
    if (!normalized) {
      return defaultValue;
    }
    return Number.parseInt(normalized, 10);
  }, z.number().int().positive());

const nonNegativeIntegerWithDefault = (defaultValue: number) =>
  z.preprocess((value) => {
    const normalized = toTrimmedString(value);
    if (!normalized) {
      return defaultValue;
    }
    return Number.parseInt(normalized, 10);
  }, z.number().int().min(0));

const logLevelSchema = z.preprocess(
  (value) => {
    const normalized = toTrimmedString(value);
    return (normalized ?? "info").toLowerCase();
  },
  z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]),
);

const trustedProxySchema = z.preprocess(
  (value) => {
    const normalized = toTrimmedString(value);
    return (normalized ?? "none").toLowerCase();
  },
  z.enum(["none", "vercel", "cloudflare"]),
);

const sandboxProviderSchema = z.preprocess(
  (value) => {
    const normalized = toTrimmedString(value);
    return (normalized ?? "docker").toLowerCase();
  },
  z.enum(["docker", "vercel", "unikraft"]),
);

const codeModeSandboxSchema = z.preprocess(
  (value) => {
    const normalized = toTrimmedString(value);
    return (normalized ?? "docker").toLowerCase();
  },
  z.enum(["docker", "vercel", "unikraft", "jslite"]),
);

const apiEnvSchema = z
  .object({
    NODE_ENV: optionalString,
    KEPPO_ENVIRONMENT: optionalString,
    KEPPO_STRICT_MODE: truthyEnvFlagSchema,
    KEPPO_URL: optionalString,
    VITE_CONVEX_URL: optionalString,
    VITE_CONVEX_SITE_URL: optionalString,
    CONVEX_SITE_URL: optionalString,
    KEPPO_E2E_MODE: booleanWithDefault(false),
    KEPPO_E2E_OPENAI_BASE_URL: optionalString,
    LOG_LEVEL: logLevelSchema,
    POSTHOG_API_KEY: optionalString,
    POSTHOG_HOST: optionalString,
    PAGERDUTY_ROUTING_KEY: optionalString,
    PORT: positiveIntegerWithDefault(8787),
    KEPPO_INLINE_WORKER: booleanWithDefault(false),
    KEPPO_WORKER_INTERVAL_MS: positiveIntegerWithDefault(1500),
    KEPPO_ACTION_TTL_MINUTES: positiveIntegerWithDefault(60),
    KEPPO_RUN_INACTIVITY_MINUTES: positiveIntegerWithDefault(30),
    KEPPO_DASHBOARD_ORIGIN: optionalString,
    KEPPO_ADMIN_USER_IDS: optionalString,
    KEPPO_LOCAL_ADMIN_BYPASS: booleanWithDefault(false),
    CORS_ALLOWED_ORIGINS: optionalString,
    KEPPO_TRUSTED_PROXY: trustedProxySchema,
    CONVEX_URL: optionalString,
    KEPPO_CONVEX_ADMIN_KEY: optionalString,
    KEPPO_MASTER_KEY: optionalString,
    KEPPO_MASTER_KEY_INTEGRATION: optionalString,
    KEPPO_MASTER_KEY_ACTION: optionalString,
    KEPPO_MASTER_KEY_BLOB: optionalString,
    KEPPO_LLM_GATEWAY_URL: optionalString,
    KEPPO_LLM_GATEWAY_MASTER_KEY: optionalString,
    KEPPO_LLM_GATEWAY_TEAM_ID: optionalString,
    KEPPO_CALLBACK_HMAC_SECRET: optionalString,
    KEPPO_OAUTH_STATE_SECRET: optionalString,
    BETTER_AUTH_SECRET: optionalString,
    STRIPE_SECRET_KEY: optionalString,
    STRIPE_PROVIDER_WEBHOOK_SECRET: optionalString,
    STRIPE_BILLING_WEBHOOK_SECRET: optionalString,
    STRIPE_WEBHOOK_SECRET: optionalString,
    GITHUB_WEBHOOK_SECRET: optionalString,
    STRIPE_STARTER_PRICE_ID: optionalString,
    STRIPE_PRO_PRICE_ID: optionalString,
    STRIPE_CREDIT_PRODUCT_ID: optionalString,
    STRIPE_AUTOMATION_RUN_PRODUCT_ID: optionalString,
    STRIPE_API_BASE_URL: optionalString,
    GOOGLE_CLIENT_ID: optionalString,
    GOOGLE_CLIENT_SECRET: optionalString,
    STRIPE_CLIENT_ID: optionalString,
    GITHUB_CLIENT_ID: optionalString,
    GITHUB_CLIENT_SECRET: optionalString,
    REDDIT_CLIENT_ID: optionalString,
    REDDIT_CLIENT_SECRET: optionalString,
    OPENAI_OAUTH_CLIENT_ID: optionalString,
    GOOGLE_REDIRECT_URI: optionalString,
    STRIPE_REDIRECT_URI: optionalString,
    GITHUB_REDIRECT_URI: optionalString,
    OPENAI_OAUTH_TOKEN_URL: optionalString,
    GOOGLE_OAUTH_AUTH_URL: optionalString,
    GOOGLE_OAUTH_TOKEN_URL: optionalString,
    GMAIL_API_BASE_URL: optionalString,
    STRIPE_OAUTH_AUTH_URL: optionalString,
    STRIPE_OAUTH_TOKEN_URL: optionalString,
    GITHUB_OAUTH_AUTH_URL: optionalString,
    GITHUB_OAUTH_TOKEN_URL: optionalString,
    GITHUB_API_BASE_URL: optionalString,
    REDDIT_OAUTH_AUTH_URL: optionalString,
    REDDIT_OAUTH_TOKEN_URL: optionalString,
    REDDIT_API_BASE_URL: optionalString,
    KEPPO_CRON_SECRET: optionalString,
    KEPPO_QUEUE_SECRET: optionalString,
    KEPPO_QUEUE_ENQUEUE_SWEEP_LIMIT: positiveIntegerWithDefault(50),
    KEPPO_QUEUE_APPROVED_FALLBACK_LIMIT: nonNegativeIntegerWithDefault(0),
    VERCEL_CRON_SECRET: optionalString,
    KEPPO_RATE_LIMIT_MCP_AUTH_FAILURES_PER_MINUTE: positiveIntegerWithDefault(20),
    KEPPO_RATE_LIMIT_MCP_REQUESTS_PER_CREDENTIAL_PER_MINUTE: positiveIntegerWithDefault(60),
    KEPPO_RATE_LIMIT_AUTOMATION_QUESTIONS_PER_ORG_PER_MINUTE: positiveIntegerWithDefault(10),
    KEPPO_RATE_LIMIT_OAUTH_CONNECT_PER_IP_PER_MINUTE: positiveIntegerWithDefault(10),
    KEPPO_RATE_LIMIT_WEBHOOKS_PER_IP_PER_MINUTE: positiveIntegerWithDefault(100),
    KEPPO_DLQ_ALERT_THRESHOLD: nonNegativeIntegerWithDefault(10),
    KEPPO_MAX_BODY_BYTES_OAUTH: positiveIntegerWithDefault(64 * 1024),
    KEPPO_MAX_BODY_BYTES_WEBHOOKS: positiveIntegerWithDefault(256 * 1024),
    KEPPO_MAX_BODY_BYTES_MCP: positiveIntegerWithDefault(256 * 1024),
    KEPPO_MAX_BODY_BYTES_INTERNAL: positiveIntegerWithDefault(256 * 1024),
    KEPPO_CODE_MODE_SANDBOX_PROVIDER: codeModeSandboxSchema,
    KEPPO_CODE_MODE_TIMEOUT_MS: positiveIntegerWithDefault(120_000),
    KEPPO_SANDBOX_PROVIDER: sandboxProviderSchema,
    UNIKRAFT_API_TOKEN: optionalString,
    UNIKRAFT_METRO: optionalString,
    UNIKRAFT_SANDBOX_IMAGE: optionalString,
    UNIKRAFT_CODE_MODE_IMAGE: optionalString,
    UNIKRAFT_CODE_MODE_BRIDGE_BASE_URL: optionalString,
    UNIKRAFT_CODE_MODE_BRIDGE_BIND_HOST: optionalString,
    KEPPO_JSLITE_PROJECT_PATH: optionalString,
    KEPPO_JSLITE_SIDECAR_PATH: optionalString,
    VERCEL_SANDBOX_API_TOKEN: optionalString,
    VERCEL_OIDC_TOKEN: optionalString,
    VERCEL_TOKEN: optionalString,
    VERCEL_TEAM_ID: optionalString,
    VERCEL_PROJECT_ID: optionalString,
    VERCEL_AUTOMATION_BYPASS_SECRET: optionalString,
    KEPPO_API_INTERNAL_BASE_URL: optionalString,
    OPENAI_API_KEY: optionalString,
    KEPPO_OPENAI_TRACING_API_KEY: optionalString,
    KEPPO_OPENAI_TRACING_ENDPOINT: optionalString,
    KEPPO_AUTOMATION_MODEL_AUTO: optionalString,
    KEPPO_AUTOMATION_MODEL_FRONTIER: optionalString,
    KEPPO_AUTOMATION_MODEL_BALANCED: optionalString,
    KEPPO_AUTOMATION_MODEL_VALUE: optionalString,
    KEPPO_AUTOMATION_DEFAULT_TIMEOUT_MS: positiveIntegerWithDefault(300_000),
    KEPPO_AUTOMATION_MCP_SERVER_URL: optionalString,
    MAILGUN_API_KEY: optionalString,
    MAILGUN_DOMAIN: optionalString,
    MAILGUN_FROM_EMAIL: optionalString,
    VAPID_PUBLIC_KEY: optionalString,
    VAPID_PRIVATE_KEY: optionalString,
    VAPID_SUBJECT: optionalString,
  })
  .passthrough();

export type ApiEnv = z.infer<typeof apiEnvSchema>;
export type ApiEnvMode = "strict" | "relaxed";
export const API_ENV_KEYS = apiEnvSchema.keyof().options as ReadonlyArray<keyof ApiEnv>;

const detectApiEnvMode = (env: Pick<ApiEnv, "NODE_ENV" | "KEPPO_E2E_MODE">): ApiEnvMode => {
  const mode = env.NODE_ENV?.toLowerCase();
  if (mode === "development" || mode === "test" || env.KEPPO_E2E_MODE) {
    return "relaxed";
  }
  return "strict";
};

const formatSchemaIssues = (issues: z.ZodIssue[]): string =>
  issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
      return `- ${path}: ${issue.message}`;
    })
    .join("\n");

const requireNonEmpty = (
  env: ApiEnv,
  keys: ReadonlyArray<keyof ApiEnv>,
  missing: string[],
  labels?: Partial<Record<keyof ApiEnv, string>>,
): void => {
  for (const key of keys) {
    const value = env[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      missing.push(labels?.[key] ?? String(key));
    }
  }
};

const deriveRootOwnedUrlFromBaseUrl = (
  baseUrl: string | undefined,
  pathname: string,
): string | undefined => {
  if (!baseUrl) {
    return undefined;
  }
  try {
    return new URL(pathname, baseUrl).toString();
  } catch {
    return undefined;
  }
};

const deriveOriginFromBaseUrl = (baseUrl: string | undefined): string | undefined => {
  if (!baseUrl) {
    return undefined;
  }
  try {
    return new URL(baseUrl).origin;
  } catch {
    return undefined;
  }
};

const deriveApiBaseFromDashboardOrigin = (
  dashboardOrigin: string | undefined,
): string | undefined => {
  if (!dashboardOrigin) {
    return undefined;
  }
  try {
    return new URL("/api", dashboardOrigin).toString();
  } catch {
    return undefined;
  }
};

const deriveConvexSiteUrl = (convexUrl: string | undefined): string | undefined => {
  if (!convexUrl) {
    return undefined;
  }
  try {
    const parsed = new URL(convexUrl);
    if (parsed.hostname.endsWith(".convex.cloud")) {
      parsed.hostname = parsed.hostname.replace(/\.convex\.cloud$/u, ".convex.site");
      return parsed.toString();
    }
    const defaultPort = parsed.protocol === "https:" ? 443 : 80;
    const convexPort = Number.parseInt(parsed.port || String(defaultPort), 10);
    if (!Number.isFinite(convexPort)) {
      return undefined;
    }
    parsed.port = String(convexPort + 1);
    return parsed.toString();
  } catch {
    return undefined;
  }
};

const resolveWithFallbacks = (base: ApiEnv): ApiEnv => {
  const callbackSecret = base.KEPPO_CALLBACK_HMAC_SECRET;
  const oauthStateSecret = base.KEPPO_OAUTH_STATE_SECRET ?? base.KEPPO_CALLBACK_HMAC_SECRET;
  const integrationMasterKey = base.KEPPO_MASTER_KEY_INTEGRATION ?? base.KEPPO_MASTER_KEY;
  const convexUrl = base.CONVEX_URL;
  const viteConvexUrl = base.VITE_CONVEX_URL ?? convexUrl;
  const convexSiteUrl =
    base.CONVEX_SITE_URL ?? base.VITE_CONVEX_SITE_URL ?? deriveConvexSiteUrl(viteConvexUrl);
  const keppoUrl = base.KEPPO_URL ?? deriveOriginFromBaseUrl(base.KEPPO_API_INTERNAL_BASE_URL);
  const dashboardOrigin = keppoUrl;
  const apiInternalBaseUrl =
    base.KEPPO_API_INTERNAL_BASE_URL ?? deriveApiBaseFromDashboardOrigin(keppoUrl);
  const stripeProviderWebhookSecret =
    base.STRIPE_PROVIDER_WEBHOOK_SECRET ?? base.STRIPE_WEBHOOK_SECRET;
  const stripeBillingWebhookSecret =
    base.STRIPE_BILLING_WEBHOOK_SECRET ?? base.STRIPE_WEBHOOK_SECRET;
  const googleRedirectUri =
    base.GOOGLE_REDIRECT_URI ??
    deriveRootOwnedUrlFromBaseUrl(apiInternalBaseUrl, "/oauth/integrations/google/callback");
  const stripeRedirectUri =
    base.STRIPE_REDIRECT_URI ??
    deriveRootOwnedUrlFromBaseUrl(apiInternalBaseUrl, "/oauth/integrations/stripe/callback");
  const githubRedirectUri =
    base.GITHUB_REDIRECT_URI ??
    deriveRootOwnedUrlFromBaseUrl(apiInternalBaseUrl, "/oauth/integrations/github/callback");
  const mcpServerUrl =
    base.KEPPO_AUTOMATION_MCP_SERVER_URL ??
    deriveRootOwnedUrlFromBaseUrl(apiInternalBaseUrl, "/mcp");
  const corsAllowedOrigins = base.CORS_ALLOWED_ORIGINS ?? dashboardOrigin;
  const mailgunFromEmail = base.MAILGUN_FROM_EMAIL ?? "notifications@keppo.ai";
  return {
    ...base,
    ...(keppoUrl ? { KEPPO_URL: keppoUrl } : {}),
    ...(viteConvexUrl ? { VITE_CONVEX_URL: viteConvexUrl } : {}),
    ...(convexSiteUrl
      ? { CONVEX_SITE_URL: convexSiteUrl, VITE_CONVEX_SITE_URL: convexSiteUrl }
      : {}),
    ...(dashboardOrigin ? { KEPPO_DASHBOARD_ORIGIN: dashboardOrigin } : {}),
    ...(apiInternalBaseUrl ? { KEPPO_API_INTERNAL_BASE_URL: apiInternalBaseUrl } : {}),
    ...(callbackSecret ? { KEPPO_CALLBACK_HMAC_SECRET: callbackSecret } : {}),
    ...(oauthStateSecret ? { KEPPO_OAUTH_STATE_SECRET: oauthStateSecret } : {}),
    ...(integrationMasterKey ? { KEPPO_MASTER_KEY_INTEGRATION: integrationMasterKey } : {}),
    ...(stripeProviderWebhookSecret
      ? { STRIPE_PROVIDER_WEBHOOK_SECRET: stripeProviderWebhookSecret }
      : {}),
    ...(stripeBillingWebhookSecret
      ? { STRIPE_BILLING_WEBHOOK_SECRET: stripeBillingWebhookSecret }
      : {}),
    ...(googleRedirectUri ? { GOOGLE_REDIRECT_URI: googleRedirectUri } : {}),
    ...(stripeRedirectUri ? { STRIPE_REDIRECT_URI: stripeRedirectUri } : {}),
    ...(githubRedirectUri ? { GITHUB_REDIRECT_URI: githubRedirectUri } : {}),
    ...(mcpServerUrl ? { KEPPO_AUTOMATION_MCP_SERVER_URL: mcpServerUrl } : {}),
    ...(corsAllowedOrigins ? { CORS_ALLOWED_ORIGINS: corsAllowedOrigins } : {}),
    MAILGUN_FROM_EMAIL: mailgunFromEmail,
  };
};

const validateRequiredEnv = (env: ApiEnv, mode: ApiEnvMode): void => {
  const missing: string[] = [];
  const invalid: string[] = [];
  const requiredCore = [
    "KEPPO_CONVEX_ADMIN_KEY",
    "KEPPO_MASTER_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_BILLING_WEBHOOK_SECRET",
    "OPENAI_API_KEY",
  ] as const;
  requireNonEmpty(env, requiredCore, missing);

  if (!env.KEPPO_URL && !env.KEPPO_API_INTERNAL_BASE_URL) {
    missing.push("KEPPO_URL (or KEPPO_API_INTERNAL_BASE_URL)");
  }

  if (!env.CONVEX_URL) {
    missing.push("CONVEX_URL");
  }

  if (mode === "strict") {
    const requiredProviders = [
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "STRIPE_CLIENT_ID",
      "STRIPE_PROVIDER_WEBHOOK_SECRET",
      "GITHUB_CLIENT_ID",
      "GITHUB_CLIENT_SECRET",
      "REDDIT_CLIENT_ID",
      "REDDIT_CLIENT_SECRET",
      "KEPPO_OAUTH_STATE_SECRET",
      "KEPPO_CALLBACK_HMAC_SECRET",
      "BETTER_AUTH_SECRET",
    ] as const;
    requireNonEmpty(env, requiredProviders, missing);

    const hasCronSecret = Boolean(
      env.KEPPO_CRON_SECRET ?? env.KEPPO_QUEUE_SECRET ?? env.VERCEL_CRON_SECRET,
    );
    if (!hasCronSecret) {
      missing.push("KEPPO_CRON_SECRET (or KEPPO_QUEUE_SECRET / VERCEL_CRON_SECRET)");
    }
  }

  if (env.KEPPO_STRICT_MODE) {
    requireNonEmpty(
      env,
      ["KEPPO_LLM_GATEWAY_URL", "KEPPO_LLM_GATEWAY_MASTER_KEY", "KEPPO_LLM_GATEWAY_TEAM_ID"],
      missing,
    );
  }

  if (env.KEPPO_SANDBOX_PROVIDER === "unikraft") {
    requireNonEmpty(
      env,
      ["UNIKRAFT_API_TOKEN", "UNIKRAFT_METRO", "UNIKRAFT_SANDBOX_IMAGE"],
      missing,
    );
  }

  if (env.KEPPO_CODE_MODE_SANDBOX_PROVIDER === "unikraft") {
    requireNonEmpty(
      env,
      ["UNIKRAFT_API_TOKEN", "UNIKRAFT_METRO", "UNIKRAFT_CODE_MODE_BRIDGE_BASE_URL"],
      missing,
    );
  }

  if (mode === "strict" && env.KEPPO_CODE_MODE_SANDBOX_PROVIDER === "jslite") {
    invalid.push(
      "KEPPO_CODE_MODE_SANDBOX_PROVIDER=jslite is development-only. Use 'vercel' or 'unikraft' in strict mode.",
    );
  }

  if (missing.length > 0 || invalid.length > 0) {
    throw new Error(
      `Invalid API environment:\n${[
        ...missing.map((item) => `- Missing ${item}`),
        ...invalid.map((item) => `- Invalid ${item}`),
      ].join("\n")}`,
    );
  }
};

export const parseApiEnv = (
  source: NodeJS.ProcessEnv,
  options: { validateRequired?: boolean; mode?: ApiEnvMode } = {},
): ApiEnv => {
  const parsed = apiEnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid API environment values:\n${formatSchemaIssues(parsed.error.issues)}`);
  }
  const mode = options.mode ?? detectApiEnvMode(parsed.data);
  const normalized = resolveWithFallbacks(parsed.data);
  if (options.validateRequired ?? false) {
    validateRequiredEnv(normalized, mode);
  }
  return normalized;
};
