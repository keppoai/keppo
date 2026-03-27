import { PROVIDER_AUTH_MODE } from "../../../provider-auth.js";
import type { ProviderModuleMetadata } from "../../../providers.js";
import { getProviderDefaultScopes } from "../../../provider-default-scopes.js";
import { listProviderToolOwnership, withProviderDeprecation } from "../shared.js";

export const metadata: ProviderModuleMetadata = {
  providerId: "reddit",
  auth: { mode: PROVIDER_AUTH_MODE.oauth2, managed: true },
  capabilities: {
    read: true,
    write: true,
    refreshCredentials: false,
    webhook: false,
    automationTriggers: true,
  },
  featureGate: "KEPPO_FEATURE_INTEGRATIONS_REDDIT_FULL",
  riskClass: "medium",
  envRequirements: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"],
  display: {
    label: "Reddit",
    description: "Reddit actions plus native polling triggers for mentions and unread inbox mail",
    icon: "reddit",
  },
  oauth: {
    defaultScopes: getProviderDefaultScopes("reddit"),
  },
  ...withProviderDeprecation("reddit"),
  toolOwnership: listProviderToolOwnership("reddit"),
  legacyAliases: [],
};
