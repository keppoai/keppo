import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dispatchStartOwnedBillingRequest,
  type StartOwnedBillingDeps,
} from "../../app/lib/server/billing-api";

const encryptStoredKeyForTest = async (secret: string, rawValue: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(rawValue),
  );
  const toHex = (bytes: Uint8Array): string =>
    Array.from(bytes)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  return `keppo-v1.${toHex(iv)}.${toHex(new Uint8Array(encrypted))}`;
};

const signStripePayload = (rawBody: string): string => {
  const secret = process.env.STRIPE_BILLING_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("Missing STRIPE_BILLING_WEBHOOK_SECRET for test signing.");
  }
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
};

const createDeps = (): StartOwnedBillingDeps => ({
  convex: {
    addPurchasedAutomationRuns: vi.fn().mockResolvedValue(undefined),
    addPurchasedCredits: vi.fn().mockResolvedValue(undefined),
    claimApiDedupeKey: vi.fn().mockResolvedValue({
      claimed: true,
      status: "pending",
      payload: null,
      expiresAtMs: Date.now() + 60_000,
    }),
    completeApiDedupeKey: vi.fn().mockResolvedValue(true),
    convertActiveInvitePromo: vi.fn().mockResolvedValue(0),
    createAuditEvent: vi.fn().mockResolvedValue(undefined),
    deactivateBundledOrgAiKeys: vi.fn().mockResolvedValue(undefined),
    emitNotificationForOrg: vi.fn().mockResolvedValue(undefined),
    getBillingUsageForOrg: vi.fn().mockResolvedValue({
      org_id: "org_test",
      tier: "pro",
      status: "active",
      billing_source: "stripe",
      invite_promo: null,
      period_start: "2026-03-01T00:00:00.000Z",
      period_end: "2026-04-01T00:00:00.000Z",
      usage: {
        id: "usage_test",
        org_id: "org_test",
        period_start: "2026-03-01T00:00:00.000Z",
        period_end: "2026-04-01T00:00:00.000Z",
        tool_call_count: 12,
        total_tool_call_time_ms: 1_200,
        updated_at: "2026-03-14T08:00:00.000Z",
      },
      limits: {
        price_cents_monthly: 7_500,
        max_workspaces: 10,
        max_members: 25,
        max_tool_calls_per_month: 1_000,
        tool_call_timeout_ms: 30_000,
        max_total_tool_call_time_ms: 3_600_000,
        included_ai_credits: {
          total: 300,
          bundled_runtime_enabled: true,
        },
      },
    }),
    getAiCreditBalance: vi.fn().mockResolvedValue({
      org_id: "org_test",
      period_start: "2026-03-01T00:00:00.000Z",
      period_end: "2026-04-01T00:00:00.000Z",
      allowance_total: 100,
      allowance_reset_period: "monthly",
      allowance_used: 0,
      allowance_remaining: 100,
      purchased_remaining: 0,
      total_available: 100,
      bundled_runtime_enabled: true,
    }),
    getOrgAiKey: vi.fn().mockResolvedValue(null),
    getSubscriptionByStripeCustomer: vi.fn().mockResolvedValue({
      id: "subrow_1",
      org_id: "org_test",
      tier: "pro",
      status: "active",
      current_period_start: "2026-03-01T00:00:00.000Z",
      current_period_end: "2026-04-01T00:00:00.000Z",
      stripe_customer_id: "cus_test",
      stripe_subscription_id: "sub_test",
      created_at: "2026-03-01T00:00:00.000Z",
      updated_at: "2026-03-01T00:00:00.000Z",
    }),
    getSubscriptionByStripeSubscription: vi.fn().mockResolvedValue(null),
    getSubscriptionForOrg: vi.fn().mockResolvedValue({
      id: "subrow_org",
      org_id: "org_test",
      tier: "pro",
      status: "active",
      current_period_start: "2026-03-01T00:00:00.000Z",
      current_period_end: "2026-04-01T00:00:00.000Z",
      stripe_customer_id: "cus_test",
      stripe_subscription_id: "sub_test",
      created_at: "2026-03-01T00:00:00.000Z",
      updated_at: "2026-03-01T00:00:00.000Z",
    }),
    releaseApiDedupeKey: vi.fn().mockResolvedValue(true),
    resolveApiSessionFromToken: vi.fn().mockResolvedValue({
      userId: "user_test",
      orgId: "org_test",
      role: "owner",
    }),
    setSubscriptionStatusByCustomer: vi.fn().mockResolvedValue(undefined),
    setSubscriptionStatusByStripeSubscription: vi.fn().mockResolvedValue(undefined),
    syncAiCreditsFromGateway: vi.fn().mockResolvedValue({
      balance: {
        org_id: "org_test",
        period_start: "2026-03-01T00:00:00.000Z",
        period_end: "2026-04-01T00:00:00.000Z",
        allowance_total: 100,
        allowance_reset_period: "monthly",
        allowance_used: 0,
        allowance_remaining: 100,
        purchased_remaining: 0,
        total_available: 100,
        bundled_runtime_enabled: true,
      },
      charged_credits: 0,
      charged_budget_usd: 0,
      previous_spend_usd: 0,
      current_spend_usd: 0,
      max_budget_usd: 6.6667,
      budget_reset_at: "2026-04-01T00:00:00.000Z",
    }),
    upsertBundledOrgAiKey: vi.fn().mockImplementation(async (args) => ({
      id: `oak_${args.provider}`,
      org_id: args.orgId,
      provider: args.provider,
      key_mode: "bundled",
      encrypted_key: await encryptStoredKeyForTest(process.env.KEPPO_MASTER_KEY!, args.rawKey),
      credential_kind: "secret",
      key_hint: "bundled",
      key_version: 1,
      is_active: true,
      subject_email: null,
      account_id: null,
      token_expires_at: null,
      last_refreshed_at: null,
      last_validated_at: null,
      created_by: args.createdBy ?? "bundled_ai",
      created_at: "2026-03-14T00:00:00.000Z",
      updated_at: "2026-03-14T00:00:00.000Z",
    })),
    upsertSubscriptionForOrg: vi.fn().mockResolvedValue(undefined),
  },
  resolveApiSessionIdentity: vi.fn().mockResolvedValue({
    userId: "user_test",
    orgId: "org_test",
    role: "owner",
  }),
});

