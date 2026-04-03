// SPDX-License-Identifier: FSL-1.1-Apache-2.0

import Stripe from "stripe";
import {
  API_DEDUPE_SCOPE,
  API_DEDUPE_STATUS,
  AUDIT_ACTOR_TYPE,
  AUDIT_EVENT_TYPES,
  SUBSCRIPTION_STATUS,
  SUBSCRIPTION_TIER,
  type SubscriptionStatus,
  type SubscriptionTier,
  type UserRole,
} from "@keppo/shared/domain";
import { AI_KEY_MODE, getAutomationRunPackagesForTier } from "@keppo/shared/automations";
import { NOTIFICATION_EVENT_ID } from "@keppo/shared/notifications";
import { parseJsonRecord } from "@keppo/shared/providers/boundaries/json";
import { getAiCreditAllowanceForTier } from "@keppo/shared/subscriptions";
import { isActiveStripeSubscriptionStatus } from "@keppo/shared/billing-contracts";
import type { ConvexInternalClient } from "../../apps/web/app/lib/server/api-runtime/convex.js";
import {
  createDyadGatewayUser,
  deleteDyadGatewayKeys,
  deleteDyadGatewayUser,
  generateDyadGatewayKey,
  getDyadGatewayUserInfo,
  hasDyadGatewayConfig,
  resolveDyadGatewayBudgetUsdForTier,
  updateDyadGatewayUser,
} from "../../apps/web/app/lib/server/api-runtime/dyad-gateway.js";
import { getEnv } from "../../apps/web/app/lib/server/api-runtime/env.js";
import { decryptStoredKey } from "../../apps/web/app/lib/server/api-runtime/routes/automations.js";

export type BillingConvexClient = Pick<
  ConvexInternalClient,
  | "addPurchasedAutomationRuns"
  | "addPurchasedCredits"
  | "claimApiDedupeKey"
  | "completeApiDedupeKey"
  | "convertActiveInvitePromo"
  | "createAuditEvent"
  | "emitNotificationForOrg"
  | "getBillingUsageForOrg"
  | "getOrgAiKey"
  | "releaseApiDedupeKey"
  | "getSubscriptionByStripeCustomer"
  | "getSubscriptionByStripeSubscription"
  | "getSubscriptionForOrg"
  | "deactivateBundledOrgAiKeys"
  | "setSubscriptionStatusByCustomer"
  | "setSubscriptionStatusByStripeSubscription"
  | "upsertBundledOrgAiKey"
  | "upsertSubscriptionForOrg"
>;

export type BillingSessionIdentity = {
  userId: string;
  orgId: string;
  role: UserRole;
};

export type BillingRequestDeps = {
  convex: BillingConvexClient;
  resolveApiSessionIdentity: (request: Request) => Promise<BillingSessionIdentity | null>;
  getStripeClient?: () => Stripe;
};

type BillingTier = typeof SUBSCRIPTION_TIER.starter | typeof SUBSCRIPTION_TIER.pro;
type CreditPackage = { credits: number; priceCents: number };

class BillingInputError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const BILLING_WEBHOOK_DEDUPE_TTL_MS = 10 * 60_000;
// Managed Payments checkout requires a preview Stripe-Version; GA SDK types use a narrower
// LatestApiVersion union, so we cast. See https://docs.stripe.com/sdks/versioning (current
// public preview) and https://docs.stripe.com/payments/managed-payments/update-checkout .
const STRIPE_MANAGED_PAYMENTS_API_VERSION =
  "2026-03-04.preview" as unknown as Stripe.LatestApiVersion;

const managedPaymentsCheckoutRequestOptions: Stripe.RequestOptions = {
  apiVersion: STRIPE_MANAGED_PAYMENTS_API_VERSION,
};
const AI_CREDIT_PACKAGES: CreditPackage[] = [
  { credits: 100, priceCents: 1_000 },
  { credits: 250, priceCents: 2_500 },
] as const;
const VALID_AUTOMATION_RUN_TOPUP_TIERS = new Set<BillingTier>([
  SUBSCRIPTION_TIER.starter,
  SUBSCRIPTION_TIER.pro,
]);
const SECURITY_HEADER_VALUES = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
} as const;

const BUNDLED_GATEWAY_PROVIDERS = ["openai", "anthropic"] as const;
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"]);

const isLoopbackUrl = (value: string | undefined): boolean => {
  if (!value) {
    return false;
  }
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(value).hostname);
  } catch {
    return false;
  }
};

const isExplicitLocalOrTestBillingRuntime = (): boolean => {
  const explicitRuntimeSignal = (process.env.KEPPO_E2E_RUNTIME_SIGNAL ?? "").trim().toLowerCase();
  if (explicitRuntimeSignal === "local" || explicitRuntimeSignal === "test") {
    return true;
  }

  const nodeEnv = (process.env.NODE_ENV ?? "").trim().toLowerCase();
  if (nodeEnv === "development" || nodeEnv === "test" || process.env.KEPPO_E2E_MODE === "true") {
    return true;
  }

  const convexDeployment = (process.env.CONVEX_DEPLOYMENT ?? "").trim().toLowerCase();
  if (convexDeployment.startsWith("local:")) {
    return true;
  }

  return (
    isLoopbackUrl(process.env.CONVEX_SITE_URL) ||
    isLoopbackUrl(process.env.CONVEX_CLOUD_URL) ||
    isLoopbackUrl(process.env.CONVEX_URL) ||
    isLoopbackUrl(process.env.CONVEX_SELF_HOSTED_URL)
  );
};

const isBundledTier = (tier: SubscriptionTier): tier is BillingTier => {
  return tier === SUBSCRIPTION_TIER.starter || tier === SUBSCRIPTION_TIER.pro;
};

type StripeSubscriptionRecord = NonNullable<
  Awaited<ReturnType<BillingConvexClient["getSubscriptionForOrg"]>>
> & {
  stripe_customer_id: string;
  stripe_subscription_id: string;
};

const getActiveStripeBilling = (
  subscription:
    | Awaited<ReturnType<BillingConvexClient["getSubscriptionForOrg"]>>
    | null
    | undefined,
): StripeSubscriptionRecord | null => {
  if (
    !subscription ||
    subscription.tier === SUBSCRIPTION_TIER.free ||
    typeof subscription.stripe_customer_id !== "string" ||
    typeof subscription.stripe_subscription_id !== "string" ||
    !isActiveStripeSubscriptionStatus(subscription.status)
  ) {
    return null;
  }
  return subscription as StripeSubscriptionRecord;
};

const shouldKeepBundledAccess = (tier: SubscriptionTier, status: SubscriptionStatus): boolean => {
  return (
    isBundledTier(tier) &&
    (status === SUBSCRIPTION_STATUS.active ||
      status === SUBSCRIPTION_STATUS.trialing ||
      status === SUBSCRIPTION_STATUS.pastDue)
  );
};

const readStoredBundledGatewayKey = async (
  convex: BillingConvexClient,
  orgId: string,
): Promise<string | null> => {
  for (const provider of BUNDLED_GATEWAY_PROVIDERS) {
    const stored = await convex.getOrgAiKey({
      orgId,
      provider,
      keyMode: AI_KEY_MODE.bundled,
    });
    if (!stored?.is_active) {
      continue;
    }
    return await decryptStoredKey(stored.encrypted_key);
  }
  return null;
};

const syncBundledGatewayForOrg = async (params: {
  convex: BillingConvexClient;
  orgId: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  resetGatewaySpend: boolean;
}): Promise<void> => {
  if (!shouldKeepBundledAccess(params.tier, params.status)) {
    if (hasDyadGatewayConfig()) {
      const storedKey = await readStoredBundledGatewayKey(params.convex, params.orgId);
      if (storedKey) {
        await deleteDyadGatewayKeys([storedKey]);
      }
      await deleteDyadGatewayUser(params.orgId);
    }
    await params.convex.deactivateBundledOrgAiKeys({ orgId: params.orgId });
    return;
  }

  if (!hasDyadGatewayConfig()) {
    if (isExplicitLocalOrTestBillingRuntime()) {
      // Local/test billing coverage should keep validating subscription state transitions even
      // when the bundled gateway env is intentionally absent.
      await params.convex.deactivateBundledOrgAiKeys({ orgId: params.orgId });
      return;
    }
    throw new Error(
      "Bundled AI inference is enabled for this tier but Dyad Gateway env is not configured.",
    );
  }

  const includedCredits = getAiCreditAllowanceForTier(params.tier);
  const maxBudgetUsd = resolveDyadGatewayBudgetUsdForTier(includedCredits);
  const existingUser = await getDyadGatewayUserInfo(params.orgId);
  const existingStoredKey = await readStoredBundledGatewayKey(params.convex, params.orgId);
  let nextKey = existingStoredKey;

  if (!existingUser) {
    nextKey = await createDyadGatewayUser({
      orgId: params.orgId,
      maxBudgetUsd,
    });
  } else {
    await updateDyadGatewayUser({
      orgId: params.orgId,
      maxBudgetUsd,
      resetSpend: params.resetGatewaySpend,
    });
    if (!nextKey) {
      nextKey = await generateDyadGatewayKey(params.orgId);
    }
  }

  if (!nextKey) {
    throw new Error("Failed to provision bundled Dyad Gateway key.");
  }

  for (const provider of BUNDLED_GATEWAY_PROVIDERS) {
    await params.convex.upsertBundledOrgAiKey({
      orgId: params.orgId,
      provider,
      rawKey: nextKey,
      createdBy: "billing",
    });
  }
};

