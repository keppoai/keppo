import { listProviderCircuitBreakerStates } from "@keppo/shared/circuit-breaker";
import { CRON_HEALTH_STATUS } from "@keppo/shared/domain";
import { isLocalAdminBypassEnabled } from "@keppo/shared/local-admin-bypass";
import { ConvexInternalClient, fireAndForgetWithDlq } from "./api-runtime/convex.ts";
import { getEnv } from "./api-runtime/env.ts";
import { logger } from "./api-runtime/logger.ts";
import { notifyPagerDutyIncident } from "./api-runtime/pagerduty.ts";
import { createQueueClient, type QueueClient } from "./api-runtime/queue.ts";

export const CIRCUIT_BREAKER_OPEN_ALERT_THRESHOLD = 2;

export type DeepHealthSubsystem =
  | {
      name: string;
      status: "up" | "down";
      critical: boolean;
      responseTimeMs: number;
      [key: string]: unknown;
    }
  | Record<string, unknown>;

export type DeepHealthReport = {
  ok: boolean;
  status: "ok" | "degraded";
  checkedAt: string;
  responseTimeMs: number;
  subsystems: DeepHealthSubsystem[];
};

export type StartOwnedHealthConvex = Pick<
  ConvexInternalClient,
  | "abandonDeadLetter"
  | "checkCronHealth"
  | "enqueueDeadLetter"
  | "listPendingDeadLetters"
  | "probeConvexHealth"
  | "replayDeadLetter"
  | "summarizeRateLimitHealth"
>;

type StartOwnedHealthReadConvex = Omit<StartOwnedHealthConvex, "enqueueDeadLetter">;

export type StartOwnedHealthRuntimeDeps = {
  convex: StartOwnedHealthConvex;
  getEnv: typeof getEnv;
  logger: Pick<typeof logger, "warn">;
  notifyPagerDutyIncident: typeof notifyPagerDutyIncident;
  queueClient: QueueClient;
};

let convexClient: ConvexInternalClient | null = null;
let queueClient: QueueClient | null = null;

export const getDefaultStartOwnedHealthRuntimeDeps = (): StartOwnedHealthRuntimeDeps => {
  const convex = (convexClient ??= new ConvexInternalClient());

  return {
    convex,
    getEnv,
    logger,
    notifyPagerDutyIncident,
    queueClient: (queueClient ??= createQueueClient(convex)),
  };
};

export const resolveAdminUserIds = (rawValue: string | undefined): Set<string> => {
  const raw = rawValue ?? "";
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );
};

export const canAccessAdminHealthRoutes = (
  userId: string,
  deps: Pick<StartOwnedHealthRuntimeDeps, "getEnv">,
): boolean => {
  const env = deps.getEnv();
  const adminUserIds = resolveAdminUserIds(env.KEPPO_ADMIN_USER_IDS);
  const localAdminBypassEnabled = isLocalAdminBypassEnabled({
    KEPPO_LOCAL_ADMIN_BYPASS: env.KEPPO_LOCAL_ADMIN_BYPASS,
    NODE_ENV: env.NODE_ENV,
    KEPPO_URL: env.KEPPO_URL,
    CONVEX_URL: env.CONVEX_URL,
  } as unknown as Parameters<typeof isLocalAdminBypassEnabled>[0]);
  return adminUserIds.has(userId) || localAdminBypassEnabled;
};

const toErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

