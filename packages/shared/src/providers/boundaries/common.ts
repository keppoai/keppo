import { z } from "zod";
import { MANAGED_OAUTH_PROVIDER_IDS as DERIVED_MANAGED_OAUTH_PROVIDER_IDS } from "../modules/index.js";
import {
  PROVIDER_ALIASES,
  resolveProvider,
  type CanonicalProviderId,
} from "../../provider-catalog.js";

export const BOUNDARY_CODE_PARAM = "boundary_code";

export const PROVIDER_PARSE_ERROR_CODES = [
  "unsupported_provider",
  "non_canonical_provider",
] as const;
export type ProviderParseErrorCode = (typeof PROVIDER_PARSE_ERROR_CODES)[number];
export const PROVIDER_PARSE_ERROR_CODE = {
  unsupportedProvider: PROVIDER_PARSE_ERROR_CODES[0],
  nonCanonicalProvider: PROVIDER_PARSE_ERROR_CODES[1],
} as const satisfies Record<string, ProviderParseErrorCode>;

export const INVALID_AUTHORIZATION_HEADER_ERROR_CODE = "invalid_authorization_header";

export const addBoundaryIssue = (ctx: z.RefinementCtx, code: string, message: string): void => {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message,
    params: {
      [BOUNDARY_CODE_PARAM]: code,
    },
  });
};

export type ManagedOAuthProvider = CanonicalProviderId;
export const MANAGED_OAUTH_PROVIDER_IDS = DERIVED_MANAGED_OAUTH_PROVIDER_IDS;

const managedOAuthProviderSet = new Set<string>(MANAGED_OAUTH_PROVIDER_IDS);

export const canonicalProviderSchema = z
  .string()
  .trim()
  .min(1, "Provider value is required.")
  .superRefine((value, ctx) => {
    const normalized = value.toLowerCase();
    const canonicalAlias = PROVIDER_ALIASES[normalized];
    if (canonicalAlias) {
      addBoundaryIssue(
        ctx,
        PROVIDER_PARSE_ERROR_CODE.nonCanonicalProvider,
        `Non-canonical provider "${normalized}" is not allowed. Use "${canonicalAlias}".`,
      );
      return;
    }
    try {
      resolveProvider(normalized, { allowAliases: false });
      return;
    } catch {}

    addBoundaryIssue(
      ctx,
      PROVIDER_PARSE_ERROR_CODE.unsupportedProvider,
      `Unsupported provider "${normalized}".`,
    );
  })
  .transform((value) => {
    return resolveProvider(value.toLowerCase(), { allowAliases: false }).providerId;
  });

export const managedOAuthProviderSchema = canonicalProviderSchema
  .superRefine((provider, ctx) => {
    if (!managedOAuthProviderSet.has(provider)) {
      addBoundaryIssue(
        ctx,
        PROVIDER_PARSE_ERROR_CODE.unsupportedProvider,
        `Provider "${provider}" does not support managed OAuth.`,
      );
    }
  })
  .transform((provider) => {
    return provider as ManagedOAuthProvider;
  });

export const canonicalProviderIdSchema = canonicalProviderSchema.transform((provider) => {
  return provider as CanonicalProviderId;
});

export const managedOAuthProviderIdSchema = managedOAuthProviderSchema.transform((provider) => {
  if (!managedOAuthProviderSet.has(provider)) {
    throw new Error(`Unsupported managed OAuth provider "${provider}".`);
  }
  return provider as ManagedOAuthProvider;
});

export const jsonRecordSchema = z.record(z.string(), z.unknown());

export const nonEmptyStringSchema = z.string().trim().min(1);
export const positiveIntegerSchema = z.number().int().positive();
export const nonNegativeIntegerSchema = z.number().int().min(0);
export const nullableNonEmptyStringSchema = z.union([nonEmptyStringSchema, z.null()]);

export const bearerAuthorizationHeaderSchema = z
  .string()
  .trim()
  .min(1)
  .superRefine((value, ctx) => {
    if (/^Bearer\s+\S+$/i.test(value)) {
      return;
    }
    addBoundaryIssue(
      ctx,
      INVALID_AUTHORIZATION_HEADER_ERROR_CODE,
      "Authorization header must use Bearer token format.",
    );
  })
  .transform((value) => value.replace(/^Bearer\s+/i, "").trim());

export const mcpSessionHeaderSchema = nonEmptyStringSchema;

export const cronAuthorizationHeaderSchema = z
  .string()
  .trim()
  .min(1)
  .superRefine((value, ctx) => {
    if (/^Bearer\s+\S+$/i.test(value)) {
      return;
    }
    addBoundaryIssue(
      ctx,
      INVALID_AUTHORIZATION_HEADER_ERROR_CODE,
      "Authorization header must use Bearer token format.",
    );
  });

export const BOUNDARY_PARSE_SOURCES = ["api", "worker", "connector", "convex"] as const;
export type BoundaryParseSource = (typeof BOUNDARY_PARSE_SOURCES)[number];
export const boundaryParseSourceSchema = z.enum(BOUNDARY_PARSE_SOURCES);

export const mcpRpcIdSchema = z.union([z.string(), z.number(), z.null()]);
