import { isAuthApiPath, proxyAuthApiRequest } from "./auth-api-proxy";
import { createProtocolNotFoundResponse, isFailClosedProtocolPath } from "./protocol-boundary";
import { isStartOwnedApiPath } from "./api-routes";
import { isStartOwnedRootPath } from "./root-routes";
import { createPublicHealthResponse } from "../../app/lib/server/public-health-api";

const isRootBillingPath = (pathname: string): boolean => {
  return pathname === "/billing" || pathname.startsWith("/billing/");
};

const isStripeBillingWebhookPath = (pathname: string): boolean => {
  return pathname === "/webhooks/stripe-billing";
};

type AdminHealthApiModule = typeof import("../../app/lib/server/admin-health-api");
type AutomationApiModule = typeof import("../../app/lib/server/automation-api");
type BillingApiModule = typeof import("../../app/lib/server/billing-api");
type DocsSearchApiModule = typeof import("../../app/lib/server/search-api");
type InternalApiModule = typeof import("../../app/lib/server/internal-api");
type OAuthApiModule = typeof import("../../app/lib/server/oauth-api");
type OperationalApiModule = typeof import("../../app/lib/server/operational-api");
type WebhookApiModule = typeof import("../../app/lib/server/webhook-api");
type McpApiModule = typeof import("../../app/lib/server/mcp-api");

let adminHealthApiModulePromise: Promise<AdminHealthApiModule> | null = null;
let automationApiModulePromise: Promise<AutomationApiModule> | null = null;
let billingApiModulePromise: Promise<BillingApiModule> | null = null;
let docsSearchApiModulePromise: Promise<DocsSearchApiModule> | null = null;
let internalApiModulePromise: Promise<InternalApiModule> | null = null;
let oauthApiModulePromise: Promise<OAuthApiModule> | null = null;
let operationalApiModulePromise: Promise<OperationalApiModule> | null = null;
let webhookApiModulePromise: Promise<WebhookApiModule> | null = null;
let mcpApiModulePromise: Promise<McpApiModule> | null = null;

const loadAdminHealthApiModule = async (): Promise<AdminHealthApiModule> => {
  adminHealthApiModulePromise ??= import("../../app/lib/server/admin-health-api");
  return await adminHealthApiModulePromise;
};

const loadAutomationApiModule = async (): Promise<AutomationApiModule> => {
  automationApiModulePromise ??= import("../../app/lib/server/automation-api");
  return await automationApiModulePromise;
};

const loadBillingApiModule = async (): Promise<BillingApiModule> => {
  billingApiModulePromise ??= import("../../app/lib/server/billing-api");
  return await billingApiModulePromise;
};

const loadDocsSearchApiModule = async (): Promise<DocsSearchApiModule> => {
  docsSearchApiModulePromise ??= import("../../app/lib/server/search-api");
  return await docsSearchApiModulePromise;
};

const loadInternalApiModule = async (): Promise<InternalApiModule> => {
  internalApiModulePromise ??= import("../../app/lib/server/internal-api");
  return await internalApiModulePromise;
};

const loadOAuthApiModule = async (): Promise<OAuthApiModule> => {
  oauthApiModulePromise ??= import("../../app/lib/server/oauth-api");
  return await oauthApiModulePromise;
};

const loadOperationalApiModule = async (): Promise<OperationalApiModule> => {
  operationalApiModulePromise ??= import("../../app/lib/server/operational-api");
  return await operationalApiModulePromise;
};

const loadWebhookApiModule = async (): Promise<WebhookApiModule> => {
  webhookApiModulePromise ??= import("../../app/lib/server/webhook-api");
  return await webhookApiModulePromise;
};

const loadMcpApiModule = async (): Promise<McpApiModule> => {
  mcpApiModulePromise ??= import("../../app/lib/server/mcp-api");
  return await mcpApiModulePromise;
};

const dispatchApiRequest = async (request: Request): Promise<Response> => {
  const pathname = new URL(request.url).pathname;
  if (request.method === "GET" && pathname === "/api/health") {
    return createPublicHealthResponse(request);
  }

  const [adminHealthApi, billingApi, docsSearchApi, internalApi, automationApi, oauthApi] =
    await Promise.all([
      loadAdminHealthApiModule(),
      loadBillingApiModule(),
      loadDocsSearchApiModule(),
      loadInternalApiModule(),
      loadAutomationApiModule(),
      loadOAuthApiModule(),
    ]);

  const response =
    (await adminHealthApi.dispatchStartOwnedAdminHealthRequest(request)) ??
    (await billingApi.dispatchStartOwnedBillingRequest(request)) ??
    (await docsSearchApi.dispatchStartOwnedDocsSearchRequest(request)) ??
    (await internalApi.dispatchStartOwnedInternalApiRequest(request)) ??
    (await automationApi.dispatchStartOwnedAutomationApiRequest(request)) ??
    (await oauthApi.dispatchStartOwnedOAuthApiRequest(request));

  return response ?? createProtocolNotFoundResponse(request);
};

export const dispatchUnifiedProtocolRequest = async (
  request: Request,
): Promise<Response | null> => {
  const pathname = new URL(request.url).pathname;

  if (isStripeBillingWebhookPath(pathname) || isRootBillingPath(pathname)) {
    return await (await loadBillingApiModule()).dispatchStartOwnedBillingRequest(request);
  }

  if (isAuthApiPath(pathname)) {
    return await proxyAuthApiRequest(request);
  }

  if (isStartOwnedRootPath(pathname)) {
    const handledRootResponse =
      (pathname === "/webhooks" || pathname.startsWith("/webhooks/")
        ? await (await loadWebhookApiModule()).handleProviderWebhookRequest(request)
        : pathname === "/mcp" || pathname.startsWith("/mcp/")
          ? await (await loadMcpApiModule()).handleStartOwnedMcpRequest(request)
          : pathname === "/oauth" || pathname.startsWith("/oauth/")
            ? await (await loadOAuthApiModule()).handleOAuthProviderCallbackRequest(request)
            : await (
                await loadOperationalApiModule()
              ).dispatchStartOwnedOperationalRequest(request)) ?? null;

    if (handledRootResponse) {
      return handledRootResponse;
    }
  }

  if (isStartOwnedApiPath(pathname)) {
    return await dispatchApiRequest(request);
  }

  if (isFailClosedProtocolPath(pathname)) {
    return createProtocolNotFoundResponse(request);
  }

  return null;
};
