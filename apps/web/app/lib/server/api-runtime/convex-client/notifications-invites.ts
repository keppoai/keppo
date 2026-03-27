import type { ConvexHttpClient } from "convex/browser";
import type { FunctionArgs } from "convex/server";
import type {
  ProviderMetricName,
  ProviderMetricOutcome,
} from "@keppo/shared/providers/boundaries/types";
import { convexRecordProviderMetricPayloadSchema } from "@keppo/shared/providers/boundaries/convex-schemas";
import { parseConvexPayload } from "@keppo/shared/providers/boundaries/error-boundary";
import type { CanonicalProviderId } from "@keppo/shared/provider-ids";
import type {
  NotificationChannel,
  NotificationEndpointType,
  NotificationEventId,
} from "@keppo/shared/notifications";
import {
  AUDIT_ACTOR_TYPE,
  PROVIDER_METRIC_EVENT_TYPE,
  NOTIFICATION_DELIVERY_STATUS,
  type NotificationDeliveryStatus,
  type UserRole,
} from "@keppo/shared/domain";
import { refs } from "./refs.js";

export type CreateAuditEventParams = FunctionArgs<(typeof refs)["createAuditEvent"]>;

export async function createAuditEvent(
  client: ConvexHttpClient,
  params: CreateAuditEventParams,
): Promise<void> {
  await client.mutation(refs.createAuditEvent, {
    orgId: params.orgId,
    actorType: params.actorType,
    actorId: params.actorId,
    eventType: params.eventType,
    payload: params.payload,
  });
}

export async function emitNotificationForOrg(
  client: ConvexHttpClient,
  params: {
    orgId: string;
    eventType: NotificationEventId;
    context?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    actionId?: string;
    ctaUrl?: string;
    ctaLabel?: string;
  },
): Promise<{ created: number; queued: number }> {
  return (await client.mutation(refs.emitNotificationForOrg, {
    orgId: params.orgId,
    eventType: params.eventType,
    ...(params.context ? { context: params.context } : {}),
    ...(params.metadata ? { metadata: params.metadata } : {}),
    ...(params.actionId ? { actionId: params.actionId } : {}),
    ...(params.ctaUrl ? { ctaUrl: params.ctaUrl } : {}),
    ...(params.ctaLabel ? { ctaLabel: params.ctaLabel } : {}),
  })) as { created: number; queued: number };
}

export async function registerPushEndpointForUser(
  client: ConvexHttpClient,
  params: {
    orgId: string;
    userId: string;
    destination: string;
    pushSubscription: string;
    preferences?: Record<string, boolean>;
  },
): Promise<{ id: string }> {
  return (await client.mutation(refs.registerEndpointForOrgMember, {
    orgId: params.orgId,
    userId: params.userId,
    type: "push",
    destination: params.destination,
    pushSubscription: params.pushSubscription,
    ...(params.preferences ? { preferences: params.preferences } : {}),
  })) as { id: string };
}

export type NotificationDeliveryEvent = {
  event: {
    id: string;
    org_id: string;
    channel: NotificationChannel;
    title: string;
    body: string;
    cta_url: string;
    cta_label: string;
    metadata?: string;
    status: NotificationDeliveryStatus;
    endpoint_id: string | null;
    event_type: NotificationEventId;
  };
  endpoint: {
    id: string;
    type: NotificationEndpointType;
    destination: string;
    push_subscription: string | null;
    enabled: boolean;
  } | null;
};

export async function getNotificationDeliveryEvent(
  client: ConvexHttpClient,
  eventId: string,
): Promise<NotificationDeliveryEvent | null> {
  return (await client.query(refs.getDeliveryEvent, {
    eventId,
  })) as NotificationDeliveryEvent | null;
}

export async function markNotificationEventSent(
  client: ConvexHttpClient,
  eventId: string,
): Promise<void> {
  await client.mutation(refs.markNotificationEventSent, { eventId });
}

