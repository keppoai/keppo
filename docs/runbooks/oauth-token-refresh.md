# OAuth Token Refresh Failures

## Symptoms

- Provider actions start failing with `401`/`invalid_grant`.
- Integrations enter degraded state after refresh attempts.
- Audit stream shows refresh failure events.

## Diagnosis

1. Find recent `integration.credential_refresh_failed` audit events.
2. Confirm provider-specific client ID/secret env vars are present and correct.
3. Validate token endpoint reachability (network allowlist and DNS).
4. Check whether refresh token was revoked/expired by the provider.
5. Verify system clock skew is not causing token validity drift.

## Fix

1. Correct provider OAuth credentials and redeploy.
2. Reconnect affected integration from dashboard if refresh token is invalid.
3. Retry the failed action after successful reconnect/refresh.
4. Confirm new `integration.credential_refresh_succeeded` events are emitted.

## Prevention

- Alert on refresh-failure rate spikes per provider.
- Track token expiry windows and reconnect prompts before hard expiry.
- Keep provider credential rotation documented and tested in staging.
