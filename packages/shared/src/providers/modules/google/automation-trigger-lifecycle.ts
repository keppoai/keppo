import {
  AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE,
  AUTOMATION_PROVIDER_TRIGGER_SUBSCRIPTION_STATUS,
  type AutomationProviderTriggerDeliveryMode,
} from "../../../automations.js";
import type {
  GmailHistoryRecord,
  GmailMessage,
  GmailSdkPort,
} from "../../../provider-sdk/google/types.js";
import type { ProviderRuntimeContext } from "../../../providers.js";
import { createRealGmailSdk } from "../../../provider-sdk/google/real.js";
import type {
  ProviderAutomationTriggerLifecycleEvent,
  ProviderAutomationTriggerLifecycleFacet,
  ProviderAutomationTriggerLifecycleRequest,
  ProviderAutomationTriggerLifecycleResult,
} from "../../registry/types.js";
import { resolveNamespaceFromContext } from "../_shared/connector_helpers.js";
import { gmailIncomingEmailTriggerEventSchema } from "./schemas.js";

type GoogleIncomingEmailLifecycleState = {
  version: 1;
  active_mode: AutomationProviderTriggerDeliveryMode | null;
  watch_topic_name: string | null;
  watch_expiration: string | null;
  history_cursor: string | null;
  last_sync_at: string | null;
  last_poll_at: string | null;
  last_error: string | null;
};

const GOOGLE_WATCH_TOPIC_ENV_KEY = "GOOGLE_GMAIL_WATCH_TOPIC_NAME";
const GOOGLE_POLL_LIMIT_ENV_KEY = "GOOGLE_GMAIL_POLL_LIMIT";
const DEFAULT_POLL_LIMIT = 25;
const MAX_POLL_LIMIT = 100;
const WATCH_RENEWAL_WINDOW_MS = 60 * 60 * 1000;
const TRIGGER_EVENT_TYPE = "google.gmail.incoming_email";

const requiredTokenMessage = "Gmail access token missing. Reconnect Gmail integration.";

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

const normalizeState = (value: Record<string, unknown>): GoogleIncomingEmailLifecycleState => {
  const activeMode = normalizeString(value.active_mode);
  return {
    version: 1,
    active_mode: activeMode === "webhook" || activeMode === "polling" ? activeMode : null,
    watch_topic_name: normalizeString(value.watch_topic_name),
    watch_expiration: normalizeString(value.watch_expiration),
    history_cursor: normalizeString(value.history_cursor),
    last_sync_at: normalizeString(value.last_sync_at),
    last_poll_at: normalizeString(value.last_poll_at),
    last_error: normalizeString(value.last_error),
  };
};