describe("start-owned billing api", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("dispatches root billing usage requests in-process", async () => {
    const deps = createDeps();

    const response = await dispatchStartOwnedBillingRequest(
      new Request("http://127.0.0.1/billing/usage?orgId=org_test", {
        headers: {
          cookie: "better-auth.session_token=session_token_test",
        },
      }),
      deps,
    );

    expect(response).not.toBeNull();
    if (!response) {
      throw new Error("Expected billing usage request to be handled.");
    }
    expect(response.status).toBe(200);
    expect(deps.resolveApiSessionIdentity).toHaveBeenCalledTimes(1);
    expect(deps.convex.getBillingUsageForOrg).toHaveBeenCalledWith("org_test");
    await expect(response.json()).resolves.toMatchObject({
      org_id: "org_test",
      next_invoice_preview: {
        amount_due_cents: 7_500,
        currency: "usd",
        note: "Estimated recurring monthly subscription charge.",
      },
    });
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("creates managed-payments checkout sessions for subscription upgrades", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_billing");
    vi.stubEnv("STRIPE_STARTER_PRICE_ID", "price_starter_test");

    const deps = createDeps();
    const checkoutCreate = vi.fn(
      async (params: {
        mode: string;
        managed_payments?: { enabled?: boolean };
        line_items?: Array<{ price?: string; quantity?: number }>;
        client_reference_id?: string;
      }) => ({
        id: "cs_test_subscription",
        object: "checkout.session",
        url: "https://checkout.stripe.test/cs_test_subscription",
      }),
    );
    deps.getStripeClient = () =>
      ({
        checkout: {
          sessions: {
            create: checkoutCreate,
          },
        },
      }) as unknown as ReturnType<NonNullable<typeof deps.getStripeClient>>;

    const response = await dispatchStartOwnedBillingRequest(
      new Request("http://127.0.0.1/api/billing/checkout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "better-auth.session_token=session_token_test",
        },
        body: JSON.stringify({
          orgId: "org_test",
          tier: "starter",
          successUrl: "/billing?checkout=success",
          cancelUrl: "/billing?checkout=cancel",
        }),
      }),
      deps,
    );

    expect(response).not.toBeNull();
    if (!response) {
      throw new Error("Expected checkout request to be handled.");
    }
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      url: "https://checkout.stripe.test/cs_test_subscription",
      session_id: "cs_test_subscription",
    });
    expect(checkoutCreate).toHaveBeenCalledTimes(1);
    expect(checkoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subscription",
        managed_payments: {
          enabled: true,
        },
        allow_promotion_codes: true,
        line_items: [{ price: "price_starter_test", quantity: 1 }],
        client_reference_id: "org_test",
      }),
      expect.objectContaining({ apiVersion: "2026-03-04.preview" }),
    );
  });

  it("returns gone for removed overage-billing endpoint", async () => {
    const deps = createDeps();

    const response = await dispatchStartOwnedBillingRequest(
      new Request("http://127.0.0.1/api/billing/extra-usage", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "better-auth.session_token=session_token_test",
        },
        body: JSON.stringify({
          orgId: "org_test",
          enabled: false,
        }),
      }),
      deps,
    );

    expect(response).not.toBeNull();
    if (!response) {
      throw new Error("Expected removed extra-usage request to be handled.");
    }
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "overage_billing_removed",
        message: "Extra usage billing has been removed. Buy AI credit packs instead.",
      },
    });
  });

  it("dedupes credit-pack fulfillment across checkout success event types", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_billing");
    vi.stubEnv("STRIPE_BILLING_WEBHOOK_SECRET", "whsec_billing");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_billing");

    const deps = createDeps();
    vi.mocked(deps.convex.claimApiDedupeKey)
      .mockResolvedValueOnce({
        claimed: true,
        status: "pending",
        payload: null,
        expiresAtMs: Date.now() + 60_000,
      })
      .mockResolvedValueOnce({
        claimed: true,
        status: "pending",
        payload: null,
        expiresAtMs: Date.now() + 60_000,
      })
      .mockResolvedValueOnce({
        claimed: true,
        status: "pending",
        payload: null,
        expiresAtMs: Date.now() + 60_000,
      })
      .mockResolvedValueOnce({
        claimed: false,
        status: "completed",
        payload: null,
        expiresAtMs: Date.now() + 60_000,
      });

    const completedPayload = JSON.stringify({
      id: "evt_credit_checkout_completed",
      object: "event",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_credit_1",
          object: "checkout.session",
          client_reference_id: "org_test",
          payment_status: "paid",
          payment_intent: "pi_credit_1",
          amount_total: 1000,
          metadata: {
            org_id: "org_test",
            credit_package_index: "0",
            credits: "100",
            price_cents: "1000",
          },
        },
      },
    });
    const asyncSucceededPayload = JSON.stringify({
      id: "evt_credit_checkout_async",
      object: "event",
      type: "checkout.session.async_payment_succeeded",
      data: {
        object: {
          id: "cs_credit_1",
          object: "checkout.session",
          client_reference_id: "org_test",
          payment_status: "paid",
          payment_intent: "pi_credit_1",
          amount_total: 1000,
          metadata: {
            org_id: "org_test",
            credit_package_index: "0",
            credits: "100",
            price_cents: "1000",
          },
        },
      },
    });

    const completedResponse = await dispatchStartOwnedBillingRequest(
      new Request("http://127.0.0.1/webhooks/stripe-billing", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": signStripePayload(completedPayload),
        },
        body: completedPayload,
      }),
      deps,
    );
    const asyncSucceededResponse = await dispatchStartOwnedBillingRequest(
      new Request("http://127.0.0.1/webhooks/stripe-billing", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": signStripePayload(asyncSucceededPayload),
        },
        body: asyncSucceededPayload,
      }),
      deps,
    );

    expect(completedResponse?.status).toBe(200);
    expect(asyncSucceededResponse?.status).toBe(200);
    expect(deps.convex.addPurchasedCredits).toHaveBeenCalledTimes(1);
    expect(deps.convex.addPurchasedCredits).toHaveBeenCalledWith({
      orgId: "org_test",
      credits: 100,
      priceCents: 1000,
      stripePaymentIntentId: "pi_credit_1",
    });
  });

  it("does not grant credits for async payment failures", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_billing");
    vi.stubEnv("STRIPE_BILLING_WEBHOOK_SECRET", "whsec_billing");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_billing");

    const deps = createDeps();
    const rawBody = JSON.stringify({
      id: "evt_credit_checkout_failed",
      object: "event",
      type: "checkout.session.async_payment_failed",
      data: {
        object: {
          id: "cs_credit_failed",
          object: "checkout.session",
          client_reference_id: "org_test",
          payment_status: "unpaid",
          payment_intent: "pi_credit_failed",
          amount_total: 1000,
          metadata: {
            org_id: "org_test",
            credit_package_index: "0",
            credits: "100",
            price_cents: "1000",
          },
        },
      },
    });

    const response = await dispatchStartOwnedBillingRequest(
      new Request("http://127.0.0.1/webhooks/stripe-billing", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": signStripePayload(rawBody),
        },
        body: rawBody,
      }),
      deps,
    );

    expect(response?.status).toBe(200);
    expect(deps.convex.addPurchasedCredits).not.toHaveBeenCalled();
  });

  it("fulfills automation run top-up purchases from valid webhook metadata", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_billing");
    vi.stubEnv("STRIPE_BILLING_WEBHOOK_SECRET", "whsec_billing");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_billing");

    const deps = createDeps();
    const rawBody = JSON.stringify({
      id: "evt_run_topup_completed",
      object: "event",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_run_topup_1",
          object: "checkout.session",
          client_reference_id: "org_test",
          payment_status: "paid",
          payment_intent: "pi_run_topup_1",
          amount_total: 1500,
          metadata: {
            org_id: "org_test",
            purchase_type: "automation_run_topup",
            tier: "starter",
            multiplier: "1x",
            runs: "1500",
            tool_calls: "75000",
            tool_call_time_ms: "7200000",
            price_cents: "1500",
          },
        },
      },
    });

    const response = await dispatchStartOwnedBillingRequest(
      new Request("http://127.0.0.1/webhooks/stripe-billing", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": signStripePayload(rawBody),
        },
        body: rawBody,
      }),
      deps,
    );

    expect(response?.status).toBe(200);
    expect(deps.convex.addPurchasedAutomationRuns).toHaveBeenCalledWith({
      orgId: "org_test",
      tier: "starter",
      multiplier: "1x",
      runs: 1500,
      toolCalls: 75000,
      toolCallTimeMs: 7200000,
      priceCents: 1500,
      stripePaymentIntentId: "pi_run_topup_1",
    });
  });

  it("ignores automation run top-up webhooks with invalid metadata", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_billing");
    vi.stubEnv("STRIPE_BILLING_WEBHOOK_SECRET", "whsec_billing");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_billing");

    const deps = createDeps();
    const rawBody = JSON.stringify({
      id: "evt_run_topup_invalid",
      object: "event",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_run_topup_invalid",
          object: "checkout.session",
          client_reference_id: "org_test",
          payment_status: "paid",
          payment_intent: "pi_run_topup_invalid",
          amount_total: 1500,
          metadata: {
            org_id: "org_test",
            purchase_type: "automation_run_topup",
            tier: "free",
            multiplier: "1x",
            runs: "NaN",
            tool_calls: "75000",
            tool_call_time_ms: "7200000",
            price_cents: "1500",
          },
        },
      },
    });

    const response = await dispatchStartOwnedBillingRequest(
      new Request("http://127.0.0.1/webhooks/stripe-billing", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": signStripePayload(rawBody),
        },
        body: rawBody,
      }),
      deps,
    );

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({
      received: true,
      ignored: true,
    });
    expect(deps.convex.addPurchasedAutomationRuns).not.toHaveBeenCalled();
    expect(deps.convex.completeApiDedupeKey).toHaveBeenCalledWith({
      scope: "webhook_delivery",
      dedupeKey: "stripe-billing:automation-run-topup-purchase:pi_run_topup_invalid",
    });
    expect(deps.convex.completeApiDedupeKey).toHaveBeenCalledWith({
      scope: "webhook_delivery",
      dedupeKey: "stripe-billing:evt_run_topup_invalid",
    });
    expect(deps.convex.releaseApiDedupeKey).not.toHaveBeenCalled();
  });

  it("provisions bundled gateway keys on paid subscription updates", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_billing");
    vi.stubEnv("STRIPE_BILLING_WEBHOOK_SECRET", "whsec_billing");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_billing");
    vi.stubEnv("STRIPE_STARTER_PRICE_ID", "price_starter_test");
    vi.stubEnv("KEPPO_LLM_GATEWAY_URL", "https://gateway.keppo.test");
    vi.stubEnv("KEPPO_LLM_GATEWAY_MASTER_KEY", "gateway_master_test");
    vi.stubEnv("KEPPO_LLM_GATEWAY_TEAM_ID", "team_keppo");

    const deps = createDeps();
    vi.mocked(deps.convex.getSubscriptionByStripeSubscription).mockResolvedValueOnce({
      id: "subrow_1",
      org_id: "org_test",
      tier: "starter",
      status: "active",
      current_period_start: "2026-02-01T00:00:00.000Z",
      current_period_end: "2026-03-01T00:00:00.000Z",
      stripe_subscription_id: "sub_test",
      stripe_customer_id: "cus_test",
      created_at: "2026-02-01T00:00:00.000Z",
      updated_at: "2026-02-01T00:00:00.000Z",
    });
    const fetchSpy = vi.fn<typeof fetch>(async (input, init) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if ((init?.method ?? "GET") === "GET" && url.includes("/user/info")) {
        return new Response(null, { status: 404 });
      }
      if ((init?.method ?? "GET") === "POST" && url.endsWith("/user/new")) {
        return new Response(JSON.stringify({ key: "sk_gateway_test" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);
    const rawBody = JSON.stringify({
      id: "evt_subscription_updated_1",
      object: "event",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_test",
          object: "subscription",
          status: "active",
          customer: "cus_test",
          current_period_start: 1772323200,
          current_period_end: 1775001600,
          items: {
            data: [
              {
                price: {
                  id: "price_starter_test",
                },
              },
            ],
          },
        },
      },
    });

    const response = await dispatchStartOwnedBillingRequest(
      new Request("http://127.0.0.1/webhooks/stripe-billing", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": signStripePayload(rawBody),
        },
        body: rawBody,
      }),
      deps,
    );

    expect(response?.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(deps.convex.upsertBundledOrgAiKey).toHaveBeenCalledTimes(2);
  });

  it("reads billing periods from subscription items when Stripe omits deprecated subscription period fields", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_billing");
    vi.stubEnv("STRIPE_BILLING_WEBHOOK_SECRET", "whsec_billing");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_billing");
    vi.stubEnv("STRIPE_STARTER_PRICE_ID", "price_starter_test");

    const deps = createDeps();
    const retrieveSubscription = vi.fn(async () => ({
      id: "sub_item_periods",
      status: "active",
      customer: "cus_test",
      items: {
        data: [
          {
            current_period_start: 1_772_323_200,
            current_period_end: 1_775_001_600,
            price: {
              id: "price_starter_test",
            },
          },
        ],
      },
    }));
    const rawBody = JSON.stringify({
      id: "evt_checkout_session_item_periods",
      object: "event",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_item_periods",
          object: "checkout.session",
          payment_status: "paid",
          metadata: {
            org_id: "org_test",
            tier: "starter",
          },
          client_reference_id: "org_test",
          customer: "cus_test",
          subscription: "sub_item_periods",
        },
      },
    });
    deps.getStripeClient = () =>
      ({
        webhooks: {
          constructEvent: vi.fn(() => JSON.parse(rawBody)),
        },
        subscriptions: {
          retrieve: retrieveSubscription,
        },
      }) as unknown as ReturnType<NonNullable<typeof deps.getStripeClient>>;

    const response = await dispatchStartOwnedBillingRequest(
      new Request("http://127.0.0.1/webhooks/stripe-billing", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": signStripePayload(rawBody),
        },
        body: rawBody,
      }),
      deps,
    );

    expect(response?.status).toBe(200);
    expect(retrieveSubscription).toHaveBeenCalledWith("sub_item_periods");
    expect(deps.convex.upsertSubscriptionForOrg).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org_test",
        stripeSubscriptionId: "sub_item_periods",
        currentPeriodStart: "2026-03-01T00:00:00.000Z",
        currentPeriodEnd: "2026-04-01T00:00:00.000Z",
      }),
    );
  });

  it("prefers a complete item period instead of mixing incomplete subscription and item fields", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_billing");
    vi.stubEnv("STRIPE_BILLING_WEBHOOK_SECRET", "whsec_billing");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_billing");
    vi.stubEnv("STRIPE_STARTER_PRICE_ID", "price_starter_test");

    const deps = createDeps();
    const rawBody = JSON.stringify({
      id: "evt_checkout_session_item_period_preferred",
      object: "event",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_item_period_preferred",
          object: "checkout.session",
          payment_status: "paid",
          metadata: {
            org_id: "org_test",
            tier: "starter",
          },
          client_reference_id: "org_test",
          customer: "cus_test",
          subscription: "sub_item_period_preferred",
        },
      },
    });
    deps.getStripeClient = () =>
      ({
        webhooks: {
          constructEvent: vi.fn(() => JSON.parse(rawBody)),
        },
        subscriptions: {
          retrieve: vi.fn(async () => ({
            id: "sub_item_period_preferred",
            status: "active",
            customer: "cus_test",
            current_period_start: 1_772_236_800,
            items: {
              data: [
                {
                  current_period_start: 1_772_323_200,
                  current_period_end: 1_775_001_600,
                  price: {
                    id: "price_starter_test",
                  },
                },
              ],
            },
          })),
        },
      }) as unknown as ReturnType<NonNullable<typeof deps.getStripeClient>>;

    const response = await dispatchStartOwnedBillingRequest(
      new Request("http://127.0.0.1/webhooks/stripe-billing", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": signStripePayload(rawBody),
        },
        body: rawBody,
      }),
      deps,
    );

    expect(response?.status).toBe(200);
    expect(deps.convex.upsertSubscriptionForOrg).toHaveBeenCalledWith(
      expect.objectContaining({
        currentPeriodStart: "2026-03-01T00:00:00.000Z",
        currentPeriodEnd: "2026-04-01T00:00:00.000Z",
      }),
    );
  });

  it("fails closed when Stripe subscription webhooks do not include any readable billing period", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_billing");
    vi.stubEnv("STRIPE_BILLING_WEBHOOK_SECRET", "whsec_billing");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_billing");
    vi.stubEnv("STRIPE_STARTER_PRICE_ID", "price_starter_test");

    const deps = createDeps();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const rawBody = JSON.stringify({
      id: "evt_checkout_session_missing_periods",
      object: "event",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_missing_periods",
          object: "checkout.session",
          payment_status: "paid",
          metadata: {
            org_id: "org_test",
            tier: "starter",
          },
          client_reference_id: "org_test",
          customer: "cus_test",
          subscription: "sub_missing_periods",
        },
      },
    });
    deps.getStripeClient = () =>
      ({
        webhooks: {
          constructEvent: vi.fn(() => JSON.parse(rawBody)),
        },
        subscriptions: {
          retrieve: vi.fn(async () => ({
            id: "sub_missing_periods",
            status: "active",
            customer: "cus_test",
            items: {
              data: [
                {
                  price: {
                    id: "price_starter_test",
                  },
                },
              ],
            },
          })),
        },
      }) as unknown as ReturnType<NonNullable<typeof deps.getStripeClient>>;

    const response = await dispatchStartOwnedBillingRequest(
      new Request("http://127.0.0.1/webhooks/stripe-billing", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": signStripePayload(rawBody),
        },
        body: rawBody,
      }),
      deps,
    );

    expect(response?.status).toBe(500);
    await expect(response?.json()).resolves.toEqual({
      error: {
        code: "webhook_processing_failed",
        message: "Stripe billing webhook processing failed.",
      },
    });
    expect(consoleError).toHaveBeenCalledWith("billing.webhook.subscription_period_missing", {
      eventType: "checkout.session.completed",
      stripeEventId: "evt_checkout_session_missing_periods",
      orgId: "org_test",
      subscriptionId: "sub_missing_periods",
    });
    expect(deps.convex.upsertSubscriptionForOrg).not.toHaveBeenCalled();
  });

  it("fails closed when checkout completion cannot resolve a paid tier from Stripe", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_billing");
    vi.stubEnv("STRIPE_BILLING_WEBHOOK_SECRET", "whsec_billing");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_billing");

    const deps = createDeps();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const rawBody = JSON.stringify({
      id: "evt_checkout_session_missing_price",
      object: "event",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_missing_price",
          object: "checkout.session",
          payment_status: "paid",
          metadata: {
            org_id: "org_test",
            tier: "enterprise",
          },
          client_reference_id: "org_test",
          customer: "cus_test",
          subscription: "sub_missing_price",
        },
      },
    });
    deps.getStripeClient = () =>
      ({
        webhooks: {
          constructEvent: vi.fn(() => JSON.parse(rawBody)),
        },
        subscriptions: {
          retrieve: vi.fn(async () => ({
            id: "sub_missing_price",
            status: "active",
            customer: "cus_test",
            current_period_start: 1_772_323_200,
            current_period_end: 1_775_001_600,
            items: {
              data: [{}],
            },
          })),
        },
      }) as unknown as ReturnType<NonNullable<typeof deps.getStripeClient>>;

    const response = await dispatchStartOwnedBillingRequest(
      new Request("http://127.0.0.1/webhooks/stripe-billing", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": signStripePayload(rawBody),
        },
        body: rawBody,
      }),
      deps,
    );

    expect(response?.status).toBe(500);
    await expect(response?.json()).resolves.toEqual({
      error: {
        code: "webhook_processing_failed",
        message: "Stripe subscription price does not match a known Keppo tier.",
      },
    });
    expect(consoleError).toHaveBeenCalledWith("billing.webhook.subscription_tier_unresolved", {
      eventType: "checkout.session.completed",
      stripeEventId: "evt_checkout_session_missing_price",
      stripeSubscriptionId: "sub_missing_price",
      orgId: "org_test",
      priceId: null,
    });
    expect(deps.convex.upsertSubscriptionForOrg).not.toHaveBeenCalled();
  });

  it("fails closed when subscription updates omit the Stripe price id", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_billing");
    vi.stubEnv("STRIPE_BILLING_WEBHOOK_SECRET", "whsec_billing");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_billing");

    const deps = createDeps();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(deps.convex.getSubscriptionByStripeSubscription).mockResolvedValueOnce({
      id: "subrow_1",
      org_id: "org_test",
      tier: "starter",
      status: "active",
      current_period_start: "2026-02-01T00:00:00.000Z",
      current_period_end: "2026-03-01T00:00:00.000Z",
      stripe_subscription_id: "sub_missing_price_update",
      stripe_customer_id: "cus_test",
      created_at: "2026-02-01T00:00:00.000Z",
      updated_at: "2026-02-01T00:00:00.000Z",
    });
    const rawBody = JSON.stringify({
      id: "evt_subscription_updated_missing_price",
      object: "event",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_missing_price_update",
          object: "subscription",
          status: "active",
          customer: "cus_test",
          current_period_start: 1_772_323_200,
          current_period_end: 1_775_001_600,
          items: {
            data: [{}],
          },
        },
      },
    });

    const response = await dispatchStartOwnedBillingRequest(
      new Request("http://127.0.0.1/webhooks/stripe-billing", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": signStripePayload(rawBody),
        },
        body: rawBody,
      }),
      deps,
    );

    expect(response?.status).toBe(500);
    await expect(response?.json()).resolves.toEqual({
      error: {
        code: "webhook_processing_failed",
        message: "Stripe subscription price does not match a known Keppo tier.",
      },
    });
    expect(consoleError).toHaveBeenCalledWith("billing.webhook.subscription_tier_unresolved", {
      eventType: "customer.subscription.updated",
      stripeEventId: "evt_subscription_updated_missing_price",
      stripeSubscriptionId: "sub_missing_price_update",
      orgId: "org_test",
      priceId: null,
    });
    expect(deps.convex.setSubscriptionStatusByStripeSubscription).not.toHaveBeenCalled();
  });

  it("revokes bundled access after subscription deletion", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_billing");
    vi.stubEnv("STRIPE_BILLING_WEBHOOK_SECRET", "whsec_billing");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_billing");
    vi.stubEnv("KEPPO_MASTER_KEY", "keppo-master-key-for-billing-tests");
    vi.stubEnv("KEPPO_LLM_GATEWAY_URL", "https://gateway.keppo.test");
    vi.stubEnv("KEPPO_LLM_GATEWAY_MASTER_KEY", "gateway_master_test");
    vi.stubEnv("KEPPO_LLM_GATEWAY_TEAM_ID", "team_keppo");

    const deps = createDeps();
    vi.mocked(deps.convex.getSubscriptionByStripeSubscription).mockResolvedValueOnce({
      id: "subrow_1",
      org_id: "org_test",
      tier: "starter",
      status: "active",
      current_period_start: "2026-03-01T00:00:00.000Z",
      current_period_end: "2026-04-01T00:00:00.000Z",
      stripe_subscription_id: "sub_test",
      stripe_customer_id: "cus_test",
      created_at: "2026-03-01T00:00:00.000Z",
      updated_at: "2026-03-01T00:00:00.000Z",
    });
    vi.mocked(deps.convex.getOrgAiKey).mockResolvedValueOnce({
      id: "oaik_bundled",
      org_id: "org_test",
      provider: "openai",
      key_mode: "bundled",
      encrypted_key: await encryptStoredKeyForTest(
        process.env.KEPPO_MASTER_KEY!,
        "sk_gateway_test",
      ),
      credential_kind: "secret",
      is_active: true,
      key_hint: "...test",
      key_version: 1,
      subject_email: null,
      account_id: null,
      token_expires_at: null,
      last_refreshed_at: null,
      last_validated_at: null,
      created_by: "billing",
      created_at: "2026-03-01T00:00:00.000Z",
      updated_at: "2026-03-01T00:00:00.000Z",
    });
    const fetchSpy = vi.fn<typeof fetch>(async (input, init) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if ((init?.method ?? "GET") === "POST" && url.endsWith("/key/delete")) {
        return new Response(null, { status: 200 });
      }
      if ((init?.method ?? "GET") === "POST" && url.endsWith("/user/delete")) {
        return new Response(null, { status: 200 });
      }
      throw new Error(`Unexpected fetch ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);
    const rawBody = JSON.stringify({
      id: "evt_subscription_deleted_1",
      object: "event",
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_test",
          object: "subscription",
          customer: "cus_test",
        },
      },
    });

    const response = await dispatchStartOwnedBillingRequest(
      new Request("http://127.0.0.1/webhooks/stripe-billing", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": signStripePayload(rawBody),
        },
        body: rawBody,
      }),
      deps,
    );

    expect(response?.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(deps.convex.setSubscriptionStatusByStripeSubscription).toHaveBeenCalledWith({
      stripeSubscriptionId: "sub_test",
      status: "canceled",
      tier: "free",
      currentPeriodStart: "",
      currentPeriodEnd: "",
    });
    expect(deps.convex.deactivateBundledOrgAiKeys).toHaveBeenCalledWith({
      orgId: "org_test",
    });
  });

  it("still revokes the gateway user when no local bundled key can be recovered", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_billing");
    vi.stubEnv("STRIPE_BILLING_WEBHOOK_SECRET", "whsec_billing");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_billing");
    vi.stubEnv("KEPPO_LLM_GATEWAY_URL", "https://gateway.keppo.test");
    vi.stubEnv("KEPPO_LLM_GATEWAY_MASTER_KEY", "gateway_master_test");
    vi.stubEnv("KEPPO_LLM_GATEWAY_TEAM_ID", "team_keppo");

    const deps = createDeps();
    vi.mocked(deps.convex.getSubscriptionByStripeSubscription).mockResolvedValueOnce({
      id: "subrow_1",
      org_id: "org_test",
      tier: "starter",
      status: "active",
      current_period_start: "2026-03-01T00:00:00.000Z",
      current_period_end: "2026-04-01T00:00:00.000Z",
      stripe_subscription_id: "sub_test",
      stripe_customer_id: "cus_test",
      created_at: "2026-03-01T00:00:00.000Z",
      updated_at: "2026-03-01T00:00:00.000Z",
    });
    vi.mocked(deps.convex.getOrgAiKey).mockResolvedValue(null);
    const fetchSpy = vi.fn<typeof fetch>(async (input, init) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if ((init?.method ?? "GET") === "POST" && url.endsWith("/user/delete")) {
        return new Response(null, { status: 200 });
      }
      throw new Error(`Unexpected fetch ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);
    const rawBody = JSON.stringify({
      id: "evt_subscription_deleted_2",
      object: "event",
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_test",
          object: "subscription",
          customer: "cus_test",
        },
      },
    });

    const response = await dispatchStartOwnedBillingRequest(
      new Request("http://127.0.0.1/webhooks/stripe-billing", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": signStripePayload(rawBody),
        },
        body: rawBody,
      }),
      deps,
    );

    expect(response?.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(deps.convex.deactivateBundledOrgAiKeys).toHaveBeenCalledWith({
      orgId: "org_test",
    });
  });

  it("marks subscriptions past due when Stripe reports an invoice payment failure", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_billing");
    vi.stubEnv("STRIPE_BILLING_WEBHOOK_SECRET", "whsec_billing");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_billing");

    const deps = createDeps();
    vi.mocked(deps.convex.getSubscriptionByStripeCustomer).mockResolvedValueOnce({
      id: "subrow_past_due",
      org_id: "org_test",
      tier: "pro",
      status: "active",
      current_period_start: "2026-03-01T00:00:00.000Z",
      current_period_end: "2026-04-01T00:00:00.000Z",
      stripe_customer_id: "cus_test",
      stripe_subscription_id: "sub_test",
      created_at: "2026-03-01T00:00:00.000Z",
      updated_at: "2026-03-01T00:00:00.000Z",
    });
    const rawBody = JSON.stringify({
      id: "evt_invoice_payment_failed",
      object: "event",
      type: "invoice.payment_failed",
      data: {
        object: {
          id: "in_failed",
          object: "invoice",
          customer: "cus_test",
        },
      },
    });

    const response = await dispatchStartOwnedBillingRequest(
      new Request("http://127.0.0.1/webhooks/stripe-billing", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": signStripePayload(rawBody),
        },
        body: rawBody,
      }),
      deps,
    );

    expect(response?.status).toBe(200);
    expect(deps.convex.setSubscriptionStatusByCustomer).toHaveBeenCalledWith({
      stripeCustomerId: "cus_test",
      status: "past_due",
    });
  });

  it("restores active status when Stripe later reports a paid invoice", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_billing");
    vi.stubEnv("STRIPE_BILLING_WEBHOOK_SECRET", "whsec_billing");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_billing");

    const deps = createDeps();
    vi.mocked(deps.convex.getSubscriptionByStripeCustomer).mockResolvedValueOnce({
      id: "subrow_recovered",
      org_id: "org_test",
      tier: "pro",
      status: "past_due",
      current_period_start: "2026-03-01T00:00:00.000Z",
      current_period_end: "2026-04-01T00:00:00.000Z",
      stripe_customer_id: "cus_test",
      stripe_subscription_id: "sub_test",
      created_at: "2026-03-01T00:00:00.000Z",
      updated_at: "2026-03-15T00:00:00.000Z",
    });
    const rawBody = JSON.stringify({
      id: "evt_invoice_paid",
      object: "event",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_paid",
          object: "invoice",
          customer: "cus_test",
        },
      },
    });

    const response = await dispatchStartOwnedBillingRequest(
      new Request("http://127.0.0.1/webhooks/stripe-billing", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": signStripePayload(rawBody),
        },
        body: rawBody,
      }),
      deps,
    );

    expect(response?.status).toBe(200);
    expect(deps.convex.setSubscriptionStatusByCustomer).toHaveBeenCalledWith({
      stripeCustomerId: "cus_test",
      status: "active",
    });
  });

  it("returns pending cancellation from GET subscription pending-change", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_billing");
    const deps = createDeps();
    vi.mocked(deps.convex.getSubscriptionForOrg).mockResolvedValue({
      id: "subrow_org",
      org_id: "org_test",
      tier: "starter",
      status: "active",
      current_period_start: "2026-03-01T00:00:00.000Z",
      current_period_end: "2026-04-01T00:00:00.000Z",
      stripe_customer_id: "cus_test",
      stripe_subscription_id: "sub_test",
      created_at: "2026-03-01T00:00:00.000Z",
      updated_at: "2026-03-01T00:00:00.000Z",
    });
    const cancelAtUnix = 1_774_966_400;
    deps.getStripeClient = () =>
      ({
        subscriptions: {
          retrieve: vi.fn(async () => ({
            id: "sub_test",
            cancel_at_period_end: true,
            cancel_at: cancelAtUnix,
            schedule: null,
          })),
        },
      }) as unknown as ReturnType<NonNullable<typeof deps.getStripeClient>>;

    const response = await dispatchStartOwnedBillingRequest(
      new Request("http://127.0.0.1/api/billing/subscription/pending-change?orgId=org_test", {
        headers: {
          cookie: "better-auth.session_token=session_token_test",
        },
      }),
      deps,
    );

    expect(response).not.toBeNull();
    expect(response!.status).toBe(200);
    await expect(response!.json()).resolves.toEqual({
      cancel_at_period_end: true,
      pending_tier: "free",
      pending_effective_at: new Date(cancelAtUnix * 1000).toISOString(),
    });
  });

  it("creates subscription schedule phases when downgrading pro to starter", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_billing");
    vi.stubEnv("STRIPE_STARTER_PRICE_ID", "price_starter_test");
    vi.stubEnv("STRIPE_PRO_PRICE_ID", "price_pro_test");
    const scheduleUpdate = vi.fn(async () => ({}));
    const scheduleCreate = vi.fn(async () => ({ id: "sched_1" }));
    const customersUpdate = vi.fn(async () => ({}));
    const deps = createDeps();

    deps.getStripeClient = () =>
      ({
        customers: { update: customersUpdate },
        subscriptions: {
          retrieve: vi.fn(async () => ({
            id: "sub_test",
            status: "active",
            cancel_at_period_end: false,
            current_period_start: 1000,
            current_period_end: 2000,
            default_payment_method: "pm_1",
            items: { data: [{ id: "si_1", price: { id: "price_pro_test" } }] },
            schedule: null,
          })),
          update: vi.fn(),
        },
        subscriptionSchedules: {
          create: scheduleCreate,
          update: scheduleUpdate,
          release: vi.fn(),
        },
      }) as unknown as ReturnType<NonNullable<typeof deps.getStripeClient>>;

    const response = await dispatchStartOwnedBillingRequest(
      new Request("http://127.0.0.1/api/billing/subscription/change", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "better-auth.session_token=session_token_test",
        },
        body: JSON.stringify({
          orgId: "org_test",
          targetTier: "starter",
          billing: {
            name: "Test User",
            address: {
              line1: "1 Main St",
              postalCode: "94102",
              country: "us",
            },
          },
        }),
      }),
      deps,
    );

    expect(response).not.toBeNull();
    expect(response!.status).toBe(200);
    expect(customersUpdate).toHaveBeenCalledTimes(1);
    expect(scheduleCreate).toHaveBeenCalledWith(
      { from_subscription: "sub_test" },
      expect.objectContaining({
        idempotencyKey: expect.stringContaining("keppo-billing-schedule-from"),
      }),
    );
    expect(scheduleUpdate).toHaveBeenCalledWith(
      "sched_1",
      {
        phases: [
          {
            items: [{ price: "price_pro_test", quantity: 1 }],
            start_date: 1000,
            end_date: 2000,
          },
          {
            items: [{ price: "price_starter_test", quantity: 1 }],
            start_date: 2000,
          },
        ],
        proration_behavior: "none",
      },
      expect.objectContaining({
        idempotencyKey: expect.stringContaining("keppo-billing-downgrade"),
      }),
    );
    await expect(response!.json()).resolves.toMatchObject({
      ok: true,
      downgrade_scheduled: true,
      pending_tier: "starter",
    });
  });

  it("rejects subscription plan changes for non-owner members", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_billing");
    const deps = createDeps();
    vi.mocked(deps.resolveApiSessionIdentity).mockResolvedValueOnce({
      userId: "user_viewer",
      orgId: "org_test",
      role: "viewer",
    });

    const response = await dispatchStartOwnedBillingRequest(
      new Request("http://127.0.0.1/api/billing/subscription/change", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "better-auth.session_token=session_token_test",
        },
        body: JSON.stringify({
          orgId: "org_test",
          undoCancelAtPeriodEnd: true,
        }),
      }),
      deps,
    );

    expect(response).not.toBeNull();
    expect(response!.status).toBe(403);
    await expect(response!.json()).resolves.toEqual({
      error: {
        code: "billing.forbidden",
        message: "Only owners and admins can change subscription plans.",
      },
    });
  });

  it("rejects billing Stripe session routes for non-owner members", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_billing");
    vi.stubEnv("STRIPE_STARTER_PRICE_ID", "price_starter_test");
    vi.stubEnv("STRIPE_CREDIT_PRODUCT_ID", "prod_credits");
    vi.stubEnv("STRIPE_AUTOMATION_RUN_PRODUCT_ID", "prod_run_topups");

    const cases = [
      {
        pathname: "/api/billing/checkout",
        body: {
          orgId: "org_test",
          tier: "starter",
        },
        expectedMessage: "Only owners and admins can start checkout.",
      },
      {
        pathname: "/api/billing/credits/checkout",
        body: {
          orgId: "org_test",
          packageIndex: 0,
        },
        expectedMessage: "Only owners and admins can buy AI credits.",
      },
      {
        pathname: "/api/billing/automation-runs/checkout",
        body: {
          orgId: "org_test",
          packageIndex: 0,
        },
        expectedMessage: "Only owners and admins can buy automation run top-ups.",
      },
      {
        pathname: "/api/billing/portal",
        body: {
          orgId: "org_test",
        },
        expectedMessage: "Only owners and admins can manage billing.",
      },
    ] as const;

    for (const role of ["viewer", "approver"] as const) {
      for (const testCase of cases) {
        const deps = createDeps();
        vi.mocked(deps.resolveApiSessionIdentity).mockResolvedValueOnce({
          userId: `user_${role}`,
          orgId: "org_test",
          role,
        });

        const response = await dispatchStartOwnedBillingRequest(
          new Request(`http://127.0.0.1${testCase.pathname}`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              cookie: "better-auth.session_token=session_token_test",
            },
            body: JSON.stringify(testCase.body),
          }),
          deps,
        );

        expect(response).not.toBeNull();
        expect(response!.status).toBe(403);
        await expect(response!.json()).resolves.toEqual({
          error: {
            code: "billing.forbidden",
            message: testCase.expectedMessage,
          },
        });
      }
    }
  });

  it("allows cancel-to-free without billing details or a payment method", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_billing");
    vi.stubEnv("STRIPE_PRO_PRICE_ID", "price_pro_test");
    const deps = createDeps();
    const cancelUpdate = vi.fn(async () => ({}));

    deps.getStripeClient = () =>
      ({
        subscriptions: {
          retrieve: vi.fn(async () => ({
            id: "sub_test",
            status: "active",
            cancel_at_period_end: false,
            current_period_start: 1000,
            current_period_end: 2000,
            default_payment_method: null,
            items: { data: [{ id: "si_1", price: { id: "price_pro_test" } }] },
            schedule: null,
          })),
          update: cancelUpdate,
        },
        subscriptionSchedules: {
          release: vi.fn(),
        },
      }) as unknown as ReturnType<NonNullable<typeof deps.getStripeClient>>;

    const response = await dispatchStartOwnedBillingRequest(
      new Request("http://127.0.0.1/api/billing/subscription/change", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "better-auth.session_token=session_token_test",
        },
        body: JSON.stringify({
          orgId: "org_test",
          targetTier: "free",
        }),
      }),
      deps,
    );

    expect(response).not.toBeNull();
    expect(response!.status).toBe(200);
    expect(cancelUpdate).toHaveBeenCalledWith(
      "sub_test",
      { cancel_at_period_end: true },
      expect.objectContaining({
        idempotencyKey: "keppo-billing-cancel-end-org_test-2000",
      }),
    );
    expect(deps.convex.createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: "user",
        actorId: "user_test",
        eventType: "billing.subscription_updated",
        payload: expect.objectContaining({
          action: "cancel_at_period_end",
          requested_target_tier: "free",
        }),
      }),
    );
  });

  it("fails closed for subscription changes when Stripe omits the current billing period", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_billing");
    vi.stubEnv("STRIPE_PRO_PRICE_ID", "price_pro_test");
    const deps = createDeps();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    deps.getStripeClient = () =>
      ({
        subscriptions: {
          retrieve: vi.fn(async () => ({
            id: "sub_test",
            status: "active",
            cancel_at_period_end: false,
            default_payment_method: null,
            items: { data: [{ id: "si_1", price: { id: "price_pro_test" } }] },
            schedule: null,
          })),
          update: vi.fn(),
        },
        subscriptionSchedules: {
          release: vi.fn(),
        },
      }) as unknown as ReturnType<NonNullable<typeof deps.getStripeClient>>;

    const response = await dispatchStartOwnedBillingRequest(
      new Request("http://127.0.0.1/api/billing/subscription/change", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "better-auth.session_token=session_token_test",
        },
        body: JSON.stringify({
          orgId: "org_test",
          targetTier: "free",
        }),
      }),
      deps,
    );

    expect(response).not.toBeNull();
    expect(response!.status).toBe(503);
    await expect(response!.json()).resolves.toEqual({
      error: {
        code: "billing_subscription_period_unavailable",
        message:
          "Stripe did not return the current billing period needed to schedule this cancellation. Please try again.",
      },
    });
    expect(consoleError).toHaveBeenCalledWith(
      "billing.subscription_change.subscription_period_missing",
      {
        orgId: "org_test",
        subscriptionId: "sub_test",
      },
    );
  });

  it("sanitizes unexpected subscription change failures", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_billing");
    const deps = createDeps();

    deps.getStripeClient = () =>
      ({
        subscriptions: {
          retrieve: vi.fn(async () => {
            throw new Error("Sensitive Stripe failure sub_123");
          }),
        },
      }) as unknown as ReturnType<NonNullable<typeof deps.getStripeClient>>;

    const response = await dispatchStartOwnedBillingRequest(
      new Request("http://127.0.0.1/api/billing/subscription/change", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "better-auth.session_token=session_token_test",
        },
        body: JSON.stringify({
          orgId: "org_test",
          targetTier: "free",
        }),
      }),
      deps,
    );

    expect(response).not.toBeNull();
    expect(response!.status).toBe(500);
    await expect(response!.json()).resolves.toEqual({
      error: {
        code: "subscription_change_failed",
        message: "Subscription change failed. Please try again.",
      },
    });
  });

  it("sanitizes unexpected pending-change failures", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_billing");
    const deps = createDeps();

    deps.getStripeClient = () =>
      ({
        subscriptions: {
          retrieve: vi.fn(async () => {
            throw new Error("Sensitive Stripe failure sched_123");
          }),
        },
      }) as unknown as ReturnType<NonNullable<typeof deps.getStripeClient>>;

    const response = await dispatchStartOwnedBillingRequest(
      new Request("http://127.0.0.1/api/billing/subscription/pending-change?orgId=org_test", {
        headers: {
          cookie: "better-auth.session_token=session_token_test",
        },
      }),
      deps,
    );

    expect(response).not.toBeNull();
    expect(response!.status).toBe(500);
    await expect(response!.json()).resolves.toEqual({
      error: {
        code: "pending_change_failed",
        message: "Could not load the pending subscription change. Please try again.",
      },
    });
  });

  it("sanitizes unexpected automation run checkout failures", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_billing");
    vi.stubEnv("STRIPE_STARTER_PRICE_ID", "price_starter_test");
    vi.stubEnv("STRIPE_AUTOMATION_RUN_PRODUCT_ID", "prod_run_topups");

    const deps = createDeps();
    deps.getStripeClient = () =>
      ({
        checkout: {
          sessions: {
            create: vi.fn(async () => {
              throw new Error("Sensitive Stripe failure cs_123");
            }),
          },
        },
      }) as unknown as ReturnType<NonNullable<typeof deps.getStripeClient>>;

    const response = await dispatchStartOwnedBillingRequest(
      new Request("http://127.0.0.1/api/billing/automation-runs/checkout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "better-auth.session_token=session_token_test",
        },
        body: JSON.stringify({
          orgId: "org_test",
          packageIndex: 0,
          successUrl: "/billing?runCheckout=success",
          cancelUrl: "/billing?runCheckout=cancel",
        }),
      }),
      deps,
    );

    expect(response).not.toBeNull();
    expect(response!.status).toBe(500);
    await expect(response!.json()).resolves.toEqual({
      error: {
        code: "automation_run_checkout_failed",
        message: "Automation run checkout failed. Please try again.",
      },
    });
  });
});