const toStripeStatus = (status: string | null | undefined): SubscriptionStatus => {
  if (
    status === SUBSCRIPTION_STATUS.pastDue ||
    status === SUBSCRIPTION_STATUS.canceled ||
    status === SUBSCRIPTION_STATUS.trialing
  ) {
    return status;
  }
  return SUBSCRIPTION_STATUS.active;
};

const toTierFromPriceId = (priceId: string | null | undefined): SubscriptionTier => {
  const env = getEnv();
  const starterPrice = env.STRIPE_STARTER_PRICE_ID;
  const proPrice = env.STRIPE_PRO_PRICE_ID;
  if (priceId && starterPrice && priceId === starterPrice) {
    return SUBSCRIPTION_TIER.starter;
  }
  if (priceId && proPrice && priceId === proPrice) {
    return SUBSCRIPTION_TIER.pro;
  }
  return SUBSCRIPTION_TIER.free;
};

const getTierPriceId = (tier: BillingTier): string | null => {
  const env = getEnv();
  const raw =
    tier === SUBSCRIPTION_TIER.starter ? env.STRIPE_STARTER_PRICE_ID : env.STRIPE_PRO_PRICE_ID;
  const value = raw?.trim();
  return value && value.length > 0 ? value : null;
};

const TIER_RANK: Record<SubscriptionTier, number> = {
  [SUBSCRIPTION_TIER.free]: 0,
  [SUBSCRIPTION_TIER.starter]: 1,
  [SUBSCRIPTION_TIER.pro]: 2,
};

const BILLING_TEXT_MAX = 256;

const parseBoundedString = (value: unknown, field: string, max: number): string => {
  const raw = parseString(value, field);
  if (raw.length > max) {
    throw new BillingInputError("invalid_billing_field", `${field} is too long.`);
  }
  return raw;
};

const parseOptionalBoundedString = (
  value: unknown,
  field: string,
  max: number,
): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new BillingInputError("invalid_billing_field", `${field} must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (trimmed.length > max) {
    throw new BillingInputError("invalid_billing_field", `${field} is too long.`);
  }
  return trimmed;
};

const parseCountryCode = (value: unknown, field: string): string => {
  const raw = parseBoundedString(value, field, 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(raw)) {
    throw new BillingInputError(
      "invalid_billing_field",
      `${field} must be a two-letter country code.`,
    );
  }
  return raw;
};

const readSubscriptionItemPriceId = (subscription: Stripe.Subscription): string | null => {
  const item = subscription.items?.data?.[0];
  const priceUnknown: unknown = item?.price;
  if (typeof priceUnknown === "string" && priceUnknown.length > 0) {
    return priceUnknown;
  }
  if (
    priceUnknown &&
    typeof priceUnknown === "object" &&
    "id" in priceUnknown &&
    typeof (priceUnknown as { id?: unknown }).id === "string"
  ) {
    return (priceUnknown as { id: string }).id;
  }
  return null;
};

const readSubscriptionItemId = (subscription: Stripe.Subscription): string | null => {
  const item = subscription.items?.data?.[0];
  return typeof item?.id === "string" && item.id.length > 0 ? item.id : null;
};

const readScheduleId = (subscription: Stripe.Subscription): string | null => {
  const schedule = subscription.schedule;
  if (typeof schedule === "string" && schedule.length > 0) {
    return schedule;
  }
  if (
    schedule &&
    typeof schedule === "object" &&
    "id" in schedule &&
    typeof schedule.id === "string"
  ) {
    return schedule.id;
  }
  return null;
};

const subscriptionHasDefaultPaymentMethodField = (subscription: Stripe.Subscription): boolean => {
  const pm = subscription.default_payment_method;
  if (typeof pm === "string" && pm.length > 0) {
    return true;
  }
  return Boolean(pm && typeof pm === "object");
};

const assertSubscriptionHasPaymentMethod = async (
  stripe: Stripe,
  subscription: Stripe.Subscription,
): Promise<void> => {
  if (subscriptionHasDefaultPaymentMethodField(subscription)) {
    return;
  }
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer &&
          typeof subscription.customer === "object" &&
          "id" in subscription.customer
        ? subscription.customer.id
        : null;
  if (!customerId) {
    throw new BillingInputError(
      "billing_missing_payment_method",
      "Add a payment method in Manage Subscription before changing your plan.",
    );
  }
  const customer = await stripe.customers.retrieve(customerId, {
    expand: ["invoice_settings.default_payment_method"],
  });
  if (customer.deleted) {
    throw new BillingInputError(
      "billing_missing_payment_method",
      "Add a payment method in Manage Subscription before changing your plan.",
    );
  }
  const defaultPm = customer.invoice_settings?.default_payment_method;
  if (typeof defaultPm === "string" && defaultPm.length > 0) {
    return;
  }
  if (defaultPm && typeof defaultPm === "object") {
    return;
  }
  throw new BillingInputError(
    "billing_missing_payment_method",
    "Add a payment method in Manage Subscription before changing your plan.",
  );
};

const applyCustomerBillingDetails = async (
  stripe: Stripe,
  customerId: string,
  billing: {
    name: string;
    companyName?: string | undefined;
    address: Stripe.AddressParam;
  },
): Promise<void> => {
  await stripe.customers.update(customerId, {
    name: billing.name,
    address: billing.address,
    ...(billing.companyName
      ? {
          metadata: {
            billing_company_name: billing.companyName,
          },
        }
      : {}),
  });
};

const releaseSubscriptionScheduleIfPresent = async (
  stripe: Stripe,
  subscription: Stripe.Subscription,
): Promise<void> => {
  const scheduleId = readScheduleId(subscription);
  if (!scheduleId) {
    return;
  }
  await stripe.subscriptionSchedules.release(scheduleId);
};

const buildDowngradeSchedulePhases = (params: {
  currentPriceId: string;
  nextPriceId: string;
  periodStart: number;
  periodEnd: number;
}): Stripe.SubscriptionScheduleUpdateParams.Phase[] => {
  const phases: Stripe.SubscriptionScheduleUpdateParams.Phase[] = [
    {
      items: [{ price: params.currentPriceId, quantity: 1 }],
      start_date: params.periodStart,
      end_date: params.periodEnd,
    },
    {
      items: [{ price: params.nextPriceId, quantity: 1 }],
      start_date: params.periodEnd,
    },
  ];
  return phases;
};

const withSecurityHeaders = (request: Request, init?: ResponseInit): ResponseInit => {
  const headers = new Headers(init?.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADER_VALUES)) {
    headers.set(key, value);
  }
  if (new URL(request.url).protocol === "https:") {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return {
    ...init,
    headers,
  };
};

const jsonResponse = (request: Request, payload: unknown, status = 200): Response => {
  return Response.json(payload, withSecurityHeaders(request, { status }));
};

const parseJsonBody = async (request: Request): Promise<Record<string, unknown>> => {
  const raw = await request.text();
  if (!raw) {
    return {};
  }
  return parseJsonRecord(raw, {
    message: "Request body must be valid JSON.",
    recordMessage: "Request body must be a JSON object.",
  });
};

const parseString = (
  value: unknown,
  field: string,
  options: { allowEmpty?: boolean } = {},
): string => {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string.`);
  }
  const trimmed = value.trim();
  if (!options.allowEmpty && trimmed.length === 0) {
    throw new Error(`${field} is required.`);
  }
  return trimmed;
};

