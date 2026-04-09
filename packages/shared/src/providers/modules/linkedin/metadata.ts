import { PROVIDER_AUTH_MODE } from "../../../provider-auth.js";
import type { ProviderModuleMetadata } from "../../../providers.js";
import { getProviderDefaultScopes } from "../../../provider-default-scopes.js";
import { listProviderToolOwnership, withProviderDeprecation } from "../shared.js";

export const metadata: ProviderModuleMetadata = {
  providerId: "linkedin",
  auth: { mode: PROVIDER_AUTH_MODE.oauth2, managed: true },
  capabilities: {
    read: true,
    write: true,
    refreshCredentials: false,
    webhook: false,
    automationTriggers: false,
  },
  featureGate: "KEPPO_FEATURE_INTEGRATIONS_LINKEDIN_FULL",
  riskClass: "high",
  envRequirements: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
  display: {
    label: "LinkedIn",
    description: "Low-level request and response tools for approved LinkedIn APIs",
    icon: "linkedin",
  },
  oauth: {
    defaultScopes: getProviderDefaultScopes("linkedin"),
  },
  ...withProviderDeprecation("linkedin"),
  toolOwnership: listProviderToolOwnership("linkedin"),
  legacyAliases: [],
};
