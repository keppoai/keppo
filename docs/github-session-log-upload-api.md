# GitHub Session Log Upload API Handoff

This document defines the API contract for the dedicated session-log ingestion service used by GitHub Actions coding-agent workflows. The same contract now also carries the minimal non-log artifacts that a fresh trusted job needs to resume an `issue-agent` run on another runner.

## Goal

Accept Codex, Claude, and GitHub Copilot session-log artifacts from GitHub Actions, authenticate the caller with a shared bearer token, validate and persist the uploaded files, and return stable artifact identifiers that workflows can use for viewer links and trusted cross-job downloads.

## Scope

This API is only for machine-to-machine traffic from trusted GitHub Actions workflows such as:

- `issue-agent-plan.yml`
- `issue-agent-issue-to-pr.yml`
- `fix-pr.yml`

It is not a user-facing API and must fail closed for missing or malformed auth, metadata, or file content.

The deployed implementation uses a Vercel-compatible two-step upload plus authenticated retrieval flow:

- `POST /upload` with JSON to validate the manifest and mint short-lived direct-upload tokens
- Direct private Blob uploads from the workflow caller
- `POST /upload/complete` with JSON to verify uploaded blobs, dedupe them, and register artifact metadata
- `GET /uploads/{upload_id}` with bearer auth to fetch the stored manifest plus completion response for a trusted follow-up job
- `GET /artifacts/{artifact_id}/download` with bearer auth to stream the raw artifact bytes directly from the service

## Endpoints

- `POST https://agent-logs.keppo.ai/upload`
- `POST https://agent-logs.keppo.ai/upload/complete`
- `GET https://agent-logs.keppo.ai/uploads/{upload_id}`
- `GET https://agent-logs.keppo.ai/artifacts/{artifact_id}/download`

All endpoints use:

- Auth header: `Authorization: Bearer <KEPPO_SESSION_LOG_UPLOAD_TOKEN>`
- Upload content type: `application/json`
- Cache behavior for authenticated `GET` routes: `Cache-Control: no-store`

`Authorization: Bearer` is preferable to a custom header because it is standard, easy to handle in `curl`, and matches existing internal-route conventions.

## Why a two-step upload plus authenticated retrieval flow

The current GitHub workflows may need to upload session logs, a git bundle, PR metadata, and an optional demo video. Vercel Functions cap inbound request bodies at `4.5 MB`, so proxying artifact bytes through the function is not viable once a run contains several logs or a larger bundle. The service therefore validates only the manifest in the function, has the workflow upload bytes directly to private Blob pathnames using short-lived client tokens, and verifies those blobs in a completion step before they become visible to later trusted jobs.

The authenticated retrieval endpoints exist so a fresh trusted runner can reconstruct the exact upload from a deterministic `upload_id` without relying on GitHub artifacts, same-runner state, or mutable files produced by the agent.

## Prepare and complete request contract

The prepare request contains one JSON body with `manifest`.

```json
{
  "manifest": {
    "schema_version": 1
  }
}
```

The completion request uses the same JSON shape after any `upload_required` files have been uploaded directly to Blob.

## Manifest schema

