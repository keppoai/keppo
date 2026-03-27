import {
  BoundaryParseError,
  parseConvexActionDetail,
  parseConvexActionList,
  parseConvexPayload,
  parseConvexWorkspaceList,
  parseConvexWorkspaceRulesResponse,
  parseOAuthConnectResponse,
} from "@keppo/shared/providers/boundaries/error-boundary";
import type {
  BoundaryIntegrationDetail,
  BoundaryProviderCatalogEntry,
  BoundaryWorkspaceIntegration,
  ConvexActionList,
  ConvexNullableActionDetail,
  ConvexWorkspaceList,
  ConvexWorkspaceRulesResponse,
  OAuthConnectResponse,
} from "@keppo/shared/providers/boundaries/types";
import {
  integrationDetailsResponseSchema,
  providerCatalogResponseSchema,
  workspaceIntegrationsResponseSchema,
} from "@keppo/shared/providers/boundaries/api-schemas";

const parseConvexBoundaryOrFallback = <T>(parse: () => T, fallback: T): T => {
  try {
    return parse();
  } catch (error) {
    if (error instanceof BoundaryParseError) {
      console.error("Invalid Convex boundary payload in dashboard client", {
        code: error.code,
        source: error.source,
        issues: error.issues,
      });
      return fallback;
    }
    throw error;
  }
};

export const parseProviderCatalogPayload = (payload: unknown): BoundaryProviderCatalogEntry[] => {
  return parseConvexBoundaryOrFallback(
    () => parseConvexPayload(providerCatalogResponseSchema, payload),
    [],
  );
};

export const parseIntegrationsPayload = (payload: unknown): BoundaryIntegrationDetail[] => {
  return parseConvexBoundaryOrFallback(
    () => parseConvexPayload(integrationDetailsResponseSchema, payload),
    [],
  );
};

export const parseWorkspaceIntegrationsPayload = (
  payload: unknown,
): BoundaryWorkspaceIntegration[] => {
  return parseConvexBoundaryOrFallback(
    () => parseConvexPayload(workspaceIntegrationsResponseSchema, payload),
    [],
  );
};

export const parseOAuthConnectResponsePayload = (payload: unknown): OAuthConnectResponse => {
  return parseOAuthConnectResponse(payload);
};

export const parsePendingActionsPayload = (payload: unknown): ConvexActionList => {
  return parseConvexBoundaryOrFallback(() => parseConvexActionList(payload), []);
};

export const parseActionDetailPayload = (payload: unknown): ConvexNullableActionDetail => {
  return parseConvexBoundaryOrFallback(() => parseConvexActionDetail(payload), null);
};

export const parseWorkspaceListPayload = (payload: unknown): ConvexWorkspaceList => {
  return parseConvexBoundaryOrFallback(() => parseConvexWorkspaceList(payload), []);
};

export const parseWorkspaceRulesPayload = (
  payload: unknown,
): ConvexWorkspaceRulesResponse | null => {
  return parseConvexBoundaryOrFallback(() => parseConvexWorkspaceRulesResponse(payload), null);
};
