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
  const runAgentLookup = async (
    options: unknown,
    hostname: string,
    lookupOptions: { all?: boolean } = {},
  ): Promise<void> => {
    const agent = (options as { agent?: { options?: { lookup?: Function } } })?.agent;
    await new Promise<void>((resolve, reject) => {
      agent?.options?.lookup?.(
        hostname,
        { all: false, verbatim: true, ...lookupOptions },
        (error: Error | null) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        },
      );
    });
  };

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
    sendNotificationMock.mockImplementation(async (_subscription, _payload, options) => {
      await runAgentLookup(options, "push.attacker.test");
    });

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
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
  });

  it("rejects hex-encoded IPv4-mapped loopback IPv6 literals", async () => {
    const { sendPushNotification } = await import("./push.js");

    const result = await sendPushNotification(
      {
        endpoint: "https://[::ffff:7f00:1]/subscription",
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

  it("treats DNS resolution failures during delivery as retryable", async () => {
    const { sendPushNotification } = await import("./push.js");
    sendNotificationMock.mockImplementation(async (_subscription, _payload, options) => {
      await runAgentLookup(options, "push.example.com");
    });
    lookupMock.mockRejectedValue(new Error("getaddrinfo EAI_AGAIN push.example.com"));

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

    expect(result).toEqual({
      success: false,
      error: "Push subscription endpoint hostname could not be resolved.",
      retryable: true,
    });
  });

  it("allows public https push subscription endpoints", async () => {
    const { sendPushNotification, validatePushSubscriptionEndpoint } = await import("./push.js");
    lookupMock.mockResolvedValue([{ address: "203.0.113.10" }]);
    sendNotificationMock.mockImplementation(async (_subscription, _payload, options) => {
      await runAgentLookup(options, "push.example.com");
    });

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
    expect(sendNotificationMock.mock.calls[0]?.[2]).toMatchObject({
      agent: expect.any(Object),
    });
  });
});
