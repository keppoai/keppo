import { resolveProviderApiBaseUrl, trimTrailingSlash } from "../fake-routing.js";
import { createXTypedHttpClient } from "./http-client.js";
import type { CreateXClient, XClient } from "./client-interface.js";

const DEFAULT_X_API_BASE_URL = "https://api.x.com";

const resolveXApiBaseUrl = (accessToken: string, namespace?: string): string => {
  return resolveProviderApiBaseUrl({
    accessToken,
    namespace,
    fakeTokenPrefix: "fake_x_",
    configuredBaseUrl: process.env.X_API_BASE_URL,
    defaultBaseUrl: DEFAULT_X_API_BASE_URL,
    formatFakeBaseUrl: (baseUrl) => `${trimTrailingSlash(baseUrl)}/x/v1`,
  });
};

export const createRealXClient: CreateXClient = (accessToken, namespace): XClient => {
  return createXTypedHttpClient({
    accessToken,
    namespace,
    baseUrl: resolveXApiBaseUrl(accessToken, namespace),
  });
};
