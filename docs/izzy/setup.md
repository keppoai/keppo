# Izzy Setup

Standalone Next.js issue-authoring app for `keppoai/keppo`, located at `apps/izzy`.

## Quickstart

```bash
pnpm --filter @keppo/izzy dev        # start Izzy on :3201
```

## Environment variables

| Variable                     | Required | Description                                                                                              |
| ---------------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `GITHUB_ID`                  | Yes      | GitHub App client id used by Izzy direct sign-in                                                         |
| `GITHUB_SECRET`              | Yes      | GitHub App client secret used by Izzy direct sign-in                                                     |
| `NEXTAUTH_SECRET`            | Yes      | Secret for Izzy `next-auth` session signing                                                              |
| `NEXTAUTH_URL`               | Yes      | Izzy app origin, for example `http://localhost:3201`                                                     |
| `IZZY_ALLOWED_GITHUB_USERS`  | Yes      | Comma-separated GitHub login allowlist; non-listed users are denied even if GitHub auth succeeds         |
| `IZZY_OPENAI_API_KEY`        | Yes      | OpenAI API key used by Izzy through the AI SDK                                                           |
| `IZZY_AI_MODEL`              | No       | AI model id used for image notes, clarification questions, and draft generation (default `gpt-4.1-mini`) |
| `IZZY_TARGET_REPO_OWNER`     | No       | Default GitHub repo owner for created issues and repo-context fetches (default `keppoai`)                |
| `IZZY_TARGET_REPO_NAME`      | No       | Default GitHub repo name for created issues and repo-context fetches (default `keppo`)                   |
| `IZZY_TARGET_REPO_ID`        | Yes      | Numeric GitHub repository id used to restrict the GitHub App user token to the target private repo       |
| `IZZY_TARGET_REPO_REF`       | No       | Default GitHub ref used when fetching repo context from GitHub (default `main`)                          |
| `IZZY_BLOB_READ_WRITE_TOKEN` | No\*     | Vercel Blob token for public screenshot uploads. _Required only when Izzy image uploads are enabled._    |
| `IZZY_BLOB_BASE_PATH`        | No       | Blob pathname prefix for uploaded images (default `izzy-issue-images`)                                   |

## GitHub App requirements

- Register Izzy's callback URL on the GitHub App and use the app's client id/client secret for `GITHUB_ID` and `GITHUB_SECRET`.
- Install the GitHub App on the target private repository and grant at least `Metadata: Read` plus `Issues: Read and write`.
- Set `IZZY_TARGET_REPO_ID` to the numeric id of that repository so Izzy exchanges the GitHub callback for a repo-restricted user token.
- Removing a GitHub login from `IZZY_ALLOWED_GITHUB_USERS` immediately invalidates that user's stored repo-scoped Izzy token and blocks token refresh until the login is re-allowlisted and signs in again.
- After switching from the old OAuth-app flow, existing Izzy sessions should sign out and sign back in so the new GitHub App token is minted.
