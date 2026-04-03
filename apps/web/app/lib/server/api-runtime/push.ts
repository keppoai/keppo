import { lookup } from "node:dns/promises";
import { Agent } from "node:https";
import { isIP } from "node:net";
import webpush, { type PushSubscription } from "web-push";
import { type NotificationPayload as DeliveryNotificationPayload } from "@keppo/shared/notifications";
import {
  BLOCKED_HOSTNAMES,
  isBlockedIpAddress,
  isLoopbackAddress,
  normalizeHostname,
} from "@keppo/shared/network-address-policy";
import { isJsonRecord, parseJsonValue } from "@keppo/shared/providers/boundaries/json";
import { getEnv } from "./env.js";

type PushResult = {
  success: boolean;
  error?: string;
  retryable?: boolean;
  subscriptionExpired?: boolean;
  subscriptionInvalid?: boolean;
};

let configured = false;

export class PushEndpointBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PushEndpointBlockedError";
  }
}

export class PushEndpointResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PushEndpointResolutionError";
  }
}

const resolveDashboardOrigin = (): string => {
  const env = getEnv();
  return (env.KEPPO_DASHBOARD_ORIGIN ?? "http://localhost:3000").replace(/\/+$/, "");
};

const toAbsoluteUrl = (value: string): string => {
  if (/^https?:\/\//.test(value)) {
    return value;
  }
  return `${resolveDashboardOrigin()}${value.startsWith("/") ? value : `/${value}`}`;
};

const ensureConfigured = (): { ok: true } | { ok: false; error: string } => {
  if (configured) {
    return { ok: true };
  }

  const env = getEnv();
  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  const subject = env.VAPID_SUBJECT;

  if (!publicKey || !privateKey || !subject) {
    return {
      ok: false,
      error: "VAPID keys are not configured",
    };
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return { ok: true };
};

const toPushPayload = (payload: DeliveryNotificationPayload): string => {
  return JSON.stringify({
    title: payload.title,
    body: payload.body,
    icon: "/keppo-icon-192.png",
    badge: "/keppo-icon-192.png",
    url: toAbsoluteUrl(payload.ctaUrl),
    eventId: payload.eventId,
  });
};

const toSubscriptionEndpointUrl = (endpoint: string): URL | null => {
  try {
    return new URL(endpoint);
  } catch {
    return null;
  }
};

const assertAddressAllowed = (address: string): void => {
  if (isLoopbackAddress(address) || isBlockedIpAddress(address)) {
    throw new PushEndpointBlockedError("Push subscription endpoint resolves to a blocked address.");
  }
};

const parseAndValidateSubscriptionEndpoint = (endpoint: string): URL => {
  const target = toSubscriptionEndpointUrl(endpoint);
  if (!target || target.protocol !== "https:") {
    throw new PushEndpointBlockedError("Push subscription endpoint must use https.");
  }

  const hostname = normalizeHostname(target.hostname);
  if (!hostname || BLOCKED_HOSTNAMES.has(hostname)) {
    throw new PushEndpointBlockedError("Push subscription endpoint hostname is not allowed.");
  }
  return target;
};

export const validatePushSubscriptionEndpoint = async (endpoint: string): Promise<void> => {
  const target = parseAndValidateSubscriptionEndpoint(endpoint);
  const hostname = normalizeHostname(target.hostname);

  if (isIP(hostname)) {
    assertAddressAllowed(hostname);
    return;
  }

  let resolved: Array<{ address: string }> = [];
  try {
    resolved = await lookup(hostname, {
      all: true,
      verbatim: true,
    });
  } catch {
    throw new PushEndpointResolutionError(
      "Push subscription endpoint hostname could not be resolved.",
    );
  }

  if (resolved.length === 0) {
    throw new PushEndpointResolutionError(
      "Push subscription endpoint hostname resolved no addresses.",
    );
  }

  for (const entry of resolved) {
    assertAddressAllowed(entry.address);
  }
};

const createValidatedPushAgent = (endpoint: string): Agent => {
  const target = parseAndValidateSubscriptionEndpoint(endpoint);
  const hostname = normalizeHostname(target.hostname);
  if (isIP(hostname)) {
    assertAddressAllowed(hostname);
  }

  return new Agent({
    keepAlive: false,
    lookup(host, options, callback) {
      lookup(host, options)
        .then((result) => {
          const resolved = Array.isArray(result) ? result : [result];
          if (resolved.length === 0) {
            callback(
              new PushEndpointResolutionError(
                "Push subscription endpoint hostname resolved no addresses.",
              ),
              "",
              0,
            );
            return;
          }

          for (const entry of resolved) {
            assertAddressAllowed(entry.address);
          }

          if (Array.isArray(result)) {
            callback(null, result[0]?.address ?? "", result[0]?.family ?? 0);
            return;
          }

          callback(null, result.address, result.family);
        })
        .catch((error: unknown) => {
          const failure =
            error instanceof PushEndpointBlockedError ||
            error instanceof PushEndpointResolutionError
              ? error
              : new PushEndpointResolutionError(
                  "Push subscription endpoint hostname could not be resolved.",
                );
          callback(failure, "", 0);
        });
    },
  });
};

export const sendPushNotification = async (
  subscription: PushSubscription,
  payload: DeliveryNotificationPayload,
): Promise<PushResult> => {
  const config = ensureConfigured();
  if (!config.ok) {
    return {
      success: false,
      error: config.error,
      retryable: false,
    };
  }

  try {
    await webpush.sendNotification(subscription, toPushPayload(payload), {
      agent: createValidatedPushAgent(subscription.endpoint),
    });
    return { success: true };
  } catch (error) {
    if (error instanceof PushEndpointBlockedError) {
      return {
        success: false,
        error: "Push subscription endpoint is not allowed.",
        retryable: false,
        subscriptionInvalid: true,
      };
    }

    if (error instanceof PushEndpointResolutionError) {
      return {
        success: false,
        error: error.message,
        retryable: true,
      };
    }

    const statusCode =
      typeof error === "object" && error !== null && "statusCode" in error
        ? Number((error as { statusCode?: unknown }).statusCode)
        : undefined;

    const message = error instanceof Error ? error.message : String(error);
    const subscriptionExpired = statusCode === 404 || statusCode === 410;

    return {
      success: false,
      error: message,
      retryable: !subscriptionExpired && statusCode !== 400,
      subscriptionExpired,
    };
  }
};

export const parsePushSubscription = (value: string): PushSubscription | null => {
  try {
    const parsed = parseJsonValue(value);
    if (!isJsonRecord(parsed)) {
      return null;
    }
    const keys = isJsonRecord(parsed.keys) ? parsed.keys : null;
    if (
      typeof parsed.endpoint !== "string" ||
      !keys ||
      typeof keys.p256dh !== "string" ||
      typeof keys.auth !== "string"
    ) {
      return null;
    }
    return {
      endpoint: parsed.endpoint,
      keys: {
        p256dh: keys.p256dh,
        auth: keys.auth,
      },
    };
  } catch {
    return null;
  }
};