export async function markNotificationEventFailed(
  client: ConvexHttpClient,
  params: {
    eventId: string;
    error: string;
    retryable?: boolean;
    deadLetterPayload?: Record<string, unknown>;
  },
): Promise<{
  attempts: number;
  shouldRetry: boolean;
  status: typeof NOTIFICATION_DELIVERY_STATUS.pending | typeof NOTIFICATION_DELIVERY_STATUS.failed;
  retryAfterMs: number | null;
  maxRetries: number;
}> {
  return (await client.mutation(refs.markNotificationEventFailed, {
    eventId: params.eventId,
    error: params.error,
    ...(params.retryable !== undefined ? { retryable: params.retryable } : {}),
    ...(params.deadLetterPayload ? { deadLetterPayload: params.deadLetterPayload } : {}),
  })) as {
    attempts: number;
    shouldRetry: boolean;
    status:
      | typeof NOTIFICATION_DELIVERY_STATUS.pending
      | typeof NOTIFICATION_DELIVERY_STATUS.failed;
    retryAfterMs: number | null;
    maxRetries: number;
  };
}

export async function disableNotificationEndpoint(
  client: ConvexHttpClient,
  endpointId: string,
): Promise<void> {
  await client.mutation(refs.disableNotificationEndpoint, { endpointId });
}

export async function createInviteInternal(
  client: ConvexHttpClient,
  params: {
    orgId: string;
    inviterUserId: string;
    email: string;
    role: UserRole;
  },
): Promise<{ inviteId: string; rawToken: string; orgName: string }> {
  return (await client.mutation(refs.createInviteInternal, {
    orgId: params.orgId,
    inviterUserId: params.inviterUserId,
    email: params.email,
    role: params.role,
  })) as { inviteId: string; rawToken: string; orgName: string };
}

export async function acceptInviteInternal(
  client: ConvexHttpClient,
  params: {
    tokenHash: string;
    userId: string;
  },
): Promise<{ orgId: string; orgName: string; role: UserRole }> {
  return (await client.mutation(refs.acceptInviteInternal, {
    tokenHash: params.tokenHash,
    userId: params.userId,
  })) as { orgId: string; orgName: string; role: UserRole };
}

export async function cleanupExpiredInvites(
  client: ConvexHttpClient,
): Promise<{ expired: number }> {
  return (await client.mutation(refs.cleanupExpiredInvites, {})) as { expired: number };
}

export async function storeInviteToken(
  client: ConvexHttpClient,
  params: {
    inviteId: string;
    orgId: string;
    email: string;
    rawToken: string;
    createdAt: string;
  },
): Promise<void> {
  await client.mutation(refs.storeInviteToken, {
    inviteId: params.inviteId,
    orgId: params.orgId,
    email: params.email,
    rawToken: params.rawToken,
    createdAt: params.createdAt,
  });
}

export async function resolveApiSessionFromToken(
  client: ConvexHttpClient,
  sessionToken: string,
): Promise<{
  userId: string;
  orgId: string;
  role: UserRole;
} | null> {
  return (await client.query(refs.resolveApiSessionFromToken, {
    sessionToken,
  })) as {
    userId: string;
    orgId: string;
    role: UserRole;
  } | null;
}

export async function recordProviderMetric(
  client: ConvexHttpClient,
  params: {
    orgId: string;
    metric: ProviderMetricName;
    provider?: CanonicalProviderId;
    providerInput?: string;
    route?: string;
    outcome?: ProviderMetricOutcome;
    reasonCode?: string;
    value?: number;
  },
): Promise<void> {
  const payload = parseConvexPayload(convexRecordProviderMetricPayloadSchema, params);
  await client.mutation(refs.createAuditEvent, {
    orgId: payload.orgId,
    actorType: AUDIT_ACTOR_TYPE.system,
    actorId: "provider-metrics",
    eventType: PROVIDER_METRIC_EVENT_TYPE,
    payload: {
      metric: payload.metric,
      ...(payload.provider ? { provider: payload.provider } : {}),
      ...(payload.providerInput ? { provider_input: payload.providerInput } : {}),
      ...(payload.route ? { route: payload.route } : {}),
      ...(payload.outcome ? { outcome: payload.outcome } : {}),
      ...(payload.reasonCode ? { reason_code: payload.reasonCode } : {}),
      value: payload.value ?? 1,
    },
  });
}
