import { readEnvBoolean } from "./env.js";
import { CANONICAL_PROVIDER_IDS, type CanonicalProviderId } from "./provider-ids.js";

export const PROVIDER_REGISTRY_PATH_FEATURE_FLAG = "KEPPO_FEATURE_PROVIDER_REGISTRY_PATH" as const;
export const AUTOMATION_SUBSCRIPTION_AUTH_FEATURE_FLAG =
  "KEPPO_FEATURE_AUTOMATION_SUBSCRIPTION_AUTH" as const;

export type ProviderRolloutFeatureFlag =
  `KEPPO_FEATURE_INTEGRATIONS_${Uppercase<CanonicalProviderId>}_FULL`;

export type KnownFeatureFlag =
  | typeof PROVIDER_REGISTRY_PATH_FEATURE_FLAG
  | typeof AUTOMATION_SUBSCRIPTION_AUTH_FEATURE_FLAG
  | ProviderRolloutFeatureFlag;

export type FeatureFlagDefinition = {
  name: KnownFeatureFlag;
  defaultValue: boolean;
  description: string;
};

export type FeatureFlagValueFetcher = (
  name: KnownFeatureFlag,
) => boolean | null | undefined | Promise<boolean | null | undefined>;

export const providerRolloutFeatureFlag = (
  provider: CanonicalProviderId,
): ProviderRolloutFeatureFlag => {
  return `KEPPO_FEATURE_INTEGRATIONS_${provider.toUpperCase()}_FULL` as ProviderRolloutFeatureFlag;
};

export const FEATURE_FLAG_DEFINITIONS: Array<FeatureFlagDefinition> = [
  {
    name: PROVIDER_REGISTRY_PATH_FEATURE_FLAG,
    defaultValue: true,
    description: "Global kill switch for provider registry runtime dispatch.",
  },
  {
    name: AUTOMATION_SUBSCRIPTION_AUTH_FEATURE_FLAG,
    defaultValue: false,
    description: "Enables automation subscription-login auth flows and configuration.",
  },
  ...CANONICAL_PROVIDER_IDS.map((provider) => ({
    name: providerRolloutFeatureFlag(provider),
    defaultValue: true,
    description: `Rollout gate for ${provider} provider runtime paths.`,
  })),
];

const FEATURE_FLAG_DEFAULTS = new Map<KnownFeatureFlag, boolean>(
  FEATURE_FLAG_DEFINITIONS.map((definition) => [definition.name, definition.defaultValue]),
);

const KNOWN_FEATURE_FLAG_SET = new Set<KnownFeatureFlag>(
  FEATURE_FLAG_DEFINITIONS.map((definition) => definition.name),
);

export const isKnownFeatureFlag = (name: string): name is KnownFeatureFlag => {
  return KNOWN_FEATURE_FLAG_SET.has(name as KnownFeatureFlag);
};

export const defaultFeatureFlagValue = (name: KnownFeatureFlag): boolean => {
  return FEATURE_FLAG_DEFAULTS.get(name) ?? false;
};

export const readFeatureFlagValue = (
  name: KnownFeatureFlag,
  env: Record<string, string | undefined> = process.env,
): boolean => {
  return readEnvBoolean(env[name], defaultFeatureFlagValue(name));
};

export const readFeatureFlagValueAsync = async (
  name: KnownFeatureFlag,
  fetcher: FeatureFlagValueFetcher,
  env: Record<string, string | undefined> = process.env,
): Promise<boolean> => {
  try {
    const fetched = await fetcher(name);
    if (typeof fetched === "boolean") {
      return fetched;
    }
  } catch {
    // Fall back to env/default when the backing store is unavailable.
  }

  return readFeatureFlagValue(name, env);
};
