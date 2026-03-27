import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDashboardRuntime } from "@/test/fake-dashboard-runtime";
import { createAuthState, renderDashboardHook } from "@/test/render-dashboard";
import { usePushNotifications } from "./use-push-notifications";

const subscribePushNotificationsMock = vi.fn();

vi.mock("@/lib/server-functions/internal-api", () => ({
  subscribePushNotifications: (...args: unknown[]) => subscribePushNotificationsMock(...args),
}));

describe("usePushNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "AQIDBA");

    Object.defineProperty(window, "PushManager", {
      configurable: true,
      value: function PushManager() {},
    });
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: {
        permission: "granted",
        requestPermission: vi.fn(async () => "granted"),
      },
    });
  });

  it("disables the just-subscribed endpoint even before the endpoints query refreshes", async () => {
    let currentSubscription: { unsubscribe: () => Promise<boolean>; toJSON: () => unknown } | null =
      null;
    const fakeSubscription = {
      toJSON: () => ({
        endpoint: "https://push.example.test/subscription",
        expirationTime: null,
        keys: {
          p256dh: "fake-p256dh",
          auth: "fake-auth",
        },
      }),
      unsubscribe: vi.fn(async () => {
        currentSubscription = null;
        return true;
      }),
    };

    Object.defineProperty(window.navigator, "serviceWorker", {
      configurable: true,
      value: {
        register: vi.fn(async () => ({
          pushManager: {
            getSubscription: async () => currentSubscription,
            subscribe: async () => {
              currentSubscription = fakeSubscription;
              return fakeSubscription;
            },
          },
        })),
        getRegistration: vi.fn(async () => ({
          pushManager: {
            getSubscription: async () => currentSubscription,
          },
        })),
      },
    });

    subscribePushNotificationsMock.mockResolvedValue({
      endpointId: "endpoint_push_123",
    });
    const toggleEndpointMutation = vi.fn(async () => undefined);
    const runtime = createFakeDashboardRuntime({
      queryHandlers: {
        "notifications:listEndpoints": () => [],
      },
      mutationHandlers: {
        "notifications:toggleEndpoint": toggleEndpointMutation,
      },
    });
    const auth = createAuthState({
      isAuthenticated: true,
      getOrgId: () => "org_123",
      session: {
        authenticated: true,
        user: {
          id: "user_123",
          email: "operator@example.com",
          name: "Operator",
        },
        role: "owner",
        organizationId: "org_123",
        organization_id: "org_123",
        orgSlug: "acme",
      },
    });

    const { result } = renderDashboardHook(() => usePushNotifications(), {
      runtime,
      auth,
    });

    await act(async () => {
      await result.current.subscribe();
    });
    await act(async () => {
      await result.current.unsubscribe();
    });

    expect(subscribePushNotificationsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org_123",
        userId: "user_123",
      }),
    );
    expect(toggleEndpointMutation).toHaveBeenCalledWith({
      endpointId: "endpoint_push_123",
      enabled: false,
    });
  });
});
