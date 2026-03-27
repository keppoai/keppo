import {
  CANONICAL_PROVIDER_IDS,
  PROVIDER_ALIASES,
  resolveProvider,
  type CanonicalProviderId,
} from "../packages/shared/src/provider-ids.js";

export type ProviderId = CanonicalProviderId;

const LEGACY_ALIASES_BY_CANONICAL: Record<ProviderId, string[]> = (() => {
  const byCanonical = {} as Record<ProviderId, string[]>;
  for (const providerId of CANONICAL_PROVIDER_IDS) {
    byCanonical[providerId] = [];
  }

  for (const [alias, canonical] of Object.entries(PROVIDER_ALIASES)) {
    byCanonical[canonical].push(alias);
  }

  return byCanonical;
})();

export const canonicalizeProvider = (provider: string): ProviderId => {
  return resolveProvider(provider, { allowAliases: false }).providerId;
};

export const canonicalizeStoredProvider = (provider: string): ProviderId | null => {
  try {
    return resolveProvider(provider, { allowAliases: true }).providerId;
  } catch {
    return null;
  }
};

export const assertCanonicalStoredProvider = (provider: string, location: string): ProviderId => {
  try {
    return canonicalizeProvider(provider);
  } catch {
    const aliases = Object.entries(LEGACY_ALIASES_BY_CANONICAL)
      .flatMap(([canonical, legacyAliases]) => {
        if (legacyAliases.includes(provider)) {
          return canonical;
        }
        return [];
      })
      .join(", ");
    const canonicalHint = aliases ? ` Expected canonical provider "${aliases}".` : "";
    throw new Error(
      `Stored non-canonical provider "${provider}" at ${location}. Run canonical provider backfill.${canonicalHint}`,
    );
  }
};
