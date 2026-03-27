import { useMemo } from "react";
import type { OptimisticLocalStore } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import type { NotificationEventId } from "@keppo/shared/notifications";
import { useDashboardRuntime } from "@/lib/dashboard-runtime";
import { useAuth } from "@/hooks/use-auth";
import { toUserFacingError } from "@/lib/user-facing-errors";

export type DashboardNotification = {
  id: string;
  event_type: NotificationEventId;
  title: string;
  body: string;
  cta_url: string;
  cta_label: string;
  metadata: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

export type NotificationEndpoint = {
  id: string;
  org_id: string;
  user_id: string;
  type: "email" | "push" | "webhook";
  destination: string;
  push_subscription: string | null;
  notification_preferences?: string;
  enabled: boolean;
  created_at: string;
  delivery_warning?: {
    recent_failure_count: number;
    consecutive_failure_count: number;
    last_error: string;
    last_attempt_at: string;
  };
};

export type NotificationEventDefinition = {
  id: NotificationEventId;
  title: string;
  channels: Array<"email" | "push" | "in_app">;
};

export function useNotifications(
  limit = 10,
  options?: {
    enabled?: boolean;
    includeInbox?: boolean;
    includeSettings?: boolean;
  },
) {
  const runtime = useDashboardRuntime();
  const { getOrgId } = useAuth();
  const orgId = getOrgId();
  const enabled = options?.enabled ?? true;
  const includeInbox = options?.includeInbox ?? true;
  const includeSettings = options?.includeSettings ?? true;

  const countUnreadRef = makeFunctionReference<"query">("notifications:countUnread");
  const listInAppNotificationsRef = makeFunctionReference<"query">(
    "notifications:listInAppNotifications",
  );
  const markNotificationReadOptimistically = (
    localStore: OptimisticLocalStore,
    eventId: string,
  ): void => {
    const stamp = new Date().toISOString();
    for (const entry of localStore.getAllQueries(listInAppNotificationsRef)) {
      if (!entry.value) {
        continue;
      }
      const notifications = entry.value as DashboardNotification[];
      const target = notifications.find((notification) => notification.id === eventId);
      if (!target || target.read_at !== null) {
        continue;
      }
      localStore.setQuery(
        listInAppNotificationsRef,
        entry.args,
        notifications.map((notification) =>
          notification.id === eventId ? { ...notification, read_at: stamp } : notification,
        ),
      );
      const currentUnread = localStore.getQuery(countUnreadRef, {
        orgId: entry.args.orgId,
      });
      if (typeof currentUnread === "number") {
        localStore.setQuery(
          countUnreadRef,
          { orgId: entry.args.orgId },
          Math.max(0, currentUnread - 1),
        );
      }
    }
  };

  const unreadCountQuery = runtime.useQuery(
    countUnreadRef,
    enabled && includeInbox && orgId ? { orgId } : "skip",
  );
  const inAppNotificationsQuery = runtime.useQuery(
    listInAppNotificationsRef,
    enabled && includeInbox && orgId ? { orgId, limit } : "skip",
  );
  const listEndpointsRef = makeFunctionReference<"query">("notifications:listEndpoints");
  const listEventDefinitionsRef = makeFunctionReference<"query">(
    "notifications:listEventDefinitions",
  );
  const endpointsQuery = runtime.useQuery(
    listEndpointsRef,
    enabled && includeSettings && orgId ? { orgId } : "skip",
  );
  const eventDefinitionsQuery = runtime.useQuery(
    listEventDefinitionsRef,
    enabled && includeSettings ? {} : "skip",
  );

  const markReadMutation = runtime
    .useMutation(makeFunctionReference<"mutation">("notifications:markRead"))
    .withOptimisticUpdate((localStore, args) => {
      markNotificationReadOptimistically(localStore, args.eventId);
    });
  const markAllReadMutation = runtime
    .useMutation(makeFunctionReference<"mutation">("notifications:markAllRead"))
    .withOptimisticUpdate((localStore, args) => {
      for (const entry of localStore.getAllQueries(listInAppNotificationsRef)) {
        if (entry.args.orgId !== args.orgId || !entry.value) {
          continue;
        }
        const stamp = new Date().toISOString();
        const notifications = entry.value as DashboardNotification[];
        localStore.setQuery(
          listInAppNotificationsRef,
          entry.args,
          notifications.map((notification) =>
            notification.read_at === null ? { ...notification, read_at: stamp } : notification,
          ),
        );
      }
      localStore.setQuery(countUnreadRef, { orgId: args.orgId }, 0);
    });
  const toggleEndpointMutation = runtime.useMutation(
    makeFunctionReference<"mutation">("notifications:toggleEndpoint"),
  );
  const registerEndpointMutation = runtime
    .useMutation(makeFunctionReference<"mutation">("notifications:registerEndpoint"))
    .withOptimisticUpdate((localStore, args) => {
      const existing =
        (localStore.getQuery(listEndpointsRef, { orgId: args.orgId }) as
          | NotificationEndpoint[]
          | null) ?? [];
      const alreadyPresent = existing.some(
        (endpoint) => endpoint.type === args.type && endpoint.destination === args.destination,
      );
      if (alreadyPresent) {
        return;
      }
      const optimisticEndpoint: NotificationEndpoint = {
        id: `optimistic:${args.type}:${args.destination}`,
        org_id: args.orgId,
        user_id: "optimistic",
        type: args.type,
        destination: args.destination,
        push_subscription: args.pushSubscription ?? null,
        enabled: true,
        created_at: new Date().toISOString(),
        ...(args.preferences ? { notification_preferences: JSON.stringify(args.preferences) } : {}),
      };
      localStore.setQuery(listEndpointsRef, { orgId: args.orgId }, [
        optimisticEndpoint,
        ...existing,
      ]);
    });
  const removeEndpointMutation = runtime
    .useMutation(makeFunctionReference<"mutation">("notifications:removeEndpoint"))
    .withOptimisticUpdate((localStore, args) => {
      for (const entry of localStore.getAllQueries(listEndpointsRef)) {
        if (!entry.value) {
          continue;
        }
        const endpoints = entry.value as NotificationEndpoint[];
        if (!endpoints.some((endpoint) => endpoint.id === args.endpointId)) {
          continue;
        }
        localStore.setQuery(
          listEndpointsRef,
          entry.args,
          endpoints.filter((endpoint) => endpoint.id !== args.endpointId),
        );
      }
    });
  const setEndpointPreferencesMutation = runtime.useMutation(
    makeFunctionReference<"mutation">("notifications:setEndpointPreferences"),
  );

  const notifications = useMemo<DashboardNotification[]>(() => {
    const rows: DashboardNotification[] = (inAppNotificationsQuery ??
      []) as DashboardNotification[];
    return rows.map((row) => ({
      id: row.id,
      event_type: row.event_type,
      title: row.title,
      body: row.body,
      cta_url: row.cta_url,
      cta_label: row.cta_label,
      metadata: row.metadata,
      read_at: row.read_at,
      created_at: row.created_at,
    }));
  }, [inAppNotificationsQuery]);
  const endpoints = (endpointsQuery ?? []) as NotificationEndpoint[];
  const eventDefinitions = (eventDefinitionsQuery ?? []) as NotificationEventDefinition[];

  return {
    orgId,
    unreadCount: unreadCountQuery ?? 0,
    notifications,
    endpoints,
    eventDefinitions,
    markRead: async (eventId: string) => {
      await markReadMutation({ eventId });
    },
    markAllRead: async () => {
      if (!orgId) {
        return;
      }
      await markAllReadMutation({ orgId });
    },
    toggleEndpoint: async (endpointId: string, enabled: boolean) => {
      await toggleEndpointMutation({ endpointId, enabled });
    },
    registerEmailEndpoint: async (email: string) => {
      if (!orgId) {
        throw toUserFacingError(new Error("Missing organization context"), {
          fallback: "Notification setup failed.",
        });
      }
      try {
        await registerEndpointMutation({
          orgId,
          type: "email",
          destination: email,
        });
      } catch (error) {
        throw toUserFacingError(error, {
          fallback: "Failed to add the email notification endpoint.",
        });
      }
    },
    removeEndpoint: async (endpointId: string) => {
      if (!orgId) {
        throw toUserFacingError(new Error("Missing organization context"), {
          fallback: "Notification setup failed.",
        });
      }
      try {
        await removeEndpointMutation({ endpointId });
      } catch (error) {
        throw toUserFacingError(error, {
          fallback: "Failed to remove the notification endpoint.",
        });
      }
    },
    setEndpointPreferences: async (endpointId: string, preferences: Record<string, boolean>) => {
      try {
        await setEndpointPreferencesMutation({
          endpointId,
          preferences,
        });
      } catch (error) {
        throw toUserFacingError(error, {
          fallback: "Failed to update notification preferences.",
        });
      }
    },
  };
}
