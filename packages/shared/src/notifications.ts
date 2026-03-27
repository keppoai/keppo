export const USAGE_WARNING_THRESHOLD = 0.8;

export const NOTIFICATION_EVENTS = {
  approval_needed: {
    title: "Approval needed",
    body: "{toolName} in {workspaceName} is waiting for approval ({riskLevel} risk).",
    ctaLabel: "Review & Approve",
    ctaUrl: "/approvals",
    channels: ["email", "push", "in_app"],
  },
  tool_call_limit_warning: {
    title: "Tool call usage warning",
    body: "{orgName} has used {currentCount} of {limit} monthly tool calls.",
    ctaLabel: "View Usage",
    ctaUrl: "/billing",
    channels: ["email", "in_app"],
  },
  tool_call_limit_reached: {
    title: "Tool call limit reached",
    body: "{orgName} reached the monthly tool call limit ({limit}).",
    ctaLabel: "Upgrade Plan",
    ctaUrl: "/billing",
    channels: ["email", "push", "in_app"],
  },
  tool_time_limit_warning: {
    title: "Tool runtime usage warning",
    body: "{orgName} has used {currentTotalMs}ms of {limitMs}ms monthly runtime budget.",
    ctaLabel: "View Usage",
    ctaUrl: "/billing",
    channels: ["email", "in_app"],
  },
  tool_time_limit_reached: {
    title: "Tool runtime limit reached",
    body: "{orgName} reached the monthly runtime budget ({limitMs}ms).",
    ctaLabel: "Upgrade Plan",
    ctaUrl: "/billing",
    channels: ["email", "push", "in_app"],
  },
  subscription_past_due: {
    title: "Payment failed",
    body: "We could not process the latest payment for {orgName}. Update billing details to avoid service disruption.",
    ctaLabel: "Update Payment",
    ctaUrl: "/billing",
    channels: ["email", "push", "in_app"],
  },
  subscription_downgraded: {
    title: "Subscription downgraded",
    body: "{orgName} was downgraded to the Free plan.",
    ctaLabel: "Resubscribe",
    ctaUrl: "/billing",
    channels: ["email", "in_app"],
  },
  automation_run_failed: {
    title: "Automation run failed",
    body: "{automationName} run {automationRunId} failed with status {status}.",
    ctaLabel: "View Run",
    ctaUrl: "/automations/{automationId}",
    channels: ["email", "push", "in_app"],
  },
  automation_run_limit_reached: {
    title: "Automation run limit reached",
    body: "{orgName} reached the billing-period automation run limit ({maxCount}).",
    ctaLabel: "View Billing",
    ctaUrl: "/billing",
    channels: ["in_app"],
  },
  ai_credit_limit_reached: {
    title: "AI credits exhausted",
    body: "{orgName} has no AI generation credits remaining.",
    ctaLabel: "Buy Credits",
    ctaUrl: "/billing",
    channels: ["in_app"],
  },
  ai_credits_expiring: {
    title: "AI credits expiring soon",
    body: "{orgName} has purchased AI credits expiring within 7 days.",
    ctaLabel: "View Billing",
    ctaUrl: "/billing",
    channels: ["in_app"],
  },
  automation_run_topups_expiring: {
    title: "Automation run top-up expiring soon",
    body: "{orgName} has purchased automation runs expiring within 7 days.",
    ctaLabel: "View Billing",
    ctaUrl: "/billing",
    channels: ["in_app"],
  },
} as const;

export type NotificationEventId = keyof typeof NOTIFICATION_EVENTS;
export const NOTIFICATION_EVENT_ID = {
  approvalNeeded: "approval_needed",
  toolCallLimitWarning: "tool_call_limit_warning",
  toolCallLimitReached: "tool_call_limit_reached",
  toolTimeLimitWarning: "tool_time_limit_warning",
  toolTimeLimitReached: "tool_time_limit_reached",
  subscriptionPastDue: "subscription_past_due",
  subscriptionDowngraded: "subscription_downgraded",
  automationRunFailed: "automation_run_failed",
  automationRunLimitReached: "automation_run_limit_reached",
  aiCreditLimitReached: "ai_credit_limit_reached",
  aiCreditsExpiring: "ai_credits_expiring",
  automationRunTopupsExpiring: "automation_run_topups_expiring",
} as const satisfies Record<string, NotificationEventId>;
export type NotificationChannel = "email" | "push" | "in_app";
export type NotificationEndpointType = "email" | "push" | "webhook";

export type NotificationPayload = {
  eventId: NotificationEventId;
  orgId: string;
  orgName: string;
  title: string;
  body: string;
  ctaUrl: string;
  ctaLabel: string;
  metadata: Record<string, string>;
};

type NotificationContext = {
  orgId: string;
  orgName?: string;
  title?: string;
  body?: string;
  ctaUrl?: string;
  ctaLabel?: string;
  metadata?: Record<string, unknown>;
} & Record<string, unknown>;

const stringifyContextValue = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (value === null || value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const interpolate = (template: string, context: Record<string, string>): string => {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_whole, key: string) => {
    return context[key] ?? "";
  });
};

export const buildNotificationPayload = (
  eventId: NotificationEventId,
  context: NotificationContext,
): NotificationPayload => {
  const config = NOTIFICATION_EVENTS[eventId];
  const stringContext: Record<string, string> = {
    eventId,
  };
  for (const [key, value] of Object.entries(context)) {
    if (key === "metadata") {
      continue;
    }
    stringContext[key] = stringifyContextValue(value);
  }

  const metadata: Record<string, string> = context.metadata
    ? Object.fromEntries(
        Object.entries(context.metadata).map(([key, value]) => [key, stringifyContextValue(value)]),
      )
    : {};

  return {
    eventId,
    orgId: context.orgId,
    orgName: context.orgName ?? context.orgId,
    title: context.title ?? interpolate(config.title, stringContext),
    body: context.body ?? interpolate(config.body, stringContext),
    ctaUrl: context.ctaUrl ?? interpolate(config.ctaUrl, stringContext),
    ctaLabel: context.ctaLabel ?? interpolate(config.ctaLabel, stringContext),
    metadata,
  };
};

export const getDefaultChannels = (eventId: NotificationEventId): NotificationChannel[] => {
  return [...NOTIFICATION_EVENTS[eventId].channels];
};
