import { getEnv } from "./env.js";

const PAGERDUTY_EVENTS_API = "https://events.pagerduty.com/v2/enqueue";
const DEFAULT_ALERT_SOURCE = "keppo-web";

export type PagerDutySeverity = "critical" | "error" | "warning" | "info";
export type PagerDutyIncidentState = "active" | "inactive";

type PagerDutyEventAction = "trigger" | "resolve";

type PagerDutyEventPayload = {
  routingKey: string;
  eventAction: PagerDutyEventAction;
  dedupKey: string;
  summary: string;
  source: string;
  severity?: PagerDutySeverity;
  customDetails?: Record<string, unknown>;
};

type PagerDutyNotifyParams = {
  dedupKey: string;
  active: boolean;
  summary: string;
  severity?: PagerDutySeverity;
  source?: string;
  customDetails?: Record<string, unknown>;
};

type PagerDutyNotifyResult = {
  enabled: boolean;
  sent: boolean;
  state: PagerDutyIncidentState;
  action?: PagerDutyEventAction;
};

const activeIncidentDedupKeys = new Set<string>();

const toOptionalString = (value: string | undefined): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const resolveRoutingKey = (): string | undefined => {
  return toOptionalString(getEnv().PAGERDUTY_ROUTING_KEY);
};

const enqueuePagerDutyEvent = async (payload: PagerDutyEventPayload): Promise<void> => {
  const response = await fetch(PAGERDUTY_EVENTS_API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      routing_key: payload.routingKey,
      event_action: payload.eventAction,
      dedup_key: payload.dedupKey,
      payload: {
        summary: payload.summary,
        source: payload.source,
        ...(payload.severity ? { severity: payload.severity } : {}),
        ...(payload.customDetails ? { custom_details: payload.customDetails } : {}),
      },
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `PagerDuty Events API request failed (${response.status}): ${body.slice(0, 400)}`,
    );
  }
};

export const notifyPagerDutyIncident = async (
  params: PagerDutyNotifyParams,
): Promise<PagerDutyNotifyResult> => {
  const routingKey = resolveRoutingKey();
  const targetState: PagerDutyIncidentState = params.active ? "active" : "inactive";
  if (!routingKey) {
    return {
      enabled: false,
      sent: false,
      state: targetState,
    };
  }

  const isCurrentlyActive = activeIncidentDedupKeys.has(params.dedupKey);
  if (params.active && isCurrentlyActive) {
    return { enabled: true, sent: false, state: "active" };
  }
  if (!params.active && !isCurrentlyActive) {
    return { enabled: true, sent: false, state: "inactive" };
  }

  const action: PagerDutyEventAction = params.active ? "trigger" : "resolve";
  await enqueuePagerDutyEvent({
    routingKey,
    eventAction: action,
    dedupKey: params.dedupKey,
    summary: params.summary,
    source: params.source ?? DEFAULT_ALERT_SOURCE,
    ...(params.active ? { severity: params.severity ?? "error" } : {}),
    ...(params.customDetails ? { customDetails: params.customDetails } : {}),
  });

  if (params.active) {
    activeIncidentDedupKeys.add(params.dedupKey);
  } else {
    activeIncidentDedupKeys.delete(params.dedupKey);
  }

  return {
    enabled: true,
    sent: true,
    state: targetState,
    action,
  };
};
