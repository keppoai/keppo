# Rate-Limit Spike (429 Surge)

## Symptoms

- Sudden increase in `429` responses.
- User reports of blocked OAuth connect, MCP, or webhook flows.
- Abuse/security dashboards show elevated rate-limit events.

## Diagnosis

1. Identify affected route category (`mcp auth`, `mcp requests`, `oauth connect`, `webhooks`).
2. Check API logs for rate-limit key dimensions (IP, credential, route).
3. Determine if spike is attack traffic, bot retry loop, or legitimate burst.
4. Validate current rate-limit env configuration values.

## Fix

1. If attack traffic: block offending IP ranges upstream and keep limits enforced.
2. If legitimate burst: tune per-route limits conservatively and monitor error rate.
3. For client retry storms: patch client backoff behavior and release hotfix.
4. Confirm affected flows recover and `429` rate returns to baseline.

## Prevention

- Alert on route-level `429` percentage and anomaly thresholds.
- Keep durable rate-limit storage and correlate incidents by request ID.
- Test client retry/backoff behavior in smoke/e2e for high-volume paths.
