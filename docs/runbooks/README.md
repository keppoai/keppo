# Operations Runbooks

Use this index during incidents. Each runbook follows `Symptoms -> Diagnosis -> Fix -> Prevention` and is designed for on-call execution without prior context.

## Core reliability runbooks

- [Stuck automation run](./stuck-automation-run.md)
- [Stripe webhook failures](./stripe-webhook-failures.md)
- [OAuth token refresh failures](./oauth-token-refresh.md)
- [OAuth helper signing](./oauth-helper-signing.md)
- [Cron job failure (STALE/FAILING)](./cron-job-failure.md)
- [Convex deployment failure](./convex-deployment.md)
- [Rate-limit spike (429 surge)](./rate-limit-spike.md)
- [Provider outage / circuit-breaker event](./provider-outage.md)

## Provider operations

- [Canonical provider backfill](./canonical-provider-backfill.md)

## Alerting setup

- [PagerDuty setup](./pagerduty-setup.md)
