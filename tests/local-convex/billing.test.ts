import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import { getTierConfig } from "../../packages/shared/src/subscriptions";
import type { DbSchema } from "../../packages/shared/src/types";
import {
  createCheckoutSessionFetch,
  createFakeStripeSubscription,
  getBillingUsageForOrg,
  createPortalSessionFetch,
  postStripeBillingWebhookFetch,
  setUsageMeterForOrg,
} from "../e2e/helpers/billing-hooks";
import {
  apiBaseUrl,
  convexUrl,
  createAdminClient,
  createApiSessionCookie,
  createRandomToken,
  createMcpClient,
  createStore,
  ensureLocalEmailPasswordUser,
  fakeGatewayBaseUrl,
  withLocalConvexNamespace,
} from "./harness";

const refs = {
  resetNamespace: makeFunctionReference<"mutation">("e2e:resetNamespace"),
  createInviteCodeForTesting: makeFunctionReference<"mutation">("e2e:createInviteCodeForTesting"),
  seedInvitePromoForOrg: makeFunctionReference<"mutation">("e2e:seedInvitePromoForOrg"),
  createWorkspaceForOrgWithLimitCheck: makeFunctionReference<"mutation">(
    "e2e:createWorkspaceForOrgWithLimitCheck",
  ),
};

type Tier = "free" | "starter" | "pro";
const BILLING_TEST_PASSWORD = "KeppoE2E!123";
type SeedableProvider =
  | "google"
  | "stripe"
  | "slack"
  | "github"
  | "notion"
  | "reddit"
  | "x"
  | "custom";

const providerScopes: Record<SeedableProvider, string[]> = {
  google: [
    "gmail.readonly",
    "gmail.send",
    "gmail.modify",
    "gmail.compose",
    "gmail.settings.basic",
    "gmail.labels",
  ],
  stripe: ["stripe.read", "stripe.write"],
  slack: ["slack.read", "slack.write"],
  github: ["repo:read", "repo:write", "workflow", "read:org"],
  notion: ["notion.read", "notion.write"],
  reddit: ["reddit.read", "reddit.write"],
  x: ["x.read", "x.write"],
  custom: ["custom.read", "custom.write"],
};

const tokenProviderByProvider: Record<SeedableProvider, string> = {
  google: "gmail",
  stripe: "stripe",
  slack: "slack",
  github: "github",
  notion: "notion",
  reddit: "reddit",
  x: "x",
  custom: "custom",
};

const latestSubscriptionForOrg = (
  subscriptions: DbSchema["subscriptions"],
  orgId: string,
): DbSchema["subscriptions"][number] => {
  const rows = subscriptions
    .filter((row) => row.org_id === orgId)
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  expect(rows.length).toBeGreaterThan(0);
  return rows[0]!;
};

const seedWorkspace = async (params: {
  namespace: string;
  suffix: string;
  subscriptionTier?: Tier;
  provider?: SeedableProvider;
  providerMetadata?: Record<string, unknown>;
}): Promise<{
  orgId: string;
  workspaceId: string;
  credentialSecret: string;
  userEmail: string;
}> => {
  const store = createStore();
  const userToken = `${params.namespace}.${params.suffix}.${createRandomToken()}`;
  const userId = `usr_${userToken}`;
  const userEmail = `e2e+${userToken}@example.com`;
  await ensureLocalEmailPasswordUser({
    headers: {
      "x-keppo-e2e-namespace": params.namespace,
      "x-e2e-scenario-id": params.suffix,
    },
    email: userEmail,
    password: BILLING_TEST_PASSWORD,
    name: "E2E User",
  });
  const orgId = await store.ensurePersonalOrgForUser({
    id: userId,
    email: userEmail,
    name: "E2E User",
  });

  const subscriptionTier = params.subscriptionTier ?? "free";
  await store.setOrgSubscription({
    org_id: orgId,
    tier: subscriptionTier,
    status: "active",
  });

  const workspace = await store.createWorkspace({
    org_id: orgId,
    name: `workspace-${params.suffix}-${createRandomToken()}`,
    policy_mode: "manual_only",
    default_action_behavior: "require_approval",
  });
  const credential = await store.rotateCredential(workspace.id);

  if (params.provider) {
    const tokenProvider = tokenProviderByProvider[params.provider];
    await store.connectIntegration({
      org_id: orgId,
      provider: params.provider,
      display_name: `${params.provider}-${params.suffix}`,
      scopes: providerScopes[params.provider],
      external_account_id: `${params.provider}+${userToken}@example.com`,
      access_token: `fake_${tokenProvider}_access_token`,
      refresh_token: `fake_${tokenProvider}_refresh_token`,
      credential_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      metadata: {
        e2e_namespace: params.namespace,
        provider: params.provider,
        ...params.providerMetadata,
      },
    });
    await store.setWorkspaceIntegrations({
      workspace_id: workspace.id,
      providers: [params.provider],
    });
  }

  return {
    orgId,
    workspaceId: workspace.id,
    credentialSecret: credential.secret,
    userEmail,
  };
};

