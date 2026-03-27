# GitHub Session Log Upload API Handoff

This document defines the API contract for a dedicated session-log ingestion service that replaces the current direct-to-Vercel-Blob upload path used by GitHub Actions coding-agent workflows.

## Goal

Accept Codex and Claude session log artifacts from GitHub Actions, authenticate the caller with a shared bearer token, validate and persist the uploaded files, and return stable artifact identifiers the workflow can surface in the GitHub job summary.

## Scope

This API is only for machine-to-machine uploads from trusted GitHub Actions workflows such as:

- `issue-agent-plan.yml`
- `issue-agent-issue-to-pr.yml`
- `fix-pr.yml`

It is not a user-facing API and should fail closed for missing or malformed auth, metadata, or file content.

## Recommended endpoint

- Method: `POST`
- URL: `https://agent-logs.keppo.ai/upload`
- Auth header: `Authorization: Bearer <KEPPO_SESSION_LOG_UPLOAD_TOKEN>`
- Content type: `multipart/form-data`

`Authorization: Bearer` is preferable to a custom header because it is standard, easy to handle in curl, and matches existing internal-route conventions.

## Why `multipart/form-data`

The current GitHub workflow uploads raw `.json` and `.jsonl` files discovered after a marker file. A multipart request keeps file bytes raw instead of base64-encoding them into JSON, which avoids a 33% payload expansion and is simpler to stream and size-limit safely.

## Request contract

The request contains:

- One `manifest` part with `Content-Type: application/json`
- One file part per uploaded session log

### Multipart parts

- `manifest`
- `file_0`
- `file_1`
- `file_2`
- ...

Each file entry in the manifest references its matching multipart part by name.

## Manifest schema

