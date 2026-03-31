import { PROVIDER_AUTH_MODE } from "../../../provider-auth.js";
import type { ProviderModuleMetadata } from "../../../providers.js";
import { getProviderDefaultScopes } from "../../../provider-default-scopes.js";
import { listProviderToolOwnership, withProviderDeprecation } from "../shared.js";

export const metadata: ProviderModuleMetadata = {
  providerId: "x",
  auth: { mode: PROVIDER_AUTH_MODE.oauth2, managed: true },
  capabilities: {
    read: true,
    write: true,
    refreshCredentials: false,
    webhook: false,
    automationTriggers: true,
  },
  featureGate: "KEPPO_FEATURE_INTEGRATIONS_X_FULL",
  riskClass: "medium",
  envRequirements: ["X_CLIENT_ID", "X_CLIENT_SECRET"],
  display: {
    label: "X",
    description: "X actions plus native polling triggers for mentions",
    icon: "x",
  },
  oauth: {
    defaultScopes: getProviderDefaultScopes("x"),
    requiresPkce: true,
  },
  ...withProviderDeprecation("x"),
  toolOwnership: listProviderToolOwnership("x"),
  legacyAliases: [],
};
