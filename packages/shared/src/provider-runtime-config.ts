const DEFAULT_PROVIDER_SELECTION = "all";

export const PROVIDER_SELECTION_ENV_KEY = "KEPPO_PROVIDER_MODULES";

const ALL_SELECTION_VALUES = new Set(["all", "*", "default"]);
const NONE_SELECTION_VALUES = new Set(["none", "off", "disabled"]);

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

const normalizeToken = (token: string): string => token.trim().toLowerCase();

export const resolveProviderSelection = <TProviderId extends string>(
  availableProviderIds: readonly TProviderId[],
  options: {
    envKey?: string;
    rawValue?: string | undefined;
    allowEmpty?: boolean;
  } = {},
): TProviderId[] => {
  const envKey = options.envKey ?? PROVIDER_SELECTION_ENV_KEY;
  const rawValue = options.rawValue ?? readEnvValue(envKey) ?? DEFAULT_PROVIDER_SELECTION;
  const normalizedValue = normalizeToken(rawValue);

  if (ALL_SELECTION_VALUES.has(normalizedValue)) {
    return [...availableProviderIds];
  }

  if (NONE_SELECTION_VALUES.has(normalizedValue)) {
    if (options.allowEmpty === true) {
      return [];
    }
    throw new Error(
      `${envKey}=none is not allowed because the provider registry requires at least one module.`,
    );
  }

  const available = new Set<string>(availableProviderIds);
  const requested = rawValue
    .split(",")
    .map((entry) => normalizeToken(entry))
    .filter((entry) => entry.length > 0);
  const uniqueRequested = [...new Set(requested)];

  if (uniqueRequested.length === 0) {
    return [...availableProviderIds];
  }

  const unknownProviderIds = uniqueRequested.filter((providerId) => !available.has(providerId));
  if (unknownProviderIds.length > 0) {
    throw new Error(
      `Invalid ${envKey} value. Unknown provider id(s): ${unknownProviderIds.join(
        ", ",
      )}. Allowed values: ${availableProviderIds.join(", ")}.`,
    );
  }

  return availableProviderIds.filter((providerId) => uniqueRequested.includes(providerId));
};
