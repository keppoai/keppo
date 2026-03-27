import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  expect,
  type APIRequestContext,
  type APIResponse,
  type Locator,
  type Page,
} from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const refs = {
  setUsageMeterForOrg: makeFunctionReference<"mutation">("e2e:setUsageMeterForOrg"),
  getUsageForOrg: makeFunctionReference<"query">("billing:getUsageForOrg"),
  createInviteCodeForTesting: makeFunctionReference<"mutation">("e2e:createInviteCodeForTesting"),
  seedInvitePromoForOrg: makeFunctionReference<"mutation">("e2e:seedInvitePromoForOrg"),
};

const toUsableAdminKey = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("encrypted:")) {
    return null;
  }
  return trimmed;
};

const resolveLocalAdminKey = (): string | null => {
  try {
    const configPath = join(process.cwd(), ".convex", "local", "default", "config.json");
    const raw = JSON.parse(readFileSync(configPath, "utf8")) as { adminKey?: unknown };
    if (typeof raw.adminKey === "string" && raw.adminKey.length > 0) {
      return raw.adminKey;
    }
    return null;
  } catch {
    return null;
  }
};

const clientFor = (convexUrl: string): ConvexHttpClient => {
  const client = new ConvexHttpClient(convexUrl);
  const adminKey =
    toUsableAdminKey(process.env.KEPPO_CONVEX_ADMIN_KEY) ??
    toUsableAdminKey(resolveLocalAdminKey());
  if (!adminKey) {
    throw new Error("Missing KEPPO_CONVEX_ADMIN_KEY for billing e2e hooks.");
  }
  (client as { setAdminAuth?: (token: string) => void }).setAdminAuth?.(adminKey);
  return client;
};

export const setUsageMeterForOrg = async (params: {
  convexUrl: string;
  orgId: string;
  periodStart: string;
  periodEnd: string;
  toolCallCount: number;
  totalToolCallTimeMs: number;
}): Promise<void> => {
  const client = clientFor(params.convexUrl);
  await client.mutation(refs.setUsageMeterForOrg, {
    orgId: params.orgId,
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
    toolCallCount: params.toolCallCount,
    totalToolCallTimeMs: params.totalToolCallTimeMs,
  });
};

export const getBillingUsageForOrg = async (
  convexUrl: string,
  orgId: string,
): Promise<{
  org_id: string;
  tier: "free" | "starter" | "pro";
  status: "active" | "past_due" | "canceled" | "trialing";
  billing_source: "free" | "stripe" | "invite_promo";
  invite_promo: {
    code: string;
    grant_tier: "free" | "starter" | "pro";
    redeemed_at: string;
    expires_at: string;
  } | null;
  period_start: string;
  period_end: string;
  usage: {
    tool_call_count: number;
    total_tool_call_time_ms: number;
  };
  limits: {
    max_tool_calls_per_month: number;
    max_total_tool_call_time_ms: number;
  };
}> => {
  const client = clientFor(convexUrl);
  return (await client.query(refs.getUsageForOrg, { orgId })) as {
    org_id: string;
    tier: "free" | "starter" | "pro";
    status: "active" | "past_due" | "canceled" | "trialing";
    billing_source: "free" | "stripe" | "invite_promo";
    invite_promo: {
      code: string;
      grant_tier: "free" | "starter" | "pro";
      redeemed_at: string;
      expires_at: string;
    } | null;
    period_start: string;
    period_end: string;
    usage: {
      tool_call_count: number;
      total_tool_call_time_ms: number;
    };
    limits: {
      max_tool_calls_per_month: number;
      max_total_tool_call_time_ms: number;
    };
  };
};

export const createInviteCodeForTesting = async (params: {
  convexUrl: string;
  code: string;
  label: string;
  grantTier: "free" | "starter" | "pro";
  active?: boolean;
}): Promise<string> => {
  const client = clientFor(params.convexUrl);
  return await client.mutation(refs.createInviteCodeForTesting, {
    code: params.code,
    label: params.label,
    grantTier: params.grantTier,
    ...(params.active !== undefined ? { active: params.active } : {}),
  });
};

export const seedInvitePromoForOrg = async (params: {
  convexUrl: string;
  orgId: string;
  inviteCodeId: string;
  grantTier: "starter" | "pro";
  redeemedAt: string;
  expiresAt: string;
}): Promise<void> => {
  const client = clientFor(params.convexUrl);
  await client.mutation(refs.seedInvitePromoForOrg, {
    orgId: params.orgId,
    inviteCodeId: params.inviteCodeId,
    grantTier: params.grantTier,
    status: "active",
    redeemedAt: params.redeemedAt,
    expiresAt: params.expiresAt,
  });
};

export const installStripeCheckoutPage = async (page: Page): Promise<void> => {
  await page.route("https://checkout.stripe.test/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: "<!doctype html><html><body><main>Fake Stripe Checkout</main></body></html>",
    });
  });
};

export const installBillingSubscriptionPendingMock = async (page: Page): Promise<void> => {
  await page.route("**/api/billing/subscription/pending-change*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        cancel_at_period_end: false,
        pending_tier: null,
        pending_effective_at: null,
      }),
    });
  });
};