```json
{
  "schema_version": 1,
  "source": "github_actions",
  "upload_id": "issue-agent-1234567890-2-codex-2914",
  "uploaded_at": "2026-04-07T07:00:00Z",
  "agent_kind": "codex",
  "repository": {
    "owner": "keppoai",
    "name": "keppo",
    "full_name": "keppoai/keppo"
  },
  "github": {
    "workflow": "issue-agent-issue-to-pr",
    "job": "issue-agent",
    "run_id": "1234567890",
    "run_attempt": 2,
    "run_number": 418,
    "actor": "keppo-bot[bot]",
    "triggering_actor": "wwwillchen",
    "event_name": "issues",
    "ref": "refs/heads/main",
    "sha": "0123456789abcdef0123456789abcdef01234567",
    "server_url": "https://github.com",
    "repository_url": "https://github.com/keppoai/keppo"
  },
  "context": {
    "issue_number": 2914,
    "pull_request_number": null,
    "root_paths": ["codex-home", "issue-agent-handoff"]
  },
  "limits": {
    "max_files": 50,
    "max_total_bytes": 104857600
  },
  "files": [
    {
      "part_name": "file_0",
      "root_label": "codex-home",
      "relative_path": "sessions/session-2026-04-07T07-00-00.jsonl",
      "filename": "session-2026-04-07T07-00-00.jsonl",
      "content_type": "application/x-ndjson",
      "size_bytes": 182044,
      "sha256_hex": "0d4f8eb0f6a77d7df78e7f3390054f1b1ac8f5a1d02c0f6cae0e63b9098f4d4b"
    },
    {
      "part_name": "file_1",
      "root_label": "issue-agent-handoff",
      "relative_path": "branch.bundle",
      "filename": "branch.bundle",
      "content_type": "application/octet-stream",
      "size_bytes": 49152,
      "sha256_hex": "5b57c1d06f7fc6f618fa0f7ad0f55be9d2c2ebf2b2e11a1263a8b62f2a53de35"
    }
  ]
}
```

## Required manifest fields

### Top-level

- `schema_version`
  - Integer. Start at `1`.
- `source`
  - Must be `github_actions` for this API version.
- `upload_id`
  - Caller-generated id for request-level idempotency. Deterministic values are allowed and are required for cross-job `issue-agent` handoff.
- `uploaded_at`
  - RFC 3339 UTC timestamp for when the workflow assembled the upload.
- `agent_kind`
  - Enum: `codex`, `claude`, or `gh-copilot`.
- `repository.full_name`
  - GitHub repository slug, for example `keppoai/keppo`.
- `github.workflow`
- `github.job`
- `github.run_id`
- `github.run_attempt`
- `github.event_name`
- `github.sha`
- `files`
  - Non-empty array.

### Per-file

- `part_name`
  - Must match an actual declared file entry.
- `root_label`
  - The logical source root from the workflow, for example `codex-home`, `claude-home-projects`, or `issue-agent-handoff`.
- `relative_path`
  - Path relative to that root. Must not be absolute and must not contain traversal segments.
- `filename`
  - Basename for display only.
- `content_type`
  - Allowed values:
    - `application/json`
    - `application/x-ndjson`
    - `application/octet-stream`
- `size_bytes`
  - Exact byte size expected for the file bytes.
- `sha256_hex`
  - Lowercase hex digest of the raw uploaded file bytes.

## Validation requirements

The service must fail closed and reject the request if any of the following is true:

- Missing or invalid bearer token
- Missing `manifest`
- Invalid JSON manifest
- `schema_version` unsupported
- `files` is empty
- `relative_path` is absolute or contains traversal segments
- Actual file byte count differs from `size_bytes`
- Computed SHA-256 differs from `sha256_hex`
- Content type is not allowed
- Request exceeds limits based on bytes actually read

## Auth requirements

- Secret name in GitHub: `KEPPO_SESSION_LOG_UPLOAD_TOKEN`
- Header format: `Authorization: Bearer <token>`
- Use the same token for prepare, complete, upload-record lookup, and raw artifact download.
- Compare bearer tokens with a constant-time comparison and a length guard.
- Do not log the raw token.
- Return `401` for missing or invalid auth on this contract version.

## Size and rate limits

Recommended initial limits:

- Max files per request: `50`
- Max total file bytes per request: `100 MiB`
- Max single file size: `10 MiB`
- Max manifest size: `256 KiB`

The implementation must enforce limits on bytes actually read, not only on `Content-Length`.

## Idempotency and dedupe

### Request-level idempotency

Use `upload_id` as the request idempotency key.

Expected behavior:

- If the exact same upload is retried with the same `upload_id`, return the original success response.
- If the same `upload_id` is reused with a different manifest or different file hashes, return `409 conflict`.

### File-level dedupe

Compute a stable file identity from:

- `repository.full_name`
- `github.run_id`
- `github.run_attempt`
- `github.job`
- `agent_kind`
- `root_label`
- `relative_path`
- `sha256_hex`

