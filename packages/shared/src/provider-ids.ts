export const CANONICAL_PROVIDER_IDS = [
  "google",
  "stripe",
  "slack",
  "github",
  "notion",
  "reddit",
  "x",
  "custom",
] as const;

export type CanonicalProviderId = (typeof CANONICAL_PROVIDER_IDS)[number];

export const GOOGLE_PROVIDER_ID: CanonicalProviderId = "google";
export const CUSTOM_PROVIDER_ID: CanonicalProviderId = "custom";

export const PROVIDER_ALIASES: Record<string, CanonicalProviderId> = Object.freeze({
  gmail: "google",
});

const CANONICAL_PROVIDER_SET = new Set<string>(CANONICAL_PROVIDER_IDS);

export type ResolveProviderOptions = {
  allowAliases?: boolean;
};

export type ProviderResolution = {
  providerId: CanonicalProviderId;
  normalizedInput: string;
  usedAlias: boolean;
};

export const resolveProvider = (
  input: string,
  options: ResolveProviderOptions = {},
): ProviderResolution => {
  void options;
  const normalizedInput = input.trim().toLowerCase();
  if (!normalizedInput) {
    throw new Error("Provider value is required.");
  }

  if (CANONICAL_PROVIDER_SET.has(normalizedInput)) {
    return {
      providerId: normalizedInput as CanonicalProviderId,
      normalizedInput,
      usedAlias: false,
    };
  }

  const canonicalHint = PROVIDER_ALIASES[normalizedInput];
  if (canonicalHint) {
    throw new Error(
      `Non-canonical provider id "${normalizedInput}" is not allowed. Use "${canonicalHint}".`,
    );
  }

  throw new Error(`Unknown provider "${normalizedInput}".`);
};
