import { resolveProviderApiBaseUrl, trimTrailingSlash } from "../fake-routing.js";
import { createRedditTypedHttpClient } from "./http-client.js";
import type { CreateRedditClient, RedditClient } from "./client-interface.js";

const DEFAULT_REDDIT_API_BASE_URL = "https://oauth.reddit.com";

const resolveRedditApiBaseUrl = (accessToken: string, namespace?: string): string => {
  return resolveProviderApiBaseUrl({
    accessToken,
    namespace,
    fakeTokenPrefix: "fake_reddit_",
    configuredBaseUrl: process.env.REDDIT_API_BASE_URL,
    defaultBaseUrl: DEFAULT_REDDIT_API_BASE_URL,
    formatFakeBaseUrl: (baseUrl) => `${trimTrailingSlash(baseUrl)}/reddit/v1`,
  });
};

export const createRealRedditClient: CreateRedditClient = (
  accessToken,
  namespace,
): RedditClient => {
  return createRedditTypedHttpClient({
    accessToken,
    namespace,
    baseUrl: resolveRedditApiBaseUrl(accessToken, namespace),
  });
};
