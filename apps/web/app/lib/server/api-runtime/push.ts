import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import webpush, { type PushSubscription } from "web-push";
import { type NotificationPayload as DeliveryNotificationPayload } from "@keppo/shared/notifications";
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
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "metadata.google.internal.",
]);

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

const toIPv4Octets = (ip: string): number[] | null => {
  const parts = ip.split(".");
  if (parts.length !== 4) {
    return null;
  }

  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    const value = Number.parseInt(part, 10);
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      return null;
    }
    octets.push(value);
  }
  return octets;
};

const isLoopbackAddress = (address: string): boolean => {
  if (isIP(address) === 4) {
    const octets = toIPv4Octets(address);
    return (octets?.[0] ?? -1) === 127;
  }
  const normalized = address.trim().toLowerCase();
  return normalized === "::1" || normalized === "0:0:0:0:0:0:0:1";
};

const isBlockedIPv4 = (address: string): boolean => {
  const octets = toIPv4Octets(address);
  if (!octets) {
    return true;
  }
  const a = octets[0] ?? -1;
  const b = octets[1] ?? -1;
  if (a === 0 || a === 10 || a === 127) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return true;
  }
  if (a === 198 && (b === 18 || b === 19)) {
    return true;
  }
  return a >= 224;
};

const isBlockedIPv6 = (address: string): boolean => {
  const normalized = address.trim().toLowerCase();
  if (normalized === "::" || normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") {
    return true;
  }

  const mappedIPv4Match = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(normalized);
  if (mappedIPv4Match) {
    return isBlockedIPv4(mappedIPv4Match[1] ?? "");
  }

  const noPrefix = normalized.startsWith("::") ? normalized.slice(2) : normalized;
  const firstSegment = (noPrefix.split(":")[0] ?? "").trim();
  if (!firstSegment) {
    return true;
  }
  if (firstSegment.startsWith("fc") || firstSegment.startsWith("fd")) {
    return true;
  }
  if (
    firstSegment.startsWith("fe8") ||
    firstSegment.startsWith("fe9") ||
    firstSegment.startsWith("fea") ||
    firstSegment.startsWith("feb")
  ) {
    return true;
  }
  return false;
};

const isBlockedIpAddress = (address: string): boolean => {
  const version = isIP(address);
  if (version === 4) {
    return isBlockedIPv4(address);
  }
  if (version === 6) {
    return isBlockedIPv6(address);
  }
  return true;
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
    throw new Error("Push subscription endpoint resolves to a blocked address.");
  }
};

export const validatePushSubscriptionEndpoint = async (endpoint: string): Promise<void> => {
  const target = toSubscriptionEndpointUrl(endpoint);
  if (!target || target.protocol !== "https:") {
    throw new Error("Push subscription endpoint must use https.");
  }

  const hostname = target.hostname.trim().toLowerCase();
  if (!hostname || BLOCKED_HOSTNAMES.has(hostname)) {
    throw new Error("Push subscription endpoint hostname is not allowed.");
  }

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
    throw new Error("Push subscription endpoint hostname could not be resolved.");
  }

  if (resolved.length === 0) {
    throw new Error("Push subscription endpoint hostname resolved no addresses.");
  }

  for (const entry of resolved) {
    assertAddressAllowed(entry.address);
  }
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
    await validatePushSubscriptionEndpoint(subscription.endpoint);
    await webpush.sendNotification(subscription, toPushPayload(payload));
    return { success: true };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Push subscription endpoint")) {
      return {
        success: false,
        error: "Push subscription endpoint is not allowed.",
        retryable: false,
        subscriptionInvalid: true,
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
