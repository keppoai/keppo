import { PROVIDER_AUTH_MODE } from "../../../provider-auth.js";
import type { ProviderModuleMetadata } from "../../../providers.js";
import { getProviderDefaultScopes } from "../../../provider-default-scopes.js";
import { listProviderToolOwnership, withProviderDeprecation } from "../shared.js";

export const metadata: ProviderModuleMetadata = {
  providerId: "notion",
  auth: { mode: PROVIDER_AUTH_MODE.oauth2, managed: true },
  capabilities: {
    read: true,
    write: true,
    refreshCredentials: false,
    webhook: false,
    automationTriggers: false,
  },
  featureGate: "KEPPO_FEATURE_INTEGRATIONS_NOTION_FULL",
  riskClass: "medium",
  envRequirements: [],
  display: {
    label: "Notion",
    description: "Notion page and content actions",
    icon: "notion",
  },
  oauth: {
    defaultScopes: getProviderDefaultScopes("notion"),
  },
  ...withProviderDeprecation("notion"),
  toolOwnership: listProviderToolOwnership("notion"),
  legacyAliases: [],
};
