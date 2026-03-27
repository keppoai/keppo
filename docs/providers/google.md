# Google Provider Integration

## Environment variables

| Variable | Usage | Description |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | server, convex | Google OAuth client ID. Also enables Google sign-in. Required in strict/prod. |
| `GOOGLE_CLIENT_SECRET` | server, convex | Google OAuth client secret. Required in strict/prod. |
| `GOOGLE_REDIRECT_URI` | server | OAuth callback URL. Derived from `KEPPO_API_INTERNAL_BASE_URL` when unset. |
| `GOOGLE_GMAIL_WATCH_TOPIC_NAME` | convex | Gmail push watch topic name. When unset, uses polling fallback. |
| `GOOGLE_GMAIL_POLL_LIMIT` | convex | Max messages per Gmail trigger poll (default `25`, max `100`) |
| `GOOGLE_OAUTH_AUTH_URL` | server | Optional auth endpoint override |
| `GOOGLE_OAUTH_TOKEN_URL` | server | Optional token endpoint override |
| `GMAIL_API_BASE_URL` | server | Optional Gmail API base override |
| `KEPPO_FEATURE_INTEGRATIONS_GOOGLE_FULL` | server | Rollout flag. Default `true`. Set `false` to disable. |

## OAuth scopes

`gmail.readonly`, `gmail.send`, `gmail.modify`, `gmail.compose`, `gmail.settings.basic`, `gmail.labels`

## Dashboard login callback

Point the Google OAuth app callback to the dashboard origin:

```
https://<your-domain>/api/auth/callback/google
```

## Integration connect callback

The provider integration OAuth callback is:

```
${KEPPO_API_INTERNAL_BASE_URL}/oauth/integrations/google/callback
```

This is derived automatically when `GOOGLE_REDIRECT_URI` is unset.

## Gmail incoming-email automations

1. Connect Google in `/integrations` and enable it for the workspace.
2. Optionally set `GOOGLE_GMAIL_WATCH_TOPIC_NAME` in the Convex runtime env to enable Gmail push watches for near-real-time delivery.
3. If `GOOGLE_GMAIL_WATCH_TOPIC_NAME` is unset, Gmail triggers still work through polling fallback; the integration detail page shows that polling mode is active.
