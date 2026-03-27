import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { makeFunctionReference } from "convex/server";
import { useAuth } from "@/hooks/use-auth";
import type { NotificationEndpoint } from "@/hooks/use-notifications";
import { getRuntimeBetterAuthCookieHeader } from "@/lib/better-auth-cookie";
import { useDashboardRuntime } from "@/lib/dashboard-runtime";
import { subscribePushNotifications } from "@/lib/server-functions/internal-api";
import { toUserFacingError } from "@/lib/user-facing-errors";

const getVapidPublicKey = (): string => import.meta.env.VITE_VAPID_PUBLIC_KEY ?? "";

const urlBase64ToArrayBuffer = (base64String: string): ArrayBuffer => {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const bytes = Uint8Array.from(rawData, (char) => char.charCodeAt(0));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

export function usePushNotifications() {
  const { getOrgId, session } = useAuth();
  const runtime = useDashboardRuntime();
  const orgId = getOrgId();
  const userId = session?.user?.id ?? null;
  const endpoints =
    runtime.useQuery(
      makeFunctionReference<"query">("notifications:listEndpoints"),
      orgId ? { orgId } : "skip",
    ) ?? [];
  const typedEndpoints = endpoints as NotificationEndpoint[];
  const toggleEndpointMutation = runtime.useMutation(
    makeFunctionReference<"mutation">("notifications:toggleEndpoint"),
  );
  const lastSubscribedEndpointIdRef = useRef<string | null>(null);

  const [permission, setPermission] = useState<NotificationPermission>(() =>
    typeof Notification === "undefined" ? "default" : Notification.permission,
  );

  const isSupported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    typeof Notification !== "undefined";

  const pushEndpoints = useMemo(
    () => typedEndpoints.filter((endpoint) => endpoint.type === "push"),
    [typedEndpoints],
  );
  const persistedIsSubscribed = pushEndpoints.some((endpoint) => endpoint.enabled);
  const [optimisticSubscribed, setOptimisticSubscribed] = useState<boolean | null>(null);
  const isSubscribed = optimisticSubscribed ?? persistedIsSubscribed;

  useEffect(() => {
    if (typeof Notification === "undefined") {
      return;
    }
    setPermission(Notification.permission);
  }, [isSubscribed]);

  useEffect(() => {
    if (optimisticSubscribed === null || optimisticSubscribed !== persistedIsSubscribed) {
      return;
    }
    setOptimisticSubscribed(null);
  }, [optimisticSubscribed, persistedIsSubscribed]);

  const subscribe = useCallback(async () => {
    try {
      if (!isSupported) {
        throw new Error("Push notifications are not supported in this browser.");
      }
      if (!orgId || !userId) {
        throw new Error("Missing organization or user context.");
      }
      const vapidPublicKey = getVapidPublicKey();
      if (!vapidPublicKey) {
        throw new Error("VAPID public key is missing.");
      }

      const nextPermission = await Notification.requestPermission();
      setPermission(nextPermission);
      if (nextPermission !== "granted") {
        throw new Error("Notification permission was not granted.");
      }

      const registration = (await navigator.serviceWorker.register(
        "/sw.js",
      )) as ServiceWorkerRegistration & {
        pushManager: PushManager;
      };
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToArrayBuffer(vapidPublicKey),
        });
      }

      const result = await subscribePushNotifications({
        orgId,
        userId,
        subscription: subscription.toJSON() as Record<string, unknown>,
        betterAuthCookie: getRuntimeBetterAuthCookieHeader(),
      });
      lastSubscribedEndpointIdRef.current = result.endpointId?.trim() || null;
      setOptimisticSubscribed(true);
    } catch (error) {
      setOptimisticSubscribed(null);
      throw toUserFacingError(error, {
        fallback: "Failed to enable push notifications.",
        fallbackCode: "push.subscription_failed",
      });
    }
  }, [isSupported, orgId, runtime.authClient, userId]);

  const unsubscribe = useCallback(async () => {
    if (!isSupported || !orgId) {
      return;
    }

    try {
      const registration = (await navigator.serviceWorker.getRegistration("/sw.js")) as
        | (ServiceWorkerRegistration & { pushManager: PushManager })
        | undefined;
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await subscription.unsubscribe();
      }

      const endpointIds = new Set(pushEndpoints.map((endpoint) => endpoint.id));
      if (lastSubscribedEndpointIdRef.current) {
        endpointIds.add(lastSubscribedEndpointIdRef.current);
      }

      for (const endpointId of endpointIds) {
        await toggleEndpointMutation({ endpointId, enabled: false });
      }
      lastSubscribedEndpointIdRef.current = null;
      setOptimisticSubscribed(false);
    } catch (error) {
      setOptimisticSubscribed(null);
      throw toUserFacingError(error, {
        fallback: "Failed to disable push notifications.",
        fallbackCode: "push.unsubscribe_failed",
      });
    }
  }, [isSupported, orgId, pushEndpoints, toggleEndpointMutation]);

  return {
    isSupported,
    isSubscribed,
    permission,
    pushEndpoints,
    subscribe,
    unsubscribe,
  };
}
