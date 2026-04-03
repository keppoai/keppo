import type { WorkerPortBlock } from "./ports";

export type WorkerEnvParams = {
  runId: string;
  workerIndex: number;
  namespacePrefix: string;
  ports: WorkerPortBlock;
  convexUrl: string;
  convexAdminKey: string;
};

export type WorkerEnv = {
  base: NodeJS.ProcessEnv;
  api: NodeJS.ProcessEnv;
  dashboard: NodeJS.ProcessEnv;
  queueBroker: NodeJS.ProcessEnv;
  fakeGateway: NodeJS.ProcessEnv;
};

const readUsableTestEnv = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.startsWith("encrypted:")) {
    return undefined;
  }
  return trimmed;
};

const toHostPort = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    const port = parsed.port || (parsed.protocol === "http:" ? "80" : "443");
    return `${parsed.hostname}:${port}`.toLowerCase();
  } catch {
    return null;
  }
};

const toLocalConvexSiteUrl = (convexUrl: string): string => {
  try {
    const parsed = new URL(convexUrl);
    const port = Number.parseInt(parsed.port || "", 10);
    if (!Number.isFinite(port)) {
      return convexUrl;
    }
    parsed.port = String(port + 1);
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return convexUrl;
  }
};

export const buildWorkerEnv = (params: WorkerEnvParams): WorkerEnv => {
  const fakeGatewayBase = `http://127.0.0.1:${params.ports.fakeGateway}`;
  const dashboardBase = `http://localhost:${params.ports.dashboard}`;
  const apiBase = dashboardBase;
  const queueBrokerBase = `http://127.0.0.1:${params.ports.queueBroker}`;
  const useFakeOpenAiResponses = process.env.KEPPO_E2E_OPENAI_RESPONSES_FAKE === "1";
  const convexSiteUrl = process.env.KEPPO_CONVEX_SITE_URL ?? toLocalConvexSiteUrl(params.convexUrl);
  const cronToken = readUsableTestEnv(process.env.KEPPO_CRON_SECRET) ?? "keppo-e2e-cron-secret";
  const externalAllowlist = new Set(
    (process.env.KEPPO_EXTERNAL_FETCH_ALLOWLIST ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  externalAllowlist.add(`127.0.0.1:${params.ports.fakeGateway}`);
  externalAllowlist.add("accounts.google.com:443");
  externalAllowlist.add("oauth2.googleapis.com:443");
  externalAllowlist.add("gmail.googleapis.com:443");
  externalAllowlist.add("api.stripe.com:443");
  externalAllowlist.add("api.github.com:443");
  externalAllowlist.add("github.com:443");
  externalAllowlist.add("oauth.reddit.com:443");
  externalAllowlist.add("www.reddit.com:443");

  const localHostAllowlist = new Set(
    (process.env.KEPPO_LOCAL_HOST_ALLOWLIST ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  localHostAllowlist.add(`127.0.0.1:${params.ports.fakeGateway}`);
  localHostAllowlist.add(`127.0.0.1:${params.ports.api}`);
  localHostAllowlist.add(`127.0.0.1:${params.ports.dashboard}`);
  localHostAllowlist.add(`127.0.0.1:${params.ports.queueBroker}`);
  const convexHostPort = toHostPort(params.convexUrl);
  if (convexHostPort) {
    localHostAllowlist.add(convexHostPort);
  }
  const convexSiteHostPort = toHostPort(convexSiteUrl);
  if (convexSiteHostPort) {
    localHostAllowlist.add(convexSiteHostPort);
  }
  const base: NodeJS.ProcessEnv = {
    ...process.env,
    TZ: "UTC",
    LANG: "C",
    LC_ALL: "C",
    KEPPO_E2E_MODE: "true",
    KEPPO_E2E_RUN_ID: params.runId,
    KEPPO_E2E_WORKER_INDEX: String(params.workerIndex),
    KEPPO_E2E_NAMESPACE_PREFIX: params.namespacePrefix,
    CONVEX_URL: params.convexUrl,
    CONVEX_SITE_URL: convexSiteUrl,
    KEPPO_CONVEX_SITE_URL: convexSiteUrl,
    KEPPO_CONVEX_ADMIN_KEY: params.convexAdminKey,
    BETTER_AUTH_SECRET:
      process.env.BETTER_AUTH_SECRET ?? `keppo-e2e-better-auth-secret-${params.workerIndex}`,
    KEPPO_URL: dashboardBase,
    KEPPO_API_INTERNAL_BASE_URL: dashboardBase,
    VITE_KEPPO_URL: dashboardBase,
    KEPPO_FAKE_EXTERNAL_BASE_URL: fakeGatewayBase,
    KEPPO_E2E_FAKE_GATEWAY_BASE_URL: fakeGatewayBase,
    ...(useFakeOpenAiResponses
      ? {
          KEPPO_E2E_OPENAI_BASE_URL: fakeGatewayBase,
          // This repro must bypass bundled gateway mode so automation dispatch
          // exercises the fake OpenAI Responses endpoint with BYOK auth.
          KEPPO_LLM_GATEWAY_URL: "",
        }
      : {}),
    KEPPO_PROCESS_APPROVED_ACTIONS_INLINE: "false",
    KEPPO_INLINE_WORKER: "false",
    KEPPO_LOG_LEVEL: process.env.KEPPO_LOG_LEVEL ?? "warn",
    KEPPO_QUEUE_CLIENT: "local",
    KEPPO_QUEUE_MAX_ATTEMPTS: "5",
    KEPPO_CRON_SECRET: cronToken,
    KEPPO_LOCAL_QUEUE_BROKER_URL: queueBrokerBase,
    KEPPO_LOCAL_QUEUE_CONSUMER_URL: `${apiBase}/internal/queue/approved-action`,
    KEPPO_LOCAL_QUEUE_CONSUMER_AUTH_HEADER: `Bearer ${cronToken}`,
    KEPPO_EXTERNAL_FETCH_ALLOWLIST: [...externalAllowlist].join(","),
    KEPPO_LOCAL_HOST_ALLOWLIST: [...localHostAllowlist].join(","),
    GOOGLE_OAUTH_AUTH_URL: `${fakeGatewayBase}/gmail/oauth/authorize`,
    GOOGLE_OAUTH_TOKEN_URL: `${fakeGatewayBase}/gmail/oauth/token`,
    GMAIL_API_BASE_URL: `${fakeGatewayBase}/gmail/v1`,
    STRIPE_OAUTH_AUTH_URL: `${fakeGatewayBase}/stripe/oauth/authorize`,
    STRIPE_OAUTH_TOKEN_URL: `${fakeGatewayBase}/stripe/oauth/token`,
    STRIPE_API_BASE_URL: `${fakeGatewayBase}/stripe/v1`,
    STRIPE_SECRET_KEY: readUsableTestEnv(process.env.STRIPE_SECRET_KEY) ?? "sk_test_e2e_billing",
    STRIPE_WEBHOOK_SECRET:
      readUsableTestEnv(process.env.STRIPE_WEBHOOK_SECRET) ?? "whsec_e2e_billing",
    STRIPE_STARTER_PRICE_ID:
      readUsableTestEnv(process.env.STRIPE_STARTER_PRICE_ID) ?? "price_e2e_starter",
    STRIPE_PRO_PRICE_ID: readUsableTestEnv(process.env.STRIPE_PRO_PRICE_ID) ?? "price_e2e_pro",
    GITHUB_OAUTH_AUTH_URL: `${fakeGatewayBase}/github/oauth/authorize`,
    GITHUB_OAUTH_TOKEN_URL: `${fakeGatewayBase}/github/oauth/token`,
    GITHUB_API_BASE_URL: `${fakeGatewayBase}/github/v1`,
    REDDIT_OAUTH_AUTH_URL: `${fakeGatewayBase}/reddit/oauth/authorize`,
    REDDIT_OAUTH_TOKEN_URL: `${fakeGatewayBase}/reddit/oauth/token`,
    REDDIT_API_BASE_URL: `${fakeGatewayBase}/reddit/v1`,
    GOOGLE_CLIENT_ID: readUsableTestEnv(process.env.GOOGLE_CLIENT_ID) ?? "fake-google-client-id",
    GOOGLE_CLIENT_SECRET:
      readUsableTestEnv(process.env.GOOGLE_CLIENT_SECRET) ?? "fake-google-client-secret",
    REDDIT_CLIENT_ID: readUsableTestEnv(process.env.REDDIT_CLIENT_ID) ?? "fake-reddit-client-id",
    REDDIT_CLIENT_SECRET:
      readUsableTestEnv(process.env.REDDIT_CLIENT_SECRET) ?? "fake-reddit-client-secret",
    VITE_VAPID_PUBLIC_KEY: process.env.VITE_VAPID_PUBLIC_KEY ?? "dGVzdA",
    KEPPO_MASTER_KEY: process.env.KEPPO_MASTER_KEY ?? "keppo-e2e-master-key",
    KEPPO_FAKE_GMAIL_ACCESS_TOKEN:
      process.env.KEPPO_FAKE_GMAIL_ACCESS_TOKEN ?? "fake_gmail_access_token",
    KEPPO_FAKE_STRIPE_ACCESS_TOKEN:
      process.env.KEPPO_FAKE_STRIPE_ACCESS_TOKEN ?? "fake_stripe_access_token",
    KEPPO_FAKE_GITHUB_ACCESS_TOKEN:
      process.env.KEPPO_FAKE_GITHUB_ACCESS_TOKEN ?? "fake_github_access_token",
    KEPPO_FAKE_REDDIT_ACCESS_TOKEN:
      process.env.KEPPO_FAKE_REDDIT_ACCESS_TOKEN ?? "fake_reddit_access_token",
  };

  return {
    base,
    fakeGateway: {
      ...base,
      HOST: "0.0.0.0",
      PORT: String(params.ports.fakeGateway),
    },
    api: {
      ...base,
      PORT: String(params.ports.api),
      VITE_API_BASE: apiBase,
    },
    queueBroker: {
      ...base,
      PORT: String(params.ports.queueBroker),
    },
    dashboard: {
      ...base,
      HOST: "127.0.0.1",
      PORT: String(params.ports.dashboard),
      NITRO_HOST: "127.0.0.1",
      NITRO_PORT: String(params.ports.dashboard),
      VITE_API_BASE: "/",
      VITE_KEPPO_URL: dashboardBase,
      VITE_CONVEX_URL: params.convexUrl,
      VITE_CONVEX_SITE_URL: convexSiteUrl,
    },
  };
};
