import { google, type gmail_v1 } from "googleapis";
import { resolveProviderApiBaseUrl, trimTrailingSlash } from "../fake-routing.js";
import type { CreateGmailClient, GmailClient } from "./client-interface.js";

const DEFAULT_GMAIL_API_BASE_URL = "https://gmail.googleapis.com/gmail/v1";

const normalizeGmailRootUrl = (value: string): string => {
  const withoutTrailingSlash = trimTrailingSlash(value);
  const withoutApiSuffix = withoutTrailingSlash.endsWith("/gmail/v1")
    ? withoutTrailingSlash.slice(0, -"/gmail/v1".length)
    : withoutTrailingSlash;
  return `${withoutApiSuffix}/`;
};

const resolveGmailRootUrl = (accessToken: string, namespace?: string): string => {
  return resolveProviderApiBaseUrl({
    accessToken,
    namespace,
    fakeTokenPrefix: "fake_gmail_",
    configuredBaseUrl: process.env.GMAIL_API_BASE_URL,
    defaultBaseUrl: DEFAULT_GMAIL_API_BASE_URL,
    formatFakeBaseUrl: normalizeGmailRootUrl,
    formatRealBaseUrl: normalizeGmailRootUrl,
    resolveFakeTokenConfiguredBaseUrl: (configuredBaseUrl) => {
      return configuredBaseUrl.includes("gmail.googleapis.com")
        ? null
        : normalizeGmailRootUrl(configuredBaseUrl);
    },
  });
};

type GmailClientMethodShape = {
  users: {
    messages: {
      list: unknown;
      get: unknown;
      send: unknown;
      batchModify: unknown;
      trash: unknown;
      untrash: unknown;
      attachments: {
        get: unknown;
      };
    };
    threads: {
      modify: unknown;
      get: unknown;
      trash: unknown;
      untrash: unknown;
    };
    getProfile: unknown;
    labels: {
      list: unknown;
      create: unknown;
      get: unknown;
      update: unknown;
      delete: unknown;
    };
    drafts: {
      create: unknown;
      list: unknown;
      get: unknown;
      update: unknown;
      send: unknown;
      delete: unknown;
    };
    history: {
      list: unknown;
    };
    watch: unknown;
    stop: unknown;
    settings: {
      filters: {
        list: unknown;
        create: unknown;
        delete: unknown;
        get: unknown;
      };
      sendAs: {
        list: unknown;
        get: unknown;
        update: unknown;
      };
      getVacation: unknown;
      updateVacation: unknown;
    };
  };
};

type GmailClientCompatibility = gmail_v1.Gmail extends GmailClientMethodShape ? true : never;

// Keep a compile-time compatibility check while bridging the SDK's more
// specific response envelopes to our narrowed interface.
const assertGmailClientCompatibility = (client: gmail_v1.Gmail): GmailClient => {
  const compatibility: GmailClientCompatibility = true;
  void compatibility;
  return client as unknown as GmailClient;
};

export const createRealGmailClient: CreateGmailClient = (accessToken, namespace): GmailClient => {
  const oauthClient = new google.auth.OAuth2();
  oauthClient.setCredentials({
    access_token: accessToken,
  });

  return assertGmailClientCompatibility(
    google.gmail({
      version: "v1",
      auth: oauthClient,
      rootUrl: resolveGmailRootUrl(accessToken, namespace),
    }),
  );
};
