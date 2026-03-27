import posthog from "posthog-js";

const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

let posthogInitialized = false;

const toOptionalString = (value: string | undefined): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const getPostHogConfig = () => {
  const apiKey = toOptionalString(import.meta.env.VITE_POSTHOG_API_KEY);
  if (!apiKey) {
    return null;
  }
  return {
    apiKey,
    host: toOptionalString(import.meta.env.VITE_POSTHOG_HOST) ?? DEFAULT_POSTHOG_HOST,
  };
};

export const initPostHog = (): boolean => {
  if (posthogInitialized) {
    return true;
  }

  const config = getPostHogConfig();
  if (!config) {
    return false;
  }

  posthog.init(config.apiKey, {
    api_host: config.host,
    capture_pageview: true,
    capture_pageleave: true,
    persistence: "localStorage+cookie",
  });
  posthog.startExceptionAutocapture();
  posthogInitialized = true;
  return true;
};

export const captureDashboardException = (
  error: unknown,
  additionalProperties?: Record<string, unknown>,
): void => {
  if (!posthogInitialized) {
    return;
  }
  posthog.captureException(error, additionalProperties);
};

export const captureDashboardEvent = (
  event: string,
  properties?: Record<string, unknown>,
): void => {
  if (!posthogInitialized) {
    return;
  }
  posthog.capture(event, properties);
};