If the same file identity arrives twice, treat it as a duplicate, not a failure.

## Response contract

Return `201 Created` when at least one file is newly stored. Return `200 OK` when the upload is fully idempotent and every file was already stored from a previous identical request.

### Upload success response

```json
{
  "upload_id": "issue-agent-1234567890-2-codex-2914",
  "status": "accepted",
  "repository": "keppoai/keppo",
  "run": {
    "workflow": "issue-agent-issue-to-pr",
    "job": "issue-agent",
    "run_id": "1234567890",
    "run_attempt": 2
  },
  "summary": {
    "received_files": 2,
    "stored_files": 1,
    "duplicate_files": 1,
    "rejected_files": 0,
    "total_bytes": 231196
  },
  "files": [
    {
      "part_name": "file_0",
      "relative_path": "sessions/session-2026-04-07T07-00-00.jsonl",
      "sha256_hex": "0d4f8eb0f6a77d7df78e7f3390054f1b1ac8f5a1d02c0f6cae0e63b9098f4d4b",
      "status": "stored",
      "artifact_id": "asl_01JQ7XAV1S7P2E8HVG2G3M4T9R",
      "storage_key": "github-actions/keppoai/keppo/run-1234567890/attempt-2/issue-agent/codex/codex-home/0d4f8eb0-session-2026-04-07T07-00-00.jsonl",
      "viewer_url": "https://agent-logs.keppo.ai/artifacts/asl_01JQ7XAV1S7P2E8HVG2G3M4T9R",
      "download_url": "https://agent-logs.keppo.ai/artifacts/asl_01JQ7XAV1S7P2E8HVG2G3M4T9R/download"
    }
  ]
}
```

`viewer_url` is required for every file with `status: "stored"` or `status: "duplicate"` so workflows can link reviewers to session logs immediately.

`download_url` is required for every file with `status: "stored"` or `status: "duplicate"` so trusted follow-up jobs can retrieve the exact stored bytes without guessing paths or reconstructing URLs.

## Authenticated upload-record lookup

Trusted follow-up jobs fetch the stored upload record by `upload_id`.

- Method: `GET`
- URL: `https://agent-logs.keppo.ai/uploads/{upload_id}`
- Auth header: `Authorization: Bearer <KEPPO_SESSION_LOG_UPLOAD_TOKEN>`
- Success response: `200 OK`
- Cache headers: `Cache-Control: no-store`

### Upload-record response

```json
{
  "upload_id": "issue-agent-1234567890-2-codex-2914",
  "manifest": {
    "schema_version": 1
  },
  "response": {
    "status": "accepted"
  }
}
```

The response must include the exact stored `manifest` plus the exact upload completion `response` that introduced or confirmed the artifacts. This is the trusted job's source of truth for `artifact_id`, `download_url`, `relative_path`, `size_bytes`, and `sha256_hex`.
Trusted jobs must obtain those fields from this authenticated upload-record lookup, not from mutable workspace files, agent-authored copies of the manifest, or ordinary GitHub job outputs.

## Authenticated artifact download

Trusted follow-up jobs download raw bytes directly from the service. This contract intentionally returns bytes from the authenticated route rather than a signed redirect URL so the workflow does not need a second auth mechanism.

- Method: `GET`
- URL: `https://agent-logs.keppo.ai/artifacts/{artifact_id}/download`
- Auth header: `Authorization: Bearer <KEPPO_SESSION_LOG_UPLOAD_TOKEN>`
- Success response: raw artifact bytes
- Cache headers: `Cache-Control: no-store`

### Required download response headers

