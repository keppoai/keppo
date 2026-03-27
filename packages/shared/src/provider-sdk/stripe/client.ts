import Stripe from "stripe";
import { resolveProviderApiBaseUrl, trimTrailingSlash } from "../fake-routing.js";
import { createStripeFetchHttpClient } from "./fetch-http-client.js";
import type { CreateStripeClient, StripeClient } from "./client-interface.js";

const DEFAULT_STRIPE_API_BASE_URL = "https://api.stripe.com/v1";

const resolveStripeApiBaseUrl = (accessToken: string, namespace?: string): string => {
  return resolveProviderApiBaseUrl({
    accessToken,
    namespace,
    fakeTokenPrefix: "fake_stripe_",
    configuredBaseUrl: process.env.STRIPE_API_BASE_URL,
    defaultBaseUrl: DEFAULT_STRIPE_API_BASE_URL,
    formatFakeBaseUrl: (baseUrl) => `${trimTrailingSlash(baseUrl)}/stripe/v1`,
  });
};

type StripeClientConfig = {
  host: string;
  port: string | number;
  protocol: "http" | "https";
  pathPrefix: string;
};

type StripeClientCompatibility = Stripe extends StripeClient ? true : never;

const resolveStripeClientConfig = (baseUrl: string): StripeClientConfig => {
  const parsed = new URL(baseUrl);
  const normalizedPath =
    parsed.pathname.length > 1 && parsed.pathname.endsWith("/")
      ? parsed.pathname.slice(0, -1)
      : parsed.pathname;

  const pathPrefix = normalizedPath.endsWith("/v1")
    ? normalizedPath.slice(0, -"/v1".length)
    : normalizedPath;

  return {
    host: parsed.hostname,
    port: parsed.port || (parsed.protocol === "http:" ? "80" : "443"),
    protocol: parsed.protocol === "http:" ? "http" : "https",
    pathPrefix: pathPrefix === "/" ? "" : pathPrefix,
  };
};

const assertStripeClientCompatibility = (client: Stripe): StripeClient => {
  const compatibility: StripeClientCompatibility = true;
  void compatibility;
  return client;
};

export const createRealStripeClient: CreateStripeClient = (accessToken, namespace) => {
  const config = resolveStripeClientConfig(resolveStripeApiBaseUrl(accessToken, namespace));

  const client = new Stripe(accessToken, {
    host: config.host,
    port: config.port,
    protocol: config.protocol,
    httpClient: createStripeFetchHttpClient(config.pathPrefix, namespace),
    maxNetworkRetries: 0,
  });

  return assertStripeClientCompatibility(client);
};