export const installLocationAssignSpy = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    const win = window as Window & typeof globalThis & { __KEPPO_ASSIGNED_URLS__?: string[] };
    const assignedUrls: string[] = [];
    win.__KEPPO_ASSIGNED_URLS__ = assignedUrls;
    Object.defineProperty(Location.prototype, "assign", {
      configurable: true,
      value(url: string | URL) {
        assignedUrls.push(String(url));
      },
    });
  });
};

export const clickElement = async (locator: Locator): Promise<void> => {
  await locator.evaluate((element) => (element as HTMLElement).click());
};

export const gotoWithNavigationRetry = async (page: Page, url: string): Promise<void> => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable =
        message.includes("net::ERR_ABORTED") ||
        message.includes("chrome-error://chromewebdata/") ||
        message.includes("interrupted by another navigation");
      if (!retryable || attempt === 2) {
        throw error;
      }
      await page.waitForLoadState("domcontentloaded").catch(() => null);
    }
  }
};

export const signStripeBillingPayload = (rawBody: string): string => {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "whsec_e2e_billing";
  const signature = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
};

const trimTrailingSlash = (value: string): string => {
  return value.endsWith("/") ? value.slice(0, -1) : value;
};

const billingApiUrl = (baseUrl: string, pathname: string): string => {
  return `${trimTrailingSlash(baseUrl)}/api/billing/${pathname}`;
};

export const postStripeBillingWebhookFetch = async (params: {
  baseUrl: string;
  headers?: Record<string, string>;
  rawBody: string;
  signature?: string;
}): Promise<Response> => {
  return await fetch(`${trimTrailingSlash(params.baseUrl)}/webhooks/stripe-billing`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...params.headers,
      "stripe-signature": params.signature ?? signStripeBillingPayload(params.rawBody),
    },
    body: params.rawBody,
  });
};

export const postStripeBillingWebhook = async (params: {
  request: APIRequestContext;
  apiBaseUrl: string;
  headers?: Record<string, string>;
  rawBody: string;
  signature?: string;
}): Promise<APIResponse> => {
  return await params.request.fetch(
    `${trimTrailingSlash(params.apiBaseUrl)}/webhooks/stripe-billing`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...params.headers,
        "stripe-signature": params.signature ?? signStripeBillingPayload(params.rawBody),
      },
      data: params.rawBody,
    },
  );
};

export const createCheckoutSession = async (params: {
  request: APIRequestContext;
  apiBaseUrl: string;
  headers?: Record<string, string>;
  orgId: string;
  tier: "starter" | "pro";
  successUrl?: string;
  cancelUrl?: string;
  customerEmail?: string;
}): Promise<APIResponse> => {
  return await params.request.fetch(billingApiUrl(params.apiBaseUrl, "checkout"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...params.headers,
    },
    data: {
      orgId: params.orgId,
      tier: params.tier,
      ...(params.successUrl ? { successUrl: params.successUrl } : {}),
      ...(params.cancelUrl ? { cancelUrl: params.cancelUrl } : {}),
      ...(params.customerEmail ? { customerEmail: params.customerEmail } : {}),
    },
  });
};

export const createCheckoutSessionFetch = async (params: {
  baseUrl: string;
  headers?: Record<string, string>;
  orgId: string;
  tier: "starter" | "pro";
  successUrl?: string;
  cancelUrl?: string;
  customerEmail?: string;
}): Promise<Response> => {
  return await fetch(billingApiUrl(params.baseUrl, "checkout"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...params.headers,
    },
    body: JSON.stringify({
      orgId: params.orgId,
      tier: params.tier,
      ...(params.successUrl ? { successUrl: params.successUrl } : {}),
      ...(params.cancelUrl ? { cancelUrl: params.cancelUrl } : {}),
      ...(params.customerEmail ? { customerEmail: params.customerEmail } : {}),
    }),
  });
};

export const createPortalSession = async (params: {
  request: APIRequestContext;
  apiBaseUrl: string;
  headers?: Record<string, string>;
  orgId: string;
  returnUrl?: string;
}): Promise<APIResponse> => {
  return await params.request.fetch(billingApiUrl(params.apiBaseUrl, "portal"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...params.headers,
    },
    data: {
      orgId: params.orgId,
      ...(params.returnUrl ? { returnUrl: params.returnUrl } : {}),
    },
  });
};

export const createPortalSessionFetch = async (params: {
  baseUrl: string;
  headers?: Record<string, string>;
  orgId: string;
  returnUrl?: string;
}): Promise<Response> => {
  return await fetch(billingApiUrl(params.baseUrl, "portal"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...params.headers,
    },
    body: JSON.stringify({
      orgId: params.orgId,
      ...(params.returnUrl ? { returnUrl: params.returnUrl } : {}),
    }),
  });
};

export const createFakeStripeSubscription = async (params: {
  baseUrl: string;
  customer: string;
  priceId: string;
}): Promise<string> => {
  const response = await fetch(`${trimTrailingSlash(params.baseUrl)}/stripe/v1/subscriptions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.STRIPE_SECRET_KEY ?? "sk_test_e2e_billing"}`,
    },
    body: JSON.stringify({
      customer: params.customer,
      items: [{ price: params.priceId, quantity: 1 }],
    }),
  });
  const payload = (await response.json()) as { id?: unknown };
  if (!response.ok || typeof payload.id !== "string" || payload.id.length === 0) {
    throw new Error(
      `Failed to create fake Stripe subscription: ${JSON.stringify({
        status: response.status,
        payload,
      })}`,
    );
  }
  return payload.id;
};
