import type { CanonicalProviderId } from "./provider-catalog.js";
import { PROVIDER_DEPRECATION_STATUS, type ProviderDeprecationStatus } from "./domain.js";

export type ProviderDeprecation = {
  status: ProviderDeprecationStatus;
  message: string;
  sunsetAt?: string;
  replacementProviderId?: CanonicalProviderId;
};

export const PROVIDER_DEPRECATIONS_ENV_KEY = "KEPPO_PROVIDER_DEPRECATIONS_JSON";

const STATIC_PROVIDER_DEPRECATIONS: Partial<Record<CanonicalProviderId, ProviderDeprecation>> =
  Object.freeze({});

const readEnvValue = (envKey: string): string | undefined => {
  if (typeof process === "undefined" || !process.env) {
    return undefined;
  }
  const value = process.env[envKey];
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
};

const isCanonicalProviderId = (value: unknown): value is CanonicalProviderId => {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "google" ||
    normalized === "stripe" ||
    normalized === "slack" ||
    normalized === "github" ||
    normalized === "notion" ||
    normalized === "reddit" ||
    normalized === "x" ||
    normalized === "custom"
  );
};

const normalizeDeprecation = (
  providerId: CanonicalProviderId,
  value: unknown,
): ProviderDeprecation => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `Invalid provider deprecation override for "${providerId}" in ${PROVIDER_DEPRECATIONS_ENV_KEY}.`,
    );
  }

  const status = (value as { status?: unknown }).status;
  if (
    status !== PROVIDER_DEPRECATION_STATUS.deprecated &&
    status !== PROVIDER_DEPRECATION_STATUS.sunset
  ) {
    throw new Error(
      `Invalid provider deprecation status for "${providerId}" in ${PROVIDER_DEPRECATIONS_ENV_KEY}.`,
    );
  }

  const message = (value as { message?: unknown }).message;
  if (typeof message !== "string" || message.trim().length === 0) {
    throw new Error(
      `Provider deprecation message is required for "${providerId}" in ${PROVIDER_DEPRECATIONS_ENV_KEY}.`,
    );
  }

  const sunsetAt = (value as { sunsetAt?: unknown }).sunsetAt;
  if (sunsetAt !== undefined && (typeof sunsetAt !== "string" || sunsetAt.trim().length === 0)) {
    throw new Error(
      `Provider deprecation sunsetAt must be a non-empty string for "${providerId}".`,
    );
  }

  const replacementProviderId = (value as { replacementProviderId?: unknown })
    .replacementProviderId;
  if (replacementProviderId !== undefined && !isCanonicalProviderId(replacementProviderId)) {
    throw new Error(
      `Provider deprecation replacementProviderId must be canonical for "${providerId}".`,
    );
  }

  return {
    status,
    message: message.trim(),
    ...(typeof sunsetAt === "string" ? { sunsetAt: sunsetAt.trim() } : {}),
    ...(replacementProviderId ? { replacementProviderId } : {}),
  };
};

const readDeprecationsFromEnv = (): Partial<Record<CanonicalProviderId, ProviderDeprecation>> => {
  const raw = readEnvValue(PROVIDER_DEPRECATIONS_ENV_KEY);
  if (!raw) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid JSON in ${PROVIDER_DEPRECATIONS_ENV_KEY}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${PROVIDER_DEPRECATIONS_ENV_KEY} must be a JSON object.`);
  }

  const overrides: Partial<Record<CanonicalProviderId, ProviderDeprecation>> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!isCanonicalProviderId(key)) {
      throw new Error(
        `Invalid provider "${key}" in ${PROVIDER_DEPRECATIONS_ENV_KEY}. Only canonical provider ids are allowed.`,
      );
    }
    overrides[key] = normalizeDeprecation(key, value);
  }

  return overrides;
};

export const providerDeprecations: Partial<Record<CanonicalProviderId, ProviderDeprecation>> =
  Object.freeze({
    ...STATIC_PROVIDER_DEPRECATIONS,
    ...readDeprecationsFromEnv(),
  });
