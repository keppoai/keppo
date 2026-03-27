import {
  AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE,
  AUTOMATION_PROVIDER_TRIGGER_SUBSCRIPTION_STATUS,
  type AutomationProviderTriggerDeliveryMode,
} from "../../../automations.js";
import type { RedditMessage, RedditSdkPort } from "../../../provider-sdk/reddit/types.js";
import type { ProviderRuntimeContext } from "../../../providers.js";
import { createRealRedditSdk } from "../../../provider-sdk/reddit/real.js";
import type {
  ProviderAutomationTriggerLifecycleEvent,
  ProviderAutomationTriggerLifecycleFacet,
  ProviderAutomationTriggerLifecycleRequest,
  ProviderAutomationTriggerLifecycleResult,
} from "../../registry/types.js";
import { resolveNamespaceFromContext } from "../_shared/connector_helpers.js";
import {
  redditMentionTriggerEventSchema,
  redditUnreadInboxMessageTriggerEventSchema,
} from "./schemas.js";

type RedditLifecycleState = {
  version: 1;
  recent_event_ids: string[];
  last_sync_at: string | null;
  last_poll_at: string | null;
  last_error: string | null;
};

const REDDIT_POLL_LIMIT_ENV_KEY = "REDDIT_AUTOMATION_TRIGGER_POLL_LIMIT";
const DEFAULT_POLL_LIMIT = 50;
const MAX_POLL_LIMIT = 100;
const MAX_TRACKED_EVENT_IDS = 250;

const requiredTokenMessage = "Reddit access token missing. Reconnect Reddit integration.";

const getAccessToken = (context: { access_token?: string }): string => {
  if (typeof context.access_token === "string" && context.access_token.length > 0) {
    return context.access_token;
  }
  throw new Error(requiredTokenMessage);
};

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeStringArray = (value: unknown): string[] => {
  return Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    : [];
};

const normalizeState = (value: Record<string, unknown>): RedditLifecycleState => ({
  version: 1,
  recent_event_ids: normalizeStringArray(value.recent_event_ids).slice(0, MAX_TRACKED_EVENT_IDS),
  last_sync_at: normalizeString(value.last_sync_at),
  last_poll_at: normalizeString(value.last_poll_at),
  last_error: normalizeString(value.last_error),
});

const clampPollLimit = (value: string | undefined): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_POLL_LIMIT;
  }
  return Math.max(1, Math.min(MAX_POLL_LIMIT, parsed));
};

const buildSubscriptionState = (params: {
  status:
    | typeof AUTOMATION_PROVIDER_TRIGGER_SUBSCRIPTION_STATUS.inactive
    | typeof AUTOMATION_PROVIDER_TRIGGER_SUBSCRIPTION_STATUS.active
    | typeof AUTOMATION_PROVIDER_TRIGGER_SUBSCRIPTION_STATUS.degraded
    | typeof AUTOMATION_PROVIDER_TRIGGER_SUBSCRIPTION_STATUS.expired
    | typeof AUTOMATION_PROVIDER_TRIGGER_SUBSCRIPTION_STATUS.failed;
  activeMode: AutomationProviderTriggerDeliveryMode | null;
  lastError: string | null;
  updatedAt: string;
}): ProviderAutomationTriggerLifecycleResult["subscriptionState"] => ({
  status: params.status,
  active_mode: params.activeMode,
  last_error: params.lastError,
  updated_at: params.updatedAt,
});

const toNextTrackedEventIds = (
  current: string[],
  nextEvents: ProviderAutomationTriggerLifecycleEvent[],
): string[] => {
  const merged = [...nextEvents.map((event) => event.providerEventId), ...current];
  return [...new Set(merged)].slice(0, MAX_TRACKED_EVENT_IDS);
};

const normalizeMentionEvent = (message: RedditMessage): ProviderAutomationTriggerLifecycleEvent => {
  const parsed = redditMentionTriggerEventSchema.parse({
    delivery_id: `reddit.message.${message.id}`,
    event_type: "reddit.inbox.mention",
    message: {
      id: message.id,
      to: message.to,
      from: message.from,
      subject: message.subject,
      body: message.body,
      unread: message.unread,
    },
  });

  return {
    triggerKey: "mentions",
    providerEventId: parsed.message.id,
    providerEventType: parsed.event_type,
    deliveryMode: AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE.polling,
    eventPayload: parsed as Record<string, unknown>,
    eventPayloadRef: parsed.delivery_id,
  };
};

const normalizeUnreadInboxEvent = (
  message: RedditMessage,
): ProviderAutomationTriggerLifecycleEvent => {
  const parsed = redditUnreadInboxMessageTriggerEventSchema.parse({
    delivery_id: `reddit.message.${message.id}`,
    event_type: "reddit.inbox.unread_message",
    message: {
      id: message.id,
      to: message.to,
      from: message.from,
      subject: message.subject,
      body: message.body,
      unread: true,
    },
  });

  return {
    triggerKey: "unread_inbox_message",
    providerEventId: parsed.message.id,
    providerEventType: parsed.event_type,
    deliveryMode: AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE.polling,
    eventPayload: parsed as Record<string, unknown>,
    eventPayloadRef: parsed.delivery_id,
  };
};