const parseInteger = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${field} must be an integer.`);
  }
  return value;
};

const toIsoFromUnix = (value: number | null | undefined): string => {
  const seconds =
    typeof value === "number" && Number.isFinite(value) ? value : Math.floor(Date.now() / 1000);
  return new Date(seconds * 1000).toISOString();
};

const readUnixPeriod = (value: unknown): { start?: number; end?: number } => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const record = value as Record<string, unknown>;
  return {
    ...(typeof record.current_period_start === "number"
      ? { start: record.current_period_start }
      : {}),
    ...(typeof record.current_period_end === "number" ? { end: record.current_period_end } : {}),
  };
};

let stripeClientCache: {
  cacheKey: string;
  client: Stripe;
} | null = null;

type ManagedPaymentsSessionCreateParams = Stripe.Checkout.SessionCreateParams & {
  managed_payments: {
    enabled: true;
  };
};

const resolveStripeClientConfig = (): Stripe.StripeConfig => {
  const env = getEnv();
  const baseUrl = env.STRIPE_API_BASE_URL;
  if (!baseUrl) {
    return {};
  }

  try {
    const parsed = new URL(baseUrl);
    const protocol = parsed.protocol === "http:" ? "http" : "https";
    const port = parsed.port || (protocol === "http" ? "80" : "443");
    return {
      host: parsed.hostname,
      port,
      protocol,
    };
  } catch {
    return {};
  }
};

const getStripeClient = (): Stripe => {
  const env = getEnv();
  const key = env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("Missing STRIPE_SECRET_KEY.");
  }
  const cacheKey = JSON.stringify({
    key,
    apiBaseUrl: env.STRIPE_API_BASE_URL ?? null,
  });
  if (!stripeClientCache || stripeClientCache.cacheKey !== cacheKey) {
    stripeClientCache = {
      cacheKey,
      client: new Stripe(key, {
        ...resolveStripeClientConfig(),
        apiVersion: STRIPE_MANAGED_PAYMENTS_API_VERSION,
      }),
    };
  }
  return stripeClientCache.client;
};

const resolveStripeClient = (deps?: BillingRequestDeps): Stripe => {
  return deps?.getStripeClient?.() ?? getStripeClient();
};

/** Stripe managed-payments typings return `Response<Subscription>`; normalize for our usage. */
const retrieveStripeSubscription = async (
  stripe: Stripe,
  subscriptionId: string,
  params?: Stripe.SubscriptionRetrieveParams,
): Promise<Stripe.Subscription> => {
  const result = await stripe.subscriptions.retrieve(subscriptionId, params);
  return result as Stripe.Subscription;
};

const retrieveStripeSubscriptionSchedule = async (
  stripe: Stripe,
  scheduleId: string,
  params?: Stripe.SubscriptionScheduleRetrieveParams,
): Promise<Stripe.SubscriptionSchedule> => {
  const result = await stripe.subscriptionSchedules.retrieve(scheduleId, params);
  return result as Stripe.SubscriptionSchedule;
};

const defaultDashboardBillingUrl = (): string => {
  const env = getEnv();
  const origin = (env.KEPPO_DASHBOARD_ORIGIN ?? "http://localhost:3000").replace(/\/+$/, "");
  return `${origin}/billing`;
};

const resolveReturnUrl = (value: unknown, fallback: string, field: string): string => {
  const fallbackUrl = new URL(fallback);

  if (typeof value !== "string" || value.trim().length === 0) {
    return fallbackUrl.toString();
  }
  const trimmed = value.trim();

  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return new URL(trimmed, fallbackUrl.origin).toString();
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new BillingInputError("invalid_redirect_url", `${field} must be a valid URL or path.`);
  }

  if (parsed.origin !== fallbackUrl.origin) {
    throw new BillingInputError(
      "invalid_redirect_url",
      `${field} must use the configured dashboard origin.`,
    );
  }

  return parsed.toString();
};

const requireSessionIdentity = async (
  request: Request,
  deps: BillingRequestDeps,
): Promise<
  | {
      ok: true;
      identity: BillingSessionIdentity;
    }
  | { ok: false; response: Response }
> => {
  const identity = await deps.resolveApiSessionIdentity(request);
  if (!identity) {
    return {
      ok: false,
      response: jsonResponse(
        request,
        {
          error: { code: "unauthorized", message: "Authentication required." },
        },
        401,
      ),
    };
  }
  return { ok: true, identity };
};

const canManageBillingPlan = (role: UserRole): boolean => {
  return role === "owner" || role === "admin";
};

const billingManagementForbiddenResponse = (
  request: Request,
  action:
    | "manage billing"
    | "start checkout"
    | "buy AI credits"
    | "buy automation run top-ups"
    | "change subscription plans",
): Response => {
  return jsonResponse(
    request,
    {
      error: {
        code: "billing.forbidden",
        message: `Only owners and admins can ${action}.`,
      },
    },
    403,
  );
};

const resolveOrgIdForRequest = (params: {
  requestedOrgId: string;
  identityOrgId: string;
}): { ok: true; orgId: string } | { ok: false; code: "cross_org_forbidden"; message: string } => {
  if (params.requestedOrgId && params.requestedOrgId !== params.identityOrgId) {
    return {
      ok: false,
      code: "cross_org_forbidden",
      message: "Authenticated session does not match requested org.",
    };
  }
  return { ok: true, orgId: params.identityOrgId };
};

const getBillingPathname = (pathname: string): string => {
  return pathname.startsWith("/api/") ? pathname.slice("/api".length) : pathname;
};

const isApiBillingPath = (pathname: string): boolean => {
  return pathname === "/api/billing" || pathname.startsWith("/api/billing/");
};

const isRootBillingPath = (pathname: string): boolean => {
  return pathname === "/billing" || pathname.startsWith("/billing/");
};

const toManagedPaymentsSessionParams = (
  params: Stripe.Checkout.SessionCreateParams,
): ManagedPaymentsSessionCreateParams => ({
  ...params,
  managed_payments: {
    enabled: true,
  },
});

export const handleBillingCheckoutRequest = async (
  request: Request,
  deps: BillingRequestDeps,
): Promise<Response> => {
  try {
    const authSession = await requireSessionIdentity(request, deps);
    if (!authSession.ok) {
      return authSession.response;
    }

    const body = await parseJsonBody(request);
    const requestedOrgId =
      typeof body.orgId === "string" ? parseString(body.orgId, "orgId", { allowEmpty: true }) : "";
    const resolvedOrg = resolveOrgIdForRequest({
      requestedOrgId,
      identityOrgId: authSession.identity.orgId,
    });
    if (!resolvedOrg.ok) {
      return jsonResponse(
        request,
        {
          error: { code: resolvedOrg.code, message: resolvedOrg.message },
        },
        403,
      );
    }
    if (!canManageBillingPlan(authSession.identity.role)) {
      return billingManagementForbiddenResponse(request, "start checkout");
    }

    const tier = parseString(body.tier, "tier");
    if (tier !== "starter" && tier !== "pro") {
      return jsonResponse(
        request,
        {
          error: {
            code: "invalid_tier",
            message: "tier must be starter or pro.",
          },
        },
        400,
      );
    }

    const priceId = getTierPriceId(tier);
    if (!priceId) {
      return jsonResponse(
        request,
        {
          error: {
            code: "missing_stripe_price",
            message: `Stripe price id for ${tier} is not configured.`,
          },
        },
        503,
      );
    }

    const stripe = resolveStripeClient(deps);
    const subscription = await deps.convex.getSubscriptionForOrg(resolvedOrg.orgId);
    const successUrl = resolveReturnUrl(
      body.successUrl,
      `${defaultDashboardBillingUrl()}?checkout=success`,
      "successUrl",
    );
    const cancelUrl = resolveReturnUrl(
      body.cancelUrl,
      `${defaultDashboardBillingUrl()}?checkout=cancel`,
      "cancelUrl",
    );
    const customerEmail =
      typeof body.customerEmail === "string" && body.customerEmail.trim().length > 0
        ? body.customerEmail.trim()
        : undefined;

    const sessionParams = toManagedPaymentsSessionParams({
      mode: "subscription",
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: resolvedOrg.orgId,
      metadata: {
        org_id: resolvedOrg.orgId,
        tier,
      },
    });
    if (subscription?.stripe_customer_id) {
      sessionParams.customer = subscription.stripe_customer_id;
    } else if (customerEmail) {
      sessionParams.customer_email = customerEmail;
    }

    console.log("billing.checkout.create_session", {
      pathname: new URL(request.url).pathname,
      orgId: resolvedOrg.orgId,
      tier,
      priceId,
      stripeApiBaseUrl: getEnv().STRIPE_API_BASE_URL ?? "https://api.stripe.com",
      vercelDeploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
      vercelGitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    });

    const session = await stripe.checkout.sessions.create(
      sessionParams,
      managedPaymentsCheckoutRequestOptions,
    );
    return jsonResponse(request, {
      url: session.url,
      session_id: session.id,
    });
  } catch (error) {
    if (error instanceof BillingInputError) {
      return jsonResponse(request, { error: { code: error.code, message: error.message } }, 400);
    }
    const message = error instanceof Error ? error.message : "Checkout session creation failed.";
    return jsonResponse(request, { error: { code: "checkout_failed", message } }, 400);
  }
};

export const handleBillingCreditsCheckoutRequest = async (
  request: Request,
  deps: BillingRequestDeps,
): Promise<Response> => {
  try {
    const authSession = await requireSessionIdentity(request, deps);
    if (!authSession.ok) {
      return authSession.response;
    }

    const body = await parseJsonBody(request);
    const requestedOrgId =
      typeof body.orgId === "string" ? parseString(body.orgId, "orgId", { allowEmpty: true }) : "";
    const resolvedOrg = resolveOrgIdForRequest({
      requestedOrgId,
      identityOrgId: authSession.identity.orgId,
    });
    if (!resolvedOrg.ok) {
      return jsonResponse(
        request,
        {
          error: { code: resolvedOrg.code, message: resolvedOrg.message },
        },
        403,
      );
    }
    if (!canManageBillingPlan(authSession.identity.role)) {
      return billingManagementForbiddenResponse(request, "buy AI credits");
    }

    const packageIndex = parseInteger(body.packageIndex, "packageIndex");
    const creditProductId = parseString(
      getEnv().STRIPE_CREDIT_PRODUCT_ID,
      "STRIPE_CREDIT_PRODUCT_ID",
    );
    const selectedPackage = AI_CREDIT_PACKAGES[packageIndex];
    if (!selectedPackage) {
      return jsonResponse(
        request,
        {
          error: {
            code: "invalid_credit_package",
            message: "packageIndex is out of range for configured credit packages.",
          },
        },
        400,
      );
    }

    const stripe = resolveStripeClient(deps);
    const subscription = await deps.convex.getSubscriptionForOrg(resolvedOrg.orgId);
    const successUrl = resolveReturnUrl(
      body.successUrl,
      `${defaultDashboardBillingUrl()}?creditCheckout=success`,
      "successUrl",
    );
    const cancelUrl = resolveReturnUrl(
      body.cancelUrl,
      `${defaultDashboardBillingUrl()}?creditCheckout=cancel`,
      "cancelUrl",
    );
    const customerEmail =
      typeof body.customerEmail === "string" && body.customerEmail.trim().length > 0
        ? body.customerEmail.trim()
        : undefined;

    const sessionParams = toManagedPaymentsSessionParams({
      mode: "payment",
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: resolvedOrg.orgId,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            product: creditProductId,
            unit_amount: selectedPackage.priceCents,
          },
        },
      ],
      metadata: {
        org_id: resolvedOrg.orgId,
        credit_package_index: packageIndex.toString(),
        credits: selectedPackage.credits.toString(),
        price_cents: selectedPackage.priceCents.toString(),
      },
    });

    if (subscription?.stripe_customer_id) {
      sessionParams.customer = subscription.stripe_customer_id;
    } else if (customerEmail) {
      sessionParams.customer_email = customerEmail;
    }

    const session = await stripe.checkout.sessions.create(
      sessionParams,
      managedPaymentsCheckoutRequestOptions,
    );
    return jsonResponse(request, {
      checkout_url: session.url,
      session_id: session.id,
    });
  } catch (error) {
    if (error instanceof BillingInputError) {
      return jsonResponse(request, { error: { code: error.code, message: error.message } }, 400);
    }
    const message =
      error instanceof Error ? error.message : "Credit checkout session creation failed.";
    return jsonResponse(request, { error: { code: "credit_checkout_failed", message } }, 400);
  }
};

export const handleBillingAutomationRunCheckoutRequest = async (
  request: Request,
  deps: BillingRequestDeps,
): Promise<Response> => {
  try {
    const authSession = await requireSessionIdentity(request, deps);
    if (!authSession.ok) {
      return authSession.response;
    }

    const body = await parseJsonBody(request);
    const requestedOrgId =
      typeof body.orgId === "string" ? parseString(body.orgId, "orgId", { allowEmpty: true }) : "";
    const resolvedOrg = resolveOrgIdForRequest({
      requestedOrgId,
      identityOrgId: authSession.identity.orgId,
    });
    if (!resolvedOrg.ok) {
      return jsonResponse(
        request,
        {
          error: { code: resolvedOrg.code, message: resolvedOrg.message },
        },
        403,
      );
    }
    if (!canManageBillingPlan(authSession.identity.role)) {
      return billingManagementForbiddenResponse(request, "buy automation run top-ups");
    }

    const packageIndex = parseInteger(body.packageIndex, "packageIndex");
    const automationRunProductId = parseString(
      getEnv().STRIPE_AUTOMATION_RUN_PRODUCT_ID,
      "STRIPE_AUTOMATION_RUN_PRODUCT_ID",
    );
    const subscription = await deps.convex.getSubscriptionForOrg(resolvedOrg.orgId);
    const tier = subscription?.tier ?? SUBSCRIPTION_TIER.free;
    if (!isBundledTier(tier)) {
      return jsonResponse(
        request,
        {
          error: {
            code: "automation_run_topups_require_paid_plan",
            message: "Automation run top-ups are only available on paid plans.",
          },
        },
        403,
      );
    }

    const packages = getAutomationRunPackagesForTier(tier);
    const selectedPackage = packages[packageIndex];
    if (!selectedPackage) {
      return jsonResponse(
        request,
        {
          error: {
            code: "invalid_automation_run_package",
            message: "packageIndex is out of range for configured automation run packages.",
          },
        },
        400,
      );
    }

    const stripe = resolveStripeClient(deps);
    const successUrl = resolveReturnUrl(
      body.successUrl,
      `${defaultDashboardBillingUrl()}?runCheckout=success`,
      "successUrl",
    );
    const cancelUrl = resolveReturnUrl(
      body.cancelUrl,
      `${defaultDashboardBillingUrl()}?runCheckout=cancel`,
      "cancelUrl",
    );
    const customerEmail =
      typeof body.customerEmail === "string" && body.customerEmail.trim().length > 0
        ? body.customerEmail.trim()
        : undefined;

    const sessionParams = toManagedPaymentsSessionParams({
      mode: "payment",
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: resolvedOrg.orgId,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            product: automationRunProductId,
            unit_amount: selectedPackage.price_cents,
          },
        },
      ],
      metadata: {
        org_id: resolvedOrg.orgId,
        purchase_type: "automation_run_topup",
        package_index: packageIndex.toString(),
        tier,
        multiplier: selectedPackage.multiplier,
        runs: selectedPackage.runs.toString(),
        tool_calls: selectedPackage.tool_calls.toString(),
        tool_call_time_ms: selectedPackage.tool_call_time_ms.toString(),
        price_cents: selectedPackage.price_cents.toString(),
      },
    });

    if (subscription?.stripe_customer_id) {
      sessionParams.customer = subscription.stripe_customer_id;
    } else if (customerEmail) {
      sessionParams.customer_email = customerEmail;
    }

    const session = await stripe.checkout.sessions.create(
      sessionParams,
      managedPaymentsCheckoutRequestOptions,
    );
    return jsonResponse(request, {
      checkout_url: session.url,
      session_id: session.id,
    });
  } catch (error) {
    if (error instanceof BillingInputError) {
      return jsonResponse(request, { error: { code: error.code, message: error.message } }, 400);
    }
    console.error("billing.automation_run_checkout.failed", error);
    return jsonResponse(
      request,
      sanitizeInternalBillingError(
        "automation_run_checkout_failed",
        "Automation run checkout failed. Please try again.",
      ),
      500,
    );
  }
};

export const handleBillingPortalRequest = async (
  request: Request,
  deps: BillingRequestDeps,
): Promise<Response> => {
  try {
    const authSession = await requireSessionIdentity(request, deps);
    if (!authSession.ok) {
      return authSession.response;
    }

    const body = await parseJsonBody(request);
    const requestedOrgId =
      typeof body.orgId === "string" ? parseString(body.orgId, "orgId", { allowEmpty: true }) : "";
    const resolvedOrg = resolveOrgIdForRequest({
      requestedOrgId,
      identityOrgId: authSession.identity.orgId,
    });
    if (!resolvedOrg.ok) {
      return jsonResponse(
        request,
        {
          error: { code: resolvedOrg.code, message: resolvedOrg.message },
        },
        403,
      );
    }
    if (!canManageBillingPlan(authSession.identity.role)) {
      return billingManagementForbiddenResponse(request, "manage billing");
    }

    const activeStripeSubscription = getActiveStripeBilling(
      await deps.convex.getSubscriptionForOrg(resolvedOrg.orgId),
    );
    if (!activeStripeSubscription) {
      const usage = await deps.convex.getBillingUsageForOrg(resolvedOrg.orgId);
      if (usage.billing_source === "invite_promo") {
        return jsonResponse(
          request,
          {
            error: {
              code: "invite_promo_has_no_portal",
              message: "Invite promo access does not have a Stripe subscription to manage yet.",
            },
          },
          400,
        );
      }
      return jsonResponse(
        request,
        {
          error: {
            code: "billing_no_active_subscription",
            message: "Use checkout to start a paid plan for this org.",
          },
        },
        400,
      );
    }

    const portal = await resolveStripeClient(deps).billingPortal.sessions.create({
      customer: activeStripeSubscription.stripe_customer_id,
      return_url: resolveReturnUrl(body.returnUrl, defaultDashboardBillingUrl(), "returnUrl"),
    });
    return jsonResponse(request, {
      url: portal.url,
    });
  } catch (error) {
    if (error instanceof BillingInputError) {
      return jsonResponse(request, { error: { code: error.code, message: error.message } }, 400);
    }
    console.error("billing.portal.failed", error);
    return jsonResponse(
      request,
      sanitizeInternalBillingError("portal_failed", "Billing portal is unavailable right now."),
      500,
    );
  }
};

type NativeBillingAddressInput = {
  line1: string;
  line2?: string | undefined;
  city?: string | undefined;
  state?: string | undefined;
  postalCode: string;
  country: string;
};

const parseNativeBillingAddress = (value: unknown, field: string): NativeBillingAddressInput => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BillingInputError("invalid_billing_field", `${field} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  return {
    line1: parseBoundedString(record.line1, `${field}.line1`, BILLING_TEXT_MAX),
    line2: parseOptionalBoundedString(record.line2, `${field}.line2`, BILLING_TEXT_MAX),
    city: parseOptionalBoundedString(record.city, `${field}.city`, BILLING_TEXT_MAX),
    state: parseOptionalBoundedString(record.state, `${field}.state`, BILLING_TEXT_MAX),
    postalCode: parseBoundedString(record.postalCode, `${field}.postalCode`, 32),
    country: parseCountryCode(record.country, `${field}.country`),
  };
};

