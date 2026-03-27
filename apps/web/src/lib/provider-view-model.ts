import type { CanonicalProviderId } from "@keppo/shared/provider-ids";
import { PROVIDER_PARSE_ERROR_CODE } from "@keppo/shared/providers/boundaries/common";
import {
  isBoundaryParseError,
  parseProviderId,
} from "@keppo/shared/providers/boundaries/error-boundary";
import type {
  ActionStatus,
  IntegrationDetail,
  ProviderCatalogEntry,
  WorkspaceIntegration,
} from "./types";

export type ProviderDeprecationNotice = {
  provider: CanonicalProviderId;
  status: "deprecated" | "sunset";
  message: string;
  sunsetAt?: string;
  replacementProvider?: CanonicalProviderId;
};

export type ActionStatusView = {
  label: string;
  badgeVariant: "default" | "secondary" | "outline" | "destructive";
};

type IntegrationActionStatus = ActionStatus | "still_pending";

export type ProviderRouteResolution =
  | {
      status: "canonical";
      providerId: CanonicalProviderId;
    }
  | {
      status: "non_canonical";
      input: string;
      canonicalProviderId: CanonicalProviderId;
    }
  | {
      status: "unknown";
      input: string;
    };

export const normalizeProviderValue = (provider: string): string => {
  return provider.trim().toLowerCase();
};

const parseCanonicalHint = (message: string): CanonicalProviderId | null => {
  const match = /Use "([^"]+)"/i.exec(message);
  if (!match?.[1]) {
    return null;
  }

  try {
    return parseProviderId(match[1]);
  } catch {
    return null;
  }
};

export const resolveIntegrationProviderRoute = (
  providerParam: string,
  catalogProviders: Iterable<string>,
): ProviderRouteResolution => {
  const normalizedInput = normalizeProviderValue(providerParam);
  if (!normalizedInput) {
    return {
      status: "unknown",
      input: normalizedInput,
    };
  }

  const supportedProviders = new Set(
    [...catalogProviders]
      .map((provider) => normalizeProviderValue(provider))
      .filter((provider) => provider.length > 0),
  );

  let canonicalProviderId: CanonicalProviderId;
  try {
    canonicalProviderId = parseProviderId(normalizedInput);
  } catch (error) {
    if (
      isBoundaryParseError(error) &&
      error.code === PROVIDER_PARSE_ERROR_CODE.nonCanonicalProvider
    ) {
      const canonicalProviderHint = parseCanonicalHint(error.message);
      if (canonicalProviderHint) {
        return {
          status: "non_canonical",
          input: normalizedInput,
          canonicalProviderId: canonicalProviderHint,
        };
      }
    }
    return {
      status: "unknown",
      input: normalizedInput,
    };
  }

  if (supportedProviders.size > 0 && !supportedProviders.has(canonicalProviderId)) {
    return {
      status: "unknown",
      input: normalizedInput,
    };
  }

  return {
    status: "canonical",
    providerId: canonicalProviderId,
  };
};

export const getProviderCatalogEntry = (
  providerCatalog: ProviderCatalogEntry[],
  providerId: CanonicalProviderId,
): ProviderCatalogEntry | null => {
  return (
    providerCatalog.find((entry) => normalizeProviderValue(entry.provider) === providerId) ?? null
  );
};

export const getProviderIntegration = (
  integrations: IntegrationDetail[],
  providerId: CanonicalProviderId,
): IntegrationDetail | null => {
  return (
    integrations.find((entry) => normalizeProviderValue(entry.provider) === providerId) ?? null
  );
};

export const getProviderWriteTools = (
  providerCatalogEntry: ProviderCatalogEntry | null,
): ProviderCatalogEntry["supported_tools"] => {
  if (!providerCatalogEntry) {
    return [];
  }
  return providerCatalogEntry.supported_tools.filter((tool) => tool.capability === "write");
};

export const getProviderDeprecation = (
  providerCatalogEntry: ProviderCatalogEntry | null,
): ProviderDeprecationNotice | null => {
  if (!providerCatalogEntry?.deprecation) {
    return null;
  }
  return {
    provider: providerCatalogEntry.provider,
    status: providerCatalogEntry.deprecation.status,
    message: providerCatalogEntry.deprecation.message,
    ...(providerCatalogEntry.deprecation.sunset_at
      ? { sunsetAt: providerCatalogEntry.deprecation.sunset_at }
      : {}),
    ...(providerCatalogEntry.deprecation.replacement_provider
      ? { replacementProvider: providerCatalogEntry.deprecation.replacement_provider }
      : {}),
  };
};

export const listProviderDeprecations = (
  providerCatalog: ProviderCatalogEntry[],
): ProviderDeprecationNotice[] => {
  return providerCatalog
    .map((entry) => getProviderDeprecation(entry))
    .filter((entry): entry is ProviderDeprecationNotice => entry !== null);
};

export const isWorkspaceProviderEnabled = (
  workspaceIntegrations: WorkspaceIntegration[],
  providerId: CanonicalProviderId,
): boolean => {
  if (workspaceIntegrations.length === 0) {
    return true;
  }
  return workspaceIntegrations.some((integration) => {
    return normalizeProviderValue(integration.provider) === providerId && integration.enabled;
  });
};

export const getActionStatusView = (
  status: IntegrationActionStatus | null | undefined,
): ActionStatusView => {
  if (!status) {
    return {
      label: "idle",
      badgeVariant: "secondary",
    };
  }

  switch (status) {
    case "still_pending":
      return {
        label: "waiting",
        badgeVariant: "secondary",
      };
    case "pending":
      return {
        label: "pending approval",
        badgeVariant: "secondary",
      };
    case "approved":
      return {
        label: "approved",
        badgeVariant: "outline",
      };
    case "executing":
      return {
        label: "executing",
        badgeVariant: "outline",
      };
    case "succeeded":
      return {
        label: "succeeded",
        badgeVariant: "secondary",
      };
    case "failed":
      return {
        label: "failed",
        badgeVariant: "destructive",
      };
    case "rejected":
      return {
        label: "rejected",
        badgeVariant: "destructive",
      };
    case "expired":
      return {
        label: "expired",
        badgeVariant: "destructive",
      };
  }
};
