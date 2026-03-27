import { PROVIDER_AUTH_MODE } from "../../../provider-auth.js";
import type { ProviderModuleMetadata } from "../../../providers.js";
import { listProviderToolOwnership, withProviderDeprecation } from "../shared.js";

export const metadata: ProviderModuleMetadata = {
  providerId: "custom",
  auth: { mode: PROVIDER_AUTH_MODE.custom, managed: false },
  capabilities: {
    read: true,
    write: true,
    refreshCredentials: false,
    webhook: false,
    automationTriggers: false,
  },
  featureGate: "KEPPO_FEATURE_INTEGRATIONS_CUSTOM_FULL",
  riskClass: "high",
  envRequirements: [],
  display: {
    label: "Custom",
    description: "Custom integration passthrough tools",
    icon: "custom",
  },
  ...withProviderDeprecation("custom"),
  toolOwnership: listProviderToolOwnership("custom"),
  legacyAliases: [],
};