const toStripeAddressParam = (address: NativeBillingAddressInput): Stripe.AddressParam => ({
  line1: address.line1,
  ...(address.line2 ? { line2: address.line2 } : {}),
  ...(address.city ? { city: address.city } : {}),
  ...(address.state ? { state: address.state } : {}),
  postal_code: address.postalCode,
  country: address.country,
});

export const handleBillingSubscriptionChangeRequest = async (
  request: Request,
  deps: BillingRequestDeps,
): Promise<Response> => {
  try {
    const authSession = await requireSessionIdentity(request, deps);
    if (!authSession.ok) {
      return authSession.response;
    }

    const body = await parseJsonBody(request);
    const requestedOrgId =
      typeof body.orgId === "string" ? parseString(body.orgId, "orgId", { allowEmpty: true }) : "";
    const resolvedOrg = resolveOrgIdForRequest({
      requestedOrgId,
      identityOrgId: authSession.identity.orgId,
    });
    if (!resolvedOrg.ok) {
      return jsonResponse(
        request,
        {
          error: { code: resolvedOrg.code, message: resolvedOrg.message },
        },
        403,
      );
    }

    if (!canManageBillingPlan(authSession.identity.role)) {
      return billingManagementForbiddenResponse(request, "change subscription plans");
    }

    const activeStripeSubscription = getActiveStripeBilling(
      await deps.convex.getSubscriptionForOrg(resolvedOrg.orgId),
    );
    if (!activeStripeSubscription) {
      const usage = await deps.convex.getBillingUsageForOrg(resolvedOrg.orgId);
      if (usage.billing_source === "invite_promo") {
        return jsonResponse(
          request,
          {
            error: {
              code: "billing_invite_promo_requires_checkout",
              message: "Invite promo orgs need checkout to start recurring Stripe billing.",
            },
          },
          400,
        );
      }
      return jsonResponse(
        request,
        {
          error: {
            code: "billing_no_active_subscription",
            message: "Use checkout to start a paid plan for this org.",
          },
        },
        400,
      );
    }

    const undoCancel = body.undoCancelAtPeriodEnd === true;
    const stripe = resolveStripeClient(deps);
    const stripeSubscriptionId = activeStripeSubscription.stripe_subscription_id;

    if (undoCancel) {
      const live = await retrieveStripeSubscription(stripe, stripeSubscriptionId, {
        expand: ["schedule"],
      });
      if (live.status === "canceled") {
        return jsonResponse(
          request,
          {
            error: {
              code: "billing_subscription_inactive",
              message: "This subscription is already canceled.",
            },
          },
          400,
        );
      }
      if (!live.cancel_at_period_end) {
        return jsonResponse(
          request,
          {
            error: {
              code: "billing_no_pending_cancel",
              message: "This subscription is not scheduled to cancel.",
            },
          },
          400,
        );
      }
      const livePeriod = readUnixPeriod(live);
      const periodEndForKey =
        typeof livePeriod.end === "number" ? livePeriod.end : Math.floor(Date.now() / 1000);
      await stripe.subscriptions.update(
        stripeSubscriptionId,
        { cancel_at_period_end: false },
        {
          idempotencyKey: `keppo-billing-undo-cancel-${resolvedOrg.orgId}-${periodEndForKey}`,
        },
      );
      await deps.convex.createAuditEvent({
        orgId: resolvedOrg.orgId,
        actorType: AUDIT_ACTOR_TYPE.user,
        actorId: authSession.identity.userId,
        eventType: AUDIT_EVENT_TYPES.billingSubscriptionUpdated,
        payload: {
          action: "undo_cancel_at_period_end",
          requested_target_tier: activeStripeSubscription.tier,
          stripe_subscription_id: stripeSubscriptionId,
        },
      });
      return jsonResponse(request, {
        ok: true,
        undo_cancel_at_period_end: true,
        effective_at: null,
        pending_tier: null,
      });
    }

    const targetTierRaw = body.targetTier;
    if (targetTierRaw !== "starter" && targetTierRaw !== "pro" && targetTierRaw !== "free") {
      return jsonResponse(
        request,
        {
          error: {
            code: "invalid_target_tier",
            message: "targetTier must be starter, pro, or free.",
          },
        },
        400,
      );
    }
    const targetTier = targetTierRaw as SubscriptionTier;

    const convexTier = activeStripeSubscription.tier;
    if (targetTier === convexTier) {
      return jsonResponse(
        request,
        {
          error: {
            code: "billing_plan_no_op",
            message: "You are already on this plan.",
          },
        },
        400,
      );
    }

    let liveSubscription = await retrieveStripeSubscription(stripe, stripeSubscriptionId, {
      expand: ["default_payment_method", "items.data.price", "schedule"],
    });

    if (liveSubscription.status === "canceled") {
      return jsonResponse(
        request,
        {
          error: {
            code: "billing_subscription_inactive",
            message: "This subscription is no longer active.",
          },
        },
        400,
      );
    }

    if (liveSubscription.cancel_at_period_end) {
      return jsonResponse(
        request,
        {
          error: {
            code: "billing_cancel_scheduled",
            message: "Remove the scheduled cancellation before changing plans.",
          },
        },
        400,
      );
    }

    const currentPriceId = readSubscriptionItemPriceId(liveSubscription);
    if (!currentPriceId) {
      return jsonResponse(
        request,
        {
          error: {
            code: "billing_subscription_invalid",
            message: "Could not read the current subscription price from Stripe.",
          },
        },
        400,
      );
    }

    const liveTier = toTierFromPriceId(currentPriceId);
    if (liveTier === SUBSCRIPTION_TIER.free) {
      return jsonResponse(
        request,
        {
          error: {
            code: "billing_subscription_invalid",
            message: "Stripe subscription price does not match a known Keppo tier.",
          },
        },
        400,
      );
    }
    if (!isBundledTier(liveTier)) {
      return jsonResponse(
        request,
        {
          error: {
            code: "billing_subscription_invalid",
            message: "Stripe subscription price does not match a known Keppo tier.",
          },
        },
        400,
      );
    }

    if (targetTier === SUBSCRIPTION_TIER.free) {
      const scheduleId = readScheduleId(liveSubscription);
      if (scheduleId) {
        await stripe.subscriptionSchedules.release(scheduleId);
        liveSubscription = await retrieveStripeSubscription(stripe, stripeSubscriptionId, {
          expand: ["default_payment_method", "items.data.price", "schedule"],
        });
      }
      const cancelPeriod = readUnixPeriod(liveSubscription);
      const periodEndForKey =
        typeof cancelPeriod.end === "number" ? cancelPeriod.end : Math.floor(Date.now() / 1000);
      await stripe.subscriptions.update(
        stripeSubscriptionId,
        { cancel_at_period_end: true },
        {
          idempotencyKey: `keppo-billing-cancel-end-${resolvedOrg.orgId}-${periodEndForKey}`,
        },
      );
      const periodEnd = typeof cancelPeriod.end === "number" ? cancelPeriod.end : periodEndForKey;
      await deps.convex.createAuditEvent({
        orgId: resolvedOrg.orgId,
        actorType: AUDIT_ACTOR_TYPE.user,
        actorId: authSession.identity.userId,
        eventType: AUDIT_EVENT_TYPES.billingSubscriptionUpdated,
        payload: {
          action: "cancel_at_period_end",
          requested_target_tier: SUBSCRIPTION_TIER.free,
          stripe_subscription_id: stripeSubscriptionId,
          effective_at: toIsoFromUnix(periodEnd),
        },
      });
      return jsonResponse(request, {
        ok: true,
        cancel_at_period_end: true,
        effective_at: toIsoFromUnix(periodEnd),
        pending_tier: SUBSCRIPTION_TIER.free,
      });
    }

    const billingRecord = body.billing;
    if (!billingRecord || typeof billingRecord !== "object" || Array.isArray(billingRecord)) {
      return jsonResponse(
        request,
        {
          error: {
            code: "invalid_billing_field",
            message: "billing must be an object with name and address.",
          },
        },
        400,
      );
    }
    const billingObj = billingRecord as Record<string, unknown>;
    const billingName = parseBoundedString(billingObj.name, "billing.name", BILLING_TEXT_MAX);
    const companyName = parseOptionalBoundedString(
      billingObj.companyName,
      "billing.companyName",
      BILLING_TEXT_MAX,
    );
    const addressInput = parseNativeBillingAddress(billingObj.address, "billing.address");
    const stripeAddress = toStripeAddressParam(addressInput);

    await applyCustomerBillingDetails(stripe, activeStripeSubscription.stripe_customer_id, {
      name: billingName,
      companyName,
      address: stripeAddress,
    });

    const targetPriceId =
      targetTier === SUBSCRIPTION_TIER.starter
        ? getTierPriceId(SUBSCRIPTION_TIER.starter)
        : getTierPriceId(SUBSCRIPTION_TIER.pro);
    if (!targetPriceId) {
      return jsonResponse(
        request,
        {
          error: {
            code: "missing_stripe_price",
            message: `Stripe price id for ${targetTier} is not configured.`,
          },
        },
        503,
      );
    }

    if (TIER_RANK[targetTier] > TIER_RANK[liveTier]) {
      await assertSubscriptionHasPaymentMethod(stripe, liveSubscription);
      await releaseSubscriptionScheduleIfPresent(stripe, liveSubscription);
      liveSubscription = await retrieveStripeSubscription(stripe, stripeSubscriptionId, {
        expand: ["default_payment_method", "items.data.price", "schedule"],
      });
      const itemId = readSubscriptionItemId(liveSubscription);
      if (!itemId) {
        return jsonResponse(
          request,
          {
            error: {
              code: "billing_subscription_invalid",
              message: "Could not read subscription line items from Stripe.",
            },
          },
          400,
        );
      }
      const upgradePeriod = readUnixPeriod(liveSubscription);
      const periodEndForKey =
        typeof upgradePeriod.end === "number" ? upgradePeriod.end : Math.floor(Date.now() / 1000);
      const updated = await stripe.subscriptions.update(
        stripeSubscriptionId,
        {
          items: [{ id: itemId, price: targetPriceId }],
          proration_behavior: "create_prorations",
        },
        {
          idempotencyKey: `keppo-billing-upgrade-${resolvedOrg.orgId}-${targetTier}-${periodEndForKey}`,
        },
      );
      const latestInvoice = updated.latest_invoice;
      if (typeof latestInvoice === "object" && latestInvoice && "payment_intent" in latestInvoice) {
        const pi = latestInvoice.payment_intent;
        const piStatus =
          typeof pi === "object" && pi && "status" in pi
            ? (pi as { status?: string }).status
            : null;
        if (piStatus === "requires_action" || piStatus === "requires_payment_method") {
          return jsonResponse(
            request,
            {
              error: {
                code: "billing_payment_requires_action",
                message:
                  "Your bank requires additional confirmation. Complete payment in Manage Subscription.",
              },
            },
            409,
          );
        }
      }
      await deps.convex.createAuditEvent({
        orgId: resolvedOrg.orgId,
        actorType: AUDIT_ACTOR_TYPE.user,
        actorId: authSession.identity.userId,
        eventType: AUDIT_EVENT_TYPES.billingSubscriptionUpdated,
        payload: {
          action: "upgrade",
          requested_target_tier: targetTier,
          stripe_subscription_id: stripeSubscriptionId,
          effective_at: new Date().toISOString(),
        },
      });
      return jsonResponse(request, {
        ok: true,
        upgrade: true,
        effective_at: new Date().toISOString(),
        pending_tier: null,
      });
    }

    if (TIER_RANK[targetTier] < TIER_RANK[liveTier]) {
      const downgradePeriod = readUnixPeriod(liveSubscription);
      const periodStart =
        typeof downgradePeriod.start === "number"
          ? downgradePeriod.start
          : Math.floor(Date.now() / 1000);
      const periodEnd =
        typeof downgradePeriod.end === "number"
          ? downgradePeriod.end
          : Math.floor(Date.now() / 1000);
      const phases = buildDowngradeSchedulePhases({
        currentPriceId,
        nextPriceId: targetPriceId,
        periodStart,
        periodEnd,
      });
      const scheduleId = readScheduleId(liveSubscription);
      if (scheduleId) {
        await stripe.subscriptionSchedules.update(
          scheduleId,
          {
            phases,
            proration_behavior: "none",
          },
          {
            idempotencyKey: `keppo-billing-downgrade-${resolvedOrg.orgId}-${targetTier}-${periodEnd}`,
          },
        );
      } else {
        const created = await stripe.subscriptionSchedules.create(
          { from_subscription: stripeSubscriptionId },
          {
            idempotencyKey: `keppo-billing-schedule-from-${resolvedOrg.orgId}`,
          },
        );
        await stripe.subscriptionSchedules.update(
          created.id,
          {
            phases,
            proration_behavior: "none",
          },
          {
            idempotencyKey: `keppo-billing-downgrade-${resolvedOrg.orgId}-${targetTier}-${periodEnd}`,
          },
        );
      }
      await deps.convex.createAuditEvent({
        orgId: resolvedOrg.orgId,
        actorType: AUDIT_ACTOR_TYPE.user,
        actorId: authSession.identity.userId,
        eventType: AUDIT_EVENT_TYPES.billingSubscriptionScheduleUpdated,
        payload: {
          action: "downgrade_scheduled",
          requested_target_tier: targetTier,
          stripe_subscription_id: stripeSubscriptionId,
          effective_at: toIsoFromUnix(periodEnd),
        },
      });
      return jsonResponse(request, {
        ok: true,
        downgrade_scheduled: true,
        effective_at: toIsoFromUnix(periodEnd),
        pending_tier: targetTier,
      });
    }

    return jsonResponse(
      request,
      {
        error: {
          code: "billing_plan_change_unsupported",
          message: "This plan change is not supported.",
        },
      },
      400,
    );
  } catch (error) {
    if (error instanceof BillingInputError) {
      return jsonResponse(request, { error: { code: error.code, message: error.message } }, 400);
    }
    console.error("billing.subscription_change.failed", error);
    return jsonResponse(
      request,
      {
        error: {
          code: "subscription_change_failed",
          message: "Subscription change failed. Please try again.",
        },
      },
      500,
    );
  }
};

