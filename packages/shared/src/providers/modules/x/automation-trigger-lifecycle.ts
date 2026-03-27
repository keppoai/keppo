import {
  AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE,
  AUTOMATION_PROVIDER_TRIGGER_SUBSCRIPTION_STATUS,
  type AutomationProviderTriggerDeliveryMode,
} from "../../../automations.js";
import type { XPost, XSdkPort } from "../../../provider-sdk/x/types.js";
import type { ProviderRuntimeContext } from "../../../providers.js";
import { createRealXSdk } from "../../../provider-sdk/x/real.js";
import type {
  ProviderAutomationTriggerLifecycleEvent,
  ProviderAutomationTriggerLifecycleFacet,
  ProviderAutomationTriggerLifecycleRequest,
  ProviderAutomationTriggerLifecycleResult,
} from "../../registry/types.js";
import { resolveNamespaceFromContext } from "../_shared/connector_helpers.js";
import { xMentionTriggerEventSchema } from "./schemas.js";

type XMentionsLifecycleState = {
  version: 1;
  user_id: string | null;
  recent_post_ids: string[];
  last_sync_at: string | null;
  last_poll_at: string | null;
  last_error: string | null;
};

const X_POLL_LIMIT_ENV_KEY = "X_AUTOMATION_TRIGGER_POLL_LIMIT";
const DEFAULT_POLL_LIMIT = 50;
const MAX_POLL_LIMIT = 100;
const MAX_TRACKED_POST_IDS = 250;

const requiredTokenMessage = "X access token missing. Reconnect X integration.";

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

const normalizeState = (value: Record<string, unknown>): XMentionsLifecycleState => ({
  version: 1,
  user_id: normalizeString(value.user_id),
  recent_post_ids: normalizeStringArray(value.recent_post_ids).slice(0, MAX_TRACKED_POST_IDS),
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

const toNextTrackedPostIds = (
  current: string[],
  nextEvents: ProviderAutomationTriggerLifecycleEvent[],
): string[] => {
  const merged = [...nextEvents.map((event) => event.providerEventId), ...current];
  return [...new Set(merged)].slice(0, MAX_TRACKED_POST_IDS);
};

const normalizeMentionEvent = (post: XPost): ProviderAutomationTriggerLifecycleEvent => {
  const parsed = xMentionTriggerEventSchema.parse({
    delivery_id: `x.mention.${post.id}`,
    event_type: "x.mentions.post",
    mention: {
      id: post.id,
      text: post.text,
      ...(typeof post.authorId === "string" ? { author_id: post.authorId } : {}),
      ...(typeof post.createdAt === "string" ? { created_at: post.createdAt } : {}),
    },
  });

  return {
    triggerKey: "mentions",
    providerEventId: parsed.mention.id,
    providerEventType: parsed.event_type,
    deliveryMode: AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE.polling,
    eventPayload: parsed as Record<string, unknown>,
    eventPayloadRef: parsed.delivery_id,
  };
};

const resolveUserId = async (params: {
  sdk: XSdkPort;
  accessToken: string;
  namespace: string | undefined;
  contextExternalAccountId: string | null | undefined;
  stateUserId: string | null;
}): Promise<string> => {
  if (params.stateUserId) {
    return params.stateUserId;
  }
  if (params.contextExternalAccountId) {
    return params.contextExternalAccountId;
  }
  const me = await params.sdk.getMe({
    accessToken: params.accessToken,
    namespace: params.namespace,
  });
  return me.id;
};

const createLifecycleFacet = (
  createSdk: () => XSdkPort,
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

    const sdk = createSdk();
    const accessToken = getAccessToken(request.context);
    const namespace = resolveNamespaceFromContext(request.context);
    const userId = await resolveUserId({
      sdk,
      accessToken,
      namespace,
      contextExternalAccountId: request.context.external_account_id,
      stateUserId: state.user_id,
    });

    if (state.last_sync_at) {
      return {
        state: {
          ...state,
          user_id: userId,
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

    const limit = clampPollLimit(runtime.secrets[X_POLL_LIMIT_ENV_KEY]);
    const existingPosts = await sdk.getUserMentions({
      accessToken,
      namespace,
      userId,
      maxResults: limit,
    });

    return {
      state: {
        ...state,
        user_id: userId,
        recent_post_ids: [...new Set(existingPosts.map((post) => post.id))].slice(
          0,
          MAX_TRACKED_POST_IDS,
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
    const userId = await resolveUserId({
      sdk,
      accessToken,
      namespace,
      contextExternalAccountId: request.context.external_account_id,
      stateUserId: state.user_id,
    });
    const limit = clampPollLimit(runtime.secrets[X_POLL_LIMIT_ENV_KEY]);
    const seenPostIds = new Set(state.recent_post_ids);

    const posts = await sdk.getUserMentions({
      accessToken,
      namespace,
      userId,
      maxResults: limit,
    });

    const nextEvents = posts
      .filter((post) => !seenPostIds.has(post.id))
      .map((post) => normalizeMentionEvent(post))
      .reverse();

    return {
      state: {
        ...state,
        user_id: userId,
        recent_post_ids: toNextTrackedPostIds(state.recent_post_ids, nextEvents),
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

export const createXAutomationTriggerLifecycle = (
  createSdk: () => XSdkPort,
): ProviderAutomationTriggerLifecycleFacet => createLifecycleFacet(createSdk);

export const automationTriggerLifecycle = createXAutomationTriggerLifecycle(() => createRealXSdk());