const createLifecycleFacet = (
  createSdk: () => RedditSdkPort,
): ProviderAutomationTriggerLifecycleFacet => {
  const sync = async (
    request: ProviderAutomationTriggerLifecycleRequest,
    runtime: ProviderRuntimeContext,
  ): Promise<ProviderAutomationTriggerLifecycleResult> => {
    const nowIso = runtime.clock.nowIso();
    const state = normalizeState(request.state);

    if (request.activeTriggers.length === 0) {
      return {
        state: {
          ...state,
          last_sync_at: nowIso,
          last_error: null,
        },
        subscriptionState: buildSubscriptionState({
          status: AUTOMATION_PROVIDER_TRIGGER_SUBSCRIPTION_STATUS.inactive,
          activeMode: null,
          lastError: null,
          updatedAt: nowIso,
        }),
        events: [],
      };
    }

    if (state.last_sync_at) {
      return {
        state: {
          ...state,
          last_sync_at: nowIso,
          last_error: null,
        },
        subscriptionState: buildSubscriptionState({
          status: AUTOMATION_PROVIDER_TRIGGER_SUBSCRIPTION_STATUS.active,
          activeMode: AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE.polling,
          lastError: null,
          updatedAt: nowIso,
        }),
        events: [],
      };
    }

    const sdk = createSdk();
    const accessToken = getAccessToken(request.context);
    const namespace = resolveNamespaceFromContext(request.context);
    const limit = clampPollLimit(runtime.secrets[REDDIT_POLL_LIMIT_ENV_KEY]);
    const existingMessages =
      request.trigger.key === "mentions"
        ? await sdk.listMentions({ accessToken, namespace, limit })
        : await sdk.listUnreadMessages({ accessToken, namespace, limit });

    return {
      state: {
        ...state,
        recent_event_ids: [...new Set(existingMessages.map((message) => message.id))].slice(
          0,
          MAX_TRACKED_EVENT_IDS,
        ),
        last_sync_at: nowIso,
        last_error: null,
      },
      subscriptionState: buildSubscriptionState({
        status: AUTOMATION_PROVIDER_TRIGGER_SUBSCRIPTION_STATUS.active,
        activeMode: AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE.polling,
        lastError: null,
        updatedAt: nowIso,
      }),
      events: [],
    };
  };

  const poll = async (
    request: ProviderAutomationTriggerLifecycleRequest,
    runtime: ProviderRuntimeContext,
  ): Promise<ProviderAutomationTriggerLifecycleResult> => {
    const nowIso = runtime.clock.nowIso();
    const state = normalizeState(request.state);

    if (request.activeTriggers.length === 0) {
      return {
        state: {
          ...state,
          last_poll_at: nowIso,
          last_error: null,
        },
        subscriptionState: buildSubscriptionState({
          status: AUTOMATION_PROVIDER_TRIGGER_SUBSCRIPTION_STATUS.inactive,
          activeMode: null,
          lastError: null,
          updatedAt: nowIso,
        }),
        events: [],
      };
    }

    const sdk = createSdk();
    const accessToken = getAccessToken(request.context);
    const namespace = resolveNamespaceFromContext(request.context);
    const limit = clampPollLimit(runtime.secrets[REDDIT_POLL_LIMIT_ENV_KEY]);
    const seenIds = new Set(state.recent_event_ids);

    const messages =
      request.trigger.key === "mentions"
        ? await sdk.listMentions({ accessToken, namespace, limit })
        : await sdk.listUnreadMessages({ accessToken, namespace, limit });

    const nextEvents = messages
      .filter((message) => !seenIds.has(message.id))
      .map((message) =>
        request.trigger.key === "mentions"
          ? normalizeMentionEvent(message)
          : normalizeUnreadInboxEvent(message),
      )
      .reverse();

    return {
      state: {
        ...state,
        recent_event_ids: toNextTrackedEventIds(state.recent_event_ids, nextEvents),
        last_poll_at: nowIso,
        last_error: null,
      },
      subscriptionState: buildSubscriptionState({
        status: AUTOMATION_PROVIDER_TRIGGER_SUBSCRIPTION_STATUS.active,
        activeMode: AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE.polling,
        lastError: null,
        updatedAt: nowIso,
      }),
      events: nextEvents,
    };
  };

  return {
    sync,
    poll,
  };
};

export const createRedditAutomationTriggerLifecycle = (
  createSdk: () => RedditSdkPort,
): ProviderAutomationTriggerLifecycleFacet => createLifecycleFacet(createSdk);

export const automationTriggerLifecycle = createRedditAutomationTriggerLifecycle(() =>
  createRealRedditSdk(),
);