export const handleBillingSubscriptionPendingRequest = async (
  request: Request,
  deps: BillingRequestDeps,
): Promise<Response> => {
  try {
    const authSession = await requireSessionIdentity(request, deps);
    if (!authSession.ok) {
      return authSession.response;
    }

    const requestedOrgId = new URL(request.url).searchParams.get("orgId")?.trim() ?? "";
    const resolvedOrg = resolveOrgIdForRequest({
      requestedOrgId,
      identityOrgId: authSession.identity.orgId,
    });
    if (!resolvedOrg.ok) {
      return jsonResponse(
        request,
        {
          error: { code: resolvedOrg.code, message: resolvedOrg.message },
        },
        403,
      );
    }

    const orgRow = await deps.convex.getSubscriptionForOrg(resolvedOrg.orgId);
    if (!orgRow?.stripe_subscription_id) {
      return jsonResponse(request, {
        cancel_at_period_end: false,
        pending_tier: null,
        pending_effective_at: null,
      });
    }

    const stripe = resolveStripeClient(deps);
    const sub = await retrieveStripeSubscription(stripe, orgRow.stripe_subscription_id, {
      expand: ["schedule"],
    });

    const cancelAtPeriodEnd = sub.cancel_at_period_end === true;
    const cancelAtUnix =
      typeof sub.cancel_at === "number" && Number.isFinite(sub.cancel_at) ? sub.cancel_at : null;

    if (cancelAtPeriodEnd) {
      return jsonResponse(request, {
        cancel_at_period_end: true,
        pending_tier: SUBSCRIPTION_TIER.free,
        pending_effective_at: cancelAtUnix ? toIsoFromUnix(cancelAtUnix) : null,
      });
    }

    const scheduleId = readScheduleId(sub);
    if (!scheduleId) {
      return jsonResponse(request, {
        cancel_at_period_end: false,
        pending_tier: null,
        pending_effective_at: null,
      });
    }

    const schedule = await retrieveStripeSubscriptionSchedule(stripe, scheduleId);
    const phases = schedule.phases ?? [];
    if (phases.length < 2) {
      return jsonResponse(request, {
        cancel_at_period_end: false,
        pending_tier: null,
        pending_effective_at: null,
      });
    }
    const nextPhase = phases[phases.length - 1];
    const firstPhase = phases[0];
    if (!firstPhase || !nextPhase) {
      return jsonResponse(request, {
        cancel_at_period_end: false,
        pending_tier: null,
        pending_effective_at: null,
      });
    }
    const firstPriceId =
      typeof firstPhase.items?.[0]?.price === "string"
        ? firstPhase.items[0].price
        : firstPhase.items?.[0]?.price && typeof firstPhase.items[0].price === "object"
          ? firstPhase.items[0].price.id
          : null;
    const nextPriceId =
      typeof nextPhase.items?.[0]?.price === "string"
        ? nextPhase.items[0].price
        : nextPhase.items?.[0]?.price && typeof nextPhase.items[0].price === "object"
          ? nextPhase.items[0].price.id
          : null;
    if (!firstPriceId || !nextPriceId || firstPriceId === nextPriceId) {
      return jsonResponse(request, {
        cancel_at_period_end: false,
        pending_tier: null,
        pending_effective_at: null,
      });
    }
    const pendingTier = toTierFromPriceId(nextPriceId);
    if (pendingTier === SUBSCRIPTION_TIER.free || pendingTier === toTierFromPriceId(firstPriceId)) {
      return jsonResponse(request, {
        cancel_at_period_end: false,
        pending_tier: null,
        pending_effective_at: null,
      });
    }
    const subPeriod = readUnixPeriod(sub);
    const startUnix =
      typeof nextPhase.start_date === "number"
        ? nextPhase.start_date
        : typeof subPeriod.end === "number"
          ? subPeriod.end
          : null;
    return jsonResponse(request, {
      cancel_at_period_end: false,
      pending_tier: pendingTier,
      pending_effective_at: typeof startUnix === "number" ? toIsoFromUnix(startUnix) : null,
    });
  } catch (error) {
    console.error("billing.subscription_pending.failed", error);
    return jsonResponse(
      request,
      {
        error: {
          code: "pending_change_failed",
          message: "Could not load the pending subscription change. Please try again.",
        },
      },
      500,
    );
  }
};

