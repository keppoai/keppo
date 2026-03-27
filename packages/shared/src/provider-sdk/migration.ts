import type { CanonicalProviderId } from "../provider-catalog.js";

// Add provider IDs here only after connector protocol calls are fully moved to
// provider-sdk adapters (no direct HTTP calls from connector.ts).
export const SDK_MIGRATED_CONNECTOR_PROVIDERS: ReadonlyArray<CanonicalProviderId> = [
  "google",
  "stripe",
  "github",
  "slack",
  "notion",
  "reddit",
  "x",
];

const sdkMigratedProviderSet = new Set<string>(SDK_MIGRATED_CONNECTOR_PROVIDERS);

export const isSdkMigratedConnectorProvider = (providerId: string): boolean => {
  return sdkMigratedProviderSet.has(providerId);
};
