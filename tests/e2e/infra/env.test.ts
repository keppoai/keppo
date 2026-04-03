import { afterEach, describe, expect, it, vi } from "vitest";
import { buildWorkerEnv } from "./env";

const params = {
  runId: "run_test",
  workerIndex: 0,
  namespacePrefix: "run_test.0",
  ports: {
    fakeGateway: 9901,
    api: 9902,
    dashboard: 9903,
    queueBroker: 9904,
  },
  convexUrl: "http://localhost:3210",
  convexAdminKey: "local-admin-key",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("buildWorkerEnv", () => {
  it("falls back to fake local billing defaults when dotenvx leaves encrypted placeholders", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "encrypted:stripe");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "encrypted:webhook");
    vi.stubEnv("STRIPE_STARTER_PRICE_ID", "encrypted:starter");
    vi.stubEnv("STRIPE_PRO_PRICE_ID", "encrypted:pro");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "encrypted:google");
    vi.stubEnv("REDDIT_CLIENT_SECRET", "encrypted:reddit");

    const env = buildWorkerEnv(params);

    expect(env.base.STRIPE_SECRET_KEY).toBe("sk_test_e2e_billing");
    expect(env.base.STRIPE_WEBHOOK_SECRET).toBe("whsec_e2e_billing");
    expect(env.base.STRIPE_STARTER_PRICE_ID).toBe("price_e2e_starter");
    expect(env.base.STRIPE_PRO_PRICE_ID).toBe("price_e2e_pro");
    expect(env.base.GOOGLE_CLIENT_SECRET).toBe("fake-google-client-secret");
    expect(env.base.REDDIT_CLIENT_SECRET).toBe("fake-reddit-client-secret");
  });

  it("preserves usable explicit billing env overrides", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_custom");
    vi.stubEnv("STRIPE_PRO_PRICE_ID", "price_custom_pro");

    const env = buildWorkerEnv(params);

    expect(env.base.STRIPE_SECRET_KEY).toBe("sk_test_custom");
    expect(env.base.STRIPE_PRO_PRICE_ID).toBe("price_custom_pro");
  });

  it("routes dashboard auth through the dashboard origin", () => {
    const env = buildWorkerEnv(params);

    expect(env.base.KEPPO_E2E_MODE).toBe("true");
    expect(env.base.KEPPO_URL).toBe("http://localhost:9903");
    expect(env.base.KEPPO_API_INTERNAL_BASE_URL).toBe("http://localhost:9903");
    expect(env.base.KEPPO_CRON_SECRET).toBe("e2e-cron-token-0");
    expect(env.fakeGateway.HOST).toBe("0.0.0.0");
    expect(env.base.VITE_KEPPO_URL).toBe("http://localhost:9903");
    expect(env.dashboard.VITE_KEPPO_URL).toBe("http://localhost:9903");
  });

  it("pins the worker cron secret to the namespace-derived token", () => {
    vi.stubEnv("KEPPO_CRON_SECRET", "shared-cron-secret");

    const env = buildWorkerEnv(params);

    expect(env.base.KEPPO_CRON_SECRET).toBe("e2e-cron-token-0");
    expect(env.base.KEPPO_LOCAL_QUEUE_CONSUMER_AUTH_HEADER).toBe("Bearer e2e-cron-token-0");
  });

  it("enables the fake OpenAI responses path only when requested", () => {
    vi.stubEnv("KEPPO_E2E_OPENAI_RESPONSES_FAKE", "1");

    const env = buildWorkerEnv(params);

    expect(env.base.KEPPO_E2E_MODE).toBe("true");
    expect(env.base.KEPPO_E2E_OPENAI_BASE_URL).toBe("http://127.0.0.1:9901");
    expect(env.base.KEPPO_LLM_GATEWAY_URL).toBe("");
  });
});