const createWorkspaceWithLimitCheck = async (orgId: string, name: string): Promise<string> => {
  const client = createAdminClient();
  return await client.mutation(refs.createWorkspaceForOrgWithLimitCheck, {
    orgId,
    name,
    policyMode: "manual_only",
    defaultActionBehavior: "require_approval",
  });
};

const createInviteCodeForTesting = async (params: {
  code: string;
  label: string;
  grantTier: Tier;
  active?: boolean;
}): Promise<string> => {
  return await createAdminClient().mutation(refs.createInviteCodeForTesting, {
    code: params.code,
    label: params.label,
    grantTier: params.grantTier,
    ...(params.active !== undefined ? { active: params.active } : {}),
  });
};

const seedInvitePromoForOrg = async (params: {
  orgId: string;
  inviteCodeId: string;
  grantTier: Extract<Tier, "starter" | "pro">;
  redeemedAt: string;
  expiresAt: string;
}): Promise<void> => {
  await createAdminClient().mutation(refs.seedInvitePromoForOrg, {
    orgId: params.orgId,
    inviteCodeId: params.inviteCodeId,
    grantTier: params.grantTier,
    status: "active",
    redeemedAt: params.redeemedAt,
    expiresAt: params.expiresAt,
  });
};

const createAuthenticatedHeaders = async (params: {
  headers: Record<string, string>;
  email: string;
  name?: string;
}): Promise<Record<string, string>> => {
  const cookie = await createApiSessionCookie({
    headers: params.headers,
    email: params.email,
    password: BILLING_TEST_PASSWORD,
    name: params.name ?? "E2E User",
  });
  return {
    ...params.headers,
    cookie,
  };
};

