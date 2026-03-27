import { PROVIDER_AUTH_MODE } from "../../../provider-auth.js";
import type { ProviderModuleMetadata } from "../../../providers.js";
import { getProviderDefaultScopes } from "../../../provider-default-scopes.js";
import { listProviderToolOwnership, withProviderDeprecation } from "../shared.js";

export const metadata: ProviderModuleMetadata = {
  providerId: "google",
  auth: { mode: PROVIDER_AUTH_MODE.oauth2, managed: true },
  capabilities: {
    read: true,
    write: true,
    refreshCredentials: true,
    webhook: false,
    automationTriggers: true,
  },
  featureGate: "KEPPO_FEATURE_INTEGRATIONS_GOOGLE_FULL",
  riskClass: "high",
  envRequirements: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  display: {
    label: "Google",
    description: "Google OAuth for Gmail tools",
    icon: "google",
  },
  oauth: {
    defaultScopes: getProviderDefaultScopes("google"),
  },
  ...withProviderDeprecation("google"),
  toolOwnership: listProviderToolOwnership("google"),
  legacyAliases: [],
};
