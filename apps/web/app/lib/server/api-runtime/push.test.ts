import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PushSubscription } from "web-push";

const lookupMock = vi.fn();
const sendNotificationMock = vi.fn();
const setVapidDetailsMock = vi.fn();

vi.mock("node:dns/promises", () => ({
  lookup: lookupMock,
}));

vi.mock("web-push", () => ({
  default: {
    sendNotification: sendNotificationMock,
    setVapidDetails: setVapidDetailsMock,
  },
}));

describe("push runtime network policy", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    lookupMock.mockReset();
    sendNotificationMock.mockReset();
    setVapidDetailsMock.mockReset();
    process.env.VAPID_PUBLIC_KEY = "public";
    process.env.VAPID_PRIVATE_KEY = "private";
    process.env.VAPID_SUBJECT = "mailto:test@example.com";
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      process.env[key] = value;
    }
  });

  it("rejects private push subscription endpoints before sending", async () => {
    const { sendPushNotification } = await import("./push.js");
    lookupMock.mockResolvedValue([{ address: "10.0.0.12" }]);

    const result = await sendPushNotification(
      {
        endpoint: "https://push.attacker.test/subscription",
        keys: {
          auth: "auth",
          p256dh: "p256dh",
        },
      } satisfies PushSubscription,
      {
        title: "Approval needed",
        body: "Review the action",
        orgId: "org_test",
        orgName: "Test Org",
        ctaUrl: "/approvals",
        ctaLabel: "Review approvals",
        eventId: "approval_needed",
        metadata: {},
      },
    );

    expect(result).toEqual({
      success: false,
      error: "Push subscription endpoint is not allowed.",
      retryable: false,
      subscriptionInvalid: true,
    });
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it("allows public https push subscription endpoints", async () => {
    const { sendPushNotification, validatePushSubscriptionEndpoint } = await import("./push.js");
    lookupMock.mockResolvedValue([{ address: "203.0.113.10" }]);
    sendNotificationMock.mockResolvedValue(undefined);

    await expect(
      validatePushSubscriptionEndpoint("https://push.example.com/subscription"),
    ).resolves.toBeUndefined();

    const result = await sendPushNotification(
      {
        endpoint: "https://push.example.com/subscription",
        keys: {
          auth: "auth",
          p256dh: "p256dh",
        },
      } satisfies PushSubscription,
      {
        title: "Approval needed",
        body: "Review the action",
        orgId: "org_test",
        orgName: "Test Org",
        ctaUrl: "/approvals",
        ctaLabel: "Review approvals",
        eventId: "approval_needed",
        metadata: {},
      },
    );

    expect(result).toEqual({ success: true });
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
  });
});
