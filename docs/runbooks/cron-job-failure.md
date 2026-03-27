# Cron Job Failure (STALE/FAILING)

## Symptoms

- `GET /health/deep` returns `503` with unhealthy cron subsystem.
- `checkCronHealth` reports `FAILING` (consecutive failures) or `STALE`.
- Background maintenance side effects stop progressing.

## Diagnosis

1. Inspect `/health/deep` response and identify failing job names.
2. Query cron heartbeat state (`lastSuccessAt`, `lastFailureAt`, `consecutiveFailures`).
3. Check Convex/API logs for the first failure stack trace.
4. Confirm dependencies used by cron jobs (queue, Convex connectivity, provider endpoints) are healthy.

## Fix

1. Resolve root cause from failing job logs (schema mismatch, env, external dependency, code regression).
2. Run maintenance endpoint manually after fix to validate one clean cycle.
3. Verify heartbeat records transition back to healthy and `/health/deep` returns `200`.
4. If PagerDuty incident triggered, confirm auto-resolve event is emitted after recovery.

## Prevention

- Keep cron heartbeat and `/health/deep` external uptime monitors enabled.
- Alert on `consecutiveFailures > 3` and stale interval breaches.
- Add regression tests for each cron handler failure mode discovered in incidents.
