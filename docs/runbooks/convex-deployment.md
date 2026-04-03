# Convex Deployment Failure

## Symptoms

- Deployment fails during schema/code push.
- Convex local/prod logs show migration or typecheck errors.
- API/dashboard behavior diverges from expected schema.

## Diagnosis

1. Capture exact Convex CLI error output from failed deployment.
2. Identify whether failure is schema, function typecheck, or runtime env validation.
3. Check recent schema/index changes for incompatible assumptions.
4. Validate required env vars exist for target deployment.

## Fix

1. For schema/index issues: make additive-safe schema adjustments and redeploy.
2. For function typecheck/runtime issues: fix code, run local build/tests, redeploy.
3. For env issues: set missing/invalid Convex/API env vars and retry deployment.
4. Verify deployment by running health checks and a short smoke flow.

## Prevention

- Keep schema changes additive and reviewed for index/query compatibility.
- Validate deploys in staging before production rollout.
- Keep `.env.example` and `docs/self-hosting-setup.md` synchronized with runtime requirements.
