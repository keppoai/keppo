import { v } from "convex/values";
import {
  type ProviderMetricName,
  type ProviderMetricOutcome,
} from "../packages/shared/src/providers/boundaries/types.js";
import { internalQuery } from "./_generated/server";
import {
  PROVIDER_METRIC_NAME,
  PROVIDER_METRIC_OUTCOME,
  PROVIDER_METRIC_ALERT_SEVERITY,
  assertNever,
  type ProviderMetricAlertSeverity,
} from "./domain_constants";
import { type ProviderId } from "./provider_ids";
import { providerMetricAlertSeverityValidator } from "./validators";

type MetricRow = {
  metric: ProviderMetricName;
  provider: ProviderId | null;
  outcome: ProviderMetricOutcome | null;
  count: number;
};

type RateRow = {
  metric:
    | typeof PROVIDER_METRIC_NAME.oauthConnect
    | typeof PROVIDER_METRIC_NAME.oauthCallback
    | typeof PROVIDER_METRIC_NAME.webhookVerify;
  provider: ProviderId;
  attempts: number;
  successes: number;
  failures: number;
  rate: number;
};

const countMetric = (
  rows: MetricRow[],
  metric: ProviderMetricName,
  outcome: ProviderMetricOutcome,
  provider?: ProviderId,
): number => {
  return rows
    .filter((row) => {
      if (row.metric !== metric || row.outcome !== outcome) {
        return false;
      }
      if (provider !== undefined) {
        return row.provider === provider;
      }
      return true;
    })
    .reduce((sum, row) => sum + row.count, 0);
};

const uniqueProviders = (rows: MetricRow[]): ProviderId[] => {
  return [
    ...new Set(
      rows.map((row) => row.provider).filter((value): value is ProviderId => value !== null),
    ),
  ].sort();
};

