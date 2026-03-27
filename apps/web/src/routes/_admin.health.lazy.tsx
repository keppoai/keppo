import { useCallback, useEffect, useMemo, useState } from "react";
import { createLazyRoute } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { Loader2Icon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { CRON_HEALTH_STATUS } from "@keppo/shared/domain";

import {
  isRecord,
  type AuditErrorEntry,
  type DeadLetterEntry,
  type DeepHealthResponse,
  type FeatureFlagEntry,
} from "@/lib/admin-health";
import { showUserFacingErrorToast } from "@/lib/show-user-facing-error-toast";
import { toUserFacingError, type UserFacingError } from "@/lib/user-facing-errors";
import {
  getAdminAuditErrors,
  getAdminDeepHealth,
  getAdminFeatureFlags,
  getAdminHealthDlq,
  runAdminDlqAction,
} from "@/lib/server-functions/internal-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UserFacingErrorView } from "@/components/ui/user-facing-error";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { adminHealthRoute } from "./_admin.health";

const summarizePayload = (payload: Record<string, unknown>): string => {
  const summaryKeys = ["message", "error", "reason", "provider", "route", "key"];
  const parts = summaryKeys
    .map((key) => payload[key])
    .filter(
      (value): value is string | number | boolean =>
        typeof value === "string" || typeof value === "number" || typeof value === "boolean",
    )
    .map((value) => String(value));
  return parts.length > 0 ? parts.join(" • ") : JSON.stringify(payload).slice(0, 120);
};

const formatTimestamp = (value: string | null | undefined): string => {
  if (!value) {
    return "-";
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }
  return new Date(parsed).toLocaleString();
};

const resolveStatusBadgeClass = (status: string): string => {
  if (status === "down" || status === CRON_HEALTH_STATUS.failing) {
    return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
  }
  if (status === CRON_HEALTH_STATUS.stale) {
    return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }
  return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
};

export const adminHealthRouteLazy = createLazyRoute(adminHealthRoute.id)({
  component: AdminHealthPage,
});

function AdminHealthPage() {
  const toggleFeatureFlagMutation = useMutation(
    makeFunctionReference<"mutation">("feature_flags:toggleFeatureFlag"),
  );
  const [health, setHealth] = useState<DeepHealthResponse | null>(null);
  const [deadLetters, setDeadLetters] = useState<DeadLetterEntry[]>([]);
  const [featureFlags, setFeatureFlags] = useState<FeatureFlagEntry[]>([]);
  const [auditErrors, setAuditErrors] = useState<AuditErrorEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<UserFacingError | null>(null);
  const [activeDlqActionId, setActiveDlqActionId] = useState<string | null>(null);
  const [activeFlagKey, setActiveFlagKey] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    setIsRefreshing(true);
    try {
      const [deepHealth, dlq, flags, errors] = await Promise.all([
        getAdminDeepHealth(),
        getAdminHealthDlq({ limit: 100 }),
        getAdminFeatureFlags(),
        getAdminAuditErrors({ limit: 50 }),
      ]);
      setHealth(deepHealth);
      setDeadLetters(dlq.pending);
      setFeatureFlags(flags.flags);
      setAuditErrors(errors.errors);
    } catch (fetchError) {
      setError(toUserFacingError(fetchError, { fallback: "Failed to load health." }));
    } finally {
      setIsRefreshing(false);
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const intervalId = window.setInterval(() => {
      void refresh();
    }, 30_000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [refresh]);

  const runDlqAction = useCallback(
    async (dlqId: string, action: "replay" | "abandon") => {
      setActiveDlqActionId(dlqId);
      try {
        await runAdminDlqAction({ id: dlqId, action });
        toast.success(action === "replay" ? "Replay requested" : "DLQ item abandoned");
        await refresh();
      } catch (actionError) {
        showUserFacingErrorToast(actionError, { fallback: "DLQ action failed." });
      } finally {
        setActiveDlqActionId(null);
      }
    },
    [refresh],
  );

  const toggleFlag = useCallback(
    async (flag: FeatureFlagEntry) => {
      setActiveFlagKey(flag.key);
      try {
        await toggleFeatureFlagMutation({ key: flag.key, enabled: !flag.enabled });
        toast.success(`${flag.label} ${flag.enabled ? "disabled" : "enabled"}`);
        await refresh();
      } catch (toggleError) {
        showUserFacingErrorToast(toggleError, { fallback: "Flag update failed." });
      } finally {
        setActiveFlagKey(null);
      }
    },
    [refresh, toggleFeatureFlagMutation],
  );

  const cronSubsystem = useMemo(
    () => health?.subsystems.find((subsystem) => subsystem.name === "cron") ?? null,
    [health],
  );
  const rateLimitSubsystem = useMemo(
    () => health?.subsystems.find((subsystem) => subsystem.name === "rate_limits") ?? null,
    [health],
  );
  const circuitSubsystem = useMemo(
    () => health?.subsystems.find((subsystem) => subsystem.name === "circuit_breakers") ?? null,
    [health],
  );

  if (isLoading) {
    return (
      <div className="flex min-h-[220px] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" />
        Loading health dashboard...
      </div>
    );
  }

  const cronJobs = Array.isArray(cronSubsystem?.jobs)
    ? (cronSubsystem.jobs.filter((job): job is Record<string, unknown> => isRecord(job)) ?? [])
    : [];
  const rateLimitBuckets = Array.isArray(rateLimitSubsystem?.buckets)
    ? (rateLimitSubsystem.buckets.filter((bucket): bucket is Record<string, unknown> =>
        isRecord(bucket),
      ) ?? [])
    : [];
  const circuitBreakers = Array.isArray(circuitSubsystem?.breakers)
    ? (circuitSubsystem.breakers.filter((breaker): breaker is Record<string, unknown> =>
        isRecord(breaker),
      ) ?? [])
    : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">System Health</h1>
          <p className="text-sm text-muted-foreground">
            Deep subsystem status, cron health, rate limits, dead-letter queue, and circuit
            breakers.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted-foreground">Auto-refresh: 30s</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isRefreshing}
            onClick={() => {
              void refresh();
            }}
          >
            <RefreshCwIcon className={`mr-1.5 size-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {error ? <UserFacingErrorView error={error} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Subsystems</CardTitle>
          <CardDescription>
            Last check: {formatTimestamp(health?.checkedAt)} ({health?.responseTimeMs ?? 0}ms)
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(health?.subsystems ?? []).map((subsystem) => (
            <div key={subsystem.name} className="rounded-md border p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{subsystem.name}</p>
                <Badge variant="outline" className={resolveStatusBadgeClass(subsystem.status)}>
                  {subsystem.status.toUpperCase()}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {subsystem.responseTimeMs}ms {subsystem.critical ? "(critical)" : "(non-critical)"}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cron Health</CardTitle>
          <CardDescription>Last success/failure state for scheduled jobs.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Consecutive Failures</TableHead>
                <TableHead>Last Success</TableHead>
                <TableHead>Last Failure</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cronJobs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    No cron job data available.
                  </TableCell>
                </TableRow>
              ) : (
                cronJobs.map((job) => (
                  <TableRow key={String(job.jobName ?? "unknown")}>
                    <TableCell className="font-mono text-xs">
                      {String(job.jobName ?? "-")}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={resolveStatusBadgeClass(
                          String(job.status ?? CRON_HEALTH_STATUS.healthy),
                        )}
                      >
                        {String(job.status ?? CRON_HEALTH_STATUS.healthy)}
                      </Badge>
                    </TableCell>
                    <TableCell>{Number(job.consecutiveFailures ?? 0)}</TableCell>
                    <TableCell>
                      {formatTimestamp(
                        typeof job.lastSuccessAt === "string" ? job.lastSuccessAt : null,
                      )}
                    </TableCell>
                    <TableCell>
                      {formatTimestamp(
                        typeof job.lastFailureAt === "string" ? job.lastFailureAt : null,
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rate Limits</CardTitle>
          <CardDescription>Durable limiter activity from recent sampled keys.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-sm text-muted-foreground">
            Active keys (lower bound): {Number(rateLimitSubsystem?.activeKeysLowerBound ?? 0)}
            <span className="mx-1">•</span>
            Sample size: {Number(rateLimitSubsystem?.sampledRows ?? 0)} /{" "}
            {Number(rateLimitSubsystem?.sampleLimit ?? 0)}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {rateLimitBuckets.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No active rate-limit buckets in the sample window.
              </p>
            ) : (
              rateLimitBuckets.map((bucket) => (
                <div key={String(bucket.bucket ?? "other")} className="rounded-md border p-3">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    {String(bucket.bucket ?? "other")}
                  </p>
                  <p className="text-lg font-semibold">{Number(bucket.activeKeys ?? 0)}</p>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Feature Flags</CardTitle>
          <CardDescription>Database-backed rollout controls with admin toggles.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-[120px]">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {featureFlags.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">
                    No feature flags available.
                  </TableCell>
                </TableRow>
              ) : (
                featureFlags.map((flag) => (
                  <TableRow key={flag.key}>
                    <TableCell className="font-mono text-xs">{flag.key}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={resolveStatusBadgeClass(flag.enabled ? "up" : "down")}
                      >
                        {flag.enabled ? "Enabled" : "Disabled"}
                      </Badge>
                    </TableCell>
                    <TableCell>{flag.description || flag.label}</TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={activeFlagKey === flag.key}
                        onClick={() => {
                          void toggleFlag(flag);
                        }}
                      >
                        {flag.enabled ? "Disable" : "Enable"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Errors</CardTitle>
          <CardDescription>
            Last 50 audit events whose type includes `failed` or `error`.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>Event Type</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Summary</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {auditErrors.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    No recent audit errors.
                  </TableCell>
                </TableRow>
              ) : (
                auditErrors.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{formatTimestamp(entry.created_at)}</TableCell>
                    <TableCell className="font-mono text-xs">{entry.event_type}</TableCell>
                    <TableCell>{`${entry.actor_type}:${entry.actor_id}`}</TableCell>
                    <TableCell>
                      {typeof entry.payload.provider === "string" ? entry.payload.provider : "-"}
                    </TableCell>
                    <TableCell className="max-w-[360px] truncate">
                      {summarizePayload(entry.payload)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dead-Letter Queue</CardTitle>
          <CardDescription>
            Pending terminal failures available for replay or abandonment.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Retries</TableHead>
                <TableHead>Last Attempt</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deadLetters.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    No pending dead-letter records.
                  </TableCell>
                </TableRow>
              ) : (
                deadLetters.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-mono text-xs">{entry.id}</TableCell>
                    <TableCell className="font-mono text-xs">{entry.sourceTable}</TableCell>
                    <TableCell className="max-w-[360px] truncate">{entry.failureReason}</TableCell>
                    <TableCell>
                      {entry.retryCount}/{entry.maxRetries}
                    </TableCell>
                    <TableCell>{formatTimestamp(entry.lastAttemptAt)}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={activeDlqActionId === entry.id}
                          onClick={() => {
                            void runDlqAction(entry.id, "replay");
                          }}
                        >
                          Replay
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          disabled={activeDlqActionId === entry.id}
                          onClick={() => {
                            void runDlqAction(entry.id, "abandon");
                          }}
                        >
                          Abandon
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Circuit Breakers</CardTitle>
          <CardDescription>Provider breaker fleet state and transitions.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Failures</TableHead>
                <TableHead>Threshold</TableHead>
                <TableHead>Cooldown</TableHead>
                <TableHead>Opened At</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {circuitBreakers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    No circuit breaker telemetry available.
                  </TableCell>
                </TableRow>
              ) : (
                circuitBreakers.map((breaker) => (
                  <TableRow key={String(breaker.provider ?? "unknown")}>
                    <TableCell className="font-medium">
                      {String(breaker.provider ?? "unknown")}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={resolveStatusBadgeClass(String(breaker.state ?? "CLOSED"))}
                      >
                        {String(breaker.state ?? "CLOSED")}
                      </Badge>
                    </TableCell>
                    <TableCell>{Number(breaker.failureCount ?? 0)}</TableCell>
                    <TableCell>{Number(breaker.failureThreshold ?? 0)}</TableCell>
                    <TableCell>{Math.round(Number(breaker.cooldownMs ?? 0) / 1000)}s</TableCell>
                    <TableCell>
                      {formatTimestamp(
                        typeof breaker.openedAt === "number" && Number.isFinite(breaker.openedAt)
                          ? new Date(breaker.openedAt).toISOString()
                          : null,
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
