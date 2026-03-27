import { PROVIDER_AUTH_MODE } from "../../../provider-auth.js";
import type { ProviderModuleMetadata } from "../../../providers.js";
import { getProviderDefaultScopes } from "../../../provider-default-scopes.js";
import { listProviderToolOwnership, withProviderDeprecation } from "../shared.js";

export const metadata: ProviderModuleMetadata = {
  providerId: "slack",
  auth: { mode: PROVIDER_AUTH_MODE.oauth2, managed: true },
  capabilities: {
    read: true,
    write: true,
    refreshCredentials: false,
    webhook: false,
    automationTriggers: false,
  },
  featureGate: "KEPPO_FEATURE_INTEGRATIONS_SLACK_FULL",
  riskClass: "medium",
  envRequirements: [],
  display: {
    label: "Slack",
    description: "Slack channel and message actions",
    icon: "slack",
  },
  oauth: {
    defaultScopes: getProviderDefaultScopes("slack"),
  },
  ...withProviderDeprecation("slack"),
  toolOwnership: listProviderToolOwnership("slack"),
  legacyAliases: [],
};
