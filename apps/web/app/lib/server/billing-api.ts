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
} from "../../../../../cloud/api/billing.ts";
import { readBetterAuthSessionToken } from "./api-runtime/app-helpers.ts";
import { ConvexInternalClient } from "./api-runtime/convex.ts";

type StartOwnedBillingConvex = BillingConvexClient &
  Pick<ConvexInternalClient, "resolveApiSessionFromToken">;

export type StartOwnedBillingDeps = BillingRequestDeps & {
  convex: StartOwnedBillingConvex;
};

let convexClient: ConvexInternalClient | null = null;

const getDefaultDeps = (): StartOwnedBillingDeps => {
  const convex = (convexClient ??= new ConvexInternalClient());
  return {
    convex,
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
