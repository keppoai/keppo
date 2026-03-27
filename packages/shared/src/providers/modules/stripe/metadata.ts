import { PROVIDER_AUTH_MODE } from "../../../provider-auth.js";
import type { ProviderModuleMetadata } from "../../../providers.js";
import { getProviderDefaultScopes } from "../../../provider-default-scopes.js";
import { listProviderToolOwnership, withProviderDeprecation } from "../shared.js";

export const metadata: ProviderModuleMetadata = {
  providerId: "stripe",
  auth: { mode: PROVIDER_AUTH_MODE.oauth2, managed: true },
  capabilities: {
    read: true,
    write: true,
    refreshCredentials: true,
    webhook: true,
    automationTriggers: false,
  },
  featureGate: "KEPPO_FEATURE_INTEGRATIONS_STRIPE_FULL",
  riskClass: "high",
  envRequirements: ["STRIPE_CLIENT_ID", "STRIPE_SECRET_KEY", "STRIPE_PROVIDER_WEBHOOK_SECRET"],
  display: {
    label: "Stripe",
    description: "Stripe customer and billing actions",
    icon: "stripe",
  },
  oauth: {
    defaultScopes: getProviderDefaultScopes("stripe"),
  },
  ...withProviderDeprecation("stripe"),
  toolOwnership: listProviderToolOwnership("stripe"),
  legacyAliases: [],
};