export const handleBillingUsageRequest = async (
  request: Request,
  deps: BillingRequestDeps,
): Promise<Response> => {
  try {
    const authSession = await requireSessionIdentity(request, deps);
    if (!authSession.ok) {
      return authSession.response;
    }

    const requestedOrgId = new URL(request.url).searchParams.get("orgId")?.trim() ?? "";
    const resolvedOrg = resolveOrgIdForRequest({
      requestedOrgId,
      identityOrgId: authSession.identity.orgId,
    });
    if (!resolvedOrg.ok) {
      return jsonResponse(
        request,
        {
          error: { code: resolvedOrg.code, message: resolvedOrg.message },
        },
        403,
      );
    }

    const usage = await deps.convex.getBillingUsageForOrg(resolvedOrg.orgId);
    const nextInvoicePreview =
      usage.tier === "free" || usage.billing_source === "invite_promo"
        ? null
        : {
            amount_due_cents: usage.limits.price_cents_monthly,
            currency: "usd",
            due_at: usage.period_end,
            note: "Estimated recurring monthly subscription charge.",
          };
    return jsonResponse(request, {
      ...usage,
      next_invoice_preview: nextInvoicePreview,
    });
  } catch (error) {
    console.error("billing.usage.failed", error);
    return jsonResponse(
      request,
      sanitizeInternalBillingError(
        "usage_failed",
        "Could not load billing usage. Please try again.",
      ),
      500,
    );
  }
};

export const handleBillingExtraUsageRequest = async (request: Request): Promise<Response> => {
  return jsonResponse(
    request,
    {
      error: {
        code: "overage_billing_removed",
        message: "Extra usage billing has been removed. Buy AI credit packs instead.",
      },
    },
    410,
  );
};

const readCheckoutOrgId = (session: Stripe.Checkout.Session): string => {
  const orgIdFromMetadata =
    (typeof session.metadata?.org_id === "string" && session.metadata.org_id.trim()) || "";
  const orgIdFromReference =
    (typeof session.client_reference_id === "string" && session.client_reference_id.trim()) || "";
  return orgIdFromMetadata || orgIdFromReference;
};

const readCheckoutPaymentIntentId = (session: Stripe.Checkout.Session): string | null => {
  return typeof session.payment_intent === "string" ? session.payment_intent : null;
};

const sanitizeInternalBillingError = (code: string, message: string) => ({
  error: { code, message },
});