- `Content-Type`
- `Content-Length`
- `Content-Disposition`
- `X-Keppo-Artifact-Id`
- `X-Keppo-Artifact-Sha256`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`

The trusted workflow must reject the download unless:

- `X-Keppo-Artifact-Id` matches the expected `artifact_id` from the upload record
- `relative_path` is still safe before writing to disk
- The actual byte size matches `size_bytes`
- `X-Keppo-Artifact-Sha256` and the recomputed digest both match `sha256_hex`

## Error response contract

Return machine-readable errors with stable codes.

```json
{
  "error": {
    "code": "file_sha_mismatch",
    "message": "Uploaded file digest did not match the manifest.",
    "details": {
      "part_name": "file_0"
    }
  }
}
```

Recommended codes:

- `unauthorized`
- `not_found`
- `invalid_content_type`
- `invalid_manifest`
- `missing_manifest`
- `missing_file_part`
- `unexpected_file_part`
- `invalid_relative_path`
- `file_too_large`
- `payload_too_large`
- `file_size_mismatch`
- `file_sha_mismatch`
- `upload_id_conflict`
- `internal_error`

## GitHub workflow caller behavior

The GitHub-side uploader should:

- Discover new session-log `.json` and `.jsonl` files after the marker file.
- For Codex uploads, only include files under the `sessions/` subtree of `CODEX_HOME`.
- Keep intentionally uploaded non-log files on explicit extra roots rather than broadening the default agent-home scan.
- Keep the existing caps of `50` files and `100 MiB` total.
- Call `POST /upload` with the manifest to get per-file direct-upload tokens.
- Upload each `upload_required` file directly to Vercel Blob using the returned private pathname and client token.
- Call `POST /upload/complete` with the same manifest after uploads finish.
- Compute `sha256_hex` and `size_bytes` for every file before sending.
- Emit `viewer_url` into step summaries and GitHub comments intended for humans.

For `issue-agent-issue-to-pr.yml`, the only approved non-log extra root is `issue-agent-handoff`, and it may contain only:

- `branch.bundle`
- `pr-metadata.json`
- `handoff.json`
- An optional demo video file referenced by trusted PR metadata

Small comment bodies that are meant to become GitHub comments should stay in job outputs rather than this upload channel.
Keep those job-output comment bodies well under GitHub's 24 KB output limit; larger payloads should be truncated or moved onto the authenticated upload channel instead of risking silent workflow failure.

The trusted follow-up job should:

- Reconstruct the deterministic `upload_id` from trusted workflow inputs.
- Fetch `GET /uploads/{upload_id}` with the same bearer token.
- Select the expected files by trusted root label, not by mutable workspace state.
- Download each artifact from its `download_url`.
- Verify `artifact_id`, `relative_path`, `size_bytes`, and `sha256_hex` before using the file.

## Suggested workflow env changes

Use:

- `KEPPO_SESSION_LOG_UPLOAD_URL`
  - Example: `https://agent-logs.keppo.ai/upload`
- `KEPPO_SESSION_LOG_UPLOAD_TOKEN`
  - Shared bearer token for uploads, upload-record lookup, and raw artifact download

The uploader should skip gracefully when either value is missing, just as it skips today when the service is not configured.

## Implementation notes for the service

- Treat these routes as internal machine endpoints, not a public browsing surface.
- Set standard hardening headers on all authenticated responses.
- Keep request and validation logs short and redacted.
- Persist enough normalized metadata to answer:
  - Which run uploaded this file?
  - Which agent produced it?
  - Which issue or PR did it relate to?
  - Was this a duplicate retry?
- Consider a retention policy from day one. `30` to `90` days is a reasonable starting point for debugging artifacts.

## Minimal implementation checklist

1. Verify bearer auth using `KEPPO_SESSION_LOG_UPLOAD_TOKEN`.
2. Parse and validate the upload manifest.
3. Mint direct-upload tokens only for allowed content types and declared files.
4. Recompute `size_bytes` and `sha256_hex` for each uploaded blob before accepting completion.
5. Enforce request-level idempotency on `upload_id`.
6. Persist file bytes, the stored manifest, and the final upload response.
7. Serve authenticated upload-record lookups by `upload_id`.
8. Serve authenticated raw artifact downloads with the required identity and digest headers.
9. Add targeted tests for auth failure, path traversal rejection, SHA mismatch, idempotent retry behavior, upload-record lookup, and raw artifact download.
