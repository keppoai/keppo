import { describe, expect, it } from "vitest";
import { CANONICAL_PROVIDER_IDS } from "./provider-ids.js";
import {
  AUTOMATION_SUBSCRIPTION_AUTH_FEATURE_FLAG,
  defaultFeatureFlagValue,
  FEATURE_FLAG_DEFINITIONS,
  isKnownFeatureFlag,
  providerRolloutFeatureFlag,
  PROVIDER_REGISTRY_PATH_FEATURE_FLAG,
  readFeatureFlagValueAsync,
  readFeatureFlagValue,
} from "./feature-flags.js";

describe("feature flag registry", () => {
  it("registers the global kill switch and each provider rollout flag", () => {
    expect(FEATURE_FLAG_DEFINITIONS).toHaveLength(CANONICAL_PROVIDER_IDS.length + 2);
    expect(FEATURE_FLAG_DEFINITIONS.map((definition) => definition.name)).toContain(
      PROVIDER_REGISTRY_PATH_FEATURE_FLAG,
    );
    expect(FEATURE_FLAG_DEFINITIONS.map((definition) => definition.name)).toContain(
      AUTOMATION_SUBSCRIPTION_AUTH_FEATURE_FLAG,
    );

    for (const provider of CANONICAL_PROVIDER_IDS) {
      expect(FEATURE_FLAG_DEFINITIONS.map((definition) => definition.name)).toContain(
        providerRolloutFeatureFlag(provider),
      );
    }
  });

  it("defaults known flags to their configured defaults", () => {
    expect(defaultFeatureFlagValue(PROVIDER_REGISTRY_PATH_FEATURE_FLAG)).toBe(true);
    expect(defaultFeatureFlagValue(AUTOMATION_SUBSCRIPTION_AUTH_FEATURE_FLAG)).toBe(false);
    expect(defaultFeatureFlagValue(providerRolloutFeatureFlag("google"))).toBe(true);
  });

  it("reads explicit env values and falls back to defaults", () => {
    expect(readFeatureFlagValue(PROVIDER_REGISTRY_PATH_FEATURE_FLAG, {})).toBe(true);
    expect(
      readFeatureFlagValue(PROVIDER_REGISTRY_PATH_FEATURE_FLAG, {
        [PROVIDER_REGISTRY_PATH_FEATURE_FLAG]: "false",
      }),
    ).toBe(false);
    expect(
      readFeatureFlagValue(providerRolloutFeatureFlag("stripe"), {
        [providerRolloutFeatureFlag("stripe")]: "true",
      }),
    ).toBe(true);
  });

  it("identifies only known canonical flags", () => {
    expect(isKnownFeatureFlag(PROVIDER_REGISTRY_PATH_FEATURE_FLAG)).toBe(true);
    expect(isKnownFeatureFlag(AUTOMATION_SUBSCRIPTION_AUTH_FEATURE_FLAG)).toBe(true);
    expect(isKnownFeatureFlag(providerRolloutFeatureFlag("notion"))).toBe(true);
    expect(isKnownFeatureFlag("KEPPO_FEATURE_INTEGRATIONS_GMAIL_FULL")).toBe(false);
  });

  it("falls back to env/default values when async flag fetch fails or is unset", async () => {
    await expect(
      readFeatureFlagValueAsync(PROVIDER_REGISTRY_PATH_FEATURE_FLAG, async () => undefined, {
        [PROVIDER_REGISTRY_PATH_FEATURE_FLAG]: "false",
      }),
    ).resolves.toBe(false);

    await expect(
      readFeatureFlagValueAsync(providerRolloutFeatureFlag("google"), async () => {
        throw new Error("convex unavailable");
      }),
    ).resolves.toBe(true);

    await expect(
      readFeatureFlagValueAsync(providerRolloutFeatureFlag("stripe"), async () => false, {
        [providerRolloutFeatureFlag("stripe")]: "true",
      }),
    ).resolves.toBe(false);
  });
});
