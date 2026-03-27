import { type WebClientOptions, WebClient } from "@slack/web-api";
import {
  resolveProviderApiBaseUrl,
  trimTrailingSlash,
  withTrailingSlash,
} from "../fake-routing.js";
import { createSlackSafeFetchAdapter } from "./fetch-axios-adapter.js";
import type {
  CreateSlackClient,
  SlackClient,
  SlackClientRequestOptions,
} from "./client-interface.js";

const DEFAULT_SLACK_API_BASE_URL = "https://slack.com/api";

const resolveSlackApiBaseUrl = (accessToken: string, namespace?: string): string => {
  return resolveProviderApiBaseUrl({
    accessToken,
    namespace,
    fakeTokenPrefix: "fake_slack_",
    configuredBaseUrl: process.env.SLACK_API_BASE_URL,
    defaultBaseUrl: DEFAULT_SLACK_API_BASE_URL,
    formatFakeBaseUrl: (baseUrl) => withTrailingSlash(`${trimTrailingSlash(baseUrl)}/slack/v1`),
    formatRealBaseUrl: withTrailingSlash,
  });
};

const assertSlackClientCompatibility = (client: WebClient): SlackClient => {
  return client;
};

export const createRealSlackClient: CreateSlackClient = (
  accessToken,
  namespace,
  options?: SlackClientRequestOptions,
): SlackClient => {
  const client = new WebClient(accessToken, {
    slackApiUrl: resolveSlackApiBaseUrl(accessToken, namespace),
    adapter: createSlackSafeFetchAdapter(
      options?.requestContext ?? "slack.sdk.request",
      namespace,
    ) as NonNullable<WebClientOptions["adapter"]>,
    maxRequestConcurrency: 1,
    rejectRateLimitedCalls: true,
    ...(options?.idempotencyKey
      ? {
          headers: {
            "x-idempotency-key": options.idempotencyKey,
          },
        }
      : {}),
  });

  return assertSlackClientCompatibility(client);
};
