import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import {
  PROVIDER_METRIC_EVENT_TYPE,
  PROVIDER_METRIC_NAMES,
  PROVIDER_METRIC_OUTCOMES,
  type ProviderMetricName,
  type ProviderMetricOutcome,
} from "../mcp_runtime_shared";
import { randomIdFor, nowIso } from "../_auth";
import { auditActionIdField } from "../audit_shared";
import { canonicalizeStoredProvider, type ProviderId } from "../provider_ids";
import {
  auditActorTypeValidator,
  auditEventTypeValidator,
  jsonRecordValidator,
} from "../validators";

const PROVIDER_METRIC_NAME_SET = new Set<string>(PROVIDER_METRIC_NAMES);
const PROVIDER_METRIC_OUTCOME_SET = new Set<string>(PROVIDER_METRIC_OUTCOMES);

const canonicalizeAuditPayloadProviderFields = (
  payload: Record<string, unknown>,
): Record<string, unknown> => {
  const normalized: Record<string, unknown> = { ...payload };
  for (const key of ["provider", "integration_provider"] as const) {
    const value = normalized[key];
    if (typeof value !== "string") {
      continue;
    }
    const canonical = canonicalizeStoredProvider(value);
    normalized[key] = canonical ?? value;
  }
  return normalized;
};

const asProviderMetricName = (value: unknown): ProviderMetricName | null => {
  if (typeof value !== "string") {
    return null;
  }
  return PROVIDER_METRIC_NAME_SET.has(value) ? (value as ProviderMetricName) : null;
};

const asProviderMetricOutcome = (value: unknown): ProviderMetricOutcome | null => {
  if (typeof value !== "string") {
    return null;
  }
  return PROVIDER_METRIC_OUTCOME_SET.has(value) ? (value as ProviderMetricOutcome) : null;
};

const normalizeProviderMetricValue = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return 1;
};

const toProviderMetricRow = (
  orgId: string,
  payload: Record<string, unknown>,
): {
  org_id: string;
  metric: ProviderMetricName;
  provider: ProviderId | null;
  provider_input: string | null;
  route: string | null;
  outcome: ProviderMetricOutcome | null;
  reason_code: string | null;
  value: number;
} | null => {
  const metric = asProviderMetricName(payload.metric);
  if (!metric) {
    return null;
  }

  const provider =
    typeof payload.provider === "string" ? canonicalizeStoredProvider(payload.provider) : null;

  return {
    org_id: orgId,
    metric,
    provider,
    provider_input: typeof payload.provider_input === "string" ? payload.provider_input : null,
    route: typeof payload.route === "string" ? payload.route : null,
    outcome: asProviderMetricOutcome(payload.outcome),
    reason_code: typeof payload.reason_code === "string" ? payload.reason_code : null,
    value: normalizeProviderMetricValue(payload.value),
  };
};

export const createAuditEvent = internalMutation({
  args: {
    orgId: v.string(),
    actorType: auditActorTypeValidator,
    actorId: v.string(),
    eventType: auditEventTypeValidator,
    payload: jsonRecordValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const payload = canonicalizeAuditPayloadProviderFields(args.payload);
    const createdAt = nowIso();
    await ctx.db.insert("audit_events", {
      id: randomIdFor("audit"),
      org_id: args.orgId,
      ...auditActionIdField(payload),
      actor_type: args.actorType,
      actor_id: args.actorId,
      event_type: args.eventType,
      payload,
      created_at: createdAt,
    });

    if (args.eventType === PROVIDER_METRIC_EVENT_TYPE) {
      const providerMetricRow = toProviderMetricRow(args.orgId, payload);
      if (providerMetricRow) {
        await ctx.db.insert("provider_metrics", {
          id: randomIdFor("pmetric"),
          ...providerMetricRow,
          created_at: createdAt,
        });
      }
    }

    return null;
  },
});
