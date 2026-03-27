import { Octokit } from "@octokit/rest";
import { resolveProviderApiBaseUrl, trimTrailingSlash } from "../fake-routing.js";
import type { GithubClient } from "./client-interface.js";

const DEFAULT_GITHUB_API_BASE_URL = "https://api.github.com";

const resolveGithubApiBaseUrl = (accessToken: string, namespace?: string): string => {
  return resolveProviderApiBaseUrl({
    accessToken,
    namespace,
    fakeTokenPrefix: "fake_github_",
    configuredBaseUrl: process.env.GITHUB_API_BASE_URL,
    defaultBaseUrl: DEFAULT_GITHUB_API_BASE_URL,
    formatFakeBaseUrl: (baseUrl) => `${trimTrailingSlash(baseUrl)}/github/v1`,
  });
};

export const createRealGithubClient = (accessToken: string, namespace?: string): GithubClient => {
  const octokit = new Octokit({
    auth: accessToken,
    baseUrl: resolveGithubApiBaseUrl(accessToken, namespace),
    userAgent: "keppo-connector",
  });

  if (namespace && namespace.trim().length > 0) {
    octokit.hook.before("request", async (options) => {
      options.headers = {
        ...options.headers,
        "x-keppo-e2e-namespace": namespace,
      };
    });
  }

  return octokit as unknown as GithubClient;
};
