# LinkedIn Provider Integration

## Environment variables

| Variable | Usage | Description |
| --- | --- | --- |
| `LINKEDIN_CLIENT_ID` | server, convex | LinkedIn OAuth client ID. Required in strict/prod. |
| `LINKEDIN_CLIENT_SECRET` | server, convex | LinkedIn OAuth client secret. Required in strict/prod. |
| `LINKEDIN_OAUTH_AUTH_URL` | server | Optional auth endpoint override. Defaults to `https://www.linkedin.com/oauth/v2/authorization`. |
| `LINKEDIN_OAUTH_TOKEN_URL` | server | Optional token endpoint override. Defaults to `https://www.linkedin.com/oauth/v2/accessToken`. |
| `LINKEDIN_API_BASE_URL` | server | Optional API base override. Defaults to `https://api.linkedin.com`. |
| `KEPPO_FEATURE_INTEGRATIONS_LINKEDIN_FULL` | server | Rollout flag. Default `true`. Set `false` to disable. |

## Default OAuth scopes

`openid`, `profile`, `email`

Keppo keeps LinkedIn defaults conservative so apps with only basic Sign In with LinkedIn access can still connect successfully. If your LinkedIn app is approved for additional product families such as Community Management, Ads, Lead Sync, Sales Navigator, or Talent APIs, request those extra scopes explicitly when starting the integration connect flow.

## Dashboard login callback

LinkedIn is an integration provider here, not dashboard login. Do not point your Better Auth social-login callback at the LinkedIn integration callback.

## Integration connect callback

The provider integration OAuth callback is:

```
${KEPPO_API_INTERNAL_BASE_URL}/oauth/integrations/linkedin/callback
```

This is derived automatically from the running API base URL.

## API surface

LinkedIn currently ships as a low-level request/response provider contract:

- `linkedin.getProfile`
- `linkedin.readApi`
- `linkedin.writeApi`

Those tools keep all traffic on the configured LinkedIn API base URL and let Keppo route approved LinkedIn product APIs through one canonical provider without requiring a bespoke typed tool for every endpoint family.

## Operational notes

- LinkedIn product access is app-dependent. OAuth success does not imply your app is approved for every LinkedIn API family.
- Keppo does not ship LinkedIn webhooks or automation triggers in this first pass.
- If you override `KEPPO_EXTERNAL_FETCH_ALLOWLIST`, include `www.linkedin.com:443`, `api.linkedin.com:443`, and any non-default `LINKEDIN_*` host overrides.