export const buildDeepHealthReport = async (deps: {
  convex: StartOwnedHealthReadConvex;
  getEnv: StartOwnedHealthRuntimeDeps["getEnv"];
  queueClient: StartOwnedHealthRuntimeDeps["queueClient"];
}): Promise<DeepHealthReport> => {
  const env = deps.getEnv();
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();

  const convexStartedAt = Date.now();
  const convexSubsystem = await (async () => {
    try {
      const probe = await deps.convex.probeConvexHealth();
      return {
        name: "convex",
        status: "up" as const,
        critical: true,
        responseTimeMs: Date.now() - convexStartedAt,
        checkedAt: probe.checkedAt,
        featureFlagSampleSize: probe.featureFlagSampleSize,
      };
    } catch (error) {
      return {
        name: "convex",
        status: "down" as const,
        critical: true,
        responseTimeMs: Date.now() - convexStartedAt,
        error: toErrorMessage(error),
      };
    }
  })();

  const queueStartedAt = Date.now();
  const queueProbe = await deps.queueClient.checkHealth();
  const queueSubsystem = {
    name: "queue",
    status: queueProbe.ok ? ("up" as const) : ("down" as const),
    critical: true,
    responseTimeMs: Date.now() - queueStartedAt,
    mode: queueProbe.mode,
    detail: queueProbe.detail,
  };

  const masterKeyStartedAt = Date.now();
  const masterKeyAvailable =
    typeof env.KEPPO_MASTER_KEY === "string" && env.KEPPO_MASTER_KEY.trim().length > 0;
  const masterKeySubsystem = {
    name: "master_key",
    status: masterKeyAvailable ? ("up" as const) : ("down" as const),
    critical: true,
    responseTimeMs: Date.now() - masterKeyStartedAt,
    present: masterKeyAvailable,
  };

  const cronStartedAt = Date.now();
  const cronSubsystem = await (async () => {
    try {
      const jobs = await deps.convex.checkCronHealth();
      const unhealthyJobs = jobs.filter((job) => job.status !== CRON_HEALTH_STATUS.healthy);
      return {
        name: "cron",
        status: unhealthyJobs.length > 0 ? ("down" as const) : ("up" as const),
        critical: true,
        responseTimeMs: Date.now() - cronStartedAt,
        unhealthyJobs: unhealthyJobs.length,
        jobs,
      };
    } catch (error) {
      return {
        name: "cron",
        status: "down" as const,
        critical: true,
        responseTimeMs: Date.now() - cronStartedAt,
        error: toErrorMessage(error),
      };
    }
  })();

  const dlqStartedAt = Date.now();
  const dlqSubsystem = await (async () => {
    const threshold = env.KEPPO_DLQ_ALERT_THRESHOLD;
    const sampleLimit = Math.max(1, threshold + 1);
    try {
      const pending = await deps.convex.listPendingDeadLetters({ limit: sampleLimit });
      const overThreshold = pending.length > threshold;
      return {
        name: "dlq",
        status: overThreshold ? ("down" as const) : ("up" as const),
        critical: true,
        responseTimeMs: Date.now() - dlqStartedAt,
        pendingCountLowerBound: pending.length,
        threshold,
        overThreshold,
        sample: pending,
      };
    } catch (error) {
      return {
        name: "dlq",
        status: "down" as const,
        critical: true,
        responseTimeMs: Date.now() - dlqStartedAt,
        error: toErrorMessage(error),
      };
    }
  })();

  const rateLimitsStartedAt = Date.now();
  const rateLimitSubsystem = await (async () => {
    try {
      const summary = await deps.convex.summarizeRateLimitHealth({
        sampleLimit: 200,
        activeWithinMs: 5 * 60_000,
      });
      return {
        name: "rate_limits",
        status: "up" as const,
        critical: false,
        responseTimeMs: Date.now() - rateLimitsStartedAt,
        activeKeysLowerBound: summary.activeKeysLowerBound,
        sampledRows: summary.sampledRows,
        sampleLimit: summary.sampleLimit,
        activeWithinMs: summary.activeWithinMs,
        buckets: summary.buckets,
      };
    } catch (error) {
      return {
        name: "rate_limits",
        status: "down" as const,
        critical: false,
        responseTimeMs: Date.now() - rateLimitsStartedAt,
        error: toErrorMessage(error),
      };
    }
  })();

  const circuitBreakerStartedAt = Date.now();
  const circuitBreakers = listProviderCircuitBreakerStates();
  const openCircuitBreakers = circuitBreakers.filter((breaker) => breaker.state === "OPEN");
  const circuitBreakerSubsystem = {
    name: "circuit_breakers",
    status:
      openCircuitBreakers.length >= CIRCUIT_BREAKER_OPEN_ALERT_THRESHOLD
        ? ("down" as const)
        : ("up" as const),
    critical: false,
    responseTimeMs: Date.now() - circuitBreakerStartedAt,
    openBreakers: openCircuitBreakers.length,
    openThreshold: CIRCUIT_BREAKER_OPEN_ALERT_THRESHOLD,
    breakers: circuitBreakers,
  };

  const subsystems = [
    convexSubsystem,
    queueSubsystem,
    masterKeySubsystem,
    cronSubsystem,
    dlqSubsystem,
    rateLimitSubsystem,
    circuitBreakerSubsystem,
  ];
  const criticalDown = subsystems.some(
    (subsystem) => subsystem.critical && subsystem.status === "down",
  );

  return {
    ok: !criticalDown,
    status: criticalDown ? "degraded" : "ok",
    checkedAt,
    responseTimeMs: Date.now() - startedAt,
    subsystems,
  };
};

