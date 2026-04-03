# Stuck Automation Run

## Symptoms

- Automation run remains `running` past expected inactivity timeout.
- Dashboard shows no new run logs while status stays `running`.
- Action queue drains but specific run never reaches `completed`/`failed`/`cancelled`.

## Diagnosis

1. Identify the run and workspace from dashboard run details.
2. Check API/Convex logs for dispatch and callback activity for the run (`/internal/automations/dispatch`, `/internal/automations/log`, `/internal/automations/complete`).
3. Confirm cron maintenance is healthy (`GET /health/deep`, `cron` subsystem).
4. Verify run timeout settings and effective tier limits are set as expected (`KEPPO_AUTOMATION_DEFAULT_TIMEOUT_MS`, the org subscription tier's automation max run duration, and `KEPPO_RUN_INACTIVITY_MINUTES`).
5. Check whether queue delivery for `approved-action`/automation dispatch is delayed or failing.

## Fix

1. Trigger maintenance tick manually to reap stale runs:
   - `POST /internal/cron/maintenance` with internal auth bearer.
2. If run is still stuck, terminate the run through the internal terminate path (`POST /internal/automations/terminate`) for the affected run.
3. Re-dispatch only if the trigger is idempotent and safe to retry.
4. Confirm the run transitions to a terminal state and that follow-up runs process normally.

## Prevention

- Keep `/health/deep` monitored and alert on cron `FAILING`/`STALE`.
- Track stuck-run counts per workspace and alert when above baseline.
- Enforce bounded retry budgets and explicit terminal-state audits for automation dispatch failures.
