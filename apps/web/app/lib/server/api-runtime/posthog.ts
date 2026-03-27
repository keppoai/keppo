import { PostHog } from "posthog-node";
import { getEnv } from "./env.js";
import { logger } from "./logger.js";

const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";
const DEFAULT_DISTINCT_ID = "keppo-web";
const POSTHOG_FLUSH_AT = 1;
const POSTHOG_FLUSH_INTERVAL_MS = 10_000;

type PostHogContext = {
  distinctId?: string;
  properties?: Record<string, unknown>;
};

let posthogClient: PostHog | null | undefined;

const toOptionalString = (value: string | undefined): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeProperties = (
  properties: Record<string, unknown> | undefined,
): Record<string | number, unknown> | undefined => {
  if (!properties) {
    return undefined;
  }

  const normalized: Record<string | number, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value !== undefined) {
      normalized[key] = value;
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

const getPostHogClient = (): PostHog | null => {
  if (posthogClient !== undefined) {
    return posthogClient;
  }

  const env = getEnv();
  const apiKey = toOptionalString(env.POSTHOG_API_KEY);
  if (!apiKey) {
    posthogClient = null;
    return posthogClient;
  }

  const host = toOptionalString(env.POSTHOG_HOST) ?? DEFAULT_POSTHOG_HOST;
  posthogClient = new PostHog(apiKey, {
    host,
    flushAt: POSTHOG_FLUSH_AT,
    flushInterval: POSTHOG_FLUSH_INTERVAL_MS,
  });
  logger.info("observability.posthog.enabled", { host });
  return posthogClient;
};

const resolveDistinctId = (context: PostHogContext): string => {
  const distinctId = toOptionalString(context.distinctId);
  return distinctId ?? DEFAULT_DISTINCT_ID;
};

export const captureApiException = (error: unknown, context: PostHogContext = {}): void => {
  const client = getPostHogClient();
  if (!client) {
    return;
  }

  try {
    client.captureException(
      error,
      resolveDistinctId(context),
      normalizeProperties(context.properties),
    );
  } catch (captureError) {
    logger.warn("observability.posthog.capture_exception_failed", {
      error: captureError instanceof Error ? captureError.message : String(captureError),
    });
  }
};

export const captureApiEvent = (event: string, context: PostHogContext = {}): void => {
  const client = getPostHogClient();
  if (!client) {
    return;
  }

  try {
    const properties = normalizeProperties(context.properties);
    client.capture({
      distinctId: resolveDistinctId(context),
      event,
      ...(properties ? { properties } : {}),
    });
  } catch (captureError) {
    logger.warn("observability.posthog.capture_event_failed", {
      event,
      error: captureError instanceof Error ? captureError.message : String(captureError),
    });
  }
};
