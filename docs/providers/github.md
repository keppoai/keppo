# GitHub Provider Integration

## Environment variables

| Variable | Usage | Description |
| --- | --- | --- |
| `GITHUB_CLIENT_ID` | server, convex | GitHub OAuth client ID. Also enables GitHub sign-in. Required in strict/prod. |
| `GITHUB_CLIENT_SECRET` | server, convex | GitHub OAuth client secret. Required in strict/prod. |
| `GITHUB_WEBHOOK_SECRET` | server | Webhook signature verification. No fallback default. |
| `GITHUB_REDIRECT_URI` | server | OAuth callback URL. Derived when unset. |
| `GITHUB_OAUTH_AUTH_URL` | server | Optional auth endpoint override |
| `GITHUB_OAUTH_TOKEN_URL` | server | Optional token endpoint override |
| `GITHUB_API_BASE_URL` | server | Optional API base override |
| `KEPPO_FEATURE_INTEGRATIONS_GITHUB_FULL` | server | Rollout flag. Default `true`. Set `false` to disable. |

## OAuth scopes

`repo:read`, `repo:write`, `workflow`, `read:org`

## Dashboard login callback

Point the GitHub OAuth app callback to the dashboard origin:

```
https://<your-domain>/api/auth/callback/github
```

## Integration connect callback

The provider integration OAuth callback is:

```
${KEPPO_API_INTERNAL_BASE_URL}/oauth/integrations/github/callback
```

This is derived automatically when `GITHUB_REDIRECT_URI` is unset.

## Webhook setup

Register a webhook endpoint in your GitHub App or repository settings:

```
https://<your-domain>/webhooks/github
```

Use `GITHUB_WEBHOOK_SECRET` for signature verification.

## Operator controls

Integration metadata key `allowed_repositories` (CSV or string array) restricts read/write connector calls to listed repositories.
