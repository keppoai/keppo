export const PROVIDER_AUTH_MODES = ["oauth2", "api_key", "custom"] as const;
export type ProviderAuthMode = (typeof PROVIDER_AUTH_MODES)[number];
export const PROVIDER_AUTH_MODE = {
  oauth2: "oauth2",
  apiKey: "api_key",
  custom: "custom",
} as const satisfies Record<string, ProviderAuthMode>;
