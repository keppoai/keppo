import webpush, { type PushSubscription } from "web-push";
import { type NotificationPayload as DeliveryNotificationPayload } from "@keppo/shared/notifications";
import { isJsonRecord, parseJsonValue } from "@keppo/shared/providers/boundaries/json";
import { getEnv } from "./env.js";

type PushResult = {
  success: boolean;
  error?: string;
  retryable?: boolean;
  subscriptionExpired?: boolean;
};

let configured = false;

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
    await webpush.sendNotification(subscription, toPushPayload(payload));
    return { success: true };
  } catch (error) {
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