const isCreditCheckoutSession = (session: Stripe.Checkout.Session): boolean => {
  const metadataCreditsRaw = session.metadata?.credits;
  const metadataCredits =
    typeof metadataCreditsRaw === "string" && metadataCreditsRaw.trim().length > 0
      ? Number.parseInt(metadataCreditsRaw, 10)
      : NaN;
  return Number.isFinite(metadataCredits) && metadataCredits > 0;
};

const isAutomationRunTopupCheckoutSession = (session: Stripe.Checkout.Session): boolean => {
  return session.metadata?.purchase_type === "automation_run_topup";
};

const isSuccessfulManagedCheckoutSettlement = (
  eventType: Stripe.Event["type"],
  session: Stripe.Checkout.Session,
): boolean => {
  if (eventType === "checkout.session.async_payment_succeeded") {
    return true;
  }
  if (eventType !== "checkout.session.completed") {
    return false;
  }
  return session.payment_status === "paid" || session.payment_status === "no_payment_required";
};

const completeBusinessDedupeKey = async (
  deps: BillingRequestDeps,
  dedupeKey: string,
): Promise<boolean> => {
  return await deps.convex.completeApiDedupeKey({
    scope: API_DEDUPE_SCOPE.webhookDelivery,
    dedupeKey,
  });
};

const claimBusinessDedupeKey = async (
  deps: BillingRequestDeps,
  dedupeKey: string,
): Promise<boolean> => {
  const claimed = await deps.convex.claimApiDedupeKey({
    scope: API_DEDUPE_SCOPE.webhookDelivery,
    dedupeKey,
    ttlMs: BILLING_WEBHOOK_DEDUPE_TTL_MS,
    initialStatus: API_DEDUPE_STATUS.pending,
  });
  return claimed.claimed;
};

const releaseBusinessDedupeKey = async (
  deps: BillingRequestDeps,
  dedupeKey: string,
): Promise<boolean> => {
  return await deps.convex.releaseApiDedupeKey({
    scope: API_DEDUPE_SCOPE.webhookDelivery,
    dedupeKey,
  });
};

export const handleStripeBillingWebhookRequest = async (
  request: Request,
  deps: BillingRequestDeps,
): Promise<Response> => {
  const webhookSecret = getEnv().STRIPE_BILLING_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return jsonResponse(
      request,
      {
        error: {
          code: "missing_webhook_secret",
          message: "Missing STRIPE_BILLING_WEBHOOK_SECRET (or legacy STRIPE_WEBHOOK_SECRET).",
        },
      },
      503,
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return jsonResponse(
      request,
      {
        error: {
          code: "missing_signature",
          message: "Missing stripe-signature header.",
        },
      },
      400,
    );
  }

  const rawBody = await request.text();
  let event: Stripe.Event;
  try {
    event = resolveStripeClient(deps).webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch {
    return jsonResponse(
      request,
      {
        error: {
          code: "invalid_signature",
          message: "Invalid Stripe webhook signature.",
        },
      },
      400,
    );
  }

  const dedupeKey = `stripe-billing:${event.id}`;
  const dedupe = await deps.convex.claimApiDedupeKey({
    scope: API_DEDUPE_SCOPE.webhookDelivery,
    dedupeKey,
    ttlMs: BILLING_WEBHOOK_DEDUPE_TTL_MS,
    initialStatus: API_DEDUPE_STATUS.pending,
  });
  if (!dedupe.claimed) {
    return jsonResponse(request, { received: true, duplicate: true });
  }

  try {
    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded" ||
      event.type === "checkout.session.async_payment_failed"
    ) {
      const session = event.data.object as Stripe.Checkout.Session;
      const orgId = readCheckoutOrgId(session);
      const settledSuccess = isSuccessfulManagedCheckoutSettlement(event.type, session);

      if (settledSuccess && isCreditCheckoutSession(session) && orgId.length > 0) {
        const metadataCredits = Number.parseInt(session.metadata?.credits ?? "", 10);
        const metadataPrice = Number.parseInt(session.metadata?.price_cents ?? "", 10);
        const priceCents =
          Number.isFinite(metadataPrice) && metadataPrice > 0
            ? metadataPrice
            : (session.amount_total ?? 0);
        const businessKey = `stripe-billing:credit-purchase:${readCheckoutPaymentIntentId(session) ?? session.id}`;

        if (await claimBusinessDedupeKey(deps, businessKey)) {
          try {
            await deps.convex.addPurchasedCredits({
              orgId,
              credits: metadataCredits,
              priceCents,
              stripePaymentIntentId: readCheckoutPaymentIntentId(session),
            });
            await deps.convex.createAuditEvent({
              orgId,
              actorType: AUDIT_ACTOR_TYPE.system,
              actorId: "stripe",
              eventType: AUDIT_EVENT_TYPES.billingCreditCheckoutCompleted,
              payload: {
                stripe_event_id: event.id,
                stripe_event_type: event.type,
                stripe_checkout_session_id: session.id,
                credits: metadataCredits,
                price_cents: priceCents,
                stripe_payment_intent_id: readCheckoutPaymentIntentId(session),
              },
            });
            await completeBusinessDedupeKey(deps, businessKey);
          } catch (error) {
            await releaseBusinessDedupeKey(deps, businessKey);
            throw error;
          }
        }
      } else if (
        settledSuccess &&
        isAutomationRunTopupCheckoutSession(session) &&
        orgId.length > 0
      ) {
        const runs = Number.parseInt(session.metadata?.runs ?? "", 10);
        const toolCalls = Number.parseInt(session.metadata?.tool_calls ?? "", 10);
        const toolCallTimeMs = Number.parseInt(session.metadata?.tool_call_time_ms ?? "", 10);
        const metadataPrice = Number.parseInt(session.metadata?.price_cents ?? "", 10);
        const priceCents =
          Number.isFinite(metadataPrice) && metadataPrice > 0
            ? metadataPrice
            : (session.amount_total ?? 0);
        const tier = session.metadata?.tier;
        const multiplier = session.metadata?.multiplier ?? "";
        const businessKey = `stripe-billing:automation-run-topup-purchase:${readCheckoutPaymentIntentId(session) ?? session.id}`;

        if (await claimBusinessDedupeKey(deps, businessKey)) {
          try {
            if (
              !Number.isFinite(runs) ||
              runs <= 0 ||
              !Number.isFinite(toolCalls) ||
              toolCalls <= 0 ||
              !Number.isFinite(toolCallTimeMs) ||
              toolCallTimeMs <= 0 ||
              !VALID_AUTOMATION_RUN_TOPUP_TIERS.has(tier as BillingTier)
            ) {
              console.warn("billing.webhook.automation_run_topup.invalid_metadata", {
                stripe_event_id: event.id,
                stripe_checkout_session_id: session.id,
                org_id: orgId,
                tier,
                multiplier,
                runs,
                toolCalls,
                toolCallTimeMs,
              });
              await completeBusinessDedupeKey(deps, businessKey);
              return jsonResponse(request, { received: true, ignored: true });
            }
            const validatedTier = tier as BillingTier;
            await deps.convex.addPurchasedAutomationRuns({
              orgId,
              tier: validatedTier,
              multiplier,
              runs,
              toolCalls,
              toolCallTimeMs,
              priceCents,
              stripePaymentIntentId: readCheckoutPaymentIntentId(session),
            });
            await deps.convex.createAuditEvent({
              orgId,
              actorType: AUDIT_ACTOR_TYPE.system,
              actorId: "stripe",
              eventType: AUDIT_EVENT_TYPES.billingAutomationRunTopupCheckoutCompleted,
              payload: {
                stripe_event_id: event.id,
                stripe_event_type: event.type,
                stripe_checkout_session_id: session.id,
                tier: validatedTier,
                multiplier,
                runs,
                tool_calls: toolCalls,
                tool_call_time_ms: toolCallTimeMs,
                price_cents: priceCents,
                stripe_payment_intent_id: readCheckoutPaymentIntentId(session),
              },
            });
            await completeBusinessDedupeKey(deps, businessKey);
          } catch (error) {
            await releaseBusinessDedupeKey(deps, businessKey);
            throw error;
          }
        }
      } else if (settledSuccess && orgId.length > 0 && typeof session.subscription === "string") {
        const businessKey = `stripe-billing:subscription-activation:${session.subscription}`;
        if (await claimBusinessDedupeKey(deps, businessKey)) {
          try {
            const stripe = resolveStripeClient(deps);
            const subscription = await stripe.subscriptions.retrieve(session.subscription);
            const period = readUnixPeriod(subscription);
            const priceId =
              subscription.items.data[0]?.price.id ??
              (typeof session.metadata?.tier === "string"
                ? getTierPriceId(session.metadata.tier === "pro" ? "pro" : "starter")
                : null);
            const tier = toTierFromPriceId(priceId);
            const status = toStripeStatus(subscription.status);
            const stripeCustomerId =
              typeof subscription.customer === "string"
                ? subscription.customer
                : (session.customer?.toString() ?? null);
            try {
              await deps.convex.convertActiveInvitePromo({
                orgId,
                stripeCustomerId,
                stripeSubscriptionId: subscription.id,
              });
            } catch (error) {
              console.error("billing.webhook.convert_invite_promo_failed", {
                eventId: event.id,
                orgId,
                stripeCustomerId,
                stripeSubscriptionId: subscription.id,
                error,
              });
            }
            await deps.convex.upsertSubscriptionForOrg({
              orgId,
              tier,
              status,
              stripeCustomerId,
              stripeSubscriptionId: subscription.id,
              currentPeriodStart: toIsoFromUnix(period.start),
              currentPeriodEnd: toIsoFromUnix(period.end),
            });
            await syncBundledGatewayForOrg({
              convex: deps.convex,
              orgId,
              tier,
              status,
              resetGatewaySpend: false,
            });
            await deps.convex.createAuditEvent({
              orgId,
              actorType: AUDIT_ACTOR_TYPE.system,
              actorId: "stripe",
              eventType: AUDIT_EVENT_TYPES.billingCheckoutCompleted,
              payload: {
                stripe_event_id: event.id,
                stripe_event_type: event.type,
                stripe_checkout_session_id: session.id,
                stripe_subscription_id: subscription.id,
                tier,
              },
            });
            await completeBusinessDedupeKey(deps, businessKey);
          } catch (error) {
            await releaseBusinessDedupeKey(deps, businessKey);
            throw error;
          }
        }
      }
    } else if (event.type === "customer.subscription.updated") {
      const subscription = event.data.object as Stripe.Subscription;
      const period = readUnixPeriod(subscription);
      const tier = toTierFromPriceId(subscription.items.data[0]?.price.id ?? null);
      const existing = await deps.convex.getSubscriptionByStripeSubscription(subscription.id);
      const nextStatus = toStripeStatus(subscription.status);
      await deps.convex.setSubscriptionStatusByStripeSubscription({
        stripeSubscriptionId: subscription.id,
        status: nextStatus,
        tier,
        currentPeriodStart: toIsoFromUnix(period.start),
        currentPeriodEnd: toIsoFromUnix(period.end),
      });
      if (existing?.org_id) {
        await syncBundledGatewayForOrg({
          convex: deps.convex,
          orgId: existing.org_id,
          tier,
          status: nextStatus,
          resetGatewaySpend:
            existing.current_period_start !== toIsoFromUnix(period.start) ||
            existing.current_period_end !== toIsoFromUnix(period.end),
        });
        await deps.convex.createAuditEvent({
          orgId: existing.org_id,
          actorType: AUDIT_ACTOR_TYPE.system,
          actorId: "stripe",
          eventType: AUDIT_EVENT_TYPES.billingSubscriptionUpdated,
          payload: {
            stripe_event_id: event.id,
            stripe_subscription_id: subscription.id,
            status: nextStatus,
            tier,
          },
        });
      }
    } else if (event.type === "subscription_schedule.updated") {
      const schedule = event.data.object as Stripe.SubscriptionSchedule;
      const subId =
        typeof schedule.subscription === "string"
          ? schedule.subscription
          : schedule.subscription && typeof schedule.subscription === "object"
            ? schedule.subscription.id
            : null;
      if (subId) {
        const existing = await deps.convex.getSubscriptionByStripeSubscription(subId);
        if (existing?.org_id) {
          await deps.convex.createAuditEvent({
            orgId: existing.org_id,
            actorType: AUDIT_ACTOR_TYPE.system,
            actorId: "stripe",
            eventType: AUDIT_EVENT_TYPES.billingSubscriptionScheduleUpdated,
            payload: {
              stripe_event_id: event.id,
              stripe_subscription_schedule_id: schedule.id,
              stripe_subscription_id: subId,
            },
          });
        }
      }
    } else if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      const existing = await deps.convex.getSubscriptionByStripeSubscription(subscription.id);
      await deps.convex.setSubscriptionStatusByStripeSubscription({
        stripeSubscriptionId: subscription.id,
        status: SUBSCRIPTION_STATUS.canceled,
        tier: SUBSCRIPTION_TIER.free,
      });
      if (existing?.org_id) {
        await syncBundledGatewayForOrg({
          convex: deps.convex,
          orgId: existing.org_id,
          tier: SUBSCRIPTION_TIER.free,
          status: SUBSCRIPTION_STATUS.canceled,
          resetGatewaySpend: false,
        });
        await deps.convex.createAuditEvent({
          orgId: existing.org_id,
          actorType: AUDIT_ACTOR_TYPE.system,
          actorId: "stripe",
          eventType: AUDIT_EVENT_TYPES.billingSubscriptionDeleted,
          payload: {
            stripe_event_id: event.id,
            stripe_subscription_id: subscription.id,
          },
        });
        await deps.convex.emitNotificationForOrg({
          orgId: existing.org_id,
          eventType: NOTIFICATION_EVENT_ID.subscriptionDowngraded,
          metadata: {
            stripe_event_id: event.id,
            stripe_subscription_id: subscription.id,
          },
        });
      }
    } else if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object as Stripe.Invoice;
      if (typeof invoice.customer === "string") {
        const existing = await deps.convex.getSubscriptionByStripeCustomer(invoice.customer);
        await deps.convex.setSubscriptionStatusByCustomer({
          stripeCustomerId: invoice.customer,
          status: SUBSCRIPTION_STATUS.pastDue,
        });
        if (existing?.org_id) {
          await syncBundledGatewayForOrg({
            convex: deps.convex,
            orgId: existing.org_id,
            tier: existing.tier,
            status: SUBSCRIPTION_STATUS.pastDue,
            resetGatewaySpend: false,
          });
          await deps.convex.createAuditEvent({
            orgId: existing.org_id,
            actorType: AUDIT_ACTOR_TYPE.system,
            actorId: "stripe",
            eventType: AUDIT_EVENT_TYPES.billingInvoicePaymentFailed,
            payload: {
              stripe_event_id: event.id,
              stripe_customer_id: invoice.customer,
              stripe_invoice_id: invoice.id,
            },
          });
          await deps.convex.emitNotificationForOrg({
            orgId: existing.org_id,
            eventType: NOTIFICATION_EVENT_ID.subscriptionPastDue,
            metadata: {
              stripe_event_id: event.id,
              stripe_customer_id: invoice.customer,
              stripe_invoice_id: invoice.id,
            },
          });
        }
      }
    } else if (event.type === "invoice.paid") {
      const invoice = event.data.object as Stripe.Invoice;
      if (typeof invoice.customer === "string") {
        const existing = await deps.convex.getSubscriptionByStripeCustomer(invoice.customer);
        await deps.convex.setSubscriptionStatusByCustomer({
          stripeCustomerId: invoice.customer,
          status: SUBSCRIPTION_STATUS.active,
        });
        if (existing?.org_id) {
          await syncBundledGatewayForOrg({
            convex: deps.convex,
            orgId: existing.org_id,
            tier: existing.tier,
            status: SUBSCRIPTION_STATUS.active,
            resetGatewaySpend: false,
          });
          await deps.convex.createAuditEvent({
            orgId: existing.org_id,
            actorType: AUDIT_ACTOR_TYPE.system,
            actorId: "stripe",
            eventType: AUDIT_EVENT_TYPES.billingInvoicePaid,
            payload: {
              stripe_event_id: event.id,
              stripe_customer_id: invoice.customer,
              stripe_invoice_id: invoice.id,
            },
          });
        }
      }
    }
    await deps.convex.completeApiDedupeKey({
      scope: API_DEDUPE_SCOPE.webhookDelivery,
      dedupeKey,
    });
  } catch (error) {
    await deps.convex.releaseApiDedupeKey({
      scope: API_DEDUPE_SCOPE.webhookDelivery,
      dedupeKey,
    });
    const message =
      error instanceof Error ? error.message : "Stripe billing webhook processing failed.";
    return jsonResponse(request, { error: { code: "webhook_processing_failed", message } }, 500);
  }

  return jsonResponse(request, { received: true, duplicate: false });
};

