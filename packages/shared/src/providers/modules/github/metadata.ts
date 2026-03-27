import { PROVIDER_AUTH_MODE } from "../../../provider-auth.js";
import type { ProviderModuleMetadata } from "../../../providers.js";
import { getProviderDefaultScopes } from "../../../provider-default-scopes.js";
import { listProviderToolOwnership, withProviderDeprecation } from "../shared.js";

export const metadata: ProviderModuleMetadata = {
  providerId: "github",
  auth: { mode: PROVIDER_AUTH_MODE.oauth2, managed: true },
  capabilities: {
    read: true,
    write: true,
    refreshCredentials: true,
    webhook: true,
    automationTriggers: false,
  },
  featureGate: "KEPPO_FEATURE_INTEGRATIONS_GITHUB_FULL",
  riskClass: "medium",
  envRequirements: ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "GITHUB_WEBHOOK_SECRET"],
  display: {
    label: "GitHub",
    description: "GitHub issue and repository actions",
    icon: "github",
  },
  oauth: {
    defaultScopes: getProviderDefaultScopes("github"),
  },
  ...withProviderDeprecation("github"),
  toolOwnership: listProviderToolOwnership("github"),
  legacyAliases: [],
};