describe.sequential("Local Convex Billing Integration", { timeout: 120_000 }, () => {
  it("stripe billing webhook rejects invalid signatures", async () => {
    await withLocalConvexNamespace(
      "vitest.billing",
      "webhook-invalid-signature",
      async ({ headers }) => {
        const rawBody = JSON.stringify({
          id: "evt_invalid_signature",
          object: "event",
          type: "invoice.payment_failed",
          data: {
            object: {
              id: "in_invalid_signature",
              object: "invoice",
              customer: "cus_invalid_signature",
            },
          },
        });

        const response = await postStripeBillingWebhookFetch({
          baseUrl: apiBaseUrl,
          headers,
          rawBody,
          signature: "t=1,v1=deadbeef",
        });
        expect(response.status).toBe(400);
        const payload = (await response.json()) as {
          error?: {
            code?: string;
          };
        };
        expect(payload.error?.code).toBe("invalid_signature");
      },
    );
  });

  it("invoice.payment_failed marks subscription as past_due", async () => {
    await withLocalConvexNamespace(
      "vitest.billing",
      "webhook-invoice-failed",
      async ({ namespace, headers }) => {
        const store = createStore();
        const seeded = await seedWorkspace({
          namespace,
          suffix: "webhook-invoice-failed",
          subscriptionTier: "pro",
        });

        await store.setOrgSubscription({
          org_id: seeded.orgId,
          tier: "pro",
          status: "active",
          stripe_customer_id: "cus_webhook_invoice_failed",
          stripe_subscription_id: "sub_webhook_invoice_failed",
        });

        const rawBody = JSON.stringify({
          id: `evt_invoice_failed_${createRandomToken()}`,
          object: "event",
          type: "invoice.payment_failed",
          data: {
            object: {
              id: `in_failed_${createRandomToken()}`,
              object: "invoice",
              customer: "cus_webhook_invoice_failed",
            },
          },
        });

        const response = await postStripeBillingWebhookFetch({
          baseUrl: apiBaseUrl,
          headers,
          rawBody,
        });
        expect(response.status).toBe(200);

        const snapshot = await store.getDbSnapshot();
        const subscription = latestSubscriptionForOrg(snapshot.subscriptions, seeded.orgId);
        expect(subscription.status).toBe("past_due");
      },
    );
  });

  it("checkout.session.completed upgrades org tier from Stripe subscription price", async () => {
    await withLocalConvexNamespace(
      "vitest.billing",
      "webhook-checkout-completed",
      async ({ namespace, headers }) => {
        const seeded = await seedWorkspace({
          namespace,
          suffix: "webhook-checkout-completed",
          subscriptionTier: "free",
        });

        const checkoutResponse = await createCheckoutSessionFetch({
          baseUrl: apiBaseUrl,
          headers: await createAuthenticatedHeaders({
            headers,
            email: seeded.userEmail,
          }),
          orgId: seeded.orgId,
          tier: "pro",
          customerEmail: `e2e+${namespace}.checkout.customer@example.com`,
        });
        expect(checkoutResponse.status).toBe(200);

        const stripeSubscriptionId = await createFakeStripeSubscription({
          baseUrl: fakeGatewayBaseUrl,
          customer: "cus_100",
          priceId: process.env.STRIPE_PRO_PRICE_ID ?? "price_e2e_pro",
        });

        const rawBody = JSON.stringify({
          id: `evt_checkout_completed_${createRandomToken()}`,
          object: "event",
          type: "checkout.session.completed",
          data: {
            object: {
              id: `cs_checkout_completed_${createRandomToken()}`,
              object: "checkout.session",
              payment_status: "paid",
              metadata: {
                org_id: seeded.orgId,
                tier: "pro",
              },
              client_reference_id: seeded.orgId,
              customer: "cus_100",
              subscription: stripeSubscriptionId,
            },
          },
        });
        const webhookResponse = await postStripeBillingWebhookFetch({
          baseUrl: apiBaseUrl,
          headers,
          rawBody,
        });
        expect(webhookResponse.status).toBe(200);

        const snapshot = await createStore().getDbSnapshot();
        const subscription = latestSubscriptionForOrg(snapshot.subscriptions, seeded.orgId);
        expect(subscription.tier).toBe("pro");
        expect(subscription.status).toBe("active");
        expect(subscription.stripe_customer_id).toBe("cus_100");
        expect(subscription.stripe_subscription_id).toBe(stripeSubscriptionId);
      },
    );
  });

  it("checkout completion converts active invite promos to Stripe billing", async () => {
    await withLocalConvexNamespace(
      "vitest.billing",
      "checkout-converts-invite-promo",
      async ({ namespace, headers }) => {
        const seeded = await seedWorkspace({
          namespace,
          suffix: "checkout-converts-invite-promo",
          subscriptionTier: "free",
        });
        const inviteCodeId = await createInviteCodeForTesting({
          code: "PROM33",
          label: "Starter Promo",
          grantTier: "starter",
        });
        await seedInvitePromoForOrg({
          orgId: seeded.orgId,
          inviteCodeId,
          grantTier: "starter",
          redeemedAt: "2026-03-12T12:00:00.000Z",
          expiresAt: "2026-04-12T12:00:00.000Z",
        });

        const checkoutResponse = await createCheckoutSessionFetch({
          baseUrl: apiBaseUrl,
          headers: await createAuthenticatedHeaders({
            headers,
            email: seeded.userEmail,
          }),
          orgId: seeded.orgId,
          tier: "pro",
          customerEmail: `e2e+${namespace}.converted@example.com`,
        });
        expect(checkoutResponse.status).toBe(200);

        const stripeSubscriptionId = await createFakeStripeSubscription({
          baseUrl: fakeGatewayBaseUrl,
          customer: "cus_100",
          priceId: process.env["STRIPE_PRO_PRICE_ID"] ?? "price_e2e_pro",
        });

        const rawBody = JSON.stringify({
          id: `evt_checkout_converted_${createRandomToken()}`,
          object: "event",
          type: "checkout.session.completed",
          data: {
            object: {
              id: `cs_checkout_converted_${createRandomToken()}`,
              object: "checkout.session",
              payment_status: "paid",
              metadata: {
                org_id: seeded.orgId,
                tier: "pro",
              },
              client_reference_id: seeded.orgId,
              customer: "cus_100",
              subscription: stripeSubscriptionId,
            },
          },
        });
        const webhookResponse = await postStripeBillingWebhookFetch({
          baseUrl: apiBaseUrl,
          headers,
          rawBody,
        });
        expect(webhookResponse.status).toBe(200);

        const snapshot = await createStore().getDbSnapshot();
        const subscription = latestSubscriptionForOrg(snapshot.subscriptions, seeded.orgId);
        const redemption = snapshot.invite_code_redemptions.find(
          (row) => row.org_id === seeded.orgId,
        );
        expect(subscription.tier).toBe("pro");
        expect(subscription.stripe_subscription_id).toBe(stripeSubscriptionId);
        expect(redemption?.status).toBe("converted");
      },
    );
  });

  it("customer.subscription.updated applies tier upgrades and downgrades", async () => {
    await withLocalConvexNamespace(
      "vitest.billing",
      "webhook-subscription-updated",
      async ({ namespace, headers }) => {
        const store = createStore();
        const seeded = await seedWorkspace({
          namespace,
          suffix: "webhook-subscription-updated",
          subscriptionTier: "starter",
        });
        await store.setOrgSubscription({
          org_id: seeded.orgId,
          tier: "starter",
          status: "active",
          stripe_customer_id: "cus_webhook_updated",
          stripe_subscription_id: "sub_webhook_updated",
        });

        const upgradeBody = JSON.stringify({
          id: `evt_subscription_updated_upgrade_${createRandomToken()}`,
          object: "event",
          type: "customer.subscription.updated",
          data: {
            object: {
              id: "sub_webhook_updated",
              object: "subscription",
              status: "active",
              current_period_start: 1_772_287_200,
              current_period_end: 1_774_966_400,
              items: {
                data: [
                  {
                    price: {
                      id: process.env.STRIPE_PRO_PRICE_ID ?? "price_e2e_pro",
                    },
                  },
                ],
              },
            },
          },
        });
        const upgradeResponse = await postStripeBillingWebhookFetch({
          baseUrl: apiBaseUrl,
          headers,
          rawBody: upgradeBody,
        });
        expect(upgradeResponse.status).toBe(200);

        const afterUpgrade = latestSubscriptionForOrg(
          (await store.getDbSnapshot()).subscriptions,
          seeded.orgId,
        );
        expect(afterUpgrade.tier).toBe("pro");

        const downgradeBody = JSON.stringify({
          id: `evt_subscription_updated_downgrade_${createRandomToken()}`,
          object: "event",
          type: "customer.subscription.updated",
          data: {
            object: {
              id: "sub_webhook_updated",
              object: "subscription",
              status: "active",
              current_period_start: 1_772_287_200,
              current_period_end: 1_774_966_400,
              items: {
                data: [
                  {
                    price: {
                      id: process.env.STRIPE_STARTER_PRICE_ID ?? "price_e2e_starter",
                    },
                  },
                ],
              },
            },
          },
        });
        const downgradeResponse = await postStripeBillingWebhookFetch({
          baseUrl: apiBaseUrl,
          headers,
          rawBody: downgradeBody,
        });
        expect(downgradeResponse.status).toBe(200);

        const afterDowngrade = latestSubscriptionForOrg(
          (await store.getDbSnapshot()).subscriptions,
          seeded.orgId,
        );
        expect(afterDowngrade.tier).toBe("starter");
      },
    );
  });

  it("customer.subscription.deleted downgrades to free and enforces free-tier tool limits", async () => {
    await withLocalConvexNamespace(
      "vitest.billing",
      "webhook-subscription-deleted",
      async ({ namespace, headers }) => {
        const seeded = await seedWorkspace({
          namespace,
          suffix: "webhook-sub-deleted-base",
          subscriptionTier: "pro",
        });

        const store = createStore();
        await store.setOrgSubscription({
          org_id: seeded.orgId,
          tier: "pro",
          status: "active",
          stripe_customer_id: "cus_webhook_deleted",
          stripe_subscription_id: "sub_webhook_deleted",
        });

        const rawBody = JSON.stringify({
          id: `evt_customer_subscription_deleted_${createRandomToken()}`,
          object: "event",
          type: "customer.subscription.deleted",
          data: {
            object: {
              id: "sub_webhook_deleted",
              object: "subscription",
              status: "canceled",
            },
          },
        });
        const response = await postStripeBillingWebhookFetch({
          baseUrl: apiBaseUrl,
          headers,
          rawBody,
        });
        expect(response.status).toBe(200);

        const snapshot = await store.getDbSnapshot();
        const subscription = latestSubscriptionForOrg(snapshot.subscriptions, seeded.orgId);
        expect(subscription.tier).toBe("free");
        expect(subscription.status).toBe("canceled");

        const freeLimits = getTierConfig("free");
        await setUsageMeterForOrg({
          convexUrl,
          orgId: seeded.orgId,
          periodStart: subscription.current_period_start,
          periodEnd: subscription.current_period_end,
          toolCallCount: freeLimits.max_tool_calls_per_month,
          totalToolCallTimeMs: 0,
        });

        const mcp = createMcpClient(seeded.workspaceId, seeded.credentialSecret, headers);
        try {
          await mcp.initialize();
          await expect(mcp.callTool("keppo.list_pending_actions", {})).rejects.toThrow(
            /TOOL_CALL_LIMIT_REACHED/,
          );
        } finally {
          await mcp.close();
        }
      },
    );
  });

  it("checkout endpoint creates Stripe sessions for starter and pro upgrades", async () => {
    await withLocalConvexNamespace(
      "vitest.billing",
      "checkout-sessions",
      async ({ namespace, headers }) => {
        const seeded = await seedWorkspace({
          namespace,
          suffix: "checkout-sessions",
          subscriptionTier: "free",
        });

        const hobbyResponse = await createCheckoutSessionFetch({
          baseUrl: apiBaseUrl,
          headers: await createAuthenticatedHeaders({
            headers,
            email: seeded.userEmail,
          }),
          orgId: seeded.orgId,
          tier: "starter",
          customerEmail: `e2e+${namespace}.starter.checkout@example.com`,
        });
        expect(hobbyResponse.status).toBe(200);
        const hobbyPayload = (await hobbyResponse.json()) as { url?: string; session_id?: string };
        expect(hobbyPayload.url).toContain("checkout.stripe.test/");
        expect(hobbyPayload.session_id).toContain("cs_");

        const proResponse = await createCheckoutSessionFetch({
          baseUrl: apiBaseUrl,
          headers: await createAuthenticatedHeaders({
            headers,
            email: seeded.userEmail,
          }),
          orgId: seeded.orgId,
          tier: "pro",
          customerEmail: `e2e+${namespace}.pro.checkout@example.com`,
        });
        expect(proResponse.status).toBe(200);
        const proPayload = (await proResponse.json()) as { url?: string; session_id?: string };
        expect(proPayload.url).toContain("checkout.stripe.test/");
        expect(proPayload.session_id).toContain("cs_");
      },
    );
  });

  it("portal endpoint creates a Stripe billing portal session", async () => {
    await withLocalConvexNamespace(
      "vitest.billing",
      "portal-session",
      async ({ namespace, headers }) => {
        const store = createStore();
        const seeded = await seedWorkspace({
          namespace,
          suffix: "portal-session",
          subscriptionTier: "starter",
        });
        await store.setOrgSubscription({
          org_id: seeded.orgId,
          tier: "starter",
          status: "active",
          stripe_customer_id: "cus_100",
          stripe_subscription_id: "sub_portal_session",
        });

        const returnUrl = `${process.env.KEPPO_DASHBOARD_BASE_URL ?? "http://127.0.0.1:3211"}/billing?return=portal`;
        const portalResponse = await createPortalSessionFetch({
          baseUrl: apiBaseUrl,
          headers: await createAuthenticatedHeaders({
            headers,
            email: seeded.userEmail,
          }),
          orgId: seeded.orgId,
          returnUrl,
        });
        expect(portalResponse.status).toBe(200);
        const payload = (await portalResponse.json()) as { url?: string };
        expect(payload.url).toContain(returnUrl);
      },
    );
  });

  it("billing usage exposes invite promo billing source and metadata", async () => {
    await withLocalConvexNamespace(
      "vitest.billing",
      "invite-promo-usage",
      async ({ namespace }) => {
        const seeded = await seedWorkspace({
          namespace,
          suffix: "invite-promo-usage",
          subscriptionTier: "free",
        });
        const inviteCodeId = await createInviteCodeForTesting({
          code: "PROM11",
          label: "Starter Promo",
          grantTier: "starter",
        });
        await seedInvitePromoForOrg({
          orgId: seeded.orgId,
          inviteCodeId,
          grantTier: "starter",
          redeemedAt: "2026-03-10T12:00:00.000Z",
          expiresAt: "2026-04-10T12:00:00.000Z",
        });

        const usage = await getBillingUsageForOrg(convexUrl, seeded.orgId);
        expect(usage.billing_source).toBe("invite_promo");
        expect(usage.invite_promo).toMatchObject({
          code: "PROM11",
          grant_tier: "starter",
          redeemed_at: "2026-03-10T12:00:00.000Z",
          expires_at: "2026-04-10T12:00:00.000Z",
        });
        expect(usage.tier).toBe("starter");
        expect(usage.status).toBe("trialing");
      },
    );
  });

  it("portal endpoint rejects invite promo orgs without opening Stripe portal", async () => {
    await withLocalConvexNamespace(
      "vitest.billing",
      "invite-promo-portal-rejected",
      async ({ namespace, headers }) => {
        const seeded = await seedWorkspace({
          namespace,
          suffix: "invite-promo-portal-rejected",
          subscriptionTier: "free",
        });
        const inviteCodeId = await createInviteCodeForTesting({
          code: "PROM22",
          label: "Pro Promo",
          grantTier: "pro",
        });
        await seedInvitePromoForOrg({
          orgId: seeded.orgId,
          inviteCodeId,
          grantTier: "pro",
          redeemedAt: "2026-03-11T12:00:00.000Z",
          expiresAt: "2026-04-11T12:00:00.000Z",
        });

        const portalResponse = await createPortalSessionFetch({
          baseUrl: apiBaseUrl,
          headers: await createAuthenticatedHeaders({
            headers,
            email: seeded.userEmail,
          }),
          orgId: seeded.orgId,
        });
        expect(portalResponse.status).toBe(400);
        const payload = (await portalResponse.json()) as { error?: { code?: string } };
        expect(payload.error?.code).toBe("invite_promo_has_no_portal");
      },
    );
  });

  it("tool call count quota is enforced for free, starter, and pro tiers", async () => {
    await withLocalConvexNamespace(
      "vitest.billing",
      "tool-call-count-quota",
      async ({ namespace, headers }) => {
        const store = createStore();

        for (const tier of ["free", "starter", "pro"] as const) {
          const seeded = await seedWorkspace({
            namespace,
            suffix: `tool-call-count-${tier}`,
            subscriptionTier: tier,
          });
          await store.setOrgSubscription({
            org_id: seeded.orgId,
            tier,
          });

          const snapshot = await store.getDbSnapshot();
          const subscription = latestSubscriptionForOrg(snapshot.subscriptions, seeded.orgId);
          const tierConfig = getTierConfig(tier);

          await setUsageMeterForOrg({
            convexUrl,
            orgId: seeded.orgId,
            periodStart: subscription.current_period_start,
            periodEnd: subscription.current_period_end,
            toolCallCount: tierConfig.max_tool_calls_per_month - 1,
            totalToolCallTimeMs: 0,
          });

          const mcp = createMcpClient(seeded.workspaceId, seeded.credentialSecret, headers);
          try {
            await mcp.initialize();
            await mcp.callTool("keppo.list_pending_actions", {});
            await expect(mcp.callTool("keppo.list_pending_actions", {})).rejects.toThrow(
              /TOOL_CALL_LIMIT_REACHED/,
            );
          } finally {
            await mcp.close();
          }
        }
      },
    );
  });

  it("tool call total-time budget blocks over-limit orgs for every tier", async () => {
    await withLocalConvexNamespace(
      "vitest.billing",
      "tool-call-time-budget",
      async ({ namespace, headers }) => {
        const store = createStore();

        const freeSeed = await seedWorkspace({
          namespace,
          suffix: "tool-call-time-free",
          subscriptionTier: "free",
        });
        const freeSnapshot = await store.getDbSnapshot();
        const freeSubscription = latestSubscriptionForOrg(
          freeSnapshot.subscriptions,
          freeSeed.orgId,
        );
        const freeLimits = getTierConfig("free");

        await setUsageMeterForOrg({
          convexUrl,
          orgId: freeSeed.orgId,
          periodStart: freeSubscription.current_period_start,
          periodEnd: freeSubscription.current_period_end,
          toolCallCount: 0,
          totalToolCallTimeMs: freeLimits.max_total_tool_call_time_ms,
        });

        const freeMcp = createMcpClient(freeSeed.workspaceId, freeSeed.credentialSecret, headers);
        try {
          await freeMcp.initialize();
          await expect(freeMcp.callTool("keppo.list_pending_actions", {})).rejects.toThrow(
            /TOOL_CALL_TIME_LIMIT_REACHED/,
          );
        } finally {
          await freeMcp.close();
        }

        const proSeed = await seedWorkspace({
          namespace,
          suffix: "tool-call-time-pro",
          subscriptionTier: "pro",
        });
        await store.setOrgSubscription({
          org_id: proSeed.orgId,
          tier: "pro",
        });

        const proSnapshot = await store.getDbSnapshot();
        const proSubscription = latestSubscriptionForOrg(proSnapshot.subscriptions, proSeed.orgId);
        const proLimits = getTierConfig("pro");

        await setUsageMeterForOrg({
          convexUrl,
          orgId: proSeed.orgId,
          periodStart: proSubscription.current_period_start,
          periodEnd: proSubscription.current_period_end,
          toolCallCount: 0,
          totalToolCallTimeMs: proLimits.max_total_tool_call_time_ms + 1,
        });

        const proMcp = createMcpClient(proSeed.workspaceId, proSeed.credentialSecret, headers);
        try {
          await proMcp.initialize();
          await expect(proMcp.callTool("keppo.list_pending_actions", {})).rejects.toThrow(
            /TOOL_CALL_TIME_LIMIT_REACHED/,
          );
        } finally {
          await proMcp.close();
        }
      },
    );
  });

  it("tool call timeout caps terminate long-running calls per tier", async () => {
    await withLocalConvexNamespace(
      "vitest.billing",
      "tool-call-timeout",
      async ({ namespace, headers }) => {
        const timeoutScale = 0.01;

        const verifyTierTimeout = async (tier: Tier): Promise<void> => {
          const seeded = await seedWorkspace({
            namespace,
            suffix: `tool-call-timeout-${tier}`,
            subscriptionTier: tier,
            provider: "custom",
            providerMetadata: {
              base_url: fakeGatewayBaseUrl,
            },
          });

          const expectedTimeoutMs = Math.max(
            1,
            Math.floor(getTierConfig(tier).tool_call_timeout_ms * timeoutScale),
          );
          const delayMs = expectedTimeoutMs + 300;
          const mcp = createMcpClient(seeded.workspaceId, seeded.credentialSecret, headers);
          try {
            await mcp.initialize();
            const startedAt = Date.now();
            await expect(
              mcp.callTool("custom.callRead", {
                tool: "timeout-probe",
                input: {
                  delay_ms: delayMs,
                  __e2eTimeoutScale: timeoutScale,
                },
              }),
            ).rejects.toThrow(/exceeded .* timeout/i);
            const elapsedMs = Date.now() - startedAt;
            expect(elapsedMs).toBeGreaterThanOrEqual(Math.max(1, expectedTimeoutMs - 200));
          } finally {
            await mcp.close();
          }
        };

        await verifyTierTimeout("free");
        await verifyTierTimeout("starter");
        await verifyTierTimeout("pro");
      },
    );
  });

  it("past_due subscriptions can still execute tool calls while under quota", async () => {
    await withLocalConvexNamespace(
      "vitest.billing",
      "tool-call-past-due",
      async ({ namespace, headers }) => {
        const seeded = await seedWorkspace({
          namespace,
          suffix: "tool-call-past-due",
          subscriptionTier: "starter",
        });
        await createStore().setOrgSubscription({
          org_id: seeded.orgId,
          tier: "starter",
          status: "past_due",
        });

        const mcp = createMcpClient(seeded.workspaceId, seeded.credentialSecret, headers);
        try {
          await mcp.initialize();
          const payload = await mcp.callTool("keppo.list_pending_actions", {});
          expect(Array.isArray(payload.actions)).toBe(true);
        } finally {
          await mcp.close();
        }
      },
    );
  });

  it("mid-period subscription updates create a new usage meter window", async () => {
    await withLocalConvexNamespace(
      "vitest.billing",
      "tool-call-period-boundary",
      async ({ namespace, headers }) => {
        const store = createStore();
        const seeded = await seedWorkspace({
          namespace,
          suffix: "tool-call-period-boundary",
          subscriptionTier: "starter",
        });

        const previousPeriodStart = "2026-01-01T00:00:00.000Z";
        const previousPeriodEnd = "2026-02-01T00:00:00.000Z";
        await store.setOrgSubscription({
          org_id: seeded.orgId,
          tier: "starter",
          status: "active",
          current_period_start: previousPeriodStart,
          current_period_end: previousPeriodEnd,
        });
        await setUsageMeterForOrg({
          convexUrl,
          orgId: seeded.orgId,
          periodStart: previousPeriodStart,
          periodEnd: previousPeriodEnd,
          toolCallCount: 4,
          totalToolCallTimeMs: 0,
        });

        const firstWindowClient = createMcpClient(
          seeded.workspaceId,
          seeded.credentialSecret,
          headers,
        );
        try {
          await firstWindowClient.initialize();
          const payload = await firstWindowClient.callTool("keppo.list_pending_actions", {});
          expect(Array.isArray(payload.actions)).toBe(true);
        } finally {
          await firstWindowClient.close();
        }

        const currentPeriodStart = "2026-02-01T00:00:00.000Z";
        const currentPeriodEnd = "2026-03-01T00:00:00.000Z";
        await store.setOrgSubscription({
          org_id: seeded.orgId,
          tier: "starter",
          status: "active",
          current_period_start: currentPeriodStart,
          current_period_end: currentPeriodEnd,
        });

        const secondWindowClient = createMcpClient(
          seeded.workspaceId,
          seeded.credentialSecret,
          headers,
        );
        try {
          await secondWindowClient.initialize();
          const payload = await secondWindowClient.callTool("keppo.list_pending_actions", {});
          expect(Array.isArray(payload.actions)).toBe(true);
        } finally {
          await secondWindowClient.close();
        }

        const usageRows = (await store.getDbSnapshot()).usage_meters.filter(
          (row) => row.org_id === seeded.orgId,
        );
        const previousWindow = usageRows.find((row) => row.period_start === previousPeriodStart);
        const currentWindow = usageRows.find((row) => row.period_start === currentPeriodStart);
        expect(previousWindow?.tool_call_count).toBe(5);
        expect(currentWindow?.tool_call_count).toBe(1);
      },
    );
  });

  it("concurrent tool calls near the quota boundary allow only one over the final slot", async () => {
    await withLocalConvexNamespace(
      "vitest.billing",
      "tool-call-concurrency-boundary",
      async ({ namespace, headers }) => {
        const store = createStore();
        const seeded = await seedWorkspace({
          namespace,
          suffix: "tool-call-concurrency-boundary",
          subscriptionTier: "free",
        });
        const snapshot = await store.getDbSnapshot();
        const subscription = latestSubscriptionForOrg(snapshot.subscriptions, seeded.orgId);
        const freeLimits = getTierConfig("free");

        await setUsageMeterForOrg({
          convexUrl,
          orgId: seeded.orgId,
          periodStart: subscription.current_period_start,
          periodEnd: subscription.current_period_end,
          toolCallCount: freeLimits.max_tool_calls_per_month - 1,
          totalToolCallTimeMs: 0,
        });

        const clientA = createMcpClient(seeded.workspaceId, seeded.credentialSecret, headers);
        const clientB = createMcpClient(seeded.workspaceId, seeded.credentialSecret, headers);
        try {
          await Promise.all([clientA.initialize(), clientB.initialize()]);
          const outcomes = await Promise.allSettled([
            clientA.callTool("keppo.list_pending_actions", {}),
            clientB.callTool("keppo.list_pending_actions", {}),
          ]);
          const fulfilledCount = outcomes.filter(
            (outcome) => outcome.status === "fulfilled",
          ).length;
          const rejected = outcomes.filter(
            (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
          );
          expect(fulfilledCount).toBe(1);
          expect(rejected.length).toBe(1);
          expect(String(rejected[0]?.reason)).toContain("TOOL_CALL_LIMIT_REACHED");
        } finally {
          await Promise.all([clientA.close(), clientB.close()]);
        }
      },
    );
  });

  it("starter tier allows up to 5 workspaces", async () => {
    await withLocalConvexNamespace(
      "vitest.billing",
      "workspace-limit-starter",
      async ({ namespace }) => {
        const store = createStore();
        const seeded = await seedWorkspace({
          namespace,
          suffix: "workspace-limit-starter-base",
          subscriptionTier: "starter",
        });
        const maxWorkspaces = getTierConfig("starter").max_workspaces;
        const initialWorkspaceCount = (await store.getDbSnapshot()).workspaces.filter(
          (workspace) => workspace.org_id === seeded.orgId,
        ).length;

        for (let index = initialWorkspaceCount; index < maxWorkspaces; index += 1) {
          await createWorkspaceWithLimitCheck(
            seeded.orgId,
            `starter-limit-${index}-${createRandomToken()}`,
          );
        }

        await expect(
          createWorkspaceWithLimitCheck(seeded.orgId, `starter-limit-over-${createRandomToken()}`),
        ).rejects.toThrow(/WORKSPACE_LIMIT_REACHED/);
      },
    );
  });

  it("pro tier allows up to 25 workspaces", async () => {
    await withLocalConvexNamespace(
      "vitest.billing",
      "workspace-limit-pro",
      async ({ namespace }) => {
        const store = createStore();
        const seeded = await seedWorkspace({
          namespace,
          suffix: "workspace-limit-pro-base",
          subscriptionTier: "pro",
        });
        const maxWorkspaces = getTierConfig("pro").max_workspaces;
        const initialWorkspaceCount = (await store.getDbSnapshot()).workspaces.filter(
          (workspace) => workspace.org_id === seeded.orgId,
        ).length;

        for (let index = initialWorkspaceCount; index < maxWorkspaces; index += 1) {
          await createWorkspaceWithLimitCheck(
            seeded.orgId,
            `pro-limit-${index}-${createRandomToken()}`,
          );
        }

        await expect(
          createWorkspaceWithLimitCheck(seeded.orgId, `pro-limit-over-${createRandomToken()}`),
        ).rejects.toThrow(/WORKSPACE_LIMIT_REACHED/);
      },
    );
  });
});
