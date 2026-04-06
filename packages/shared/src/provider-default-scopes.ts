import type { CanonicalProviderId } from "./provider-catalog.js";

export const PROVIDER_DEFAULT_SCOPES: Record<CanonicalProviderId, Array<string>> = {
  google: [
    "gmail.readonly",
    "gmail.send",
    "gmail.modify",
    "gmail.compose",
    "gmail.settings.basic",
    "gmail.labels",
  ],
  stripe: ["stripe.read", "stripe.write"],
  slack: ["slack.read", "slack.write"],
  github: ["repo:read", "repo:write", "workflow", "read:org"],
  notion: ["notion.read", "notion.write"],
  reddit: ["reddit.read", "reddit.write"],
  x: ["x.read", "x.write"],
  linkedin: ["openid", "profile", "email"],
  custom: ["custom.read", "custom.write"],
};

export const getProviderDefaultScopes = (providerId: CanonicalProviderId): Array<string> => {
  return [...(PROVIDER_DEFAULT_SCOPES[providerId] ?? [])];
};
