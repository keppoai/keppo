# PagerDuty setup for health alerts

This runbook configures both outage-level and internal failure alerts:

1. External uptime monitor -> PagerDuty incident (detects total API outages).
2. Internal `/health/deep` PagerDuty events (detects subsystem and cron failures while API is still reachable).

## 1) External monitor to `/health/deep`

Choose one external monitor (Better Stack, UptimeRobot, or PagerDuty HTTP check):

1. Target URL: `https://<api-domain>/health/deep`
2. Method: `GET`
3. Frequency: every 60 seconds
4. Timeout: 10 seconds
5. Failure conditions:
- HTTP status not in `2xx`
- timeout / network failure
6. Notification destination: PagerDuty service integration

Expected behavior:
- A `503` from `/health/deep` opens or updates an incident.
- A return to `200` resolves the incident.

## 2) Internal PagerDuty Events API integration

The API can emit PagerDuty events directly for subsystem and cron health transitions.

### Environment

Set in API runtime:

- `PAGERDUTY_ROUTING_KEY=<events-api-v2-routing-key>`

### Trigger and dedup keys

`/health/deep` sends events with stable dedup keys:

- Subsystems: `health:subsystem:<name>`
- Cron jobs with `FAILING` status: `cron:<jobName>`

This prevents alert storms and supports automatic resolve when health recovers.

## 3) Verification checklist

1. Set `PAGERDUTY_ROUTING_KEY` and deploy API.
2. Call `/health/deep` with normal state; no trigger incident should be created.
3. Force queue or Convex subsystem down; verify trigger event arrives in PagerDuty.
4. Restore subsystem; verify resolve event for the same dedup key.
5. Force a cron job into `FAILING` (`consecutiveFailures >= 3`); verify `cron:<jobName>` trigger.
6. Recover cron execution; verify resolve event.

## 4) Troubleshooting

- Missing incidents:
  - Verify `PAGERDUTY_ROUTING_KEY` exists in API env.
  - Check API logs for `pagerduty.health.subsystem.<name>`, `pagerduty.cron.<jobName>`, or `pagerduty.circuit_breakers.multiple_open` task identifiers.
- Repeated incidents:
  - Confirm dedup keys are stable and no middleware rewrites route behavior.
- Alerts not resolving:
  - Confirm `/health/deep` returns subsystem/job status as healthy after remediation.

## 5) Suggested SLO alert baselines

- **Connect success rate:** alert below 99.0% (5m rolling) per provider
- **Webhook failure rate:** alert above 1.0% invalid/failed deliveries (15m rolling)
- **Action execution failure rate:** alert above 2.0% failures (15m rolling), excluding policy rejections
