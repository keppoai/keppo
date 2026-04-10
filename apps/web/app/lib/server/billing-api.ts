import {
  dispatchBillingRequest,
  handleBillingAutomationRunCheckoutRequest as handleBillingAutomationRunCheckoutRequestImpl,
  handleBillingCheckoutRequest as handleBillingCheckoutRequestImpl,
  handleBillingCreditsCheckoutRequest as handleBillingCreditsCheckoutRequestImpl,
  handleBillingExtraUsageRequest as handleBillingExtraUsageRequestImpl,
  handleBillingPortalRequest as handleBillingPortalRequestImpl,
  handleBillingUsageRequest as handleBillingUsageRequestImpl,
  handleStripeBillingWebhookRequest as handleStripeBillingWebhookRequestImpl,
  type BillingConvexClient,
  type BillingRequestDeps,
  type BillingRuntime,
} from "../../../../../cloud/api/billing.ts";
import { readBetterAuthSessionToken } from "./api-runtime/app-helpers.ts";
import { ConvexInternalClient } from "./api-runtime/convex.ts";
import {
  createDyadGatewayUser,
  deleteDyadGatewayKeys,
  deleteDyadGatewayUser,
  generateDyadGatewayKey,
  getDyadGatewayUserInfo,
  resolveDyadGatewayMaxBudgetUsd,
  updateDyadGatewayUser,
  hasDyadGatewayConfig,
} from "./api-runtime/dyad-gateway.ts";
import { getEnv } from "./api-runtime/env.ts";
import { decryptStoredKey } from "./api-runtime/routes/automations.ts";

type StartOwnedBillingConvex = BillingConvexClient &
  Pick<ConvexInternalClient, "resolveApiSessionFromToken">;

export type StartOwnedBillingDeps = BillingRequestDeps & {
  convex: StartOwnedBillingConvex;
};

let convexClient: ConvexInternalClient | null = null;
let billingRuntime: BillingRuntime | null = null;

const getBillingRuntime = (): BillingRuntime => {
  if (billingRuntime) {
    return billingRuntime;
  }
  billingRuntime = {
    decryptStoredKey,
    gateway: {
      createUser: createDyadGatewayUser,
      deleteKeys: deleteDyadGatewayKeys,
      deleteUser: deleteDyadGatewayUser,
      generateKey: generateDyadGatewayKey,
      getUserInfo: getDyadGatewayUserInfo,
      hasConfig: hasDyadGatewayConfig,
      resolveMaxBudgetUsd: resolveDyadGatewayMaxBudgetUsd,
      updateUser: updateDyadGatewayUser,
    },
    getConfig: () => {
      const env = getEnv();
      return {
        KEPPO_DASHBOARD_ORIGIN: env.KEPPO_DASHBOARD_ORIGIN,
        STRIPE_API_BASE_URL: env.STRIPE_API_BASE_URL,
        STRIPE_AUTOMATION_RUN_PRODUCT_ID: env.STRIPE_AUTOMATION_RUN_PRODUCT_ID,
        STRIPE_BILLING_WEBHOOK_SECRET: env.STRIPE_BILLING_WEBHOOK_SECRET,
        STRIPE_CREDIT_PRODUCT_ID: env.STRIPE_CREDIT_PRODUCT_ID,
        STRIPE_PRO_PRICE_ID: env.STRIPE_PRO_PRICE_ID,
        STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY,
        STRIPE_STARTER_PRICE_ID: env.STRIPE_STARTER_PRICE_ID,
      };
    },
  };
  return billingRuntime;
};

const getDefaultDeps = (): StartOwnedBillingDeps => {
  const convex = (convexClient ??= new ConvexInternalClient());
  return {
    convex,
    runtime: getBillingRuntime(),
    resolveApiSessionIdentity: async (request) => {
      const sessionToken =
        readBetterAuthSessionToken(request.headers.get("cookie") ?? undefined) ??
        readBetterAuthSessionToken(request.headers.get("better-auth-cookie") ?? undefined);
      if (!sessionToken) {
        return null;
      }
      return await convex.resolveApiSessionFromToken(sessionToken);
    },
  };
};

export const handleBillingCheckoutRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response> => {
  return await handleBillingCheckoutRequestImpl(request, deps);
};

export const handleBillingAutomationRunCheckoutRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response> => {
  return await handleBillingAutomationRunCheckoutRequestImpl(request, deps);
};

export const handleBillingCreditsCheckoutRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response> => {
  return await handleBillingCreditsCheckoutRequestImpl(request, deps);
};

export const handleBillingPortalRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response> => {
  return await handleBillingPortalRequestImpl(request, deps);
};

export const handleBillingUsageRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response> => {
  return await handleBillingUsageRequestImpl(request, deps);
};

export const handleBillingExtraUsageRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response> => {
  void deps;
  return await handleBillingExtraUsageRequestImpl(request);
};

export const handleStripeBillingWebhookRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response> => {
  return await handleStripeBillingWebhookRequestImpl(request, deps);
};

export const dispatchStartOwnedBillingRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response | null> => {
  return await dispatchBillingRequest(request, deps);
};