export const dispatchBillingRequest = async (
  request: Request,
  deps: BillingRequestDeps,
): Promise<Response | null> => {
  const pathname = new URL(request.url).pathname;
  const billingPathname = getBillingPathname(pathname);

  if (
    request.method === "POST" &&
    (isRootBillingPath(pathname) || isApiBillingPath(pathname)) &&
    billingPathname === "/billing/checkout"
  ) {
    return await handleBillingCheckoutRequest(request, deps);
  }
  if (
    request.method === "POST" &&
    (isRootBillingPath(pathname) || isApiBillingPath(pathname)) &&
    billingPathname === "/billing/credits/checkout"
  ) {
    return await handleBillingCreditsCheckoutRequest(request, deps);
  }
  if (
    request.method === "POST" &&
    (isRootBillingPath(pathname) || isApiBillingPath(pathname)) &&
    billingPathname === "/billing/automation-runs/checkout"
  ) {
    return await handleBillingAutomationRunCheckoutRequest(request, deps);
  }
  if (
    request.method === "POST" &&
    (isRootBillingPath(pathname) || isApiBillingPath(pathname)) &&
    billingPathname === "/billing/portal"
  ) {
    return await handleBillingPortalRequest(request, deps);
  }
  if (
    request.method === "POST" &&
    (isRootBillingPath(pathname) || isApiBillingPath(pathname)) &&
    billingPathname === "/billing/subscription/change"
  ) {
    return await handleBillingSubscriptionChangeRequest(request, deps);
  }
  if (
    request.method === "GET" &&
    (isRootBillingPath(pathname) || isApiBillingPath(pathname)) &&
    billingPathname === "/billing/subscription/pending-change"
  ) {
    return await handleBillingSubscriptionPendingRequest(request, deps);
  }
  if (
    request.method === "GET" &&
    (isRootBillingPath(pathname) || isApiBillingPath(pathname)) &&
    billingPathname === "/billing/usage"
  ) {
    return await handleBillingUsageRequest(request, deps);
  }
  if (
    request.method === "POST" &&
    (isRootBillingPath(pathname) || isApiBillingPath(pathname)) &&
    billingPathname === "/billing/extra-usage"
  ) {
    return await handleBillingExtraUsageRequest(request);
  }
  if (request.method === "POST" && pathname === "/webhooks/stripe-billing") {
    return await handleStripeBillingWebhookRequest(request, deps);
  }

  return null;
};