export const emitDeepHealthAlerts = (
  report: DeepHealthReport,
  deps: Pick<StartOwnedHealthRuntimeDeps, "convex" | "logger" | "notifyPagerDutyIncident">,
): void => {
  for (const subsystem of report.subsystems) {
    if (
      typeof subsystem.name !== "string" ||
      typeof subsystem.status !== "string" ||
      typeof subsystem.critical !== "boolean"
    ) {
      continue;
    }

    void fireAndForgetWithDlq(
      `pagerduty.health.subsystem.${subsystem.name}`,
      async () => {
        await deps.notifyPagerDutyIncident({
          dedupKey: `health:subsystem:${subsystem.name}`,
          active: subsystem.status === "down",
          summary:
            subsystem.status === "down"
              ? `Deep health check: ${subsystem.name} is down`
              : `Deep health check: ${subsystem.name} recovered`,
          severity: "critical",
          source: "keppo-web/internal-health-deep",
          customDetails: {
            subsystem: subsystem.name,
            status: subsystem.status,
            critical: subsystem.critical,
          },
        });
      },
      deps.convex,
      {
        logger: deps.logger,
        payload: {
          dedupKey: `health:subsystem:${subsystem.name}`,
          subsystem: subsystem.name,
          status: subsystem.status,
          critical: subsystem.critical,
        },
      },
    );
  }

  const cronSubsystem = report.subsystems.find((subsystem) => subsystem.name === "cron");
  const jobs = Array.isArray(cronSubsystem?.jobs) ? cronSubsystem.jobs : [];
  for (const job of jobs) {
    if (!job || typeof job !== "object" || typeof job.jobName !== "string") {
      continue;
    }
    const failing = job.status === CRON_HEALTH_STATUS.failing;

    void fireAndForgetWithDlq(
      `pagerduty.cron.${job.jobName}`,
      async () => {
        await deps.notifyPagerDutyIncident({
          dedupKey: `cron:${job.jobName}`,
          active: failing,
          summary: failing
            ? `Cron job failing: ${job.jobName} (${job.consecutiveFailures} consecutive failures)`
            : `Cron job recovered: ${job.jobName}`,
          severity: "critical",
          source: "keppo-web/internal-health-deep",
          customDetails: {
            job_name: job.jobName,
            status: job.status,
            consecutive_failures: job.consecutiveFailures,
            last_failure_at: job.lastFailureAt,
            last_error: job.lastError,
          },
        });
      },
      deps.convex,
      {
        logger: deps.logger,
        payload: {
          dedupKey: `cron:${job.jobName}`,
          jobName: job.jobName,
          status: job.status,
          consecutiveFailures: job.consecutiveFailures,
          lastFailureAt: job.lastFailureAt ?? null,
          lastError: job.lastError ?? null,
        },
      },
    );
  }

  const circuitBreakerSubsystem = report.subsystems.find(
    (subsystem) => subsystem.name === "circuit_breakers",
  );
  const openBreakers = Array.isArray(circuitBreakerSubsystem?.breakers)
    ? circuitBreakerSubsystem.breakers
        .filter((breaker) => breaker && typeof breaker === "object" && breaker.state === "OPEN")
        .map((breaker) => (typeof breaker.provider === "string" ? breaker.provider : "unknown"))
    : [];

  void fireAndForgetWithDlq(
    "pagerduty.circuit_breakers.multiple_open",
    async () => {
      await deps.notifyPagerDutyIncident({
        dedupKey: "circuit_breakers:multiple_open",
        active: openBreakers.length >= CIRCUIT_BREAKER_OPEN_ALERT_THRESHOLD,
        summary:
          openBreakers.length >= CIRCUIT_BREAKER_OPEN_ALERT_THRESHOLD
            ? `Multiple provider circuit breakers open (${openBreakers.length})`
            : "Provider circuit breaker fleet recovered",
        severity: "critical",
        source: "keppo-web/internal-health-deep",
        customDetails: {
          threshold: CIRCUIT_BREAKER_OPEN_ALERT_THRESHOLD,
          open_breakers: openBreakers,
        },
      });
    },
    deps.convex,
    {
      logger: deps.logger,
      payload: {
        dedupKey: "circuit_breakers:multiple_open",
        threshold: CIRCUIT_BREAKER_OPEN_ALERT_THRESHOLD,
        openBreakers,
      },
    },
  );
};
