# Izzy

Izzy is a standalone Next.js app that helps approved GitHub users create higher-signal issues for `keppoai/keppo`.

## Local run

```bash
pnpm install
pnpm --filter @keppo/izzy dev
```

Izzy runs on `http://localhost:3201` by default.

## Required env

- `GITHUB_ID`
- `GITHUB_SECRET`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`
- `IZZY_ALLOWED_GITHUB_USERS`
- `IZZY_OPENAI_API_KEY`
- `IZZY_TARGET_REPO_ID`

## Optional env

- `IZZY_AI_MODEL` default `gpt-4.1-mini`
- `IZZY_TARGET_REPO_OWNER` default `keppoai`
- `IZZY_TARGET_REPO_NAME` default `keppo`
- `IZZY_TARGET_REPO_REF` default `main`
- `IZZY_BLOB_READ_WRITE_TOKEN` required only for image uploads
- `IZZY_BLOB_BASE_PATH` default `izzy-issue-images`
- `IZZY_E2E_PREVIEW_LOGIN` local/test only. Enables an explicit preview identity for Playwright screenshots and local UI validation.

## Auth

Izzy uses direct GitHub App auth through `next-auth`. Access is blocked unless the signed-in GitHub login appears in the comma-separated `IZZY_ALLOWED_GITHUB_USERS` env var. If an allowlisted login is later removed, Izzy immediately revokes the stored repo token, blocks refresh, and requires a newly approved sign-in before any protected route can call GitHub again. The GitHub App token is restricted to `IZZY_TARGET_REPO_ID`, stays server-side, and is not exposed in the browser session payload.

## Uploads

Uploaded images are stored at public Vercel Blob URLs. Do not upload sensitive screenshots.