const parseDate = (value: string | null): number | null => {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toIsoString = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (/^\d+$/.test(trimmed)) {
    const asNumber = Number.parseInt(trimmed, 10);
    if (Number.isFinite(asNumber)) {
      return new Date(asNumber).toISOString();
    }
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
};

const getHeaderValue = (
  headers: Array<{ name?: string | null; value?: string | null }> | undefined,
  name: string,
): string => {
  return (
    headers?.find((header) => (header.name ?? "").toLowerCase() === name.toLowerCase())?.value ?? ""
  );
};

const splitRecipients = (value: string): string[] => {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

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

const isWatchExpiringSoon = (expiration: string | null, now: number): boolean => {
  const parsed = parseDate(expiration);
  if (parsed === null) {
    return true;
  }
  return parsed - now <= WATCH_RENEWAL_WINDOW_MS;
};

const isIncomingMessage = (message: GmailMessage): boolean => {
  const labels = new Set(Array.isArray(message.labelIds) ? message.labelIds : []);
  return !labels.has("SENT") && !labels.has("DRAFT");
};

const collectMessageIds = (history: Array<GmailHistoryRecord>): string[] => {
  const seen = new Set<string>();
  const ids: string[] = [];

  for (const record of history) {
    const messagesAdded = Array.isArray(record.messagesAdded)
      ? record.messagesAdded
          .map((entry) => entry?.message?.id ?? "")
          .filter((id) => typeof id === "string" && id.length > 0)
      : [];
    const fallbackMessages = Array.isArray(record.messages)
      ? record.messages
          .map((entry) => entry?.id ?? "")
          .filter((id) => typeof id === "string" && id.length > 0)
      : [];

    for (const messageId of messagesAdded.length > 0 ? messagesAdded : fallbackMessages) {
      if (seen.has(messageId)) {
        continue;
      }
      seen.add(messageId);
      ids.push(messageId);
    }
  }

  return ids;
};

const listAllHistoryPages = async (params: {
  sdk: GmailSdkPort;
  accessToken: string;
  namespace: string | undefined;
  startHistoryId: string;
  maxResults: number;
}): Promise<{ history: GmailHistoryRecord[]; historyId: string | null }> => {
  const history: GmailHistoryRecord[] = [];
  let historyId: string | null = null;
  let pageToken: string | undefined;

  do {
    const response = await params.sdk.listHistory({
      accessToken: params.accessToken,
      namespace: params.namespace,
      startHistoryId: params.startHistoryId,
      maxResults: params.maxResults,
      historyTypes: ["messageAdded"],
      labelId: "INBOX",
      ...(pageToken ? { pageToken } : {}),
    });
    history.push(...(response.history ?? []));
    historyId = response.historyId ?? historyId;
    pageToken = response.nextPageToken ?? undefined;
  } while (pageToken);

  return {
    history,
    historyId,
  };
};

const normalizeIncomingEmailEvent = (
  message: GmailMessage,
): ProviderAutomationTriggerLifecycleEvent => {
  const headers = message.payload?.headers;
  const eventPayload = {
    delivery_id: `google.gmail.message.${message.id ?? ""}`,
    event_type: TRIGGER_EVENT_TYPE,
    history_id: message.historyId ?? "",
    message: {
      id: message.id ?? "",
      thread_id: message.threadId ?? "",
      from: getHeaderValue(headers, "From"),
      to: splitRecipients(getHeaderValue(headers, "To")),
      subject: getHeaderValue(headers, "Subject"),
      label_ids: Array.isArray(message.labelIds) ? message.labelIds : [],
      snippet: message.snippet ?? "",
      internal_date: message.internalDate ?? "",
    },
  };
  const parsed = gmailIncomingEmailTriggerEventSchema.parse(eventPayload);
  return {
    triggerKey: "incoming_email",
    providerEventId: parsed.message.id,
    providerEventType: parsed.event_type,
    deliveryMode: AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE.polling,
    eventPayload: parsed as Record<string, unknown>,
    eventPayloadRef: parsed.delivery_id,
  };
};

const createLifecycleFacet = (
  createSdk: () => GmailSdkPort,
): ProviderAutomationTriggerLifecycleFacet => {
  const sync = async (
    request: ProviderAutomationTriggerLifecycleRequest,
    runtime: ProviderRuntimeContext,
  ): Promise<ProviderAutomationTriggerLifecycleResult> => {
    const nowIso = runtime.clock.nowIso();
    const now = runtime.clock.now();
    const state = normalizeState(request.state);
    const baseState: GoogleIncomingEmailLifecycleState = {
      ...state,
      last_sync_at: nowIso,
    };

    if (request.activeTriggers.length === 0) {
      if (state.active_mode === AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE.webhook) {
        const sdk = createSdk();
        await sdk.stopWatch({
          accessToken: getAccessToken(request.context),
          namespace: resolveNamespaceFromContext(request.context),
          idempotencyKey: `google_incoming_email_stop_${request.context.orgId}`,
        });
      }

      return {
        state: {
          ...baseState,
          active_mode: null,
          watch_topic_name: null,
          watch_expiration: null,
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
    const watchTopicName = normalizeString(runtime.secrets[GOOGLE_WATCH_TOPIC_ENV_KEY]);
    let nextState: GoogleIncomingEmailLifecycleState = {
      ...baseState,
      watch_topic_name: watchTopicName,
      active_mode: watchTopicName
        ? AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE.webhook
        : AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE.polling,
      last_error: null,
    };
    let subscriptionStatus: ProviderAutomationTriggerLifecycleResult["subscriptionState"]["status"] =
      AUTOMATION_PROVIDER_TRIGGER_SUBSCRIPTION_STATUS.active;

    if (watchTopicName && isWatchExpiringSoon(state.watch_expiration, now)) {
      try {
        const watchResponse = await sdk.watch({
          accessToken,
          namespace,
          topicName: watchTopicName,
          labelIds: ["INBOX"],
          labelFilterBehavior: "include",
          idempotencyKey: `google_incoming_email_watch_${request.context.orgId}`,
        });
        nextState = {
          ...nextState,
          watch_expiration: toIsoString(watchResponse.expiration ?? null),
          ...(watchResponse.historyId ? { history_cursor: watchResponse.historyId } : {}),
        };
      } catch (error) {
        nextState = {
          ...nextState,
          active_mode: AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE.polling,
          last_error:
            error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
        };
        subscriptionStatus = AUTOMATION_PROVIDER_TRIGGER_SUBSCRIPTION_STATUS.degraded;
      }
    }

    if (!nextState.history_cursor) {
      const profile = await sdk.getProfile({
        accessToken,
        namespace,
      });
      nextState = {
        ...nextState,
        history_cursor: profile.historyId ?? null,
      };
    }

    return {
      state: nextState,
      subscriptionState: buildSubscriptionState({
        status: subscriptionStatus,
        activeMode: nextState.active_mode,
        lastError: nextState.last_error,
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
    const sdk = createSdk();
    const accessToken = getAccessToken(request.context);
    const namespace = resolveNamespaceFromContext(request.context);

    if (request.activeTriggers.length === 0) {
      return {
        state: {
          ...state,
          last_poll_at: nowIso,
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

    if (!state.history_cursor) {
      const profile = await sdk.getProfile({
        accessToken,
        namespace,
      });
      const nextState = {
        ...state,
        history_cursor: profile.historyId ?? null,
        last_poll_at: nowIso,
      };
      return {
        state: nextState,
        subscriptionState: buildSubscriptionState({
          status: AUTOMATION_PROVIDER_TRIGGER_SUBSCRIPTION_STATUS.active,
          activeMode: state.active_mode ?? AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE.polling,
          lastError: state.last_error,
          updatedAt: nowIso,
        }),
        events: [],
      };
    }

    const historyResponse = await listAllHistoryPages({
      sdk,
      accessToken,
      namespace,
      startHistoryId: state.history_cursor,
      maxResults: clampPollLimit(runtime.secrets[GOOGLE_POLL_LIMIT_ENV_KEY]),
    });

    const messageIds = collectMessageIds(historyResponse.history ?? []);
    const events: Array<ProviderAutomationTriggerLifecycleEvent> = [];
    for (const messageId of messageIds) {
      const message = await sdk.getMessage({
        accessToken,
        namespace,
        messageId,
        format: "metadata",
        metadataHeaders: ["From", "To", "Subject"],
      });
      if (!isIncomingMessage(message)) {
        continue;
      }
      const event = normalizeIncomingEmailEvent(message);
      events.push({
        ...event,
        deliveryMode:
          state.active_mode === AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE.webhook
            ? AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE.webhook
            : AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE.polling,
      });
    }

    const nextState: GoogleIncomingEmailLifecycleState = {
      ...state,
      history_cursor: historyResponse.historyId ?? state.history_cursor,
      last_poll_at: nowIso,
      last_error: null,
    };

    return {
      state: nextState,
      subscriptionState: buildSubscriptionState({
        status: AUTOMATION_PROVIDER_TRIGGER_SUBSCRIPTION_STATUS.active,
        activeMode: nextState.active_mode ?? AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE.polling,
        lastError: null,
        updatedAt: nowIso,
      }),
      events,
    };
  };

  return {
    sync,
    poll,
  };
};

export const createGoogleAutomationTriggerLifecycle = (
  createSdk: () => GmailSdkPort = createRealGmailSdk,
) => createLifecycleFacet(createSdk);

export const automationTriggerLifecycle = createGoogleAutomationTriggerLifecycle();
