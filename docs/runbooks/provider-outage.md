# Provider Outage / Circuit-Breaker Event

## Symptoms

- One provider starts returning high `5xx`/timeout rates.
- Connector calls fail fast due to open circuit breaker (when enabled).
- Integration health degrades for a specific provider while others stay healthy.

## Diagnosis

1. Identify impacted provider and failure window from logs/metrics.
2. Confirm external provider status page and API incident reports.
3. Verify whether failures are provider-side or caused by local networking/secrets.
4. Check circuit-breaker state transitions and open duration.

## Fix

1. If provider outage is confirmed, reduce or pause non-critical traffic for that provider.
2. Keep fail-fast behavior enabled to protect queue capacity and latency budgets.
3. Retry only after provider recovery signals and health probes stabilize.
4. Validate successful half-open/closed recovery before restoring full traffic.

## Prevention

- Maintain per-provider SLO alerts and timeout budgets.
- Tune provider-specific breaker thresholds and cooldowns from real incident data.
- Keep user-facing reconnect/degraded messaging clear during provider incidents.