export const rollupProviderMetrics = internalQuery({
  args: {
    windowMinutes: v.optional(v.number()),
    resolutionFailureSpike: v.optional(v.number()),
    unknownProviderSpike: v.optional(v.number()),
    nonCanonicalSpike: v.optional(v.number()),
    capabilityMismatchSpike: v.optional(v.number()),
    connectSuccessRateMin: v.optional(v.number()),
    callbackSuccessRateMin: v.optional(v.number()),
    webhookVerifyFailureRateMax: v.optional(v.number()),
    minSampleSize: v.optional(v.number()),
  },
  returns: v.object({
    generated_at: v.string(),
    window_minutes: v.number(),
    window_start_at: v.string(),
    total_events: v.number(),
    counts: v.array(
      v.object({
        metric: v.string(),
        provider: v.union(v.string(), v.null()),
        outcome: v.union(v.string(), v.null()),
        count: v.number(),
      }),
    ),
    rates: v.array(
      v.object({
        metric: v.string(),
        provider: v.string(),
        attempts: v.number(),
        successes: v.number(),
        failures: v.number(),
        rate: v.number(),
      }),
    ),
    alert_breaches: v.array(
      v.object({
        code: v.string(),
        message: v.string(),
        severity: providerMetricAlertSeverityValidator,
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const windowMinutes = Math.max(1, Math.floor(args.windowMinutes ?? 15));
    const now = Date.now();
    const windowStartAt = new Date(now - windowMinutes * 60_000).toISOString();

    const resolutionFailureSpike = Math.max(1, Math.floor(args.resolutionFailureSpike ?? 20));
    const unknownProviderSpike = Math.max(1, Math.floor(args.unknownProviderSpike ?? 10));
    const nonCanonicalSpike = Math.max(1, Math.floor(args.nonCanonicalSpike ?? 10));
    const capabilityMismatchSpike = Math.max(1, Math.floor(args.capabilityMismatchSpike ?? 10));
    const connectSuccessRateMin = args.connectSuccessRateMin ?? 0.99;
    const callbackSuccessRateMin = args.callbackSuccessRateMin ?? 0.99;
    const webhookVerifyFailureRateMax = args.webhookVerifyFailureRateMax ?? 0.01;
    const minSampleSize = Math.max(1, Math.floor(args.minSampleSize ?? 20));

    const metricEvents = await ctx.db
      .query("provider_metrics")
      .withIndex("by_created", (q) => q.gte("created_at", windowStartAt))
      .collect();

    const countByKey = new Map<string, number>();
    for (const event of metricEvents) {
      const metric = event.metric;
      const outcome = event.outcome;
      const provider = event.provider;
      const value =
        typeof event.value === "number" && Number.isFinite(event.value) && event.value > 0
          ? Math.floor(event.value)
          : 1;

      const key = `${metric}|${provider ?? "_"}|${outcome ?? "_"}`;
      countByKey.set(key, (countByKey.get(key) ?? 0) + value);
    }

    const counts: MetricRow[] = [...countByKey.entries()]
      .map(([key, count]) => {
        const [metric, provider, outcome] = key.split("|");
        return {
          metric: metric as ProviderMetricName,
          provider: provider === "_" ? null : (provider as ProviderId),
          outcome: outcome === "_" ? null : (outcome as ProviderMetricOutcome),
          count,
        };
      })
      .sort((left, right) => {
        if (left.metric !== right.metric) {
          return left.metric.localeCompare(right.metric);
        }
        if ((left.provider ?? "") !== (right.provider ?? "")) {
          return (left.provider ?? "").localeCompare(right.provider ?? "");
        }
        return (left.outcome ?? "").localeCompare(right.outcome ?? "");
      });

    const rates: RateRow[] = [];
    for (const provider of uniqueProviders(counts)) {
      const connectAttempts = countMetric(
        counts,
        PROVIDER_METRIC_NAME.oauthConnect,
        PROVIDER_METRIC_OUTCOME.attempt,
        provider,
      );
      const connectSuccesses = countMetric(
        counts,
        PROVIDER_METRIC_NAME.oauthConnect,
        PROVIDER_METRIC_OUTCOME.success,
        provider,
      );
      if (connectAttempts > 0) {
        rates.push({
          metric: PROVIDER_METRIC_NAME.oauthConnect,
          provider,
          attempts: connectAttempts,
          successes: connectSuccesses,
          failures: Math.max(0, connectAttempts - connectSuccesses),
          rate: connectSuccesses / connectAttempts,
        });
      }

      const callbackAttempts = countMetric(
        counts,
        PROVIDER_METRIC_NAME.oauthCallback,
        PROVIDER_METRIC_OUTCOME.attempt,
        provider,
      );
      const callbackSuccesses = countMetric(
        counts,
        PROVIDER_METRIC_NAME.oauthCallback,
        PROVIDER_METRIC_OUTCOME.success,
        provider,
      );
      if (callbackAttempts > 0) {
        rates.push({
          metric: PROVIDER_METRIC_NAME.oauthCallback,
          provider,
          attempts: callbackAttempts,
          successes: callbackSuccesses,
          failures: Math.max(0, callbackAttempts - callbackSuccesses),
          rate: callbackSuccesses / callbackAttempts,
        });
      }

      const webhookAttempts = countMetric(
        counts,
        PROVIDER_METRIC_NAME.webhookVerify,
        PROVIDER_METRIC_OUTCOME.attempt,
        provider,
      );
      const webhookFailures = countMetric(
        counts,
        PROVIDER_METRIC_NAME.webhookVerify,
        PROVIDER_METRIC_OUTCOME.failure,
        provider,
      );
      const webhookSuccesses = countMetric(
        counts,
        PROVIDER_METRIC_NAME.webhookVerify,
        PROVIDER_METRIC_OUTCOME.success,
        provider,
      );
      if (webhookAttempts > 0) {
        rates.push({
          metric: PROVIDER_METRIC_NAME.webhookVerify,
          provider,
          attempts: webhookAttempts,
          successes: webhookSuccesses,
          failures: webhookFailures,
          rate: webhookFailures / webhookAttempts,
        });
      }
    }

    const alertBreaches: Array<{
      code: string;
      message: string;
      severity: ProviderMetricAlertSeverity;
    }> = [];

    const resolutionFailures = countMetric(
      counts,
      PROVIDER_METRIC_NAME.providerResolutionFailure,
      PROVIDER_METRIC_OUTCOME.failure,
    );
    if (resolutionFailures >= resolutionFailureSpike) {
      alertBreaches.push({
        code: "provider_resolution_failure_spike",
        severity: PROVIDER_METRIC_ALERT_SEVERITY.warning,
        message: `Provider resolution failures ${String(resolutionFailures)} >= ${String(resolutionFailureSpike)} in ${String(windowMinutes)}m window.`,
      });
    }

    const unknownProviderRequests = countMetric(
      counts,
      PROVIDER_METRIC_NAME.unknownProviderRequest,
      PROVIDER_METRIC_OUTCOME.rejected,
    );
    if (unknownProviderRequests >= unknownProviderSpike) {
      alertBreaches.push({
        code: "unknown_provider_request_spike",
        severity: PROVIDER_METRIC_ALERT_SEVERITY.warning,
        message: `Unknown provider requests ${String(unknownProviderRequests)} >= ${String(unknownProviderSpike)} in ${String(windowMinutes)}m window.`,
      });
    }

    const nonCanonicalRejections = countMetric(
      counts,
      PROVIDER_METRIC_NAME.nonCanonicalProviderRejection,
      PROVIDER_METRIC_OUTCOME.rejected,
    );
    if (nonCanonicalRejections >= nonCanonicalSpike) {
      alertBreaches.push({
        code: "non_canonical_provider_rejection_spike",
        severity: PROVIDER_METRIC_ALERT_SEVERITY.warning,
        message: `Non-canonical provider rejections ${String(nonCanonicalRejections)} >= ${String(nonCanonicalSpike)} in ${String(windowMinutes)}m window.`,
      });
    }

    const capabilityMismatchBlocks = countMetric(
      counts,
      PROVIDER_METRIC_NAME.capabilityMismatchBlock,
      PROVIDER_METRIC_OUTCOME.blocked,
    );
    if (capabilityMismatchBlocks >= capabilityMismatchSpike) {
      alertBreaches.push({
        code: "capability_mismatch_block_spike",
        severity: PROVIDER_METRIC_ALERT_SEVERITY.warning,
        message: `Capability mismatch blocks ${String(capabilityMismatchBlocks)} >= ${String(capabilityMismatchSpike)} in ${String(windowMinutes)}m window.`,
      });
    }

    for (const rate of rates) {
      switch (rate.metric) {
        case PROVIDER_METRIC_NAME.oauthConnect:
          if (rate.attempts >= minSampleSize && rate.rate < connectSuccessRateMin) {
            alertBreaches.push({
              code: `oauth_connect_success_rate_low:${rate.provider}`,
              severity: PROVIDER_METRIC_ALERT_SEVERITY.critical,
              message: `OAuth connect success rate for ${rate.provider} is ${(rate.rate * 100).toFixed(2)}% with ${String(rate.attempts)} attempts (min ${(connectSuccessRateMin * 100).toFixed(2)}%).`,
            });
          }
          break;
        case PROVIDER_METRIC_NAME.oauthCallback:
          if (rate.attempts >= minSampleSize && rate.rate < callbackSuccessRateMin) {
            alertBreaches.push({
              code: `oauth_callback_success_rate_low:${rate.provider}`,
              severity: PROVIDER_METRIC_ALERT_SEVERITY.critical,
              message: `OAuth callback success rate for ${rate.provider} is ${(rate.rate * 100).toFixed(2)}% with ${String(rate.attempts)} attempts (min ${(callbackSuccessRateMin * 100).toFixed(2)}%).`,
            });
          }
          break;
        case PROVIDER_METRIC_NAME.webhookVerify:
          if (rate.attempts >= minSampleSize && rate.rate > webhookVerifyFailureRateMax) {
            alertBreaches.push({
              code: `webhook_verify_failure_rate_high:${rate.provider}`,
              severity: PROVIDER_METRIC_ALERT_SEVERITY.critical,
              message: `Webhook verify failure rate for ${rate.provider} is ${(rate.rate * 100).toFixed(2)}% with ${String(rate.attempts)} attempts (max ${(webhookVerifyFailureRateMax * 100).toFixed(2)}%).`,
            });
          }
          break;
        default:
          assertNever(rate.metric, "provider metric rate key");
      }
    }

    return {
      generated_at: new Date(now).toISOString(),
      window_minutes: windowMinutes,
      window_start_at: windowStartAt,
      total_events: metricEvents.length,
      counts,
      rates,
      alert_breaches: alertBreaches,
    };
  },
});
