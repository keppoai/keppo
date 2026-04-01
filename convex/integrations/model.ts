import { v } from "convex/values";
import type { ProviderCatalogEntry as SharedProviderCatalogEntry } from "../../packages/shared/src/provider-catalog.js";
import {
  getProviderDefaultScopes,
  normalizeJsonRecord,
  providerCatalog as sharedProviderCatalog,
} from "../integrations_shared";
import {
  PROVIDER_CATALOG_CONFIGURATION_STATUS,
  INTEGRATION_STATUS,
  type IntegrationErrorCategory,
  type IntegrationErrorCode,
  type IntegrationStatus,
} from "../domain_constants";
import { assertCanonicalStoredProvider, type ProviderId } from "../provider_ids";
import {
  actionRiskValidator,
  integrationErrorCategoryValidator,
  integrationErrorCodeValidator,
  integrationStatusValidator,
  jsonRecordValidator,
  providerCatalogConfigurationStatusValidator,
  providerDeprecationStatusValidator,
  providerValidator,
  toolCapabilityValidator,
} from "../validators";

export const PROVIDER_MODULE_VERSION = 1;

export const integrationValidator = v.object({
  id: v.string(),
  org_id: v.string(),
  provider: providerValidator,
  display_name: v.string(),
  status: integrationStatusValidator,
  created_at: v.string(),
  connected: v.boolean(),
  scopes: v.array(v.string()),
  external_account_id: v.union(v.string(), v.null()),
  credential_expires_at: v.union(v.string(), v.null()),
  has_refresh_token: v.boolean(),
  last_health_check_at: v.union(v.string(), v.null()),
  last_successful_health_check_at: v.union(v.string(), v.null()),
  last_error_code: v.union(integrationErrorCodeValidator, v.null()),
  last_error_category: v.union(integrationErrorCategoryValidator, v.null()),
  last_webhook_at: v.union(v.string(), v.null()),
  degraded_reason: v.union(v.string(), v.null()),
  provider_module_version: v.union(v.number(), v.null()),
  metadata: jsonRecordValidator,
});

const isCredentialExpired = (expiresAt: string | null | undefined): boolean => {
  if (!expiresAt) {
    return false;
  }
  const expiresAtMillis = Date.parse(expiresAt);
  return Number.isFinite(expiresAtMillis) && expiresAtMillis <= Date.now();
};

export const isIntegrationReconnectRequired = (params: {
  status: IntegrationStatus;
  lastErrorCategory: IntegrationErrorCategory | null | undefined;
  credentialExpiresAt: string | null | undefined;
}): boolean => {
  if (params.status === INTEGRATION_STATUS.disconnected) {
    return false;
  }
  if (isCredentialExpired(params.credentialExpiresAt)) {
    return true;
  }
  return params.status === INTEGRATION_STATUS.degraded && params.lastErrorCategory === "auth";
};

export const isIntegrationConnected = (params: {
  status: IntegrationStatus;
  lastErrorCategory: IntegrationErrorCategory | null | undefined;
  credentialExpiresAt: string | null | undefined;
}): boolean => {
  if (params.status === INTEGRATION_STATUS.disconnected) {
    return false;
  }
  return !isIntegrationReconnectRequired(params);
};

export const toIntegrationResponse = (params: {
  integration: {
    id: string;
    org_id: string;
    provider: string;
    provider_module_version?: number;
    display_name: string;
    status: IntegrationStatus;
    created_at: string;
    last_health_check_at?: string | null;
    last_successful_health_check_at?: string | null;
    last_error_code?: IntegrationErrorCode | null;
    last_error_category?: IntegrationErrorCategory | null;
    last_webhook_at?: string | null;
    degraded_reason?: string | null;
  };
  account?: {
    external_account_id: string;
    scopes: string[];
    metadata: unknown;
  } | null;
  credential?: {
    expires_at: string | null;
    refresh_token_enc?: string | null;
  } | null;
}) => ({
  id: params.integration.id,
  org_id: params.integration.org_id,
  provider: assertCanonicalStoredProvider(
    params.integration.provider,
    `integrations:${params.integration.id}`,
  ),
  display_name: params.integration.display_name,
  status: params.integration.status,
  connected: isIntegrationConnected({
    status: params.integration.status,
    lastErrorCategory: params.integration.last_error_category,
    credentialExpiresAt: params.credential?.expires_at,
  }),
  created_at: params.integration.created_at,
  scopes: params.account?.scopes ?? [],
  external_account_id: params.account?.external_account_id ?? null,
  credential_expires_at: params.credential?.expires_at ?? null,
  has_refresh_token: Boolean(params.credential?.refresh_token_enc),
  last_health_check_at: params.integration.last_health_check_at ?? null,
  last_successful_health_check_at: params.integration.last_successful_health_check_at ?? null,
  last_error_code: params.integration.last_error_code ?? null,
  last_error_category: params.integration.last_error_category ?? null,
  last_webhook_at: params.integration.last_webhook_at ?? null,
  degraded_reason: params.integration.degraded_reason ?? null,
  provider_module_version: params.integration.provider_module_version ?? null,
  metadata: normalizeJsonRecord(params.account?.metadata),
});

export const providerCatalogValidator = v.array(
  v.object({
    provider: providerValidator,
    supported_tools: v.array(
      v.object({
        name: v.string(),
        capability: toolCapabilityValidator,
        risk_level: actionRiskValidator,
        requires_approval: v.boolean(),
      }),
    ),
    configuration: v.optional(
      v.object({
        status: providerCatalogConfigurationStatusValidator,
        message: v.string(),
      }),
    ),
    deprecation: v.optional(
      v.object({
        status: providerDeprecationStatusValidator,
        message: v.string(),
        sunset_at: v.optional(v.string()),
        replacement_provider: v.optional(providerValidator),
      }),
    ),
  }),
);

export const providerCatalogEntries: Array<SharedProviderCatalogEntry> = sharedProviderCatalog;

export { PROVIDER_CATALOG_CONFIGURATION_STATUS };

export const resolveFallbackScopes = (provider: ProviderId): string[] => {
  return getProviderDefaultScopes(provider);
};