```json
{
  "schema_version": 1,
  "source": "github_actions",
  "upload_id": "01JQ7X9P6X9J9JQ7YJ8Y2C3D4E",
  "uploaded_at": "2026-03-13T02:14:55Z",
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
    "root_paths": [
      "codex-home"
    ]
  },
  "limits": {
    "max_files": 50,
    "max_total_bytes": 52428800
  },
  "files": [
    {
      "part_name": "file_0",
      "root_label": "codex-home",
      "relative_path": "sessions/session-2026-03-13T02-14-20.jsonl",
      "filename": "session-2026-03-13T02-14-20.jsonl",
      "content_type": "application/x-ndjson",
      "size_bytes": 182044,
      "sha256_hex": "0d4f8eb0f6a77d7df78e7f3390054f1b1ac8f5a1d02c0f6cae0e63b9098f4d4b"
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
  - Caller-generated unique id for request-level idempotency. ULID or UUIDv7 preferred.
- `uploaded_at`
  - RFC 3339 UTC timestamp for when the workflow assembled the upload.
- `agent_kind`
  - Enum: `codex` or `claude`.
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
  - Must match an actual multipart file part.
- `root_label`
  - The logical source root from the workflow, for example `codex-home` or `claude-home-projects`.
- `relative_path`
  - Path relative to that root. Must not be absolute and must not contain `..`.
- `filename`
  - Basename for display only.
- `content_type`
  - Expected file MIME type. Allowed:
    - `application/json`
    - `application/x-ndjson`
- `size_bytes`
  - Exact byte size expected for the file part.
- `sha256_hex`
  - Lowercase hex digest of the raw uploaded file bytes.

## Validation requirements

The service should fail closed and reject the request if any of the following is true:

- Missing or invalid bearer token
- Missing `manifest` part
- Invalid JSON manifest
- `schema_version` unsupported
- `files` is empty
- A manifest file entry references a missing multipart part
- An extra multipart file part is present that is not declared in the manifest
- `relative_path` is absolute or contains traversal segments
- Actual file byte count differs from `size_bytes`
- Computed SHA-256 differs from `sha256_hex`
- Content type is not allowed
- Request exceeds limits based on bytes actually read

## Auth requirements

- Secret name in GitHub: `KEPPO_SESSION_LOG_UPLOAD_TOKEN`
- Header format: `Authorization: Bearer <token>`
- Compare bearer tokens with a constant-time comparison and a length guard.
- Do not log the raw token.
- Return `401` for missing auth and `403` for wrong token if you want operational distinction. If you prefer less information leakage, always return `401`.

## Size and rate limits

Recommended initial limits:

- Max files per request: `50`
- Max total file bytes per request: `50 MiB`
- Max single file size: `10 MiB`
- Max manifest size: `256 KiB`

These match the current GitHub upload script defaults closely enough to avoid immediate workflow churn.

The implementation must enforce limits on bytes actually read, not only on `Content-Length`.

## Idempotency and dedupe

There are two useful idempotency layers.

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

## Storage recommendations

Persist:

- The raw file bytes
- The validated manifest
- Normalized upload metadata for search/debugging

Recommended storage key shape:

```text
github-actions/{repository_full_name}/run-{run_id}/attempt-{run_attempt}/{job}/{agent_kind}/{root_label}/{sha256_hex}-{sanitized_filename}
```

Important:

- Derive the canonical storage key on the server.
- Keep logs private by default.
- If the service returns viewer URLs, those URLs should be signed, scoped, or otherwise access-controlled.

## Response contract

Return `201 Created` when at least one file is newly stored. Return `200 OK` when the upload is fully idempotent and every file was already stored from a previous identical request.

### Success response

```json
{
  "upload_id": "01JQ7X9P6X9J9JQ7YJ8Y2C3D4E",
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
    "total_bytes": 293812
  },
  "files": [
    {
      "part_name": "file_0",
      "relative_path": "projects/.../session-2026-03-13T02-14-20.jsonl",
      "sha256_hex": "0d4f8eb0f6a77d7df78e7f3390054f1b1ac8f5a1d02c0f6cae0e63b9098f4d4b",
      "status": "stored",
      "artifact_id": "asl_01JQ7XAV1S7P2E8HVG2G3M4T9R",
      "storage_key": "github-actions/keppoai/keppo/run-1234567890/attempt-2/issue-agent/codex/codex-home/0d4f8eb0...-session-2026-03-13T02-14-20.jsonl",
      "viewer_url": "https://agent-logs.keppo.ai/artifacts/asl_01JQ7XAV1S7P2E8HVG2G3M4T9R"
    }
  ]
}
```

`viewer_url` is required for every file with `status: "stored"` or `status: "duplicate"`. The GitHub workflow should treat a missing `viewer_url` as an upload failure because the job summary depends on an immediately usable link.

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
- `forbidden`
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

- Discover new `.json` and `.jsonl` files after the marker file, as it does today.
- Keep the existing caps of `50` files and `50 MiB` total.
- Build one multipart request per workflow run instead of one PUT per file.
- Generate `upload_id` once per request.
- Compute `sha256_hex` and `size_bytes` for every file before sending.
- Emit the returned `viewer_url` into the GitHub step summary and use `artifact_id` or `storage_key` only as supporting metadata.

## Suggested workflow env changes

Replace the current Vercel Blob secret dependency with:

- `KEPPO_SESSION_LOG_UPLOAD_URL`
  - Example: `https://agent-logs.keppo.ai/upload`
- `KEPPO_SESSION_LOG_UPLOAD_TOKEN`
  - Shared secret used in the `Authorization` header

The uploader should skip gracefully when either value is missing, just as it skips today when the Blob token is absent.

## Implementation notes for the new service

- Treat this route as an internal machine endpoint, not a public browsing surface.
- Set standard hardening headers on responses.
- Keep request and validation logs short and redacted.
- Store enough normalized metadata to answer:
  - Which run uploaded this file?
  - Which agent produced it?
  - Which issue or PR did it relate to?
  - Was this a duplicate retry?
- Consider a retention policy from day one. `30` to `90` days is a reasonable starting point for debugging artifacts.

## Minimal implementation checklist

1. Verify bearer auth using `KEPPO_SESSION_LOG_UPLOAD_TOKEN`.
2. Parse multipart safely with streaming size limits.
3. Parse and validate the manifest.
4. Recompute `size_bytes` and `sha256_hex` for each file part.
5. Enforce request-level idempotency on `upload_id`.
6. Persist file bytes plus normalized metadata.
7. Return per-file statuses and stable artifact identifiers.
8. Add targeted tests for auth failure, size limits, path traversal rejection, manifest/file mismatch, SHA mismatch, and idempotent retry behavior.

## Open choices

These are the only material implementation choices left open by this handoff:

- Which backing store to use for raw bytes and metadata.
- Whether wrong-token auth failures should return `401` or `403`.

Everything else above should be treated as the contract.
